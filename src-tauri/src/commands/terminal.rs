use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::pty::PtyManager;

/// Managed state holding the PTY session manager.
pub struct AppState {
    pub pty: Arc<PtyManager>,
}

/// Create a new PTY session for a terminal pane.
///
/// If a session already exists for the given `pane_id` it is destroyed
/// before the new one is spawned.
///
/// PTY output is forwarded to the frontend via the `vibe99:terminal-data` event:
/// ```json
/// { "paneId": "...", "data": "<utf8>" }
/// ```
///
/// When the child process exits, a `vibe99:terminal-exit` event is emitted:
/// ```json
/// { "paneId": "...", "exitCode": 0 }
/// ```
#[tauri::command]
pub fn terminal_create(
    app: AppHandle,
    state: State<'_, AppState>,
    pane_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
    shell_profile_id: Option<String>,
) -> Result<(), String> {
    state.pty
        .spawn(app, &pane_id, cols, rows, cwd.as_deref(), shell_profile_id.as_deref())
}

/// Write raw bytes to the PTY for the given pane.
///
/// `data` is expected to be a base64-encoded string of the bytes to write.
#[tauri::command]
pub fn terminal_write(
    state: State<'_, AppState>,
    pane_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = base64_decode(&data).map_err(|e| format!("invalid base64 data: {e}"))?;
    state.pty.write(&pane_id, &bytes)
}

/// Resize the PTY for the given pane.
#[tauri::command]
pub fn terminal_resize(
    state: State<'_, AppState>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.pty.resize(&pane_id, cols, rows)
}

/// Destroy the PTY session for the given pane.
#[tauri::command]
pub fn terminal_destroy(state: State<'_, AppState>, pane_id: String) {
    state.pty.destroy(&pane_id);
}

/// Destroy all active PTY sessions.
///
/// Called during application shutdown to ensure child processes are cleaned up.
pub fn destroy_all_terminals(state: &AppState) {
    state.pty.destroy_all();
}

/// Return the current working directory as a string.
///
/// Used by the frontend to derive the default tab title (directory basename).
#[tauri::command]
pub fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.display().to_string())
        .map_err(|e| format!("failed to get cwd: {e}"))
}

// ----------------------------------------------------------------
// Base64 helpers
// ----------------------------------------------------------------

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("{e}"))
}
