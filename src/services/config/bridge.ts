import { invoke } from '@tauri-apps/api/core';
import type { LabConfig } from './labConfig';

export function readLabConfig() {
  return invoke<LabConfig>('read_lab_config');
}

export function writeLabConfig(config: LabConfig) {
  return invoke<void>('write_lab_config', { config });
}
