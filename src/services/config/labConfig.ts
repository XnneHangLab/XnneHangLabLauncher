export interface LlmProvider {
  name: string;
  llm_api_key: string;
  llm_base_url: string;
  api_format: string;
}

export interface LabConfig {
  conf_version: string;
  asr: {
    FFMPEG_PATH: string;
    device: string;
    custom_output_dir: boolean;
    cache_dir: string;
    output_dir: string;
    vad_model_path: string;
    asr_model_provider: string;
    punctuation_list: string;
    cut: boolean;
    cut_line: number;
    combine: boolean;
    combine_line: number;
    max_sentence_length: number;
    sherpa: {
      asr_model_dir: string;
      num_threads: number;
      vad_min_silence_duration: number;
      vad_min_speech_duration: number;
      vad_max_speech_duration: number;
    };
    qwen_asr: {
      model_dir: string;
      preload_models: string[];
      model_0_6b_path: string;
      model_1_7b_path: string;
      device: string;
      cpu_threads: number;
      gpu_cache_dir: string;
      forced_aligner_path: string;
      forced_aligner_device: string;
    };
  };
  agent: {
    enable_tool: boolean;
    translate_provider: string;
    user_lang: string;
    speaker_lang: string;
    faster_first_response: boolean;
    max_vision_concurrency: number;
    require_detailed: boolean;
    structured_history_full_turns: number;
    segment_method: string;
    interrupt_method: string;
    memory_agent_profile: string;
    memory_chat_profile: string;
    chat_model: {
      llm_provider: string;
      llm_model_name: string;
      support_vision: boolean;
    };
    vision_model: {
      llm_provider: string;
      llm_model_name: string;
      reasoning_effort: string | null;
    };
    prompts: {
      vision_prompt: string;
    };
    llm: {
      providers: LlmProvider[];
    };
    translate: {
      deeplx: { api_key: string };
      llm: { model_path: string; n_gpu_layers: number };
    };
    tts: {
      provider: string;
      voice_assets_root: string;
      gsv_lite: { use_bert: boolean };
      genie_tts: { language: string; use_roberta: boolean; onnx_intra_threads: number };
    };
    qwen_tts: {
      model_name: string;
      model_0_6b_path: string;
      model_1_7b_path: string;
      device: string;
      warmup_cuda_graphs: boolean;
    };
  };
  local_embedding: {
    model_path: string;
    pooling_type: string;
    n_gpu_layers: number;
  };
  package: {
    llm_translate: boolean;
    local_embedding: boolean;
    memory_bench: boolean;
  };
  root: { root_dir: string };
  server: {
    host: string;
    port: number;
    config_alts_dir: string;
    uvicorn_log_level: string;
    live2d_render_scale: number;
  };
  memory_bench: {
    search_limit: number;
    server_api_key: string;
  };
}
