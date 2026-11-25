// Intentionally does nothing. Exits 0.
//
// Used as `tauriScript` for `tauri-apps/tauri-action` on the release path.
// tauri-action always runs a build before it publishes, and it has no input to
// skip that step. By the time it runs, this workflow has already built the
// app and (when SignPath signing is enabled) replaced the installers with
// Authenticode-signed copies and regenerated their updater `.sig` files.
// A no-op keeps those artifacts untouched so the action uploads exactly what
// is on disk. Arguments passed by the action are ignored on purpose.
process.exit(0);
