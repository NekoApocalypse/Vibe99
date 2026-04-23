use super::settings::{sanitize_config, settings_path, ShellProfile};
use serde_json::Value;
use tauri::AppHandle;

/// Result type for commands that return the full shell block.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellConfig {
    profiles: Vec<ShellProfile>,
    default_profile: String,
}

/// Read the raw settings file, apply full sanitization, and extract
/// the shell block. Returns a default (empty) shell config if the
/// file does not exist or cannot be parsed.
fn read_shell_config(app: &AppHandle) -> Result<(Value, ShellConfig), String> {
    let path = settings_path(app)?;

    let raw = if path.exists() {
        let contents =
            std::fs::read_to_string(&path).map_err(|e| format!("failed to read settings: {e}"))?;
        serde_json::from_str(&contents).unwrap_or(Value::Null)
    } else {
        Value::Null
    };

    let sanitized = sanitize_config(&raw);
    let profiles = extract_profiles(&sanitized);
    let default_profile = extract_default_profile(&sanitized);

    Ok((
        sanitized,
        ShellConfig { profiles, default_profile },
    ))
}

/// Persist the full sanitized config (with the shell block replaced)
/// back to disk.
fn write_config(app: &AppHandle, config: &Value) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create settings directory: {e}"))?;
    }
    let serialized = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize settings: {e}"))?;
    std::fs::write(&path, serialized).map_err(|e| format!("failed to write settings: {e}"))
}

fn extract_profiles(config: &Value) -> Vec<ShellProfile> {
    config
        .get("shell")
        .and_then(|s| s.get("profiles"))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

fn extract_default_profile(config: &Value) -> String {
    config
        .get("shell")
        .and_then(|s| s.get("defaultProfile"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

// ----------------------------------------------------------------
// Tauri commands
// ----------------------------------------------------------------

/// List all shell profiles and the current default profile id.
#[tauri::command]
pub fn shell_profiles_list(app: AppHandle) -> Result<ShellConfig, String> {
    let (_, shell_config) = read_shell_config(&app)?;
    Ok(shell_config)
}

/// Set the default shell profile by `profile_id`.
///
/// Returns an error if no profile with the given id exists.
#[tauri::command]
pub fn shell_profile_set(app: AppHandle, profile_id: String) -> Result<ShellConfig, String> {
    let (mut config, mut shell_config) = read_shell_config(&app)?;

    if !shell_config.profiles.iter().any(|p| p.id == profile_id) {
        return Err(format!("profile not found: {profile_id}"));
    }

    shell_config.default_profile = profile_id;

    // Patch the shell block in the config and re-sanitize for consistency.
    if let Some(obj) = config.as_object_mut() {
        obj.insert(
            "shell".to_string(),
            serde_json::json!({
                "profiles": shell_config.profiles,
                "defaultProfile": shell_config.default_profile,
            }),
        );
    }

    let sanitized = sanitize_config(&config);
    write_config(&app, &sanitized)?;

    Ok(ShellConfig {
        profiles: extract_profiles(&sanitized),
        default_profile: extract_default_profile(&sanitized),
    })
}

/// Add a new shell profile. If a profile with the same `id` already
/// exists it is replaced.
///
/// The `name` field is optional (defaults to `id` if absent). The `args`
/// field is optional (defaults to `[]`).
#[tauri::command]
pub fn shell_profile_add(
    app: AppHandle,
    profile: Value,
) -> Result<ShellConfig, String> {
    let (mut config, mut shell_config) = read_shell_config(&app)?;

    let new_profile =
        ShellProfile::sanitize(&profile).ok_or("invalid profile: 'id' and 'command' are required")?;

    // Upsert: replace existing profile with the same id, or append.
    if let Some(existing) = shell_config.profiles.iter_mut().find(|p| p.id == new_profile.id) {
        *existing = new_profile;
    } else {
        shell_config.profiles.push(new_profile);
    }

    // If no default is set yet, point to the first profile.
    if shell_config.default_profile.is_empty() {
        shell_config.default_profile = shell_config.profiles[0].id.clone();
    }

    if let Some(obj) = config.as_object_mut() {
        obj.insert(
            "shell".to_string(),
            serde_json::json!({
                "profiles": shell_config.profiles,
                "defaultProfile": shell_config.default_profile,
            }),
        );
    }

    let sanitized = sanitize_config(&config);
    write_config(&app, &sanitized)?;

    Ok(ShellConfig {
        profiles: extract_profiles(&sanitized),
        default_profile: extract_default_profile(&sanitized),
    })
}

/// Remove a shell profile by `profile_id`.
///
/// If the removed profile was the default, the default is cleared
/// (set to the first remaining profile's id, or empty string).
#[tauri::command]
pub fn shell_profile_remove(app: AppHandle, profile_id: String) -> Result<ShellConfig, String> {
    let (mut config, mut shell_config) = read_shell_config(&app)?;

    let before_len = shell_config.profiles.len();
    shell_config.profiles.retain(|p| p.id != profile_id);

    if shell_config.profiles.len() == before_len {
        return Err(format!("profile not found: {profile_id}"));
    }

    // Re-point default if the removed profile was selected.
    if shell_config.default_profile == profile_id {
        shell_config.default_profile = shell_config
            .profiles
            .first()
            .map(|p| p.id.clone())
            .unwrap_or_default();
    }

    if let Some(obj) = config.as_object_mut() {
        obj.insert(
            "shell".to_string(),
            serde_json::json!({
                "profiles": shell_config.profiles,
                "defaultProfile": shell_config.default_profile,
            }),
        );
    }

    let sanitized = sanitize_config(&config);
    write_config(&app, &sanitized)?;

    Ok(ShellConfig {
        profiles: extract_profiles(&sanitized),
        default_profile: extract_default_profile(&sanitized),
    })
}
