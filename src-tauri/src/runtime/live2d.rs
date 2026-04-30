use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::State;

use super::state::RuntimeState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Live2DPreset {
    pub name: String,
    pub model_path: String,
    #[serde(default)]
    pub clip_keys: Option<Vec<String>>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Live2DModelData {
    pub model_json: serde_json::Value,
    pub files: HashMap<String, String>,
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

fn read_file_as_base64(path: &std::path::Path) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| format!("读取文件失败 {}: {e}", path.display()))?;
    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data))
}

fn to_model_relative_path(model_dir: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(model_dir)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

fn collect_loose_exp3_files(dir: &Path, model_dir: &Path, files: &mut HashMap<String, String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_loose_exp3_files(&path, model_dir, files);
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.ends_with(".exp3.json") {
            continue;
        }
        let Some(relative) = to_model_relative_path(model_dir, &path) else {
            continue;
        };
        if files.contains_key(&relative) {
            continue;
        }
        if let Ok(data) = read_file_as_base64(&path) {
            files.insert(relative, data);
        }
    }
}

/// Collects sub-resource paths from a model3.json FileReferences.
fn collect_file_refs(root: &serde_json::Value, model_dir: &std::path::Path, files: &mut HashMap<String, String>) {
    let fr = &root["FileReferences"];

    // Moc
    if let Some(moc) = fr["Moc"].as_str() {
        let path = model_dir.join(moc);
        if let Ok(data) = read_file_as_base64(&path) {
            files.insert(moc.to_string(), data);
        }
    }

    // Textures
    if let Some(texs) = fr["Textures"].as_array() {
        for tex in texs {
            if let Some(tex_path) = tex.as_str() {
                let path = model_dir.join(tex_path);
                if let Ok(data) = read_file_as_base64(&path) {
                    files.insert(tex_path.to_string(), data);
                }
            }
        }
    }

    // Motions
    if let Some(motions) = fr["Motions"].as_object() {
        for (_group, arr) in motions {
            if let Some(arr) = arr.as_array() {
                for entry in arr {
                    if let Some(file) = entry["File"].as_str() {
                        let path = model_dir.join(file);
                        if let Ok(data) = read_file_as_base64(&path) {
                            files.insert(file.to_string(), data);
                        }
                    }
                }
            }
        }
    }

    // Expressions
    if let Some(exps) = fr["Expressions"].as_array() {
        for exp in exps {
            if let Some(file) = exp["File"].as_str() {
                let path = model_dir.join(file);
                if let Ok(data) = read_file_as_base64(&path) {
                    files.insert(file.to_string(), data);
                }
            }
        }
    }

    // Pose
    if let Some(pose) = fr["Pose"].as_str() {
        let path = model_dir.join(pose);
        if let Ok(data) = read_file_as_base64(&path) {
            files.insert(pose.to_string(), data);
        }
    }

    // Physics
    if let Some(physics) = fr["Physics"].as_str() {
        let path = model_dir.join(physics);
        if let Ok(data) = read_file_as_base64(&path) {
            files.insert(physics.to_string(), data);
        }
    }

    // User data (optional)
    if let Some(ud) = fr["UserData"].as_str() {
        let path = model_dir.join(ud);
        if let Ok(data) = read_file_as_base64(&path) {
            files.insert(ud.to_string(), data);
        }
    }

    // Display info (optional) — CDI
    if let Some(cdi) = fr["DisplayInfo"].as_str() {
        let path = model_dir.join(cdi);
        if let Ok(data) = read_file_as_base64(&path) {
            files.insert(cdi.to_string(), data);
        }
    }
}

#[tauri::command]
pub async fn read_live2d_model_data(model3_path: String) -> Result<Live2DModelData, String> {
    // ... same as before ...
    let path = std::path::PathBuf::from(&model3_path);
    let model_dir = path.parent().ok_or_else(|| "无法获取模型目录".to_string())?;

    // Read and parse model3.json
    let json_text = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取模型文件失败: {e}"))?;
    let model_json: serde_json::Value = serde_json::from_str(&json_text)
        .map_err(|e| format!("解析模型文件失败: {e}"))?;

    let mut files = HashMap::new();
    collect_file_refs(&model_json, model_dir, &mut files);
    collect_loose_exp3_files(model_dir, model_dir, &mut files);

    Ok(Live2DModelData { model_json, files })
}

/// Read any file and return its content as a base64 string.
#[tauri::command]
pub async fn read_file_base64(path: String) -> Result<String, String> {
    read_file_as_base64(std::path::Path::new(&path))
}

/// Save a motion3.json file to disk.
/// The file path is derived from model3_path, group, and index
/// by reading the model3.json's Motion references.
#[tauri::command]
pub async fn write_live2d_motion(
    model3_path: String,
    group: String,
    index: u32,
    motion_json: serde_json::Value,
) -> Result<(), String> {
    // Read model3.json to find the motion file path
    let path = std::path::PathBuf::from(&model3_path);
    let model_dir = path.parent().ok_or_else(|| "无法获取模型目录".to_string())?;

    let json_text = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取模型文件失败: {e}"))?;
    let model_json: serde_json::Value = serde_json::from_str(&json_text)
        .map_err(|e| format!("解析模型文件失败: {e}"))?;

    // Find the motion file path
    let motions = model_json["FileReferences"]["Motions"].as_object()
        .ok_or_else(|| "模型中未找到动作定义".to_string())?;
    let group_arr = motions.get(&group)
        .and_then(|v| v.as_array())
        .ok_or_else(|| format!("未找到动作组: {group}"))?;
    let entry = group_arr.get(index as usize)
        .ok_or_else(|| format!("未找到动作 #{index} 在组 {group} 中"))?;
    let motion_file = entry["File"].as_str()
        .ok_or_else(|| "动作文件路径为空".to_string())?;

    let write_path = model_dir.join(motion_file);
    let content = serde_json::to_string_pretty(&motion_json)
        .map_err(|e| format!("序列化动作数据失败: {e}"))?;
    std::fs::write(&write_path, &content)
        .map_err(|e| format!("写入动作文件失败: {e}"))?;

    Ok(())
}
