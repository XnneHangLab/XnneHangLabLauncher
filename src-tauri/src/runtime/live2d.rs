use serde::{Deserialize, Serialize};
use tauri::State;

use super::state::RuntimeState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Live2DPreset {
    pub name: String,
    pub model_path: String,
}

fn presets_path(state: &RuntimeState) -> std::path::PathBuf {
    state.repo_root.join("config").join("live2d_presets.json")
}

#[tauri::command]
pub fn read_live2d_presets(state: State<'_, RuntimeState>) -> Result<Vec<Live2DPreset>, String> {
    let path = presets_path(&state);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("读取 Live2D 预设失败: {e}"))?;
    serde_json::from_str(&contents).map_err(|e| format!("解析 Live2D 预设失败: {e}"))
}

#[tauri::command]
pub fn write_live2d_presets(
    state: State<'_, RuntimeState>,
    presets: Vec<Live2DPreset>,
) -> Result<(), String> {
    let path = presets_path(&state);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let contents =
        serde_json::to_string_pretty(&presets).map_err(|e| format!("序列化预设失败: {e}"))?;
    std::fs::write(&path, contents).map_err(|e| format!("写入 Live2D 预设失败: {e}"))
}
