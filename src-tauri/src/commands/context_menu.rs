use serde::Deserialize;
use tauri::{AppHandle, Emitter};

/// Payload sent by the frontend when requesting a context menu.
///
/// Mirrors the Electron `vibe99:show-context-menu` IPC payload.
#[derive(Deserialize)]
pub struct ShowContextMenuPayload {
    pub kind: String,
    #[serde(rename = "paneId")]
    pub pane_id: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    #[serde(rename = "hasSelection")]
    pub has_selection: Option<bool>,
    #[serde(rename = "hasClipboardText")]
    pub has_clipboard_text: Option<bool>,
    #[serde(rename = "hasClipboardImage")]
    pub has_clipboard_image: Option<bool>,
    #[serde(rename = "canClose")]
    pub can_close: Option<bool>,
}

/// Event payload emitted to the frontend when a menu action is triggered.
///
/// Matches the existing Electron `vibe99:menu-action` contract:
/// ```json
/// { "action": "terminal-copy", "paneId": "pane-1" }
/// ```
#[derive(Clone, serde::Serialize)]
pub struct MenuActionPayload {
    pub action: String,
    #[serde(rename = "paneId", skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
}

/// Show a context menu for the given pane.
///
/// In Tauri v2 there is no native popup-menu API at arbitrary coordinates, so
/// this command validates the request and emits a `context-menu-show` event
/// back to the frontend. The frontend then renders a custom HTML context menu.
///
/// When the user picks an item, the frontend calls [`emit_menu_action`] (or
/// handles selection entirely on the frontend side) and the result is
/// forwarded as a `menu-action` event with the `{ action, paneId }` contract.
#[tauri::command]
pub fn show_context_menu(
    app: AppHandle,
    payload: ShowContextMenuPayload,
) -> Result<(), String> {
    if payload.kind != "terminal" && payload.kind != "tab" {
        return Err(format!("unknown context menu kind: {}", payload.kind));
    }

    let _ = app.emit(
        "context-menu-show",
        serde_json::json!({
            "kind": payload.kind,
            "paneId": payload.pane_id,
            "x": payload.x,
            "y": payload.y,
            "hasSelection": payload.has_selection,
            "hasClipboardText": payload.has_clipboard_text,
            "hasClipboardImage": payload.has_clipboard_image,
            "canClose": payload.can_close,
        }),
    );

    Ok(())
}

/// Emit a `menu-action` event to the frontend.
///
/// Called by the frontend (or other Tauri commands) when the user selects a
/// context-menu item. The payload matches the Electron contract:
/// ```json
/// { "action": "terminal-copy", "paneId": "pane-1" }
/// ```
#[tauri::command]
pub fn emit_menu_action(
    app: AppHandle,
    action: String,
    pane_id: Option<String>,
) -> Result<(), String> {
    let _ = app.emit(
        "menu-action",
        MenuActionPayload {
            action,
            pane_id: pane_id,
        },
    );
    Ok(())
}
