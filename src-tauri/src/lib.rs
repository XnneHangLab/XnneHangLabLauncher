mod runtime;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime_state =
        runtime::commands::build_runtime_state().expect("failed to build runtime state");

    let app = tauri::Builder::default()
        .manage(runtime_state)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                cleanup_all_processes(&window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            runtime::commands::probe_environment,
            runtime::commands::choose_workspace_root,
            runtime::commands::use_repo_workspace_root,
            runtime::commands::enqueue_download,
            runtime::commands::list_download_tasks,
            runtime::commands::list_model_statuses,
            runtime::commands::list_managed_folders,
            runtime::commands::open_managed_path,
            runtime::commands::open_url_command,
            runtime::commands::export_console_logs,
            runtime::commands::set_runtime_driver,
            runtime::commands::pick_python_path_command,
            runtime::commands::launch_webui,
            runtime::commands::launch_frontend,
            runtime::config::read_lab_config,
            runtime::config::write_lab_config,
            runtime::config::fetch_model_list,
            runtime::config::list_profiles,
            runtime::config::read_profile,
            runtime::config::write_profile,
            runtime::config::create_profile,
            runtime::config::delete_profile,
            runtime::config::pick_file_for_profile,
            runtime::config::pick_any_file,
            runtime::config::pick_any_dir,
            runtime::live2d::read_live2d_presets,
            runtime::live2d::write_live2d_presets,
            runtime::live2d::read_live2d_model_data,
            runtime::live2d::write_live2d_motion,
            runtime::live2d::read_file_base64,
            runtime::live2d::pick_save_file,
            runtime::live2d::write_file,
            runtime::live2d::get_repo_root,
            runtime::live2d::to_relative_path,
            runtime::live2d::to_absolute_path,
            runtime::voice::read_voice_config,
            runtime::voice::write_voice_emotions,
            runtime::voice::scan_voice_emotions,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            cleanup_all_processes(app_handle);
        }
    });
}

fn cleanup_all_processes(app_handle: &tauri::AppHandle) {
    let state = app_handle.state::<runtime::state::RuntimeState>();
    if let Err(error) = runtime::process::cleanup_webui_processes(app_handle, &state) {
        log::warn!("failed to clean up backend process: {error}");
    }
    if let Err(error) = runtime::process::cleanup_frontend_processes(app_handle, &state) {
        log::warn!("failed to clean up frontend process: {error}");
    }
}
