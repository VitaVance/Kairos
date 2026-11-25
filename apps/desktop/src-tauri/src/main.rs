// Hide the console window in release builds.
//
// This attribute MUST live in the *binary* crate root. Tauri's template has it
// in `lib.rs`, but `lib.rs` is a library crate — its crate-level attributes
// describe the rlib/cdylib, not the PE header of `todolist.exe`. Without it here
// the linker emits a CONSOLE-subsystem binary, so Windows attaches a console
// window and closing that window sends CTRL_CLOSE_EVENT, killing the app.
//
// The PE header byte this produces (subsystem field at offset 0x44 of the
// optional header: 2 = GUI, 3 = CONSOLE) is checkable after a build with
// `node scripts/pe-subsystem.mjs <path-to-exe>`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    todolist_desktop_lib::run()
}
