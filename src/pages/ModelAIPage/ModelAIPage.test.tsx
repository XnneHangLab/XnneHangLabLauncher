import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelAIPanel } from './ModelAIPage';
import type { LabConfig } from '../../services/config/labConfig';

function makeConfig(): LabConfig {
  return {
    conf_version: 'v1.6.6',
    asr: {} as LabConfig['asr'],
    agent: {
      enable_tool: true,
      translate_provider: 'none',
      user_lang: 'ZH',
      speaker_lang: 'ZH',
      faster_first_response: false,
      max_vision_concurrency: 4,
      require_detailed: false,
      structured_history_full_turns: 5,
      segment_method: 'pysbd',
      interrupt_method: 'user',
      memory_agent_profile: 'profiles/baoqiao.toml',
      memory_chat_profile: 'profiles/congyin.toml',
      chat_model: {
        llm_provider: 'deepseek',
        llm_model_name: 'deepseek-v4-flash-vision-exp',
        support_vision: true,
        thinking_mode: 'disabled',
      },
      vision_model: {
        llm_provider: '',
        llm_model_name: '',
        reasoning_effort: null,
      },
      prompts: { vision_prompt: './prompts/vision_prompt.txt' },
      llm: { providers: [] },
      translate: {
        deeplx: { api_key: '' },
        llm: { model_path: '', n_gpu_layers: 0 },
      },
      tts: {
        provider: 'none',
        voice_assets_root: './voices',
        gsv_lite: { use_bert: false },
        genie_tts: { language: 'auto', use_roberta: false, onnx_intra_threads: 4 },
      },
      qwen_tts: {
        model_name: '0.6b',
        model_0_6b_path: '',
        model_1_7b_path: '',
        device: 'cpu',
        warmup_cuda_graphs: false,
      },
    },
    local_embedding: {} as LabConfig['local_embedding'],
    package: {} as LabConfig['package'],
    root: { root_dir: '' },
    server: {} as LabConfig['server'],
    memory_bench: {} as LabConfig['memory_bench'],
  };
}

describe('ModelAIPanel', () => {
  it('saves an explicit chat thinking mode', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<ModelAIPanel labConfig={makeConfig()} onSaveLabConfig={onSave} />);

    const selects = screen.getAllByRole('combobox');
    const selectedThinking = selects.find((select) => (select as HTMLSelectElement).value === 'disabled');
    expect(selectedThinking).toBeDefined();

    await user.selectOptions(selectedThinking as HTMLSelectElement, 'enabled');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          chat_model: expect.objectContaining({ thinking_mode: 'enabled' }),
        }),
      }),
    );
  });
});
