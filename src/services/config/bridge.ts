import { invoke } from '@tauri-apps/api/core';
import type { LabConfig } from './labConfig';

export interface Live2DPreset {
  name: string;
  modelPath: string;
}

export function readLabConfig() {
  return invoke<LabConfig>('read_lab_config');
}

export function writeLabConfig(config: LabConfig) {
  return invoke<void>('write_lab_config', { config });
}

export function fetchModelList(baseUrl: string, apiKey: string) {
  return invoke<string[]>('fetch_model_list', { baseUrl, apiKey });
}

export function pickAnyFile(title: string) {
  return invoke<string | null>('pick_any_file', { title });
}

export function pickAnyDir(title: string) {
  return invoke<string | null>('pick_any_dir', { title });
}

export function readLive2DPresets() {
  return invoke<Live2DPreset[]>('read_live2d_presets');
}

export function writeLive2DPresets(presets: Live2DPreset[]) {
  return invoke<void>('write_live2d_presets', { presets });
}
