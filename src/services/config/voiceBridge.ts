import { invoke } from '@tauri-apps/api/core';
import type { VoiceConfigResponse, VoiceEmotion } from './voiceConfig';

export function readVoiceConfig(voiceId: string) {
  return invoke<VoiceConfigResponse>('read_voice_config', { voiceId });
}

export function writeVoiceEmotions(voiceId: string, emotions: VoiceEmotion[]) {
  return invoke<void>('write_voice_emotions', { voiceId, emotions });
}

export function scanVoiceEmotions(voiceId: string) {
  return invoke<string[]>('scan_voice_emotions', { voiceId });
}
