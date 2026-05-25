use serde::{Deserialize, Serialize};
use tauri::State;

use super::state::RuntimeState;

/// A single audio clip within an emotion.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceClip {
    /// Filename (e.g., "1.wav").
    pub file_name: String,
    /// Absolute path for audio preview via convertFileSrc.
    pub abs_path: String,
}

/// A single emotion entry as exposed to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceEmotion {
    /// Directory name / original key (immutable).
    pub name: String,
    /// Display label used in [tts:label] tags. Defaults to name.
    pub label: String,
    /// Scene description injected into format prompt.
    pub description: String,
    /// Audio clips available for preview.
    #[serde(default)]
    pub clips: Vec<VoiceClip>,
}

/// Voice config data returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConfigResponse {
    pub voice_id: String,
    pub asset_bundle: String,
    pub default_emotion: String,
    /// Absolute path of the voice asset directory (for display).
    pub asset_dir: String,
    pub emotions: Vec<VoiceEmotion>,
}

// ── PLACEHOLDER_NEXT ──

fn voice_config_path(state: &RuntimeState, voice_id: &str) -> std::path::PathBuf {
    state.repo_root.join("config").join("voices").join(format!("{voice_id}.toml"))
}

fn voices_asset_dir(state: &RuntimeState, asset_bundle: &str) -> std::path::PathBuf {
    state.repo_root.join("voices").join(asset_bundle)
}

#[tauri::command]
pub fn read_voice_config(
    state: State<'_, RuntimeState>,
    voice_id: String,
) -> Result<VoiceConfigResponse, String> {
    let path = voice_config_path(&state, &voice_id);
    if !path.exists() {
        return Err(format!("Voice config not found: {}", path.display()));
    }

    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("读取 voice config 失败: {e}"))?;
    let payload: toml::Value =
        toml::from_str(&contents).map_err(|e| format!("解析 voice config 失败: {e}"))?;

    let voice_section = payload.get("voice").and_then(|v| v.as_table());
    let asset_bundle = voice_section
        .and_then(|v| v.get("asset_bundle"))
        .and_then(|v| v.as_str())
        .unwrap_or(&voice_id)
        .to_string();
    let default_emotion = voice_section
        .and_then(|v| v.get("default_emotion"))
        .and_then(|v| v.as_str())
        .unwrap_or("default")
        .to_string();

    let mut emotions: Vec<VoiceEmotion> = Vec::new();
    let asset_dir = voices_asset_dir(&state, &asset_bundle);
    if let Some(emotions_table) = payload.get("emotions").and_then(|v| v.as_table()) {
        for (key, value) in emotions_table {
            let table = value.as_table();
            let label = table
                .and_then(|t| t.get("label"))
                .and_then(|v| v.as_str())
                .unwrap_or(key)
                .to_string();
            let description = table
                .and_then(|t| t.get("description"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // Scan audio files in the emotion directory
            let emotion_dir = asset_dir.join(key);
            let clips = if emotion_dir.is_dir() {
                let mut found: Vec<VoiceClip> = Vec::new();
                if let Ok(entries) = std::fs::read_dir(&emotion_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                                if matches!(ext.to_lowercase().as_str(), "wav" | "mp3" | "ogg" | "m4a" | "opus") {
                                    let file_name = entry.file_name().to_string_lossy().to_string();
                                    let abs_path = path.to_string_lossy().to_string();
                                    found.push(VoiceClip { file_name, abs_path });
                                }
                            }
                        }
                    }
                }
                found.sort_by(|a, b| a.file_name.cmp(&b.file_name));
                found
            } else {
                Vec::new()
            };

            emotions.push(VoiceEmotion {
                name: key.clone(),
                label,
                description,
                clips,
            });
        }
    }

    Ok(VoiceConfigResponse {
        voice_id,
        asset_bundle,
        default_emotion,
        asset_dir: asset_dir.to_string_lossy().to_string(),
        emotions,
    })
}

#[tauri::command]
pub fn write_voice_emotions(
    state: State<'_, RuntimeState>,
    voice_id: String,
    emotions: Vec<VoiceEmotion>,
) -> Result<(), String> {
    let path = voice_config_path(&state, &voice_id);
    if !path.exists() {
        return Err(format!("Voice config not found: {}", path.display()));
    }

    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("读取 voice config 失败: {e}"))?;
    let mut doc: toml::Value =
        toml::from_str(&contents).map_err(|e| format!("解析 voice config 失败: {e}"))?;

    // Update label and description for each emotion, preserving clips and other fields
    if let Some(emotions_table) = doc.get_mut("emotions").and_then(|v| v.as_table_mut()) {
        for emotion in &emotions {
            if let Some(entry) = emotions_table.get_mut(&emotion.name) {
                if let Some(table) = entry.as_table_mut() {
                    // Set label (only if different from name)
                    if emotion.label != emotion.name {
                        table.insert(
                            "label".to_string(),
                            toml::Value::String(emotion.label.clone()),
                        );
                    } else {
                        table.remove("label");
                    }
                    // Set description
                    if emotion.description.is_empty() {
                        table.remove("description");
                    } else {
                        table.insert(
                            "description".to_string(),
                            toml::Value::String(emotion.description.clone()),
                        );
                    }
                }
            }
        }
    }

    let output = toml::to_string_pretty(&doc).map_err(|e| format!("序列化 voice config 失败: {e}"))?;
    std::fs::write(&path, output).map_err(|e| format!("写入 voice config 失败: {e}"))
}

#[tauri::command]
pub fn scan_voice_emotions(
    state: State<'_, RuntimeState>,
    voice_id: String,
) -> Result<Vec<String>, String> {
    // First read the config to get asset_bundle
    let path = voice_config_path(&state, &voice_id);
    let asset_bundle = if path.exists() {
        let contents =
            std::fs::read_to_string(&path).map_err(|e| format!("读取 voice config 失败: {e}"))?;
        let payload: toml::Value =
            toml::from_str(&contents).map_err(|e| format!("解析 voice config 失败: {e}"))?;
        payload
            .get("voice")
            .and_then(|v| v.as_table())
            .and_then(|v| v.get("asset_bundle"))
            .and_then(|v| v.as_str())
            .unwrap_or(&voice_id)
            .to_string()
    } else {
        voice_id.clone()
    };

    let dir = voices_asset_dir(&state, &asset_bundle);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut names: Vec<String> = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("扫描 voice 目录失败: {e}"))?;
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}
