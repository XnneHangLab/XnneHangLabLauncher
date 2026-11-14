import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { readProfile, writeProfile } from './profileBridge';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe('OCR thread validation', () => {
  it.each([undefined, 1, 2, 32])('saves valid thread setting %s', async (ocr_threads) => {
    const config = { profile: { description: 'test' }, plugins: { screen_shot: { enable_ocr: false, ocr_threads } } };
    await writeProfile('test', config);
    expect(invoke).toHaveBeenCalledWith('write_profile', { file: 'test', config });
  });

  it.each(['', 0, -1, 33, 1.5, null, NaN, Infinity, '2'])('rejects invalid thread setting %s before writing', async (ocr_threads) => {
    const config = { profile: { description: 'test' }, plugins: { screen_shot: { enable_ocr: false, ocr_threads } } };
    await expect(writeProfile('test', config)).rejects.toThrow('OCR 线程数必须是 1–32 的整数');
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('profile visual config migration', () => {
  it('drops retired visual settings while preserving mood and screenshot options', async () => {
    const config = {
      profile: { description: 'test' },
      plugins: {
        enabled: ['visual_observer', 'mood_chat', 'screen_shot'],
        visual_observer: { vision_boost: true },
        mood_chat: { game_companion_mode: true, game_interval_s: 1, prompt: 'ordinary', interval_normal_s: 30 },
        screen_shot: { enable_ocr: true },
      },
    };
    vi.mocked(invoke).mockResolvedValueOnce(config);
    const migrated = await readProfile('test');
    expect(migrated.plugins).toEqual({
      enabled: ['mood_chat', 'screen_shot'],
      mood_chat: { prompt: 'ordinary', interval_normal_s: 30 },
      screen_shot: { enable_ocr: true },
    });
    expect(config.plugins.enabled).toContain('visual_observer');
    await writeProfile('test', config);
    expect(invoke).toHaveBeenLastCalledWith('write_profile', { file: 'test', config: migrated });
  });
});
