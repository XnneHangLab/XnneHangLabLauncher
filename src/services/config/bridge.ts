import { invoke } from '@tauri-apps/api/core';
import type { LabConfig } from './labConfig';

export type Live2DExpressionBlend = 'Add' | 'Multiply' | 'Overwrite';
export type Live2DExpressionRole = 'expression' | 'appearance' | 'system' | 'watermark' | 'test' | 'unknown';
export type Live2DExpressionApplyMode = 'transient' | 'persistent' | 'base';

export interface Live2DExpressionParamOp {
  id: string;
  value: number;
  blend: Live2DExpressionBlend;
}

export interface Live2DExpressionPreset {
  name: string;
  label: string;
  file: string;
  role: Live2DExpressionRole;
  applyMode: Live2DExpressionApplyMode;
  isDefaultStartup: boolean;
  isWatermarkControl: boolean;
  description?: string;
  parameters?: Live2DExpressionParamOp[];
}

export interface Live2DTimelineClipRef {
  group: string;
  index: number;
}

export interface Live2DTimelineMotionItem extends Live2DTimelineClipRef {
  kind: 'motion';
  uid?: string;
  sourceDuration: number;
  sourceStart: number;
  sourceEnd: number;
}

export interface Live2DTimelineTransitionItem {
  kind: 'transition';
  uid?: string;
  duration: number;
}

export type Live2DTimelineItem = Live2DTimelineMotionItem | Live2DTimelineTransitionItem;

export interface Live2DTimelinePreset {
  clipKeys: string[];
  clips?: Live2DTimelineClipRef[];
  items?: Live2DTimelineItem[];
}

export interface Live2DPreset {
  name: string;
  modelPath: string;
  /** Ordered "group_index" keys for timeline clips. */
  clipKeys?: string[];
  schemaVersion?: 1;
  model?: {
    name: string;
    modelPath: string;
    url?: string;
    kScale: number;
    initialXshift: number;
    initialYshift: number;
  };
  defaultAppearance?: string;
  emotionMap?: Record<string, string>;
  expressions?: Live2DExpressionPreset[];
  appearancePresets?: Array<{ key: string; expression: string; description?: string }>;
  excludedExpressions?: Array<{ name: string; label: string; file: string; reason: string }>;
  timeline?: Live2DTimelinePreset;
  manualOverrides?: Record<string, number>;
  importedMotions?: Array<{ path: string; fileName: string; name: string; base64: string }>;
}

export interface Live2DModelData {
  modelJson: Record<string, unknown>;
  files: Record<string, string>;
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

export function readLive2DModelData(model3Path: string) {
  return invoke<Live2DModelData>('read_live2d_model_data', { model3Path });
}

export function readFileBase64(path: string) {
  return invoke<string>('read_file_base64', { path });
}

export function writeLive2DMotion(model3Path: string, group: string, index: number, motionJson: unknown) {
  return invoke<void>('write_live2d_motion', { model3Path, group, index, motionJson });
}
