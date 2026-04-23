#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use vibe99_lib::commands::context_menu;
use vibe99_lib::commands::settings;
use std::sync::Arc;
use tauri::Manager;
use vibe99_lib::commands::terminal::{self, AppState};
use vibe99_lib::pty::PtyManager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            pty: Arc::new(PtyManager::new()),
        })
        .invoke_handler(tauri::generate_handler![
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_destroy,
            terminal::get_cwd,
            settings::settings_load,
            settings::settings_save,
            context_menu::show_context_menu,
            context_menu::emit_menu_action,
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<AppState>();
                terminal::destroy_all_terminals(&state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
