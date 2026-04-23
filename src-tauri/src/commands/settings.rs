use serde_json::Value;
use tauri::{AppHandle, Manager};

const CURRENT_CONFIG_VERSION: u8 = 1;

const DEFAULT_FONT_SIZE: u32 = 13;
const DEFAULT_PANE_OPACITY: f64 = 0.8;
const DEFAULT_PANE_WIDTH: u32 = 720;

/// Resolve the path to `settings.json` inside the app data directory.
fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))
        .map(|p: std::path::PathBuf| p.join("settings.json"))
}

/// Clamp a UI field from an arbitrary JSON value, falling back to `default`.
fn get_number(v: &Value, key: &str, default: f64) -> f64 {
    v.get(key)
        .and_then(|n| n.as_f64())
        .filter(|n| n.is_finite())
        .unwrap_or(default)
}

/// Sanitize the `ui` block of a config, clamping all values to valid ranges.
fn sanitize_ui_config(ui: Option<&Value>) -> Value {
    let ui = ui.unwrap_or(&Value::Null);

    let font_size = get_number(ui, "fontSize", DEFAULT_FONT_SIZE as f64);
    let font_size = font_size.round().clamp(10.0, 24.0) as u32;

    let pane_opacity = get_number(ui, "paneOpacity", DEFAULT_PANE_OPACITY);
    let pane_opacity = ((pane_opacity * 100.0).round() / 100.0).clamp(0.55, 1.0);

    let pane_width = get_number(ui, "paneWidth", DEFAULT_PANE_WIDTH as f64);
    let pane_width = ((pane_width / 10.0).round() * 10.0).clamp(520.0, 1000.0) as u32;

    serde_json::json!({
        "fontSize": font_size,
        "paneOpacity": pane_opacity,
        "paneWidth": pane_width,
    })
}

/// Sanitize an arbitrary config value into the current schema.
///
/// Handles:
/// - Current versioned format (`{ version: 1, ui: { ... } }`)
/// - Legacy flat format (`{ fontSize, paneOpacity, paneWidth }` without version/ui)
/// - Null / invalid input → defaults
fn sanitize_config(candidate: &Value) -> Value {
    if let Some(obj) = candidate.as_object() {
        // Check for current versioned format
        if obj
            .get("version")
            .and_then(|v| v.as_u64())
            .is_some_and(|v| v == CURRENT_CONFIG_VERSION as u64)
        {
            return serde_json::json!({
                "version": CURRENT_CONFIG_VERSION,
                "ui": sanitize_ui_config(obj.get("ui")),
            });
        }

        // Legacy flat format: fields at top level, no version/ui nesting
        if obj.keys().any(|k| ["fontSize", "paneOpacity", "paneWidth"].contains(&k.as_str())) {
            return serde_json::json!({
                "version": CURRENT_CONFIG_VERSION,
                "ui": sanitize_ui_config(Some(candidate)),
            });
        }
    }

    // Null, non-object, or unrecognized format → defaults
    serde_json::json!({
        "version": CURRENT_CONFIG_VERSION,
        "ui": {
            "fontSize": DEFAULT_FONT_SIZE,
            "paneOpacity": DEFAULT_PANE_OPACITY,
            "paneWidth": DEFAULT_PANE_WIDTH,
        },
    })
}

/// Load the application settings from disk.
///
/// Returns the sanitized config. If the file does not exist or cannot be
/// parsed, the default config is returned instead.
#[tauri::command]
pub fn settings_load(app: AppHandle) -> Result<Value, String> {
    let path = settings_path(&app)?;

    if !path.exists() {
        return Ok(sanitize_config(&Value::Null));
    }

    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("failed to read settings: {e}"))?;

    let parsed: Value =
        serde_json::from_str(&contents).unwrap_or_else(|_| sanitize_config(&Value::Null));

    Ok(sanitize_config(&parsed))
}

/// Save application settings to disk.
///
/// The input is sanitized before writing, so the returned value is the
/// canonical representation that was persisted.
#[tauri::command]
pub fn settings_save(app: AppHandle, settings: Value) -> Result<Value, String> {
    let path = settings_path(&app)?;

    // Create parent directory if it doesn't exist
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create settings directory: {e}"))?;
    }

    let sanitized = sanitize_config(&settings);
    let serialized =
        serde_json::to_string_pretty(&sanitized).map_err(|e| format!("failed to serialize settings: {e}"))?;

    std::fs::write(&path, serialized).map_err(|e| format!("failed to write settings: {e}"))?;

    Ok(sanitized)
}
