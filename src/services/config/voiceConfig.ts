export interface VoiceClip {
  /** Filename (e.g., "1.wav"). */
  fileName: string;
  /** Absolute path for audio preview. */
  absPath: string;
}

export interface VoiceEmotion {
  /** Directory name / original key (immutable). */
  name: string;
  /** Display label used in [tts:label] tags. Defaults to name. */
  label: string;
  /** Scene description injected into format prompt. */
  description: string;
  /** Audio clips available for preview. */
  clips: VoiceClip[];
}

export interface VoiceConfigResponse {
  voiceId: string;
  assetBundle: string;
  defaultEmotion: string;
  /** Absolute path of the voice asset directory. */
  assetDir: string;
  emotions: VoiceEmotion[];
}
