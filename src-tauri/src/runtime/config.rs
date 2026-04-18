use serde_json;
use tauri::State;

use super::state::RuntimeState;

fn json_to_toml(val: serde_json::Value) -> Result<toml::Value, String> {
    match val {
        serde_json::Value::Null => Ok(toml::Value::String(String::new())),
        serde_json::Value::Bool(b) => Ok(toml::Value::Boolean(b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(toml::Value::Integer(i))
            } else if let Some(f) = n.as_f64() {
                Ok(toml::Value::Float(f))
            } else {
                Err(format!("unsupported number: {n}"))
            }
        }
        serde_json::Value::String(s) => Ok(toml::Value::String(s)),
        serde_json::Value::Array(arr) => {
            let vals: Result<Vec<_>, _> = arr.into_iter().map(json_to_toml).collect();
            Ok(toml::Value::Array(vals?))
        }
        serde_json::Value::Object(map) => {
            let mut table = toml::map::Map::new();
            for (k, v) in map {
                table.insert(k, json_to_toml(v)?);
            }
            Ok(toml::Value::Table(table))
        }
    }
}

#[tauri::command]
pub fn read_lab_config(state: State<'_, RuntimeState>) -> Result<serde_json::Value, String> {
    let config_path = state.repo_root.join("config").join("lab.toml");
    let contents = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("读取配置失败: {e}"))?;
    let toml_val: toml::Value = contents
        .parse()
        .map_err(|e| format!("解析配置失败: {e}"))?;
    serde_json::to_value(&toml_val).map_err(|e| format!("转换配置失败: {e}"))
}

#[tauri::command]
pub fn write_lab_config(
    state: State<'_, RuntimeState>,
    config: serde_json::Value,
) -> Result<(), String> {
    let config_path = state.repo_root.join("config").join("lab.toml");
    let toml_val = json_to_toml(config)?;
    let toml_str = toml::to_string_pretty(&toml_val)
        .map_err(|e| format!("序列化配置失败: {e}"))?;
    std::fs::write(&config_path, toml_str).map_err(|e| format!("写入配置失败: {e}"))
}

#[tauri::command]
pub fn list_profiles(state: State<'_, RuntimeState>) -> Result<serde_json::Value, String> {
    let profiles_dir = state.repo_root.join("profiles");
    let mut list: Vec<serde_json::Value> = Vec::new();

    let entries = std::fs::read_dir(&profiles_dir)
        .map_err(|e| format!("无法读取 profiles 目录: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("toml") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let contents = std::fs::read_to_string(&path).unwrap_or_default();
        let toml_val: toml::Value = contents.parse().unwrap_or(toml::Value::Table(Default::default()));
        let profile_section = toml_val.get("profile");
        let character_section = toml_val.get("character");
        list.push(serde_json::json!({
            "file": stem,
            "name": profile_section.and_then(|p| p.get("name")).and_then(|v| v.as_str()).unwrap_or(&stem),
            "description": profile_section.and_then(|p| p.get("description")).and_then(|v| v.as_str()).unwrap_or(""),
            "agent_name": profile_section.and_then(|p| p.get("agent_name")).and_then(|v| v.as_str()).unwrap_or(""),
            "character_name": character_section.and_then(|c| c.get("character_name")).and_then(|v| v.as_str()).unwrap_or(""),
            "avatar": character_section.and_then(|c| c.get("avatar")).and_then(|v| v.as_str()).unwrap_or(""),
        }));
    }

    list.sort_by(|a, b| {
        a["file"].as_str().unwrap_or("").cmp(b["file"].as_str().unwrap_or(""))
    });

    serde_json::to_value(list).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_profile(state: State<'_, RuntimeState>, file: String) -> Result<serde_json::Value, String> {
    let path = state.repo_root.join("profiles").join(format!("{file}.toml"));
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取 profile 失败: {e}"))?;
    let toml_val: toml::Value = contents
        .parse()
        .map_err(|e| format!("解析 profile 失败: {e}"))?;
    serde_json::to_value(&toml_val).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_profile(
    state: State<'_, RuntimeState>,
    file: String,
    config: serde_json::Value,
) -> Result<(), String> {
    let path = state.repo_root.join("profiles").join(format!("{file}.toml"));
    let toml_val = json_to_toml(config)?;
    let toml_str = toml::to_string_pretty(&toml_val)
        .map_err(|e| format!("序列化 profile 失败: {e}"))?;
    std::fs::write(&path, toml_str).map_err(|e| format!("写入 profile 失败: {e}"))
}

#[tauri::command]
pub fn create_profile(state: State<'_, RuntimeState>, file: String) -> Result<(), String> {
    let path = state.repo_root.join("profiles").join(format!("{file}.toml"));
    if path.exists() {
        return Err(format!("profile '{file}' 已存在"));
    }
    let default_toml = format!(
        "[profile]\nname = \"{file}\"\ndescription = \"\"\nagent_name = \"{file}\"\n\n[prompt]\npersona = \"\"\nformat = \"\"\nshow_control_tags = false\n\n[plugins]\nenabled = []\n"
    );
    std::fs::write(&path, default_toml).map_err(|e| format!("创建 profile 失败: {e}"))
}

#[tauri::command]
pub fn delete_profile(state: State<'_, RuntimeState>, file: String) -> Result<(), String> {
    let path = state.repo_root.join("profiles").join(format!("{file}.toml"));
    std::fs::remove_file(&path).map_err(|e| format!("删除 profile 失败: {e}"))
}

#[tauri::command]
pub async fn fetch_model_list(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("API 返回错误: {}", resp.status()));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {e}"))?;

    let models = data["data"]
        .as_array()
        .ok_or_else(|| "响应格式不符合预期（缺少 data 字段）".to_string())?
        .iter()
        .filter_map(|m| m["id"].as_str().map(String::from))
        .collect();

    Ok(models)
}
