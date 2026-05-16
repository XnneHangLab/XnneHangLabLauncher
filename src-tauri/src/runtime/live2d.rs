use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::State;

use super::state::RuntimeState;

/// Preset as exchanged with the frontend.
/// `model_path` is always an absolute path on the user's machine.
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

/// Preset as stored on disk.
/// `model_path_relative` is forward-slash, relative to `state.repo_root`, so the
/// presets file is portable across machines.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Live2DPresetStored {
    pub name: String,
    pub model_path_relative: String,
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

fn absolute_from_relative(repo_root: &Path, relative: &str) -> String {
    repo_root.join(relative).to_string_lossy().into_owned()
}

fn relative_from_absolute(repo_root: &Path, absolute: &str) -> Result<String, String> {
    let abs_path = Path::new(absolute);
    let rel = abs_path.strip_prefix(repo_root).map_err(|_| {
        format!(
            "预设模型路径必须位于仓库目录内（repo_root={}）: {}",
            repo_root.display(),
            absolute,
        )
    })?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn read_live2d_presets(state: State<'_, RuntimeState>) -> Result<Vec<Live2DPreset>, String> {
    let path = presets_path(&state);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("读取 Live2D 预设失败: {e}"))?;
    let stored: Vec<Live2DPresetStored> =
        serde_json::from_str(&contents).map_err(|e| format!("解析 Live2D 预设失败: {e}"))?;
    Ok(stored
        .into_iter()
        .map(|p| Live2DPreset {
            name: p.name,
            model_path: absolute_from_relative(&state.repo_root, &p.model_path_relative),
            clip_keys: p.clip_keys,
            extra: p.extra,
        })
        .collect())
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
    let stored: Vec<Live2DPresetStored> = presets
        .into_iter()
        .map(|p| {
            let rel = relative_from_absolute(&state.repo_root, &p.model_path)?;
            Ok(Live2DPresetStored {
                name: p.name,
                model_path_relative: rel,
                clip_keys: p.clip_keys,
                extra: p.extra,
            })
        })
        .collect::<Result<_, String>>()?;
    let contents =
        serde_json::to_string_pretty(&stored).map_err(|e| format!("序列化预设失败: {e}"))?;
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

/// Open a save-file dialog and return the chosen path, or None if cancelled.
#[tauri::command]
pub async fn pick_save_file(title: String, default_name: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             $d = New-Object System.Windows.Forms.SaveFileDialog; \
             $d.Title = '{title}'; \
             $d.FileName = '{default_name}'; \
             $d.Filter = 'Live2D 动作文件 (*.motion3.json)|*.motion3.json|所有文件 (*.*)|*.*'; \
             if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) \
             {{ [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $d.FileName }}"
        );
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .map_err(|e| format!("无法启动保存对话框: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(if stdout.is_empty() { None } else { Some(stdout) });
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "set f to choose file name with prompt \"{title}\" default name \"{default_name}\"; \
             POSIX path of f"
        );
        let output = std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| format!("无法启动保存对话框: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim_end_matches('\n').to_string();
        return Ok(if stdout.is_empty() { None } else { Some(stdout) });
    }

    #[cfg(target_os = "linux")]
    {
        for (program, args) in [
            ("zenity", vec!["--file-selection", "--save", "--confirm-overwrite",
                &format!("--title={title}"), &format!("--filename={default_name}")]),
            ("kdialog", vec!["--getsavefilename", ".", &format!("--title={title}")]),
        ] {
            let Ok(output) = std::process::Command::new(program).args(&args).output() else { continue };
            if !output.status.success() { continue; }
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !stdout.is_empty() {
                return Ok(Some(stdout));
            }
        }
        return Err("未找到可用的保存对话框（需要 zenity 或 kdialog）".to_string());
    }
}

/// Write a string to a file (UTF-8).
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("写入文件失败: {e}"))
}
