import { invoke } from '@tauri-apps/api/core';
import type { ProfileMeta, ProfileConfig } from './profileConfig';

export function listProfiles() {
  return invoke<ProfileMeta[]>('list_profiles');
}

export function readProfile(file: string) {
  return invoke<ProfileConfig>('read_profile', { file });
}

export function writeProfile(file: string, config: ProfileConfig) {
  return invoke<void>('write_profile', { file, config });
}

export function createProfile(file: string) {
  return invoke<void>('create_profile', { file });
}

export function deleteProfile(file: string) {
  return invoke<void>('delete_profile', { file });
}
