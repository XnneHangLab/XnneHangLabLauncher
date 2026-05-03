/**
 * Live2D animation editor context and provider.
 * Manages the Cubism model lifecycle, animation loop, and shared state.
 */

import React, { useEffect, useRef, useState, useCallback, createContext, useContext } from 'react';
import type { ConsoleLogEntry } from '../../services/launcher/launcher';
import { CubismInit } from '../../live2d/engine/CubismFrameworkInit';
import { loadModelFromData, base64ToArrayBuffer } from '../../live2d/engine/ModelLoader';
import type { ModelInstance } from '../../live2d/engine/ModelLoader';
import { MotionPlayer } from '../../live2d/engine/MotionPlayer';
import { KeyframeOverlay } from '../../live2d/engine/KeyframeOverlay';
import { spliceMotions, extractMotionSubrange, createTransitionMotion } from '../../live2d/engine/MotionSplicer';
import { parseMotion, evaluateMotion } from '../../live2d/engine/MotionParser';
import type { ParsedMotion } from '../../live2d/types';
import { readLive2DModelData, pickAnyFile, readFileBase64, pickSaveFile, writeFile } from '../../services/config/bridge';
import type { Live2DModelData, Live2DTimelineItem as PersistedTimelineItem } from '../../services/config/bridge';
import type { MotionData } from '../../live2d/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MotionEntry {
  group: string;
  index: number;
  name: string;
  file: string;
}

export interface ParamRange {
  min: number;
  max: number;
  default: number;
}

export interface ParamMeta {
  id: string;
  label: string;
  group: 'standard' | 'expression' | 'motion' | 'all';
  sources: string[];
}

export type ExpressionBlend = 'Add' | 'Multiply' | 'Overwrite';
export type ExpressionRole = 'expression' | 'appearance' | 'system' | 'watermark' | 'test' | 'unknown';
export type ExpressionApplyMode = 'transient' | 'persistent' | 'base';

export interface ExpressionParamOp {
  id: string;
  value: number;
  blend: ExpressionBlend;
}

export interface ExpressionMeta {
  name: string;
  file: string;
  parameters: ExpressionParamOp[];
  guessedTags: string[];
  parseError?: string;
}

export interface ExpressionPresetConfig {
  name: string;
  label: string;
  file: string;
  role: ExpressionRole;
  applyMode: ExpressionApplyMode;
  isDefaultStartup: boolean;
  isWatermarkControl: boolean;
  description?: string;
}

export interface TimelineClip {
  kind: 'motion';
  uid: string;
  group: string;
  index: number;
  label: string;
  sourceDuration: number;
  sourceStart: number;
  sourceEnd: number;
  duration: number;
  missingParams: string[];
}

export interface TimelineTransition {
  kind: 'transition';
  uid: string;
  duration: number;
}

export type TimelineItem = TimelineClip | TimelineTransition;

export interface TimelinePlaybackState {
  active: boolean;
  itemUid: string | null;
  itemIndex: number;
  itemStartTime: number;
  clipUid: string | null;
  clipIndex: number;
  clipStartTime: number;
  totalTime: number;
  totalDuration: number;
}

export interface TimelineExpressionSegmentMarker {
  uid: string;
  /** Position on the total timeline in seconds (0 .. totalDuration). */
  time: number;
  /**
   * Keys into expressionMetas (via expressionKey(name, file)).
   * Multiple expressions can be active in the same segment.
   * Empty array = no expression for this segment.
   */
  expressionKeys: string[];
}

interface ExpressionSegment {
  startTime: number;
  endTime: number;
  expressionKeys: string[];
}

interface TimelineClipRef {
  group: string;
  index: number;
}

interface ImportedMotionState {
  path: string;
  fileName: string;
  name: string;
  base64: string;
  group?: string;
  index?: number;
}

export interface Live2DAdaptedPreset {
  schemaVersion: 1;
  name: string;
  model: {
    name: string;
    modelPath: string;
    url?: string;
    kScale: number;
    initialXshift: number;
    initialYshift: number;
  };
  defaultAppearance?: string;
  emotionMap: Record<string, string>;
  expressions: Array<ExpressionPresetConfig & { parameters: ExpressionParamOp[] }>;
  appearancePresets: Array<{ key: string; expression: string; description?: string }>;
  excludedExpressions: Array<{ name: string; label: string; file: string; reason: string }>;
  timeline: { clipKeys: string[]; clips?: TimelineClipRef[]; items?: PersistedTimelineItem[] };
  manualOverrides: Record<string, number>;
  importedMotions: ImportedMotionState[];
  expressionSegmentMarkers?: TimelineExpressionSegmentMarker[];
  endExpressionKeys?: string[];
}

interface ExpressionPreviewBaselineEntry {
  value: number;
  hadManualOverride: boolean;
}

interface Live2DSessionState {
  modelPath: string | null;
  manualOverrides: Record<string, number>;
  motionAliases: Record<string, string>;
  timelineClipKeys: string[];
  timelineClips?: TimelineClipRef[];
  timelineItems?: PersistedTimelineItem[];
  importedMotions?: ImportedMotionState[];
  expressionConfigs?: Record<string, ExpressionPresetConfig>;
  expressionSegmentMarkers?: TimelineExpressionSegmentMarker[];
  endExpressionKeys?: string[];
}

const live2dSessionKey = 'live2d.previewSession';

export interface EditorContextValue {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  modelInstance: ModelInstance | null;
  keyframeOverlay: KeyframeOverlay;
  motionEntries: MotionEntry[];
  modelLoaded: boolean;
  modelError: string | null;
  modelPath: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  timelinePlayback: TimelinePlaybackState;
  paramValues: Record<string, number>;
  paramRanges: Record<string, ParamRange>;
  paramMetas: ParamMeta[];
  expressionMetas: ExpressionMeta[];
  expressionConfigs: Record<string, ExpressionPresetConfig>;
  activeExpressionPreviews: string[];
  currentMotion: { group: string; index: number } | null;
  motionAliases: Record<string, string>;
  timelineClips: TimelineClip[];
  timelineItems: TimelineItem[];
  expressionSegmentMarkers: TimelineExpressionSegmentMarker[];
  endExpressionKeys: string[];

  loadModelByPath: (path: string) => Promise<void>;
  openImportDialog: () => Promise<void>;
  openMotionImportDialog: () => Promise<void>;
  playMotion: (group: string, index: number) => void;
  setParameter: (id: string, value: number) => void;
  resetAllParameters: () => void;
  previewExpression: (name: string) => void;
  updateExpressionConfig: (name: string, patch: Partial<Omit<ExpressionPresetConfig, 'name' | 'file'>>) => void;
  buildAdaptedPreset: (name: string) => Live2DAdaptedPreset | null;
  togglePlay: () => void;
  scrub: (time: number) => void;
  seekTimeline: (time: number) => void;
  renameMotion: (key: string, name: string) => void;
  deleteMotion: (group: string, index: number) => void;
  addClipToTimeline: (group: string, index: number, beforeUid?: string | null) => void;
  addTransitionAfter: (afterUid: string, duration?: number) => void;
  resizeTransition: (uid: string, duration: number) => void;
  splitClipAtTimelineTime: (time: number) => void;
  moveClipInTimeline: (uid: string, beforeUid: string | null) => void;
  trimClip: (uid: string, edge: 'start' | 'end', sourceTime: number) => void;
  playClip: (uid: string) => void;
  removeClipFromTimeline: (uid: string) => void;
  clearTimeline: () => void;
  exportTimelineAsMotion: () => Promise<void>;
  addExpressionSegmentMarker: (time: number) => void;
  removeExpressionSegmentMarker: (uid: string) => void;
  updateExpressionSegmentMarker: (uid: string, expressionKeys: string[]) => void;
  moveExpressionSegmentMarker: (uid: string, time: number) => void;
  segmentExpressionKeyAtTime: (time: number) => string | null;
  segmentExpressionKeysAtTime: (time: number) => string[];
  assignExpressionToSegmentAtTime: (time: number, expressionKey: string) => void;
  setEndExpressionKeys: (keys: string[]) => void;
}

const EditorCtx = createContext<EditorContextValue | null>(null);
export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error('useEditor must be inside EditorProvider');
  return ctx;
}

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function parseBase64Json(base64: string): unknown {
  return JSON.parse(decodeBase64Utf8(base64));
}

function readLive2DSession(): Live2DSessionState | null {
  try {
    return JSON.parse(window.localStorage.getItem(live2dSessionKey) ?? 'null');
  } catch {
    return null;
  }
}

function writeLive2DSession(state: Live2DSessionState): void {
  window.localStorage.setItem(live2dSessionKey, JSON.stringify(state));
}

function clipKey(group: string, index: number): string {
  return `${group}_${index}`;
}

function timelineClipRefs(items: TimelineItem[]): TimelineClipRef[] {
  return items.flatMap((item) => item.kind === 'motion' ? [{ group: item.group, index: item.index }] : []);
}

function timelinePersistenceItems(items: TimelineItem[]): PersistedTimelineItem[] {
  return items.map((item) => item.kind === 'motion'
    ? {
      kind: 'motion',
      uid: item.uid,
      group: item.group,
      index: item.index,
      sourceDuration: item.sourceDuration,
      sourceStart: item.sourceStart,
      sourceEnd: item.sourceEnd,
    }
    : { kind: 'transition', uid: item.uid, duration: item.duration });
}

function clipKeysFromRefs(refs: TimelineClipRef[]): string[] {
  return refs.map((clip) => clipKey(clip.group, clip.index));
}

function clipRefsFromKeys(keys?: string[] | null): TimelineClipRef[] {
  return (keys ?? []).flatMap((key) => {
    const sep = key.lastIndexOf('_');
    if (sep < 1) return [];
    const group = key.slice(0, sep);
    const index = Number(key.slice(sep + 1));
    return Number.isNaN(index) ? [] : [{ group, index }];
  });
}



