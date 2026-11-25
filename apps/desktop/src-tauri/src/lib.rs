// NOTE: `#![windows_subsystem = "windows"]` deliberately does NOT live here.
// This is a *library* crate; crate-level attributes on it do not reach the PE
// header of `todolist.exe`. It lives in `src/main.rs`, the real binary root —
// putting it only here is what shipped a CONSOLE-subsystem exe whose window
// closing killed the whole app.

mod update;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

/// Set right before we ask the runtime to exit. Without it the window-close
/// handler below would `prevent_close()` the shutdown Tauri performs for us and
/// 「退出」 would only hide the window — the classic "app won't die" trap.
struct Exiting(AtomicBool);

/// Language tag the tray menu should render in, e.g. `"en"` or `"zh-CN"`.
///
/// The tray lives in Rust and has no access to the webview's i18next instance,
/// so the frontend pushes its current language here and we rebuild the menu.
/// Defaults to `"en"` to match the app's `fallbackLng`.
struct TrayLanguage(Mutex<String>);

/// Tray menu copy. Deliberately tiny — two items and a tooltip — so it stays
/// honest rather than turning into a second translation surface that drifts.
fn tray_labels(language: &str) -> (&'static str, &'static str) {
    if language.starts_with("zh") {
        ("显示 Kairos", "退出")
    } else {
        ("Show Kairos", "Quit")
    }
}

/// Rebuild the tray menu in `language`.
fn apply_tray_language(app: &AppHandle, language: &str) -> tauri::Result<()> {
    let (show_label, quit_label) = tray_labels(language);
    let show_item = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

/// Called by the frontend whenever the user changes language, so the tray menu
/// and the UI never disagree about which language the app is in.
#[tauri::command]
fn set_tray_language(app: AppHandle, language: String) -> Result<(), String> {
    *app.state::<TrayLanguage>().0.lock().unwrap() = language.clone();
    apply_tray_language(&app, &language).map_err(|e| e.to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // Restore from a minimized taskbar state before showing, otherwise
        // `show()` on an iconic window leaves it minimized.
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Thin host shell. All business logic lives in the TypeScript core package;
/// Rust here only hosts the webview, the local SQLite plugin, local OS
/// notifications, and the signed update channel.
///
/// Network reachability is limited to the update path: `tauri-plugin-updater`
/// performs a GET for `latest.json` and verifies the artifact signature, and
/// `tauri-plugin-opener` hands an `https://` release page to the system browser.
/// **No business data ever leaves the machine** — there is no sync, no account
/// and no telemetry, which is what 「纯本地」 means here.
///
/// `read_update_manifest` is the offline fallback: a plain local file read.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(Exiting(AtomicBool::new(false)))
        .manage(TrayLanguage(Mutex::new("en".to_string())))
        .invoke_handler(tauri::generate_handler![
            update::read_update_manifest,
            set_tray_language
        ])
        .setup(|app| {
            // Closes hide the window: reminders are scheduled from the webview,
            // so exiting here would silently drop every pending reminder.
            let (show_label, quit_label) = tray_labels("en");
            let show_item = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(Image::from_bytes(include_bytes!("../icons/32x32.png"))?)
                .tooltip("Kairos")
                .menu(&menu)
                // Left click must summon the window, not the menu. Windows
                // defaults this to true, which would make the icon feel like a
                // menu button; the menu stays on right click instead.
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => {
                        app.state::<Exiting>().0.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    // Ignore the button-up half so a single physical click does
                    // not show and re-focus the window twice.
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                    | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => show_main_window(tray.app_handle()),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // An explicit quit must not be swallowed; everything else — the
                // title-bar X, Alt+F4, `CloseMainWindow()` — just hides.
                if !window.state::<Exiting>().0.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
