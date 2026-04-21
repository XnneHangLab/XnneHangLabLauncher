use tauri::{AppHandle, State};
use std::path::{Path, PathBuf};
use serde::Deserialize;

use super::process::{
    cleanup_frontend_processes, cleanup_webui_port_conflicts, cleanup_webui_processes,
    drain_download_queue, ensure_environment_ready, open_path, pick_python_path,
    pick_workspace_root, resolve_managed_path, run_probe_command,
    spawn_backend_process, spawn_frontend_process, write_console_log,
};
use super::state::{resolve_repo_root, resolve_workspace_root, RuntimeDriverConfig, RuntimeState};

// ── lab.toml minimal reader ────────────────────────────────────────────────

#[derive(Deserialize, Default)]
struct LabToml {
    #[serde(default)] root:            LabTomlRoot,
    #[serde(default)] local_embedding: LabTomlEmbedding,
    #[serde(default)] agent:           LabTomlAgent,
    #[serde(default)] asr:             LabTomlAsr,
}

#[derive(Deserialize, Default)]
struct LabTomlRoot      { #[serde(default)] root_dir:    String }
#[derive(Deserialize, Default)]
struct LabTomlEmbedding { #[serde(default)] model_path:  String }
#[derive(Deserialize, Default)]
struct LabTomlAgent     { #[serde(default)] translate:   LabTomlTranslate }
#[derive(Deserialize, Default)]
struct LabTomlTranslate { #[serde(default)] llm:         LabTomlLlm }
#[derive(Deserialize, Default)]
struct LabTomlLlm       { #[serde(default)] model_path:  String }
#[derive(Deserialize, Default)]
struct LabTomlAsr {
    #[serde(default)] vad_model_path: String,
    #[serde(default)] sherpa:         LabTomlSherpa,
}
#[derive(Deserialize, Default)]
struct LabTomlSherpa    { #[serde(default)] asr_model_dir: String }

fn is_valid_gguf(path: &Path) -> bool {
    use std::io::Read;
    std::fs::File::open(path)
        .ok()
        .and_then(|mut f| {
            let mut magic = [0u8; 4];
            f.read_exact(&mut magic).ok().map(|_| magic)
        })
        .map(|magic| magic == [0x47, 0x47, 0x55, 0x46])
        .unwrap_or(false)
}

fn file_nonempty(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.len() > 0)
        .unwrap_or(false)
}

fn load_lab_toml(workspace_root: &Path) -> LabToml {
    let path = workspace_root.join("config").join("lab.toml");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| toml::from_str(&s).ok())
        .unwrap_or_default()
}

/// Mirrors Python's `_resolve_path`: absolute paths pass through,
/// relative paths are resolved against `root_dir` (or `workspace_root`).
fn resolve_model_path(root_dir: &str, workspace_root: &Path, configured: &str, default: &str) -> PathBuf {
    let s = if configured.is_empty() { default } else { configured };
    let p = Path::new(s);
    if p.is_absolute() {
        return p.to_path_buf();
    }
    let base = if !root_dir.is_empty() {
        Path::new(root_dir)
    } else {
        workspace_root
    };
    // Strip leading "./" or ".\"
    let rel = s.strip_prefix("./").or_else(|| s.strip_prefix(".\\")).unwrap_or(s);
    base.join(rel)
}

#[tauri::command]
pub async fn probe_environment(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<serde_json::Value, String> {
    let repo_root = state.repo_root.clone();
    let workspace_root = state.current_workspace_root();
    let driver = state.current_driver_config();
    run_blocking_runtime_action(move || {
        let probe = run_probe_command(&repo_root, &workspace_root, &driver, &app)?;
        serde_json::to_value(probe).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn choose_workspace_root(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<Option<serde_json::Value>, String> {
    let picked = run_blocking_runtime_action(pick_workspace_root).await?;
    let Some(path) = picked else {
        return Ok(None);
    };

    switch_workspace_root(app, &state, path).await.map(Some)
}

#[tauri::command]
pub async fn use_repo_workspace_root(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<serde_json::Value, String> {
    let repo_root = state.repo_root.clone();
    switch_workspace_root(app, &state, repo_root).await
}

#[tauri::command]
pub async fn enqueue_download(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    target: String,
) -> Result<serde_json::Value, String> {
    let repo_root = state.repo_root.clone();
    let workspace_root = state.current_workspace_root();
    let driver = state.current_driver_config();
    let app_for_ensure = app.clone();
    run_blocking_runtime_action(move || {
        ensure_environment_ready(&repo_root, &workspace_root, &driver, &app_for_ensure)
            .map(|_| ())
    })
    .await?;

    let (target, label) = validate_download_target(&target)?;
    let (task, should_spawn_worker) = {
        let mut queue = state.queue.lock().unwrap();
        queue.enqueue_with_worker_control(target.to_string(), label.to_string())
    };

    if should_spawn_worker {
        let app_handle = app.clone();
        let runtime_state = RuntimeState {
            repo_root: state.repo_root.clone(),
            workspace_root: state.workspace_root.clone(),
            queue: state.queue.clone(),
            driver_config: state.driver_config.clone(),
            webui: state.webui.clone(),
            frontend: state.frontend.clone(),
        };

        tauri::async_runtime::spawn_blocking(move || {
            drain_download_queue(app_handle.clone(), runtime_state);
        });
    }

    serde_json::to_value(task).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_download_tasks(state: State<'_, RuntimeState>) -> Result<serde_json::Value, String> {
    let queue = state.queue.lock().unwrap();
    serde_json::to_value(&queue.tasks).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_model_statuses(state: State<'_, RuntimeState>) -> serde_json::Value {
    let workspace_root = state.current_workspace_root();
    let lab = load_lab_toml(&workspace_root);
    let root_dir = &lab.root.root_dir;
    let m = workspace_root.join("models");

    let dir_nonempty = |rel: &str| -> bool {
        std::fs::read_dir(m.join(rel))
            .map(|mut iter| iter.next().is_some())
            .unwrap_or(false)
    };

    let rp = |configured: &str, default: &str| -> PathBuf {
        resolve_model_path(root_dir, &workspace_root, configured, default)
    };

    let embedding_path = rp(&lab.local_embedding.model_path,     "models/bge-m3-q8_0.gguf");
    let translate_path = rp(&lab.agent.translate.llm.model_path, "models/qwen2.5-0.5b-instruct-q8_0.gguf");
    let vad_path       = rp(&lab.asr.vad_model_path,             "models/silero_vad.onnx");
    let sherpa_dir     = rp(&lab.asr.sherpa.asr_model_dir,       "models/sherpa-onnx-paraformer-zh-2023-09-14");

    // sherpa: tokens.txt + at least one onnx layout (offline or streaming)
    let sherpa_ok = sherpa_dir.join("tokens.txt").is_file()
        && (file_nonempty(&sherpa_dir.join("model.int8.onnx"))
            || file_nonempty(&sherpa_dir.join("model.onnx"))
            || (file_nonempty(&sherpa_dir.join("encoder.int8.onnx"))
                && file_nonempty(&sherpa_dir.join("decoder.int8.onnx"))));

    // genie-base: key onnx + bin files that the Genie-TTS package requires
    let gd = m.join("GenieData");
    let genie_ok = file_nonempty(&gd.join("chinese-hubert-base").join("chinese-hubert-base.onnx"))
        && file_nonempty(&gd.join("chinese-hubert-base").join("chinese-hubert-base_weights_fp16.bin"))
        && file_nonempty(&gd.join("speaker_encoder.onnx"));

    // gsv-lite: 4 sub-dirs non-empty + roberta pytorch_model.bin present
    let gsv_parts = [
        "GSVLiteData/chinese-hubert-base",
        "GSVLiteData/chinese-roberta-wwm-ext-large",
        "GSVLiteData/g2p",
        "GSVLiteData/sv",
    ];
    let gsv_roberta_bin = m.join("GSVLiteData/chinese-roberta-wwm-ext-large/pytorch_model.bin");
    let gsv_dirs_ready = gsv_parts.iter().filter(|&&p| dir_nonempty(p)).count() == gsv_parts.len();
    let gsv_status = if gsv_dirs_ready && file_nonempty(&gsv_roberta_bin) {
        "ready"
    } else if gsv_parts.iter().any(|&p| dir_nonempty(p)) {
        "partial"
    } else {
        "missing"
    };

    // luming: v2-pro-plus specific onnx + bin files
    let ld = m.join("genie-tts/luming-v2-pro-plus");
    let luming_ok = file_nonempty(&ld.join("vits_fp32.onnx"))
        && file_nonempty(&ld.join("t2s_encoder_fp32.onnx"))
        && file_nonempty(&ld.join("t2s_encoder_fp32.bin"))
        && file_nonempty(&ld.join("t2s_shared_fp16.bin"))
        && file_nonempty(&ld.join("vits_fp16.bin"))
        && file_nonempty(&ld.join("prompt_encoder_fp32.onnx"))
        && file_nonempty(&ld.join("prompt_encoder_fp16.bin"));

    // gsv-baoqiao: infer config must exist so the engine knows gpt/sovits paths
    let baoqiao_dir = m.join("gsv-tts-lite/baoqiao");
    let baoqiao_ok = baoqiao_dir.join("infer_config.json").is_file()
        || baoqiao_dir.join("infer.json").is_file();

    let mut out = serde_json::Map::new();
    let mut s = |key: &str, status: &str| out.insert(key.into(), status.into());
    s("sherpa-paraformer",            if sherpa_ok    { "ready" } else { "missing" });
    s("silero-vad",                   if file_nonempty(&vad_path) { "ready" } else { "missing" });
    s("genie-base",                   if genie_ok     { "ready" } else { "missing" });
    s("gsv-lite",                     gsv_status);
    s("luming-genie-tts-v2-pro-plus", if luming_ok    { "ready" } else { "missing" });
    s("gsv-baoqiao",                  if baoqiao_ok   { "ready" } else { "missing" });
    s("qwen-tts-0.6b",                if dir_nonempty("Qwen3-TTS-12Hz-0.6B-Base")  { "ready" } else { "missing" });
    s("qwen-tts-1.7b",                if dir_nonempty("Qwen3-TTS-12Hz-1.7B-Base")  { "ready" } else { "missing" });
    s("local-embedding",              if is_valid_gguf(&embedding_path) { "ready" } else { "missing" });
    s("llm-translate",                if is_valid_gguf(&translate_path) { "ready" } else { "missing" });
    serde_json::Value::Object(out)
}

#[tauri::command]
pub fn list_managed_folders(state: State<'_, RuntimeState>) -> Result<serde_json::Value, String> {
    let workspace_root = state.current_workspace_root();
    let models_root = workspace_root.join("models");
    let logs_root = workspace_root.join("logs");
    let items = serde_json::json!([
        { "key": "workspace",    "label": "根目录",           "path": workspace_root.display().to_string() },
        { "key": "models",       "label": "模型目录",         "path": models_root.display().to_string() },
        { "key": "genieBase",    "label": "Genie 基础资源",   "path": models_root.join("GenieData").display().to_string() },
        { "key": "downloadLogs", "label": "下载日志",         "path": logs_root.join("downloads").display().to_string() },
    ]);
    Ok(items)
}

#[tauri::command]
pub fn open_managed_path(state: State<'_, RuntimeState>, path_key: String) -> Result<(), String> {
    let workspace_root = state.current_workspace_root();
    let path = resolve_managed_path(&workspace_root, &path_key)?;
    open_path(&path)
}

#[tauri::command]
pub fn export_console_logs(
    state: State<'_, RuntimeState>,
    contents: String,
) -> Result<String, String> {
    let workspace_root = state.current_workspace_root();
    let log_dir = resolve_managed_path(&workspace_root, "downloadLogs")?;
    let path = write_console_log(&log_dir, &contents)?;
    Ok(path.display().to_string())
}

pub fn build_runtime_state() -> Result<RuntimeState, String> {
    let repo_root = resolve_repo_root()?;
    let workspace_root = resolve_workspace_root(&repo_root)?;
    Ok(RuntimeState::new(repo_root, workspace_root))
}

#[tauri::command]
pub async fn set_runtime_driver(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    driver: String,
    python_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let driver_config = match driver.as_str() {
        "uv" => RuntimeDriverConfig::Uv,
        "conda" => {
            let path = python_path
                .filter(|p| !p.is_empty())
                .ok_or_else(|| "conda mode requires a python_path".to_string())?;
            RuntimeDriverConfig::DirectPython {
                python_path: std::path::PathBuf::from(path),
            }
        }
        other => return Err(format!("unsupported runtime driver: {other}")),
    };
    state.set_driver_config(driver_config.clone());

    let repo_root = state.repo_root.clone();
    let workspace_root = state.current_workspace_root();
    run_blocking_runtime_action(move || {
        let probe = run_probe_command(&repo_root, &workspace_root, &driver_config, &app)?;
        serde_json::to_value(probe).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn pick_python_path_command() -> Result<Option<String>, String> {
    run_blocking_runtime_action(move || {
        let path = pick_python_path()?;
        Ok(path.map(|p| p.display().to_string()))
    })
    .await
}

#[tauri::command]
pub async fn launch_webui(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<(), String> {
    let repo_root = state.repo_root.clone();
    let workspace_root = state.current_workspace_root();
    let driver = state.current_driver_config();
    let runtime_state = RuntimeState {
        repo_root: state.repo_root.clone(),
        workspace_root: state.workspace_root.clone(),
        queue: state.queue.clone(),
        driver_config: state.driver_config.clone(),
        webui: state.webui.clone(),
        frontend: state.frontend.clone(),
    };
    run_blocking_runtime_action(move || {
        ensure_environment_ready(&repo_root, &workspace_root, &driver, &app)?;
        cleanup_webui_processes(&app, &runtime_state)?;
        cleanup_webui_port_conflicts(&app, 7860)?;
        spawn_backend_process(app, runtime_state, &repo_root, &workspace_root, &driver)
    })
    .await
}

#[tauri::command]
pub async fn launch_frontend(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<(), String> {
    let repo_root = state.repo_root.clone();
    let runtime_state = RuntimeState {
        repo_root: state.repo_root.clone(),
        workspace_root: state.workspace_root.clone(),
        queue: state.queue.clone(),
        driver_config: state.driver_config.clone(),
        webui: state.webui.clone(),
        frontend: state.frontend.clone(),
    };
    run_blocking_runtime_action(move || {
        cleanup_frontend_processes(&app, &runtime_state)?;
        spawn_frontend_process(app, runtime_state, &repo_root)
    })
    .await
}

fn validate_download_target(target: &str) -> Result<(&'static str, &'static str), String> {
    match target {
        "genie-base" => Ok(("genie-base", "GenieData 基础资源")),
        "gsv-lite" => Ok(("gsv-lite", "GSV-Lite 数据包")),
        "qwen-tts-0.6b" => Ok(("qwen-tts-0.6b", "Qwen3-TTS 0.6B")),
        "qwen-tts-1.7b" => Ok(("qwen-tts-1.7b", "Qwen3-TTS 1.7B")),
        "luming-genie-tts-v2-pro-plus" => Ok(("luming-genie-tts-v2-pro-plus", "路鸣 Genie-TTS v2 Pro+")),
        "gsv-baoqiao" => Ok(("gsv-baoqiao", "薄巧 GSV 角色模型")),
        "local-embedding" => Ok(("local-embedding", "BGE-M3 本地嵌入模型")),
        "llm-translate" => Ok(("llm-translate", "Qwen2.5 0.5B 翻译辅助")),
        "sherpa-paraformer" => Ok(("sherpa-paraformer", "Sherpa Paraformer ZH")),
        "silero-vad" => Ok(("silero-vad", "Silero VAD")),
        other => Err(format!("unsupported download target: {other}")),
    }
}

async fn run_blocking_runtime_action<T, F>(action: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|error| format!("failed to join runtime task: {error}"))?
}

async fn switch_workspace_root(
    app: AppHandle,
    state: &RuntimeState,
    next_workspace_root: std::path::PathBuf,
) -> Result<serde_json::Value, String> {
    {
        let mut queue = state.queue.lock().unwrap();
        if queue.has_active_tasks() {
            return Err("当前有任务运行，禁止切换工作目录".to_string());
        }
        queue.reset_for_workspace_switch();
    }

    state.set_workspace_root(next_workspace_root.clone());

    let repo_root = state.repo_root.clone();
    let driver = state.current_driver_config();
    run_blocking_runtime_action(move || {
        let probe = run_probe_command(&repo_root, &next_workspace_root, &driver, &app)?;
        serde_json::to_value(probe).map_err(|error| error.to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    #[test]
    fn run_blocking_runtime_action_moves_work_off_the_calling_thread() {
        let caller_thread = format!("{:?}", std::thread::current().id());
        let worker_thread =
            tauri::async_runtime::block_on(super::run_blocking_runtime_action(|| {
                Ok(format!("{:?}", std::thread::current().id()))
            }))
            .unwrap();

        assert_ne!(worker_thread, caller_thread);
    }
}