function insertTimelineItem(items: TimelineItem[], item: TimelineItem, beforeUid?: string | null): TimelineItem[] {
  if (!beforeUid) return [...items, item];
  const index = items.findIndex((candidate) => candidate.uid === beforeUid);
  if (index < 0) return [...items, item];
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function moveTimelineItem(items: TimelineItem[], uid: string, beforeUid: string | null): TimelineItem[] {
  if (uid === beforeUid) return items;
  const moving = items.find((item) => item.uid === uid);
  if (!moving) return items;
  const rest = items.filter((item) => item.uid !== uid);
  if (!beforeUid) return [...rest, moving];
  const index = rest.findIndex((item) => item.uid === beforeUid);
  if (index < 0) return [...rest, moving];
  return [...rest.slice(0, index), moving, ...rest.slice(index)];
}

function timelineTotalDuration(items: TimelineItem[]): number {
  return items.reduce((sum, item) => sum + item.duration, 0);
}

function timelineTimeAtItem(items: TimelineItem[], index: number, itemTime: number): number {
  return items.slice(0, Math.max(0, index)).reduce((sum, item) => sum + item.duration, 0) + itemTime;
}

function makeTimelinePlaybackState(
  items: TimelineItem[],
  index: number,
  itemTime = 0,
  active = true,
): TimelinePlaybackState {
  const item = items[index];
  const itemStartTime = items.slice(0, Math.max(0, index)).reduce((sum, candidate) => sum + candidate.duration, 0);
  return {
    active,
    itemUid: item?.uid ?? null,
    itemIndex: item ? index : -1,
    itemStartTime,
    clipUid: item?.kind === 'motion' ? item.uid : null,
    clipIndex: item?.kind === 'motion' ? index : -1,
    clipStartTime: item?.kind === 'motion' ? itemStartTime : 0,
    totalTime: item ? timelineTimeAtItem(items, index, itemTime) : 0,
    totalDuration: timelineTotalDuration(items),
  };
}

function timelinePlaybackStateAtTime(items: TimelineItem[], time: number, active = false): TimelinePlaybackState {
  const totalDuration = timelineTotalDuration(items);
  const clamped = Math.max(0, Math.min(time, totalDuration));
  let cursor = 0;
  for (let i = 0; i < items.length; i++) {
    const end = cursor + items[i].duration;
    if (clamped <= end || i === items.length - 1) {
      return makeTimelinePlaybackState(items, i, Math.max(0, clamped - cursor), active);
    }
    cursor = end;
  }
  return idleTimelinePlaybackState(items);
}

function idleTimelinePlaybackState(items: TimelineItem[] = []): TimelinePlaybackState {
  return {
    active: false,
    itemUid: null,
    itemIndex: -1,
    itemStartTime: 0,
    clipUid: null,
    clipIndex: -1,
    clipStartTime: 0,
    totalTime: 0,
    totalDuration: timelineTotalDuration(items),
  };
}

export function deriveExpressionSegments(
  markers: TimelineExpressionSegmentMarker[],
  totalDuration: number,
  endExpressionKeys?: string[],
): ExpressionSegment[] {
  if (totalDuration <= 0) return [];
  const sorted = [...markers].sort((a, b) => a.time - b.time);
  const segments: ExpressionSegment[] = [];
  let prevTime = 0;

  // Each marker's expressionKeys control the segment to its LEFT:
  // [prevTime, marker.time). The marker is the RIGHT boundary of its segment.
  for (let i = 0; i < sorted.length; i++) {
    const endTime = Math.max(prevTime, Math.min(sorted[i].time, totalDuration));
    if (endTime > prevTime) {
      segments.push({ startTime: prevTime, endTime, expressionKeys: sorted[i].expressionKeys ?? [] });
      prevTime = endTime;
    }
  }

  // Last segment (after the last marker) is controlled by endExpressionKeys.
  if (totalDuration > prevTime) {
    segments.push({ startTime: prevTime, endTime: totalDuration, expressionKeys: endExpressionKeys ?? [] });
  }

  return segments;
}

function findExpressionSegment(
  markers: TimelineExpressionSegmentMarker[],
  totalTime: number,
  totalDuration: number,
  endExpressionKeys?: string[],
): ExpressionSegment | null {
  const segments = deriveExpressionSegments(markers, totalDuration, endExpressionKeys);
  return segments.find((s) => totalTime >= s.startTime && totalTime < s.endTime) ?? null;
}

function importKey(group: string, index: number): string {
  return `${group}_${index}`;
}

function uniqueImportedFileName(fileName: string, group: string, index: number): string {
  return `__imported_${group}_${index}__${fileName}`;
}

function normalizeImportedMotions(motions: ImportedMotionState[] = []): ImportedMotionState[] {
  const seen = new Set<string>();
  const next: ImportedMotionState[] = [];
  for (const motion of motions) {
    const key = motion.group !== undefined && motion.index !== undefined
      ? importKey(motion.group, motion.index)
      : `${motion.path}|${motion.fileName}|${motion.base64}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({ ...motion });
  }
  return next;
}

function normalizeMotionEntries(entries: MotionEntry[]): MotionEntry[] {
  const seen = new Set<string>();
  const next: MotionEntry[] = [];
  for (const entry of entries) {
    const key = importKey(entry.group, entry.index);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(entry);
  }
  return next;
}

function normalizeBlend(blend: unknown): ExpressionBlend {
  return blend === 'Add' || blend === 'Multiply' || blend === 'Overwrite' ? blend : 'Overwrite';
}

export function expressionKey(name: string, file: string): string {
  return name || file;
}

function guessExpressionTags(name: string, file: string): string[] {
  const text = `${name} ${file}`.toLowerCase();
  const tags: string[] = [];
  if (/水印|版权|logo|author|credit|copyright/.test(text)) tags.push('水印/版权');
  if (/hair|发型|马尾|披发|刘海|辫/.test(text)) tags.push('外观');
  if (/hide|隐藏|显示|show|visible|显隐/.test(text)) tags.push('显隐');
  if (/test|测试|飞头|debug/.test(text)) tags.push('测试');
  if (/blush|脸红|黑脸|dark|angry|sad|happy|tear|委屈|生气/.test(text)) tags.push('表情');
  return tags;
}

function inferExpressionApplyMode(config: Pick<ExpressionPresetConfig, 'role'>): ExpressionApplyMode {
  switch (config.role) {
    case 'appearance':
      return 'persistent';
    case 'system':
    case 'watermark':
      return 'base';
    case 'expression':
    case 'test':
    case 'unknown':
    default:
      return 'transient';
  }
}

function createDefaultExpressionConfig(meta: ExpressionMeta): ExpressionPresetConfig {
  const tags = new Set(meta.guessedTags);
  const likelyWatermark = tags.has('水印/版权');
  const likelyTest = tags.has('测试');
  const likelyAppearance = tags.has('外观') || tags.has('显隐');

  const role: ExpressionRole = likelyWatermark ? 'watermark' : likelyTest ? 'test' : likelyAppearance ? 'appearance' : 'expression';

  return {
    name: meta.name,
    label: meta.name,
    file: meta.file,
    role,
    applyMode: inferExpressionApplyMode({ role }),
    isDefaultStartup: role === 'watermark',
    isWatermarkControl: role === 'watermark',
    description: '',
  };
}

function mergeExpressionConfigs(
  metas: ExpressionMeta[],
  savedConfigs?: Record<string, ExpressionPresetConfig>,
): Record<string, ExpressionPresetConfig> {
  const next: Record<string, ExpressionPresetConfig> = {};
  for (const meta of metas) {
    const key = expressionKey(meta.name, meta.file);
    const saved = savedConfigs?.[key];
    const merged = saved
      ? { ...createDefaultExpressionConfig(meta), ...saved, name: meta.name, file: meta.file }
      : createDefaultExpressionConfig(meta);
    next[key] = {
      ...merged,
      applyMode: inferExpressionApplyMode(merged),
      isDefaultStartup: merged.role === 'system' || merged.role === 'watermark',
      isWatermarkControl: merged.role === 'watermark',
    };
  }
  return next;
}

function collectExpressionMetas(
  modelJson: Record<string, unknown>,
  files: Record<string, string>,
): ExpressionMeta[] {
  const fr = modelJson.FileReferences as Record<string, unknown> | undefined;
  const expressions = Array.isArray(fr?.Expressions) ? fr.Expressions as Array<{ Name?: string; File?: string }> : [];
  const declaredFiles = new Set(expressions.map((expression) => expression.File).filter(Boolean));
  const looseExpressionFiles = Object.keys(files)
    .filter((file) => file.endsWith('.exp3.json') && !declaredFiles.has(file))
    .map((file) => ({
      Name: file.split(/[/\\]/).pop()?.replace(/\.exp3\.json$/i, ''),
      File: file,
    }));
  const allExpressions = [...expressions, ...looseExpressionFiles];

  return allExpressions
    .filter((expression) => expression.File)
    .map((expression, index) => {
      const file = expression.File ?? '';
      const name = expression.Name || file.replace(/\.exp3\.json$/i, '') || `expression_${index}`;
      const guessedTags = guessExpressionTags(name, file);
      const baseMeta: ExpressionMeta = { name, file, parameters: [], guessedTags };
      if (!files[file]) return { ...baseMeta, parseError: '文件未读取' };

      try {
        const exp = parseBase64Json(files[file]) as { Parameters?: Array<{ Id?: string; Value?: number; Blend?: string }> };
        const params = exp.Parameters ?? [];
        return {
          ...baseMeta,
          parameters: params
            .filter((param): param is { Id: string; Value: number; Blend?: string } => (
              typeof param.Id === 'string' && typeof param.Value === 'number'
            ))
            .map((param) => ({
              id: param.Id,
              value: param.Value,
              blend: normalizeBlend(param.Blend),
            })),
        };
      } catch (error) {
        return { ...baseMeta, parseError: String(error) };
      }
    });
}

function applyExpressionOperation(currentValue: number, operation: ExpressionParamOp): number {
  switch (operation.blend) {
    case 'Add':
      return currentValue + operation.value;
    case 'Multiply':
      return currentValue * operation.value;
    case 'Overwrite':
    default:
      return operation.value;
  }
}

function applySegmentExpressionToModel(
  model: ModelInstance,
  totalTime: number,
  markers: TimelineExpressionSegmentMarker[],
  expressionMetas: ExpressionMeta[],
  totalDuration: number,
  endExpressionKeys?: string[],
): void {
  if (!model) return;
  const segment = findExpressionSegment(markers, totalTime, totalDuration, endExpressionKeys);
  if (!segment || segment.expressionKeys.length === 0) return;

  // Apply all expressions for this segment, in order.
  // Each expression is applied on top of the previous (motion + earlier expressions).
  for (const expKey of segment.expressionKeys) {
    const meta = expressionMetas.find(
      (m) => expressionKey(m.name, m.file) === expKey,
    );
    if (!meta) continue;

    // Apply expression with save=false so the values are used for the current frame's
    // draw but do NOT persist into the model's save/load snapshot. This prevents
    // accumulation across frames: each frame starts from a clean baseline (motion values)
    // and expressions are re-applied fresh.
    for (const op of meta.parameters) {
      const currentValue = model.getParameterValue(op.id);
      const nextValue = applyExpressionOperation(currentValue, op);
      model.setParameterValue(op.id, nextValue, false);
    }
  }
}

function clampParameterValue(value: number, range?: ParamRange): number {
  return range ? Math.min(Math.max(value, range.min), range.max) : value;
}

function writeManualOverride(
  overrides: Record<string, number>,
  id: string,
  value: number,
  range?: ParamRange,
): void {
  const defaultValue = range?.default ?? 0;
  if (Math.abs(value - defaultValue) <= 0.001) delete overrides[id];
  else overrides[id] = value;
}

function restoreManualOverride(
  overrides: Record<string, number>,
  id: string,
  entry: ExpressionPreviewBaselineEntry,
): void {
  if (entry.hadManualOverride) overrides[id] = entry.value;
  else delete overrides[id];
}

function collectParamMetas(
  ids: string[],
  modelJson: Record<string, unknown>,
  files: Record<string, string>,
): ParamMeta[] {
  const metas = new Map<string, ParamMeta>();

  const ensure = (id: string, group: ParamMeta['group'], source: string, label?: string) => {
    if (!ids.includes(id)) return;
    const cleanLabel = label && !/[锟�]/.test(label) ? label : undefined;
    const current = metas.get(id);
    if (current) {
      if (current.group === 'all') current.group = group;
      if (group === 'expression' && current.group !== 'standard') current.group = group;
      if (cleanLabel && current.label === id) current.label = cleanLabel;
      if (!current.sources.includes(source)) current.sources.push(source);
      return;
    }
    metas.set(id, { id, label: cleanLabel ?? id, group, sources: [source] });
  };

  const fr = modelJson.FileReferences as Record<string, unknown> | undefined;
  const cdiFile = fr?.DisplayInfo as string | undefined;
  if (cdiFile && files[cdiFile]) {
    try {
      const cdi = parseBase64Json(files[cdiFile]) as { Parameters?: Array<{ Id: string; Name?: string }> };
      const params = cdi.Parameters ?? [];
      for (const param of params) ensure(param.Id, 'all', 'CDI', param.Name);
    } catch {
      // ignore invalid optional display info
    }
  }

  const groups: Array<{ Name?: string; Ids?: string[] }> = Array.isArray(modelJson.Groups) ? modelJson.Groups as Array<{ Name?: string; Ids?: string[] }> : [];
  for (const group of groups) {
    for (const id of group.Ids ?? []) ensure(id, 'standard', group.Name ?? 'Group');
  }

  for (const id of ids) {
    if (/^(Param)?(Angle|Body|Eye|Mouth)|body|eye|mouth/i.test(id)) ensure(id, 'standard', '常用');
  }

  const expressions = Array.isArray(fr?.Expressions) ? fr.Expressions as Array<{ Name?: string; File?: string }> : [];
  for (const expression of expressions) {
    if (!expression.File || !files[expression.File]) continue;
    try {
      const exp = parseBase64Json(files[expression.File]) as { Parameters?: Array<{ Id: string }> };
      const params = exp.Parameters ?? [];
      for (const param of params) ensure(param.Id, 'expression', expression.Name ?? expression.File);
    } catch {
      // ignore invalid optional expression
    }
  }

  const motions = fr?.Motions as Record<string, Array<{ File?: string }>> | undefined;
  for (const [group, entries] of Object.entries(motions ?? {})) {
    for (const entry of entries) {
      if (!entry.File || !files[entry.File]) continue;
      try {
        const motion = parseBase64Json(files[entry.File]) as { Curves?: Array<{ Target?: string; Id?: string }> };
        const curves = motion.Curves ?? [];
        for (const curve of curves) {
          if (curve.Target === 'Parameter' && curve.Id) ensure(curve.Id, 'motion', group);
        }
      } catch {
        // ignore invalid optional motion
      }
    }
  }

  for (const id of ids) ensure(id, 'all', '全部');

  const order: Record<ParamMeta['group'], number> = { standard: 0, expression: 1, motion: 2, all: 3 };
  return [...metas.values()].sort((a, b) => order[a.group] - order[b.group] || a.label.localeCompare(b.label));
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function EditorProvider({
  children,
  onDebugLog,
}: {
  children: React.ReactNode;
  onDebugLog?: (text: string, kind?: ConsoleLogEntry['kind']) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<ModelInstance | null>(null);
  const motionPlayerRef = useRef(new MotionPlayer());
  const overlayRef = useRef(new KeyframeOverlay());
  const rafRef = useRef(0);
  const lastTimeRef = useRef(0);
  const cubismReadyRef = useRef(false);
  const modelDataRef = useRef<Live2DModelData | null>(null);

  const [modelPath, setModelPath] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [motionEntries, setMotionEntries] = useState<MotionEntry[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [paramRanges, setParamRanges] = useState<Record<string, ParamRange>>({});
  const [paramMetas, setParamMetas] = useState<ParamMeta[]>([]);
  const [expressionMetas, setExpressionMetas] = useState<ExpressionMeta[]>([]);
  const [expressionConfigs, setExpressionConfigs] = useState<Record<string, ExpressionPresetConfig>>({});
  const [activeExpressionPreviews, setActiveExpressionPreviews] = useState<string[]>([]);
  const manualOverridesRef = useRef<Record<string, number>>({});
  const expressionConfigsRef = useRef<Record<string, ExpressionPresetConfig>>({});
  const expressionMetasRef = useRef<ExpressionMeta[]>([]);
  const expressionPreviewBaselinesRef = useRef<Record<string, Record<string, ExpressionPreviewBaselineEntry>>>({});
  const motionSafeOverridesRef = useRef<Record<string, number>>({});
  const baseParameterValuesRef = useRef<Record<string, number>>({});
  const importedMotionsRef = useRef<ImportedMotionState[]>([]);
  const importingMotionRef = useRef(false);
  const pendingSessionItemsRef = useRef<PersistedTimelineItem[] | null>(null);
  const pendingSessionClipRefsRef = useRef<TimelineClipRef[] | null>(null);
  const restoringTimelineRef = useRef(false);
  const restoredSessionRef = useRef(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const debugParamRef = useRef<string | null>(null);
  const debugFrameRef = useRef(0);
  const debugLogRef = useRef(onDebugLog);
  const [currentMotion, setCurrentMotion] = useState<{ group: string; index: number } | null>(null);
  const activeMotionRef = useRef<{ group: string; index: number; loop: boolean; onFinish?: () => void } | null>(null);
  const motionTimeRef = useRef(0);
  const [motionAliases, setMotionAliases] = useState<Record<string, string>>({});
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [timelinePlayback, setTimelinePlayback] = useState<TimelinePlaybackState>(() => idleTimelinePlaybackState());
  const [expressionSegmentMarkers, setExpressionSegmentMarkers] = useState<TimelineExpressionSegmentMarker[]>([]);
  const [endExpressionKeys, setEndExpressionKeys] = useState<string[]>([]);
  const timelineItemsRef = useRef<TimelineItem[]>([]);
  const timelinePlaybackRef = useRef<{ active: boolean; nextIndex: number }>({ active: false, nextIndex: 0 });
  const expressionSegmentMarkersRef = useRef<TimelineExpressionSegmentMarker[]>([]);
  const endExpressionKeysRef = useRef<string[]>([]);
  const lastTimelineTimeRef = useRef(0);
  const transitionElapsedRef = useRef<{ active: boolean; index: number; elapsed: number }>({ active: false, index: -1, elapsed: 0 });
  const timelineClipEndTimerRef = useRef<number | null>(null);
  const timelineClips = timelineItems.filter((item): item is TimelineClip => item.kind === 'motion');

  function clearTimelineClipEndTimer(): void {
    if (timelineClipEndTimerRef.current !== null) {
      window.clearTimeout(timelineClipEndTimerRef.current);
      timelineClipEndTimerRef.current = null;
    }
  }

  useEffect(() => {
    timelineItemsRef.current = timelineItems;
    setTimelinePlayback((prev) => {
      if (prev.active) return { ...prev, totalDuration: timelineTotalDuration(timelineItems) };
      if (prev.totalTime > 0 || prev.itemUid || prev.clipUid) return timelinePlaybackStateAtTime(timelineItems, prev.totalTime, false);
      return idleTimelinePlaybackState(timelineItems);
    });
  }, [timelineItems]);

  useEffect(() => {
    expressionSegmentMarkersRef.current = expressionSegmentMarkers;
  }, [expressionSegmentMarkers]);

  useEffect(() => {
    endExpressionKeysRef.current = endExpressionKeys;
  }, [endExpressionKeys]);

  // ── Init Cubism on canvas mount ──────────────────────────────────────────

  useEffect(() => {
    debugLogRef.current = onDebugLog;
  }, [onDebugLog]);

  useEffect(() => {
    expressionConfigsRef.current = expressionConfigs;
  }, [expressionConfigs]);

  useEffect(() => {
    expressionMetasRef.current = expressionMetas;
  }, [expressionMetas]);

  const getPersistableManualOverrides = useCallback((overrides: Record<string, number> = manualOverridesRef.current) => {
    const cleanOverrides = { ...overrides };
    for (const baseline of Object.values(expressionPreviewBaselinesRef.current)) {
      for (const [id, entry] of Object.entries(baseline)) {
        restoreManualOverride(cleanOverrides, id, entry);
      }
    }
    return cleanOverrides;
  }, []);

  const writeCurrentSession = useCallback((overrides: Record<string, number> = manualOverridesRef.current) => {
    const refs = timelineClipRefs(timelineItems);
    writeLive2DSession({
      modelPath,
      manualOverrides: getPersistableManualOverrides(overrides),
      motionAliases,
      timelineClipKeys: clipKeysFromRefs(refs),
      timelineClips: refs,
      timelineItems: timelinePersistenceItems(timelineItems),
      importedMotions: importedMotionsRef.current,
      expressionConfigs: expressionConfigsRef.current,
      expressionSegmentMarkers: expressionSegmentMarkersRef.current,
      endExpressionKeys: endExpressionKeysRef.current,
    });
  }, [getPersistableManualOverrides, modelPath, motionAliases, timelineItems]);

  const restoreExpressionPreviewBaseline = useCallback((key?: string) => {
    const baselines = expressionPreviewBaselinesRef.current;
    const keys = key ? [key] : Object.keys(baselines);
    let restored = false;

    for (const previewKey of keys) {
      const baseline = baselines[previewKey];
      if (!baseline) continue;
      for (const [id, entry] of Object.entries(baseline)) {
        restoreManualOverride(manualOverridesRef.current, id, entry);
      }
      delete baselines[previewKey];
      restored = true;
    }

    if (restored) {
      setActiveExpressionPreviews(Object.keys(baselines));
    }
    return restored;
  }, []);

  const clearExpressionPreviewState = useCallback(() => {
    expressionPreviewBaselinesRef.current = {};
    setActiveExpressionPreviews([]);
  }, []);

  const collectTransientExpressionParamIds = useCallback(() => {
    const ids = new Set<string>();
    for (const meta of expressionMetasRef.current) {
      const key = expressionKey(meta.name, meta.file);
      const config = expressionConfigsRef.current[key] ?? createDefaultExpressionConfig(meta);
      if (config.applyMode !== 'transient') continue;
      for (const operation of meta.parameters) ids.add(operation.id);
    }
    return ids;
  }, []);

  const stripTransientExpressionParameterOverrides = useCallback((overrides: Record<string, number>) => {
    const next = { ...overrides };
    for (const id of collectTransientExpressionParamIds()) delete next[id];
    return next;
  }, [collectTransientExpressionParamIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cubismReadyRef.current) return;
    CubismInit.initialize(canvas);
    CubismInit.resize();
    cubismReadyRef.current = true;
    setCanvasReady(true);
  }, []);

  // ── Animation loop ───────────────────────────────────────────────────────

  useEffect(() => {
    const loop = (now: number) => {
      const dt = lastTimeRef.current ? Math.min((now - lastTimeRef.current) / 1000, 0.05) : 0.016;
      lastTimeRef.current = now;

      try {
        const model = modelRef.current;
        if (model) {
          const player = motionPlayerRef.current;
          const motionActive = player.hasMotion;
          const transitionElapsed = transitionElapsedRef.current;
          if (transitionElapsed.active) {
            // Transition playback: SDK crossfades A→B via motion queue.
            // We just advance the timeline cursor through the transition block.
            model.update(dt, manualOverridesRef.current, { skipExpressions: true });
            player.tick(dt);
            const items = timelineItemsRef.current;
            const item = items[transitionElapsed.index];
            if (item?.kind === 'transition') {
              const elapsed = Math.min(item.duration, transitionElapsed.elapsed + dt);
              transitionElapsedRef.current = { ...transitionElapsed, elapsed };
              setTimelinePlayback(makeTimelinePlaybackState(items, transitionElapsed.index, elapsed, true));
              setCurrentTime(timelineTimeAtItem(items, transitionElapsed.index, elapsed));
              setDuration(timelineTotalDuration(items));
              if (elapsed >= item.duration) {
                transitionElapsedRef.current = { active: false, index: -1, elapsed: 0 };
                timelinePlaybackRef.current = { active: true, nextIndex: transitionElapsed.index + 2 };
                debugLogRef.current?.(
                  `[Live2D:transition-done] index=${transitionElapsed.index} elapsed=${elapsed.toFixed(3)}`,
                  'system',
                );
              }
            } else {
              transitionElapsedRef.current = { active: false, index: -1, elapsed: 0 };
            }
          } else if (motionActive) {
            model.update(dt, manualOverridesRef.current, {
              skipExpressions: true,
            });
            player.tick(dt);
            overlayRef.current.apply(model, player.currentTime);
          } else {
            model.update(dt, manualOverridesRef.current);
          }

          // Apply expression segment values for the current timeline position
          {
            const items = timelineItemsRef.current;

            // Track the correct timeline total time for use in idle-path expression evaluation
            let exprTimelineTime = lastTimelineTimeRef.current;
            if (transitionElapsed.active) {
              exprTimelineTime = timelineTimeAtItem(items, transitionElapsed.index, transitionElapsed.elapsed);
              lastTimelineTimeRef.current = exprTimelineTime;
            } else if (timelinePlaybackRef.current.active) {
              const idx = Math.max(0, timelinePlaybackRef.current.nextIndex - 1);
              const item = items[idx];
              const lt = item?.kind === 'motion' ? Math.max(0, player.currentTime - item.sourceStart) : player.currentTime;
              exprTimelineTime = timelineTimeAtItem(items, idx, lt);
              lastTimelineTimeRef.current = exprTimelineTime;
            }
            applySegmentExpressionToModel(
              model,
              exprTimelineTime,
              expressionSegmentMarkersRef.current,
              expressionMetasRef.current,
              timelineTotalDuration(items),
              endExpressionKeysRef.current,
            );
            // Recompute drawable vertices, opacities, and colors so expression
            // parameter changes (setParameterValue with save=false above) are
            // reflected in the render.  The Cubism SDK bakes drawable state
            // during model.update() — any parameter changes made after that
            // call are invisible until the next update().
            model.commitParameterValues();
          }

          motionTimeRef.current = player.currentTime;
          if (debugParamRef.current && debugFrameRef.current < 60) {
            debugFrameRef.current++;
            const snapshot = model.getDebugSnapshot(debugParamRef.current);
            const message = `[Live2D:param-preview] frame=${debugFrameRef.current} ${JSON.stringify(snapshot)}`;
            console.log(message);
            if (debugFrameRef.current === 1 || debugFrameRef.current % 10 === 0) {
              debugLogRef.current?.(message, 'system');
            }
          }
          CubismInit.resize();
          model.draw();
          const isTransitionActive = transitionElapsedRef.current.active;
          if (motionActive && !isTransitionActive) {
            setCurrentTime(player.currentTime);
            if (timelinePlaybackRef.current.active) {
              const items = timelineItemsRef.current;
              const currentIndex = Math.max(0, timelinePlaybackRef.current.nextIndex - 1);
              const item = items[currentIndex];
              const localTime = item?.kind === 'motion' ? Math.max(0, player.currentTime - item.sourceStart) : player.currentTime;
              setTimelinePlayback(makeTimelinePlaybackState(items, currentIndex, localTime, true));
            }
            if (player.hasMotion) setDuration(player.duration);
          }
          setIsPlaying(player.isPlaying || isTransitionActive);

          const ids = model.parameterIds;
          if (ids.length > 0) {
            const vals: Record<string, number> = {};
            for (let i = 0; i < ids.length; i++) vals[ids[i]] = model.getParameterValueAt(i);
            for (const [id, value] of Object.entries(manualOverridesRef.current)) vals[id] = value;
            setParamValues(vals);
          }
        }
      } catch (error) {
        console.error('[Live2D] Preview loop error:', error);
        debugLogRef.current?.(`[Live2D] Preview loop error: ${String(error)}`, 'stderr');
        const activeBeforeError = activeMotionRef.current;
        motionPlayerRef.current.unload();
        modelRef.current?.stopAllMotions();
        activeMotionRef.current = null;
        motionTimeRef.current = 0;
        motionSafeOverridesRef.current = stripTransientExpressionParameterOverrides(getPersistableManualOverrides());
        const model = modelRef.current;
        if (model) {
          const recoveredDuration = activeBeforeError
            ? getMotionDurationSeconds(
              model.motionEntries.find(e => e.group === activeBeforeError.group && e.index === activeBeforeError.index) ?? {
                group: activeBeforeError.group,
                index: activeBeforeError.index,
                name: `${activeBeforeError.group}_${activeBeforeError.index}`,
                file: '',
              },
              model,
              modelDataRef.current?.files,
            )
            : 0;
          model.applyParameterValues({ ...baseParameterValuesRef.current, ...motionSafeOverridesRef.current }, true);
          if (recoveredDuration > 0) setDuration(recoveredDuration);
        }
        setCurrentMotion(null);
        setCurrentTime(0);
        setTimelinePlayback(idleTimelinePlaybackState(timelineItemsRef.current));
        if (!activeBeforeError) setDuration(0);
        setIsPlaying(false);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Motion validation helper ─────────────────────────────────────────────

  function validateMotion(file: string, paramIds: Set<string>, files: Record<string, string>): string[] {
    const b64 = files[file];
    if (!b64) return [];
    try {
      const json = parseBase64Json(b64) as { Curves?: Array<{ Target: string; Id: string }> };
      const curves = json.Curves ?? [];
      return curves
        .filter(c => c.Target === 'Parameter' && !paramIds.has(c.Id))
        .map(c => c.Id)
        .filter((v, i, a) => a.indexOf(v) === i); // dedupe
    } catch {
      return [];
    }
  }

  function getMotionDurationSeconds(entry: MotionEntry, instance: ModelInstance, files?: Record<string, string>): number {
    const sdkDuration = instance.getMotionDuration(entry.group, entry.index);
    if (sdkDuration > 0) return sdkDuration;

    const b64 = files?.[entry.file];
    if (!b64) return 0;
    try {
      const motionJson = parseBase64Json(b64) as MotionData;
      const meta = motionJson.Meta as MotionData['Meta'] & { duration?: number };
      return Number(meta?.Duration) || Number(meta?.duration) || 0;
    } catch {
      return 0;
    }
  }

  const loadMotionIntoPlayer = useCallback((
    entry: MotionEntry,
    loop: boolean,
    onFinish?: () => void,
    startTime = 0,
    options?: { keepTimelinePositionOnFinish?: boolean; fadeInSeconds?: number; zeroCurveFades?: boolean },
  ) => {
    const instance = modelRef.current;
    const data = modelDataRef.current;
    if (!instance || !data) return false;
    const b64 = data.files[entry.file];
    if (!b64) return false;
    try {
      clearTimelineClipEndTimer();
      const durationSeconds = getMotionDurationSeconds(entry, instance, data.files);
      const motionBaseOverrides = getPersistableManualOverrides();
      motionSafeOverridesRef.current = stripTransientExpressionParameterOverrides(motionBaseOverrides);
      const clampedStartTime = Math.max(0, Math.min(startTime, durationSeconds || startTime));
      motionTimeRef.current = clampedStartTime;
      motionPlayerRef.current.load(entry.group, entry.index, instance, durationSeconds, loop);
      motionPlayerRef.current.scrub(clampedStartTime);
      const entryKey = clipKey(entry.group, entry.index);
      debugLogRef.current?.(
        `[Live2D:timeline-motion-load] motion=${entryKey} start=${clampedStartTime.toFixed(3)} fadeIn=${options?.fadeInSeconds ?? 'default'}`,
        'system',
      );
      motionPlayerRef.current.setOnFinish(() => {
        motionPlayerRef.current.unload();
        clearTimelineClipEndTimer();
        activeMotionRef.current = null;
        motionTimeRef.current = 0;
        setCurrentMotion(null);
        if (!options?.keepTimelinePositionOnFinish) {
          setCurrentTime(0);
          setTimelinePlayback(idleTimelinePlaybackState(timelineItemsRef.current));
          setDuration(0);
        }
        setIsPlaying(false);
        onFinish?.();
      });
      motionPlayerRef.current.play(clampedStartTime, options?.fadeInSeconds, options?.zeroCurveFades, options?.preserveCurrentMotion);
      activeMotionRef.current = { group: entry.group, index: entry.index, loop, onFinish };
      setDuration(durationSeconds);
      setCurrentTime(clampedStartTime);
      setIsPlaying(true);
      return true;
    } catch (error) {
      console.error('[Live2D] Motion preview parse error:', error);
      return false;
    }
  }, [getPersistableManualOverrides, stripTransientExpressionParameterOverrides]);

  const returnToBasePose = useCallback((options?: { keepTimelinePosition?: boolean }) => {
    const instance = modelRef.current;
    motionPlayerRef.current.unload();
    clearTimelineClipEndTimer();
    instance?.stopAllMotions();
    activeMotionRef.current = null;
    motionTimeRef.current = 0;
    motionSafeOverridesRef.current = stripTransientExpressionParameterOverrides(getPersistableManualOverrides());
    if (instance && !options?.keepTimelinePosition) {
      instance.applyParameterValues({ ...baseParameterValuesRef.current, ...motionSafeOverridesRef.current }, true);
    }
    setCurrentMotion(null);
    if (!options?.keepTimelinePosition) {
      setCurrentTime(0);
      setTimelinePlayback(idleTimelinePlaybackState(timelineItemsRef.current));
      setDuration(0);
    }
    setIsPlaying(false);
  }, [getPersistableManualOverrides, stripTransientExpressionParameterOverrides]);

  const startIdlePreview = useCallback(() => {
    const idle = modelRef.current?.motionEntries.find((e) => e.group.toLowerCase().includes('idle'));
    if (!idle) {
      returnToBasePose();
      return;
    }
    if (loadMotionIntoPlayer(idle, true)) setCurrentMotion(null);
  }, [loadMotionIntoPlayer, returnToBasePose]);

  // ── Model loading ────────────────────────────────────────────────────────

  const loadModelByPath = useCallback(async (path: string, options?: { keepManualOverrides?: boolean; keepTimeline?: boolean }) => {
    const savedExpressionConfigs = options?.keepManualOverrides ? expressionConfigsRef.current : {};
    setModelLoaded(false);
    setModelError(null);
    setModelPath(path);
    setTimelinePlayback(idleTimelinePlaybackState(options?.keepTimeline ? timelineItemsRef.current : []));
    setParamRanges({});
    setParamValues({});
    setParamMetas([]);
    setExpressionMetas([]);
    setExpressionConfigs({});
    clearExpressionPreviewState();
    expressionConfigsRef.current = savedExpressionConfigs;
    if (!options?.keepManualOverrides) manualOverridesRef.current = {};
    if (!options?.keepManualOverrides) importedMotionsRef.current = [];
    if (!options?.keepTimeline) setTimelineItems([]);

    try {
      const data: Live2DModelData = await readLive2DModelData(path);
      modelDataRef.current = data;

      const { instance } = await loadModelFromData(
        data.modelJson as Record<string, unknown>,
        data.files,
      );

      if (modelRef.current) modelRef.current.release();
      modelRef.current = instance;
      motionSafeOverridesRef.current = stripTransientExpressionParameterOverrides(getPersistableManualOverrides());
      motionPlayerRef.current.unload();
      clearTimelineClipEndTimer();
      modelRef.current?.stopAllMotions();
      activeMotionRef.current = null;
      motionTimeRef.current = 0;
      const loadedImportedMotions = normalizeImportedMotions(importedMotionsRef.current);
      for (const imported of loadedImportedMotions) {
        const usedIndices = instance.motionEntries
          .filter(e => e.group === 'imported')
          .map(e => e.index);
        const nextIndex = imported.index ?? (usedIndices.length > 0 ? Math.max(...usedIndices) + 1 : 0);
        const group = imported.group ?? 'imported';
        const key = importKey(group, nextIndex);
        const motionFileName = uniqueImportedFileName(imported.fileName, group, nextIndex);
        const alreadyLoaded = instance.motionEntries.some(e => e.group === group && e.index === nextIndex);
        if (!alreadyLoaded) {
          const buf = base64ToArrayBuffer(imported.base64);
          if (!instance.addLoadedMotion(key, buf)) continue;
          if (modelDataRef.current) modelDataRef.current.files[motionFileName] = imported.base64;
          instance.motionEntries.push({ group, index: nextIndex, name: imported.name, file: motionFileName });
        }
        imported.index = nextIndex;
        imported.group = group;
      }
      importedMotionsRef.current = normalizeImportedMotions(loadedImportedMotions);
      instance.motionEntries = normalizeMotionEntries(instance.motionEntries);
      setMotionEntries(instance.motionEntries);

      const values: Record<string, number> = {};
      const ranges: Record<string, ParamRange> = {};
      for (let i = 0; i < instance.parameterIds.length; i++) {
        const id = instance.parameterIds[i];
        values[id] = instance.getParameterValueAt(i);
        ranges[id] = instance.getParameterRangeAt(i);
      }
      baseParameterValuesRef.current = values;
      setParamValues(values);
      setParamRanges(ranges);
      setParamMetas(collectParamMetas(instance.parameterIds, data.modelJson as Record<string, unknown>, data.files));
      const nextExpressionMetas = collectExpressionMetas(data.modelJson as Record<string, unknown>, data.files);
      const nextExpressionConfigs = mergeExpressionConfigs(nextExpressionMetas, expressionConfigsRef.current);
      setExpressionMetas(nextExpressionMetas);
      setExpressionConfigs(nextExpressionConfigs);
      expressionConfigsRef.current = nextExpressionConfigs;
      CubismInit.resize();
      setModelLoaded(true);

      // Auto-start Idle motion
      startIdlePreview();
    } catch (err: unknown) {
      setModelError(String(err));
    }
  }, [clearExpressionPreviewState, getPersistableManualOverrides, startIdlePreview, stripTransientExpressionParameterOverrides]);

  const openImportDialog = useCallback(async () => {
    const path = await pickAnyFile('选择 Live2D 模型文件 (.model3.json)');
    if (path) await loadModelByPath(path);
  }, [loadModelByPath]);

  const openMotionImportDialog = useCallback(async () => {
    if (importingMotionRef.current) return;
    const instance = modelRef.current;
    if (!instance) return;
    importingMotionRef.current = true;
    try {
      const path = await pickAnyFile('选择动作文件 (.motion3.json)');
      if (!path) return;
      const b64 = await readFileBase64(path);
      const fileName = path.split(/[/\\]/).pop() ?? path;
      const existingImport = importedMotionsRef.current.find((motion) => motion.path === path || motion.base64 === b64);
      const existingGroup = existingImport?.group ?? 'imported';
      const existingIndex = existingImport?.index;
      if (existingIndex !== undefined) {
        const existingEntry = instance.motionEntries.find((entry) => entry.group === existingGroup && entry.index === existingIndex);
        if (existingEntry) {
          setMotionEntries(normalizeMotionEntries(instance.motionEntries));
          return;
        }
      }

      const group = 'imported';
      const usedIndices = instance.motionEntries
        .filter(e => e.group === group)
        .map(e => e.index);
      const nextIndex = usedIndices.length > 0 ? Math.max(...usedIndices) + 1 : 0;
      const key = importKey(group, nextIndex);
      const motionFileName = uniqueImportedFileName(fileName, group, nextIndex);
      const buf = base64ToArrayBuffer(b64);
      const ok = instance.addLoadedMotion(key, buf);
      if (!ok) {
        console.error('[Live2D] Failed to create motion from', fileName);
        return;
      }
      if (modelDataRef.current) modelDataRef.current.files[motionFileName] = b64;
      const motionName = fileName.replace(/\.motion3\.json$/i, '');
      const entry = { group, index: nextIndex, name: motionName, file: motionFileName };
      instance.motionEntries = normalizeMotionEntries([...instance.motionEntries, entry]);
      importedMotionsRef.current = normalizeImportedMotions([
        ...importedMotionsRef.current,
        { path, fileName, name: motionName, base64: b64, group, index: nextIndex },
      ]);
      setMotionAliases(prev => ({ ...prev, [key]: motionName }));
      setMotionEntries(instance.motionEntries);
    } catch (err) {
      console.error('[Live2D] Motion import error:', err);
    } finally {
      importingMotionRef.current = false;
    }
  }, []);

  const playMotion = useCallback((group: string, index: number) => {
    timelinePlaybackRef.current = { active: false, nextIndex: 0 };
    setTimelinePlayback(idleTimelinePlaybackState(timelineItemsRef.current));
    if (currentMotion?.group === group && currentMotion.index === index) {
      returnToBasePose();
      return;
    }
    const entry = modelRef.current?.motionEntries.find((motion) => motion.group === group && motion.index === index);
    if (!entry) return;
    if (loadMotionIntoPlayer(entry, false, returnToBasePose)) {
      setCurrentMotion({ group, index });
    }
  }, [currentMotion, loadMotionIntoPlayer, returnToBasePose]);

  const setParameter = useCallback((id: string, value: number) => {
    const restoredPreview = restoreExpressionPreviewBaseline();
    const range = paramRanges[id];
    const nextValue = clampParameterValue(value, range);
    writeManualOverride(manualOverridesRef.current, id, nextValue, range);
    writeCurrentSession();
    debugParamRef.current = id;
    debugFrameRef.current = 0;
    const rangeText = range ? ` range=[${range.min},${range.max}] default=${range.default}` : '';
    debugLogRef.current?.(
      `[Live2D:param-set] id=${id} value=${nextValue}${rangeText} overrides=${Object.keys(manualOverridesRef.current).length}${restoredPreview ? ' preview=cancelled' : ''}`,
      'system',
    );
    setParamValues(prev => ({ ...prev, [id]: nextValue }));
  }, [paramRanges, restoreExpressionPreviewBaseline, writeCurrentSession]);

  const resetAllParameters = useCallback(() => {
    if (motionPlayerRef.current.hasMotion) return;
    const restoredPreview = restoreExpressionPreviewBaseline();
    manualOverridesRef.current = {};
    writeCurrentSession({});
    const defaults: Record<string, number> = {};
    for (const [id, range] of Object.entries(paramRanges)) defaults[id] = range.default;
    setParamValues((prev) => ({ ...prev, ...defaults }));
    debugLogRef.current?.(
      `[Live2D:param-reset-all] count=${Object.keys(defaults).length}${restoredPreview ? ' preview=cancelled' : ''}`,
      'system',
    );
  }, [paramRanges, restoreExpressionPreviewBaseline, writeCurrentSession]);

  const updateExpressionConfig = useCallback((
    name: string,
    patch: Partial<Omit<ExpressionPresetConfig, 'name' | 'file'>>,
  ) => {
    setExpressionConfigs((prev) => {
      const current = prev[name];
      if (!current) return prev;
      const merged = { ...current, ...patch };
      const normalized = {
        ...merged,
        applyMode: inferExpressionApplyMode(merged),
        isDefaultStartup: merged.role === 'system' || merged.role === 'watermark',
        isWatermarkControl: merged.role === 'watermark',
      };
      const next = { ...prev, [name]: normalized };
      expressionConfigsRef.current = next;
      writeCurrentSession();
      return next;
    });
  }, [writeCurrentSession]);

  const previewExpression = useCallback((name: string) => {
    const metaByKey = new Map(expressionMetas.map((entry) => [expressionKey(entry.name, entry.file), entry]));
    const meta = expressionMetas.find((entry) => expressionKey(entry.name, entry.file) === name || entry.name === name);
    if (!meta) return;

    const key = expressionKey(meta.name, meta.file);
    const previousBaselines = { ...expressionPreviewBaselinesRef.current };
    const wasActive = Object.prototype.hasOwnProperty.call(previousBaselines, key);
    const affectedIds = new Set<string>();

    for (const baseline of Object.values(previousBaselines)) {
      for (const id of Object.keys(baseline)) affectedIds.add(id);
    }
    for (const operation of meta.parameters) affectedIds.add(operation.id);

    if (wasActive) {
      delete expressionPreviewBaselinesRef.current[key];
    } else {
      const baseline: Record<string, ExpressionPreviewBaselineEntry> = {};
      for (const operation of meta.parameters) {
        if (baseline[operation.id] !== undefined) continue;
        const existingEntry = Object.values(previousBaselines)
          .map((entries) => entries[operation.id])
          .find(Boolean);
        if (existingEntry) {
          baseline[operation.id] = { ...existingEntry };
          continue;
        }

        const hadManualOverride = Object.prototype.hasOwnProperty.call(manualOverridesRef.current, operation.id);
        baseline[operation.id] = {
          value: hadManualOverride
            ? manualOverridesRef.current[operation.id]
            : paramValues[operation.id] ?? paramRanges[operation.id]?.default ?? 0,
          hadManualOverride,
        };
      }
      expressionPreviewBaselinesRef.current[key] = baseline;
    }

    const nextActiveKeys = Object.keys(expressionPreviewBaselinesRef.current);
    const baseEntries: Record<string, ExpressionPreviewBaselineEntry> = {};
    for (const id of affectedIds) {
      const entry = Object.values(previousBaselines)
        .map((entries) => entries[id])
        .find(Boolean)
        ?? Object.values(expressionPreviewBaselinesRef.current)
          .map((entries) => entries[id])
          .find(Boolean);
      if (entry) baseEntries[id] = entry;
    }

    const computedValues: Record<string, number> = {};
    for (const id of affectedIds) {
      const entry = baseEntries[id];
      if (entry) computedValues[id] = entry.value;
    }

    const finalPreviewValues: Record<string, number> = {};
    for (const activeKey of nextActiveKeys) {
      const activeMeta = metaByKey.get(activeKey);
      if (!activeMeta) continue;
      for (const operation of activeMeta.parameters) {
        const baseValue = computedValues[operation.id]
          ?? paramValues[operation.id]
          ?? paramRanges[operation.id]?.default
          ?? 0;
        const nextValue = clampParameterValue(
          applyExpressionOperation(baseValue, operation),
          paramRanges[operation.id],
        );
        computedValues[operation.id] = nextValue;
        finalPreviewValues[operation.id] = nextValue;
      }
    }

    for (const id of affectedIds) {
      const entry = baseEntries[id];
      if (Object.prototype.hasOwnProperty.call(finalPreviewValues, id)) {
        writeManualOverride(manualOverridesRef.current, id, finalPreviewValues[id], paramRanges[id]);
      } else if (entry) {
        restoreManualOverride(manualOverridesRef.current, id, entry);
      }
    }

    setActiveExpressionPreviews(nextActiveKeys);
    debugLogRef.current?.(
      wasActive
        ? `[Live2D:expression-preview-cancel] name=${meta.name} file=${meta.file} active=${nextActiveKeys.length}`
        : `[Live2D:expression-preview] name=${meta.name} file=${meta.file} params=${meta.parameters.length} active=${nextActiveKeys.length}`,
      'system',
    );
    setParamValues((prev) => {
      const next = { ...prev };
      for (const id of affectedIds) {
        if (Object.prototype.hasOwnProperty.call(finalPreviewValues, id)) {
          next[id] = finalPreviewValues[id];
        } else if (Object.prototype.hasOwnProperty.call(manualOverridesRef.current, id)) {
          next[id] = manualOverridesRef.current[id];
        } else if (baseEntries[id]) {
          next[id] = baseEntries[id].value;
        }
      }
      return next;
    });
  }, [expressionMetas, paramRanges, paramValues]);

  const buildAdaptedPreset = useCallback((name: string): Live2DAdaptedPreset | null => {
    if (!modelPath) return null;

    const expressions = expressionMetas.map((meta) => {
      const key = expressionKey(meta.name, meta.file);
      const config = expressionConfigsRef.current[key] ?? createDefaultExpressionConfig(meta);
      return {
        ...config,
        applyMode: inferExpressionApplyMode(config),
        isDefaultStartup: config.role === 'system' || config.role === 'watermark',
        isWatermarkControl: config.role === 'watermark',
        parameters: meta.parameters,
      };
    });
    const defaultAppearance = expressions.find((expression) => expression.isDefaultStartup)?.name;
    const emotionMap: Record<string, string> = {};
    for (const expression of expressions) {
      if (expression.role === 'expression') {
        emotionMap[expression.label || expression.name] = expression.name;
      }
    }
    const appearancePresets = expressions
      .filter((expression) => expression.role === 'appearance')
      .map((expression) => ({
        key: expression.label || expression.name,
        expression: expression.name,
        description: expression.description || undefined,
      }));
    const excludedExpressions = expressions
      .filter((expression) => expression.role === 'system' || expression.role === 'watermark' || expression.role === 'test')
      .map((expression) => ({
        name: expression.name,
        label: expression.label || expression.name,
        file: expression.file,
        reason: expression.role === 'watermark'
          ? '默认启动/水印版权控制，不作为普通表情或持久外观'
          : expression.role === 'test'
            ? '测试/危险表达式，不作为运行时能力'
            : '默认启动表达式，不作为普通表情或持久外观',
      }));

    return {
      schemaVersion: 1,
      name,
      model: {
        name,
        modelPath,
        kScale: 0.75,
        initialXshift: 0,
        initialYshift: 0,
      },
      defaultAppearance,
      emotionMap,
      expressions,
      appearancePresets,
      excludedExpressions,
      timeline: {
        clipKeys: clipKeysFromRefs(timelineClipRefs(timelineItems)),
        clips: timelineClipRefs(timelineItems),
        items: timelinePersistenceItems(timelineItems),
      },
      manualOverrides: getPersistableManualOverrides(),
      importedMotions: importedMotionsRef.current,
      expressionSegmentMarkers: expressionSegmentMarkersRef.current,
      endExpressionKeys: endExpressionKeysRef.current,
    };
  }, [expressionMetas, getPersistableManualOverrides, modelPath, timelineItems]);

  const playTimelineFromIndex = useCallback((index: number, startTime = 0) => {
    const items = timelineItemsRef.current;
    const item = items[index];
    debugLogRef.current?.(
      `[Live2D:timeline-play-index] index=${index} kind=${item?.kind ?? 'none'} start=${startTime.toFixed(3)}`,
      'system',
    );
    if (!item) {
      timelinePlaybackRef.current = { active: false, nextIndex: 0 };
      setTimelinePlayback(idleTimelinePlaybackState(items));
      returnToBasePose();
      return;
    }
    if (item.kind === 'transition') {
      clearTimelineClipEndTimer();
      const nextItem = items[index + 1];
      const entry = nextItem?.kind === 'motion'
        ? modelRef.current?.motionEntries.find((motion) => motion.group === nextItem.group && motion.index === nextItem.index)
        : null;
      if (!nextItem || nextItem.kind !== 'motion' || !entry) {
        playTimelineFromIndex(index + 1);
        return;
      }
      const elapsed = Math.max(0, Math.min(startTime, item.duration));
      transitionElapsedRef.current = { active: true, index, elapsed };
      timelinePlaybackRef.current = { active: true, nextIndex: index + 1 };
      setTimelinePlayback(makeTimelinePlaybackState(items, index, elapsed, true));
      setDuration(timelineTotalDuration(items));
      setCurrentTime(timelineTimeAtItem(items, index, elapsed));
      setCurrentMotion(null);
      setIsPlaying(true);
      motionPlayerRef.current.unload();
      modelRef.current?.stopAllMotions();
      loadMotionIntoPlayer(entry, false, () => {
        clearTimelineClipEndTimer();
        const nextIndex = timelinePlaybackRef.current.nextIndex;
        if (!timelinePlaybackRef.current.active || nextIndex >= timelineItemsRef.current.length) {
          timelinePlaybackRef.current = { active: false, nextIndex: 0 };
          const finishedItems = timelineItemsRef.current;
          const finishedTime = timelineTotalDuration(finishedItems);
          const finishedPlayback = timelinePlaybackStateAtTime(finishedItems, finishedTime, false);
          setTimelinePlayback(finishedPlayback);
          setCurrentTime(finishedPlayback.totalTime);
          setDuration(finishedPlayback.totalDuration);
          returnToBasePose({ keepTimelinePosition: true });
          return;
        }
        playTimelineFromIndex(nextIndex);
      }, nextItem.sourceStart, { keepTimelinePositionOnFinish: true, fadeInSeconds: item.duration, preserveCurrentMotion: true });
      debugLogRef.current?.(
        `[Live2D:transition-start] uid=${item.uid} duration=${item.duration.toFixed(3)} elapsed=${elapsed.toFixed(3)} target=${nextItem.group}_${nextItem.index} mode=sdk-crossfade`,
        'system',
      );
      return;
    }

    const entry = modelRef.current?.motionEntries.find((motion) => motion.group === item.group && motion.index === item.index);
    if (!entry) return;

    const clipStartTime = Math.max(0, Math.min(startTime, item.duration || startTime));
    timelinePlaybackRef.current = { active: true, nextIndex: index + 1 };
    setTimelinePlayback(makeTimelinePlaybackState(items, index, clipStartTime, true));
    setDuration(timelineTotalDuration(items));
    setCurrentTime(timelineTimeAtItem(items, index, clipStartTime));
    clearTimelineClipEndTimer();
    if (loadMotionIntoPlayer(entry, false, () => {
      clearTimelineClipEndTimer();
      const nextIndex = timelinePlaybackRef.current.nextIndex;
      if (!timelinePlaybackRef.current.active || nextIndex >= timelineItemsRef.current.length) {
        timelinePlaybackRef.current = { active: false, nextIndex: 0 };
        const finishedItems = timelineItemsRef.current;
        const finishedTime = timelineTotalDuration(finishedItems);
        const finishedPlayback = timelinePlaybackStateAtTime(finishedItems, finishedTime, false);
        setTimelinePlayback(finishedPlayback);
        setCurrentTime(finishedPlayback.totalTime);
        setDuration(finishedPlayback.totalDuration);
        returnToBasePose({ keepTimelinePosition: true });
        return;
      }
      playTimelineFromIndex(nextIndex);
    }, item.sourceStart + clipStartTime, { keepTimelinePositionOnFinish: true })) {
      const remainingClipMs = Math.max(0, (item.duration - clipStartTime) * 1000);
      if (remainingClipMs > 0 && item.sourceEnd < item.sourceDuration) {
        timelineClipEndTimerRef.current = window.setTimeout(() => {
          if (!timelinePlaybackRef.current.active || timelinePlaybackRef.current.nextIndex !== index + 1) return;
          motionPlayerRef.current.unload();
          clearTimelineClipEndTimer();
          playTimelineFromIndex(index + 1);
        }, remainingClipMs);
      }
      setDuration(timelineTotalDuration(items));
      setCurrentMotion({ group: item.group, index: item.index });
    }
  }, [loadMotionIntoPlayer, returnToBasePose]);

  const togglePlay = useCallback(() => {
    const active = activeMotionRef.current;
    const transition = transitionElapsedRef.current;
    if (active || transition.active) {
      const items = timelineItemsRef.current;
      const preserveTimeline = timelinePlaybackRef.current.active && items.length > 0;
      const currentIndex = transition.active
        ? transition.index
        : preserveTimeline
          ? Math.max(0, Math.min(items.length - 1, timelinePlaybackRef.current.nextIndex - 1))
          : -1;
      const item = items[currentIndex];
      const playerTime = transition.active
        ? transition.elapsed
        : item?.kind === 'motion'
          ? Math.max(0, motionPlayerRef.current.currentTime - item.sourceStart)
          : motionPlayerRef.current.currentTime;
      transitionElapsedRef.current = { active: false, index: -1, elapsed: 0 };
      timelinePlaybackRef.current = { active: false, nextIndex: 0 };
      if (preserveTimeline && currentIndex >= 0) {
        const nextPlayback = makeTimelinePlaybackState(items, currentIndex, playerTime, false);
        setTimelinePlayback(nextPlayback);
        setCurrentTime(nextPlayback.totalTime);
        setDuration(nextPlayback.totalDuration);
      }
      motionPlayerRef.current.unload();
      clearTimelineClipEndTimer();
      modelRef.current?.stopAllMotions();
      activeMotionRef.current = null;
      setIsPlaying(false);
      return;
    }

    if (timelineItemsRef.current.length > 0) {
      const playback = timelinePlayback;
      const startIndex = playback.itemIndex >= 0
        ? playback.itemIndex
        : currentMotion
          ? Math.max(0, timelineItemsRef.current.findIndex((item) => item.kind === 'motion' && item.group === currentMotion.group && item.index === currentMotion.index))
          : 0;
      const startClipTime = playback.itemIndex >= 0
        ? Math.max(0, playback.totalTime - playback.itemStartTime)
        : 0;
      playTimelineFromIndex(startIndex < 0 ? 0 : startIndex, startClipTime);
      return;
    }

    if (!currentMotion) {
      startIdlePreview();
      return;
    }

    const entry = modelRef.current?.motionEntries.find(e => e.group === currentMotion.group && e.index === currentMotion.index);
    if (entry) loadMotionIntoPlayer(entry, false, returnToBasePose);
  }, [currentMotion, loadMotionIntoPlayer, playTimelineFromIndex, returnToBasePose, startIdlePreview, timelinePlayback]);

  const scrub = useCallback((time: number) => {
    // SDK-driven preview is intentionally used for correctness (same as frontend).
    // Precise non-linear scrubbing will need a separate verified evaluator/export path.
    const timelineSeeking = timelineItemsRef.current.length > 0 && !motionPlayerRef.current.hasMotion;
    const total = timelinePlaybackRef.current.active || timelineSeeking
      ? timelineTotalDuration(timelineItemsRef.current)
      : duration;
    motionTimeRef.current = Math.max(0, Math.min(time, total || time));
    setCurrentTime(motionTimeRef.current);
    if (timelinePlaybackRef.current.active || timelineSeeking) {
      const clips = timelineItemsRef.current;
      setTimelinePlayback(timelinePlaybackStateAtTime(clips, motionTimeRef.current, timelinePlaybackRef.current.active));
    }
  }, [duration]);

  const seekTimeline = useCallback((time: number) => {
    const clips = timelineItemsRef.current;
    if (clips.length === 0) return;
    transitionElapsedRef.current = { active: false, index: -1, elapsed: 0 };
    clearTimelineClipEndTimer();
    timelinePlaybackRef.current = { active: false, nextIndex: 0 };
    motionPlayerRef.current.unload();
    modelRef.current?.stopAllMotions();
    activeMotionRef.current = null;
    const nextPlayback = timelinePlaybackStateAtTime(clips, time, false);
    lastTimelineTimeRef.current = nextPlayback.totalTime;
    motionTimeRef.current = Math.max(0, nextPlayback.totalTime - nextPlayback.itemStartTime);
    setTimelinePlayback(nextPlayback);
    setCurrentTime(nextPlayback.totalTime);
    setDuration(nextPlayback.totalDuration);
    const item = clips[nextPlayback.itemIndex];
    setCurrentMotion(
      item?.kind === 'motion'
        ? { group: item.group, index: item.index }
        : null,
    );
    setIsPlaying(false);
  }, []);

  const renameMotion = useCallback((key: string, name: string) => {
    setMotionAliases((prev) => {
      const next = { ...prev, [key]: name };
      const sep = key.lastIndexOf('_');
      const group = sep > 0 ? key.slice(0, sep) : '';
      const index = sep > 0 ? Number(key.slice(sep + 1)) : Number.NaN;
      if (group && !Number.isNaN(index)) {
        setTimelineItems((items) => items.map((item) => (
          item.kind === 'motion' && item.group === group && item.index === index
            ? { ...item, label: name || `${group}#${index}` }
            : item
        )));
      }
      return next;
    });
  }, []);

  const deleteMotion = useCallback((group: string, index: number) => {
    if (group !== 'imported') return;
    const key = clipKey(group, index);
    const isCurrentMotion = currentMotion?.group === group && currentMotion.index === index;
    if (isCurrentMotion) returnToBasePose();
    modelRef.current?.removeLoadedMotion(key);
    if (modelRef.current) {
      modelRef.current.motionEntries = modelRef.current.motionEntries.filter((entry) => !(entry.group === group && entry.index === index));
    }
    importedMotionsRef.current = normalizeImportedMotions(importedMotionsRef.current.filter((motion) => !(
      (motion.group ?? 'imported') === group && motion.index === index
    )));
    setMotionEntries((prev) => prev.filter((entry) => !(entry.group === group && entry.index === index)));
    setMotionAliases((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setTimelineItems((prev) => {
      const next = prev.filter((item) => !(item.kind === 'motion' && item.group === group && item.index === index));
      setTimelinePlayback(idleTimelinePlaybackState(next));
      return next;
    });
    setCurrentMotion((current) => (
      current?.group === group && current.index === index ? null : current
    ));
  }, [currentMotion, returnToBasePose]);

  // ── Timeline clip management ─────────────────────────────────────────────

  function createTimelineClip(group: string, index: number, uidSuffix = `${Date.now()}`): TimelineClip | null {
    const instance = modelRef.current;
    const data = modelDataRef.current;
    if (!instance) return null;

    const entry = instance.motionEntries.find(e => e.group === group && e.index === index);
    if (!entry) return null;

    const paramSet = new Set(instance.parameterIds);
    const missingParams = data
      ? validateMotion(entry.file, paramSet, data.files)
      : [];
    const label = motionAliases[`${group}_${index}`] ?? `${group}#${index}`;
    const sourceDuration = getMotionDurationSeconds(entry, instance, data?.files);
    return {
      kind: 'motion',
      uid: `${group}_${index}_${uidSuffix}`,
      group,
      index,
      label,
      sourceDuration,
      sourceStart: 0,
      sourceEnd: sourceDuration,
      duration: sourceDuration,
      missingParams,
    };
  }

  const addClipToTimeline = useCallback((group: string, index: number, beforeUid?: string | null) => {
    const clip = createTimelineClip(group, index);
    if (!clip) return;
    setTimelineItems(prev => insertTimelineItem(prev, clip, beforeUid));
  }, [motionAliases]);

  const addTransitionAfter = useCallback((afterUid: string, duration = 0.3) => {
    setTimelineItems((prev) => {
      const index = prev.findIndex((item) => item.uid === afterUid);
      if (index < 0 || prev[index]?.kind !== 'motion' || prev[index + 1]?.kind !== 'motion') return prev;
      const transition: TimelineTransition = {
        kind: 'transition',
        uid: `transition_${Date.now()}`,
        duration: Math.max(0.1, duration),
      };
      return [...prev.slice(0, index + 1), transition, ...prev.slice(index + 1)];
    });
  }, []);

  const resizeTransition = useCallback((uid: string, duration: number) => {
    setTimelineItems((prev) => prev.map((item) => (
      item.kind === 'transition' && item.uid === uid
        ? { ...item, duration: Math.max(0.1, duration) }
        : item
    )));
  }, []);

  const restoreTimelineItems = useCallback((items: PersistedTimelineItem[]) => {
    const restoredItems = items.flatMap((item, index): TimelineItem[] => {
      if (item.kind === 'transition') {
        return [{ kind: 'transition', uid: item.uid ?? `transition_restored_${index}_${Date.now()}`, duration: Math.max(0.05, item.duration) }];
      }
      const clip = createTimelineClip(item.group, item.index, item.uid ?? `restored_${index}_${Date.now()}`);
      if (!clip) return [];
      const sourceDuration = item.sourceDuration || clip.sourceDuration;
      const sourceStart = Math.max(0, Math.min(item.sourceStart, sourceDuration));
      const sourceEnd = Math.max(sourceStart, Math.min(item.sourceEnd, sourceDuration));
      return [{ ...clip, sourceDuration, sourceStart, sourceEnd, duration: Math.max(0, sourceEnd - sourceStart) }];
    });
    setTimelineItems(restoredItems);
    setTimelinePlayback(idleTimelinePlaybackState(restoredItems));
  }, [motionAliases]);

  const restoreTimelineClips = useCallback((refs: TimelineClipRef[]) => {
    const restoredClips = refs.flatMap((ref, index) => {
      const clip = createTimelineClip(ref.group, ref.index, `restored_${index}_${Date.now()}`);
      return clip ? [clip] : [];
    });
    setTimelineItems(restoredClips);
    setTimelinePlayback(idleTimelinePlaybackState(restoredClips));
  }, [motionAliases]);

  const moveClipInTimeline = useCallback((uid: string, beforeUid: string | null) => {
    setTimelineItems(prev => moveTimelineItem(prev, uid, beforeUid));
  }, []);

  const trimClip = useCallback((uid: string, edge: 'start' | 'end', sourceTime: number) => {
    setTimelineItems((prev) => prev.map((item) => {
      if (item.kind !== 'motion' || item.uid !== uid) return item;
      const minDuration = Math.min(0.05, item.sourceDuration);
      if (edge === 'start') {
        const sourceStart = Math.max(0, Math.min(sourceTime, item.sourceEnd - minDuration));
        return { ...item, sourceStart, duration: item.sourceEnd - sourceStart };
      }
      const sourceEnd = Math.min(item.sourceDuration, Math.max(sourceTime, item.sourceStart + minDuration));
      return { ...item, sourceEnd, duration: sourceEnd - item.sourceStart };
    }));
  }, []);

  const splitClipAtTimelineTime = useCallback((time: number) => {
    setTimelineItems((prev) => {
      const playback = timelinePlaybackStateAtTime(prev, time, false);
      const item = prev[playback.itemIndex];
      if (item?.kind !== 'motion') return prev;

      const localTime = Math.max(0, playback.totalTime - playback.itemStartTime);
      const splitSourceTime = item.sourceStart + localTime;
      const minDuration = Math.min(0.05, item.sourceDuration);
      if (splitSourceTime <= item.sourceStart + minDuration || splitSourceTime >= item.sourceEnd - minDuration) return prev;

      const left: TimelineClip = {
        ...item,
        uid: `${item.uid}_left_${Date.now()}`,
        sourceEnd: splitSourceTime,
        duration: splitSourceTime - item.sourceStart,
      };
      const right: TimelineClip = {
        ...item,
        uid: `${item.uid}_right_${Date.now()}`,
        sourceStart: splitSourceTime,
        duration: item.sourceEnd - splitSourceTime,
      };
      const next = [...prev.slice(0, playback.itemIndex), left, right, ...prev.slice(playback.itemIndex + 1)];
      setTimelinePlayback(makeTimelinePlaybackState(next, playback.itemIndex, left.duration, false));
      return next;
    });
  }, []);

  const playClip = useCallback((uid: string) => {
    const index = timelineItemsRef.current.findIndex((clip) => clip.uid === uid);
    if (index < 0) return;
    timelinePlaybackRef.current = { active: false, nextIndex: 0 };
    setTimelinePlayback(makeTimelinePlaybackState(timelineItemsRef.current, index, 0, true));
    playTimelineFromIndex(index);
  }, [playTimelineFromIndex]);

  const removeClipFromTimeline = useCallback((uid: string) => {
    setTimelineItems((prev) => {
      const next = prev.filter(c => c.uid !== uid);
      setTimelinePlayback(idleTimelinePlaybackState(next));
      return next;
    });
  }, []);

  const clearTimeline = useCallback(() => {
    timelinePlaybackRef.current = { active: false, nextIndex: 0 };
    setTimelinePlayback(idleTimelinePlaybackState());
    setTimelineItems([]);
  }, []);

  const addExpressionSegmentMarker = useCallback((time: number) => {
    const totalDur = timelineTotalDuration(timelineItemsRef.current);
    const clamped = Math.max(0, Math.min(time, totalDur));
    setExpressionSegmentMarkers((prev) => [
      ...prev,
      { uid: `expmarker_${Date.now()}`, time: clamped, expressionKeys: [] },
    ]);
  }, []);

  const removeExpressionSegmentMarker = useCallback((uid: string) => {
    setExpressionSegmentMarkers((prev) => prev.filter((m) => m.uid !== uid));
  }, []);

  const updateExpressionSegmentMarker = useCallback((uid: string, expressionKeys: string[]) => {
    setExpressionSegmentMarkers((prev) =>
      prev.map((m) => (m.uid === uid ? { ...m, expressionKeys } : m)),
    );
  }, []);

  const moveExpressionSegmentMarker = useCallback((uid: string, time: number) => {
    const totalDur = timelineTotalDuration(timelineItemsRef.current);
    setExpressionSegmentMarkers((prev) =>
      prev.map((m) => (m.uid === uid ? { ...m, time: Math.max(0, Math.min(time, totalDur)) } : m)),
    );
  }, []);

  const segmentExpressionKeyAtTime = useCallback((time: number): string | null => {
    const totalDur = timelineTotalDuration(timelineItemsRef.current);
    const segment = findExpressionSegment(expressionSegmentMarkersRef.current, time, totalDur, endExpressionKeysRef.current);
    return segment?.expressionKeys?.[0] ?? null;
  }, []);

  const segmentExpressionKeysAtTime = useCallback((time: number): string[] => {
    const totalDur = timelineTotalDuration(timelineItemsRef.current);
    const segment = findExpressionSegment(expressionSegmentMarkersRef.current, time, totalDur, endExpressionKeysRef.current);
    return segment?.expressionKeys ?? [];
  }, []);

  const assignExpressionToSegmentAtTime = useCallback((time: number, expressionKey: string) => {
    const totalDur = timelineTotalDuration(timelineItemsRef.current);
    const markers = expressionSegmentMarkersRef.current;
    // Find the right boundary marker: the first marker whose time is > current time.
    // That marker's expressionKeys control the segment containing `time`.
    const sorted = [...markers].sort((a, b) => a.time - b.time);
    const boundaryMarker = sorted.find((m) => m.time > time) ?? null;
    if (boundaryMarker) {
      // Toggle: if already assigned, remove it; otherwise add it
      setExpressionSegmentMarkers((prev) =>
        prev.map((m) => {
          if (m.uid !== boundaryMarker.uid) return m;
          const has = m.expressionKeys.includes(expressionKey);
          return {
            ...m,
            expressionKeys: has
              ? m.expressionKeys.filter((k) => k !== expressionKey)
              : [...m.expressionKeys, expressionKey],
          };
        }),
      );
    } else {
      // No marker ahead → we're in the last segment (or there are no markers)
      setEndExpressionKeys((prev) => {
        const has = prev.includes(expressionKey);
        return has ? prev.filter((k) => k !== expressionKey) : [...prev, expressionKey];
      });
    }
  }, []);

  const exportTimelineAsMotion = useCallback(async () => {
    const items = timelineItemsRef.current;
    if (items.length === 0) {
      debugLogRef.current?.('[Live2D:export] 时间线为空，跳过导出', 'stderr');
      return;
    }
    const instance = modelRef.current;
    const data = modelDataRef.current;
    if (!instance || !data) {
      debugLogRef.current?.('[Live2D:export] 模型未加载', 'stderr');
      return;
    }

    const chunks: ParsedMotion[] = [];
    const gaps: number[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item.kind === 'motion') {
        const entry = instance.motionEntries.find(
          (e) => e.group === item.group && e.index === item.index,
        );
        if (!entry) {
          debugLogRef.current?.(
            `[Live2D:export] 跳过剪片段: 未找到 ${item.group}_${item.index}`,
            'stderr',
          );
          continue;
        }

        const b64 = data.files[entry.file];
        if (!b64) {
          debugLogRef.current?.(
            `[Live2D:export] 跳过剪片段: 文件缺失 ${entry.file}`,
            'stderr',
          );
          continue;
        }

        try {
          const motionData = parseBase64Json(b64) as MotionData;
          const parsed = parseMotion(motionData);
          const subrange = extractMotionSubrange(
            parsed,
            item.sourceStart,
            item.sourceEnd,
          );
          chunks.push(subrange);
          gaps.push(0);
        } catch (error) {
          debugLogRef.current?.(
            `[Live2D:export] 解析动作失败 ${item.group}_${item.index}: ${String(error)}`,
            'stderr',
          );
          continue;
        }
      } else if (item.kind === 'transition') {
        // Find the surrounding motion clips
        const prevClip = i > 0 && items[i - 1].kind === 'motion'
          ? items[i - 1] as TimelineClip
          : null;
        const nextClip = i < items.length - 1 && items[i + 1].kind === 'motion'
          ? items[i + 1] as TimelineClip
          : null;

        if (!prevClip || !nextClip) {
          debugLogRef.current?.(
            `[Live2D:export] 跳过过渡段 ${item.uid}: 缺少相邻剪片段`,
            'stderr',
          );
          continue;
        }

        // Evaluate parameter values at the boundary points
        const prevEntry = instance.motionEntries.find(
          (e) => e.group === prevClip.group && e.index === prevClip.index,
        );
        const nextEntry = instance.motionEntries.find(
          (e) => e.group === nextClip.group && e.index === nextClip.index,
        );

        if (!prevEntry || !nextEntry) {
          debugLogRef.current?.(
            `[Live2D:export] 跳过过渡段: 未找到动作入口`,
            'stderr',
          );
          continue;
        }

        const prevB64 = data.files[prevEntry.file];
        const nextB64 = data.files[nextEntry.file];
        if (!prevB64 || !nextB64) {
          debugLogRef.current?.('[Live2D:export] 跳过过渡段: 文件缺失', 'stderr');
          continue;
        }

        try {
          const prevParsed = parseMotion(parseBase64Json(prevB64) as MotionData);
          const nextParsed = parseMotion(parseBase64Json(nextB64) as MotionData);

          const prevValues = evaluateMotion(prevParsed, prevClip.sourceEnd);
          const nextValues = evaluateMotion(nextParsed, nextClip.sourceStart);

          const fps = prevParsed.fps || nextParsed.fps || 30;
          const transitionMotion = createTransitionMotion(
            prevValues,
            nextValues,
            item.duration,
            fps,
          );
          chunks.push(transitionMotion);
          gaps.push(0);
        } catch (error) {
          debugLogRef.current?.(
            `[Live2D:export] 创建过渡曲线失败: ${String(error)}`,
            'stderr',
          );
          continue;
        }
      }
    }

    if (chunks.length === 0) {
      debugLogRef.current?.('[Live2D:export] 没有可导出的内容', 'stderr');
      return;
    }

    try {
      // Add cumulative gaps so spliceMotions places them correctly
      const cumulativeGaps: number[] = [];
      let runningGap = 0;
      for (let g = 0; g < chunks.length - 1; g++) {
        runningGap += gaps[g] ?? 0;
        cumulativeGaps.push(runningGap);
      }

      const motionData = spliceMotions(chunks, cumulativeGaps);
      const jsonContent = JSON.stringify(motionData, null, 2);

      const savePath = await pickSaveFile(
        '导出时间线动作',
        `timeline_export_${Date.now()}.motion3.json`,
      );
      if (!savePath) {
        debugLogRef.current?.('[Live2D:export] 用户取消了保存', 'system');
        return;
      }

      await writeFile(savePath, jsonContent);
      debugLogRef.current?.(
        `[Live2D:export] 成功导出到 ${savePath} (${chunks.length} 个片段, ${motionData.Meta.Duration.toFixed(3)}s)`,
        'system',
      );
    } catch (error) {
      debugLogRef.current?.(
        `[Live2D:export] 导出失败: ${String(error)}`,
        'stderr',
      );
    }
  }, []);

  useEffect(() => {
    if (!canvasReady || restoredSessionRef.current) return;
    restoredSessionRef.current = true;
    const session = readLive2DSession();
    if (!session?.modelPath) {
      setSessionReady(true);
      return;
    }

    manualOverridesRef.current = session.manualOverrides ?? {};
    importedMotionsRef.current = normalizeImportedMotions(session.importedMotions ?? []);
    expressionConfigsRef.current = session.expressionConfigs ?? {};
    clearExpressionPreviewState();
    setExpressionConfigs(session.expressionConfigs ?? {});
    // Migrate old-format markers (expressionKey: string|null → expressionKeys: string[])
    const migratedMarkers = (session.expressionSegmentMarkers ?? []).map((m) => ({
      ...m,
      expressionKeys: (m as any).expressionKeys ?? ((m as any).expressionKey != null ? [(m as any).expressionKey] : []),
    }));
    setExpressionSegmentMarkers(migratedMarkers);
    setEndExpressionKeys(
      (session as any).endExpressionKeys ?? (
        (session as any).endExpressionKey != null ? [(session as any).endExpressionKey] : []
      ),
    );
    setMotionAliases(session.motionAliases ?? {});
    pendingSessionItemsRef.current = session.timelineItems ?? null;
    pendingSessionClipRefsRef.current = session.timelineItems ? null : session.timelineClips ?? clipRefsFromKeys(session.timelineClipKeys);
    setTimelineItems([]);
    setTimelinePlayback(idleTimelinePlaybackState());
    loadModelByPath(session.modelPath, { keepManualOverrides: true })
      .catch(console.error)
      .finally(() => setSessionReady(true));
  }, [canvasReady, clearExpressionPreviewState, loadModelByPath]);

  useEffect(() => {
    if (!sessionReady || pendingSessionItemsRef.current || pendingSessionClipRefsRef.current || restoringTimelineRef.current || !modelLoaded) return;
    const refs = timelineClipRefs(timelineItems);
    const nextSession = {
      modelPath,
      manualOverrides: getPersistableManualOverrides(),
      motionAliases,
      timelineClipKeys: clipKeysFromRefs(refs),
      timelineClips: refs,
      timelineItems: timelinePersistenceItems(timelineItems),
      importedMotions: importedMotionsRef.current,
      expressionConfigs,
      expressionSegmentMarkers: expressionSegmentMarkersRef.current,
      endExpressionKeys: endExpressionKeysRef.current,
    };
    writeLive2DSession(nextSession);
  }, [modelPath, motionAliases, sessionReady, modelLoaded, timelineItems, expressionConfigs, getPersistableManualOverrides]);

  useEffect(() => {
    if (!modelLoaded || (!pendingSessionItemsRef.current && !pendingSessionClipRefsRef.current)) return;
    const items = pendingSessionItemsRef.current;
    const refs = pendingSessionClipRefsRef.current;
    pendingSessionItemsRef.current = null;
    pendingSessionClipRefsRef.current = null;
    restoringTimelineRef.current = true;
    if (items) restoreTimelineItems(items);
    else restoreTimelineClips(refs ?? []);
    window.setTimeout(() => {
      restoringTimelineRef.current = false;
    }, 0);
  }, [modelLoaded, restoreTimelineClips, restoreTimelineItems]);

  // ── Context value ────────────────────────────────────────────────────────

  const ctx: EditorContextValue = {
    canvasRef,
    modelInstance: modelRef.current,
    keyframeOverlay: overlayRef.current,
    motionEntries,
    modelLoaded,
    modelError,
    modelPath,
    isPlaying,
    currentTime,
    duration,
    timelinePlayback,
    paramValues,
    paramRanges,
    paramMetas,
    expressionMetas,
    expressionConfigs,
    activeExpressionPreviews,
    currentMotion,
    motionAliases,
    timelineClips,
    timelineItems,
    expressionSegmentMarkers,
    endExpressionKeys,
    loadModelByPath,
    openImportDialog,
    openMotionImportDialog,
    playMotion,
    setParameter,
    resetAllParameters,
    previewExpression,
    updateExpressionConfig,
    buildAdaptedPreset,
    togglePlay,
    scrub,
    seekTimeline,
    renameMotion,
    deleteMotion,
    addClipToTimeline,
    addTransitionAfter,
    resizeTransition,
    splitClipAtTimelineTime,
    moveClipInTimeline,
    trimClip,
    playClip,
    removeClipFromTimeline,
    clearTimeline,
    exportTimelineAsMotion,
    addExpressionSegmentMarker,
    removeExpressionSegmentMarker,
    updateExpressionSegmentMarker,
    moveExpressionSegmentMarker,
    segmentExpressionKeyAtTime,
    segmentExpressionKeysAtTime,
    assignExpressionToSegmentAtTime,
    setEndExpressionKeys,
  };

  return (
    <EditorCtx.Provider value={ctx}>
      {children}
    </EditorCtx.Provider>
  );
}
