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
