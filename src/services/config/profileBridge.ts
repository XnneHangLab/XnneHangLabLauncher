import { invoke } from '@tauri-apps/api/core';
import type { ProfileMeta, ProfileConfig } from './profileConfig';

export function listProfiles() {
  return invoke<ProfileMeta[]>('list_profiles');
}

function normalizePlugins(config: ProfileConfig): ProfileConfig {
  if (!config.plugins) return config;
  const plugins = { ...config.plugins };
  delete plugins.visual_observer;
  plugins.enabled = plugins.enabled?.filter(id => id !== 'visual_observer');
  if (plugins.mood_chat && typeof plugins.mood_chat === 'object') {
    const mood = { ...plugins.mood_chat } as Record<string, unknown>;
    for (const key of ['game_companion_mode', 'game_mood_decrease', 'game_interval_s', 'game_prompt_suffix', 'game_require_visual_change']) {
      delete mood[key];
    }
    plugins.mood_chat = mood;
  }
  return { ...config, plugins };
}

export async function readProfile(file: string) {
  return normalizePlugins(await invoke<ProfileConfig>('read_profile', { file }));
}

export async function writeProfile(file: string, config: ProfileConfig) {
  const screenshot = config.plugins?.screen_shot;
  if (screenshot && typeof screenshot === 'object') {
    const threads = (screenshot as Record<string, unknown>).ocr_threads;
    if (threads !== undefined && (typeof threads !== 'number' || !Number.isInteger(threads) || threads < 1 || threads > 32)) {
      throw new Error('OCR 线程数必须是 1–32 的整数，请填写后再保存。');
    }
  }
  return invoke<void>('write_profile', { file, config: normalizePlugins(config) });
}

export function createProfile(file: string) {
  return invoke<void>('create_profile', { file });
}

export function deleteProfile(file: string) {
  return invoke<void>('delete_profile', { file });
}

export function pickFileForProfile(title: string, startSubdir: string) {
  return invoke<string | null>('pick_file_for_profile', { title, startSubdir });
}
