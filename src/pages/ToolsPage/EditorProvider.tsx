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
import { readLive2DModelData, pickAnyFile, readFileBase64 } from '../../services/config/bridge';
import type { Live2DModelData } from '../../services/config/bridge';
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
  uid: string;
  group: string;
  index: number;
  /** Display label (alias if set, else "group#index") */
  label: string;
  /** Clip duration in seconds from motion3 meta / CubismMotion. */
  duration: number;
  /** Parameters in this motion that are absent from the loaded model */
  missingParams: string[];
}

export interface TimelinePlaybackState {
  active: boolean;
  clipUid: string | null;
  clipIndex: number;
  clipStartTime: number;
  totalTime: number;
  totalDuration: number;
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
  timeline: { clipKeys: string[]; clips?: TimelineClipRef[] };
  manualOverrides: Record<string, number>;
  importedMotions: ImportedMotionState[];
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
  importedMotions?: ImportedMotionState[];
  expressionConfigs?: Record<string, ExpressionPresetConfig>;
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
  moveClipInTimeline: (uid: string, beforeUid: string | null) => void;
  playClip: (uid: string) => void;
  removeClipFromTimeline: (uid: string) => void;
  clearTimeline: () => void;
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

function timelineClipRefs(clips: TimelineClip[]): TimelineClipRef[] {
  return clips.map((clip) => ({ group: clip.group, index: clip.index }));
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

function insertClip(clips: TimelineClip[], clip: TimelineClip, beforeUid?: string | null): TimelineClip[] {
  if (!beforeUid) return [...clips, clip];
  const index = clips.findIndex((item) => item.uid === beforeUid);
  if (index < 0) return [...clips, clip];
  return [...clips.slice(0, index), clip, ...clips.slice(index)];
}

function moveClip(clips: TimelineClip[], uid: string, beforeUid: string | null): TimelineClip[] {
  if (uid === beforeUid) return clips;
  const moving = clips.find((clip) => clip.uid === uid);
  if (!moving) return clips;
  const rest = clips.filter((clip) => clip.uid !== uid);
  if (!beforeUid) return [...rest, moving];
  const index = rest.findIndex((clip) => clip.uid === beforeUid);
  if (index < 0) return [...rest, moving];
  return [...rest.slice(0, index), moving, ...rest.slice(index)];
}

function timelineTotalDuration(clips: TimelineClip[]): number {
  return clips.reduce((sum, clip) => sum + clip.duration, 0);
}

function timelineTimeAtClip(clips: TimelineClip[], index: number, clipTime: number): number {
  return clips.slice(0, Math.max(0, index)).reduce((sum, clip) => sum + clip.duration, 0) + clipTime;
}

function makeTimelinePlaybackState(
  clips: TimelineClip[],
  index: number,
  clipTime = 0,
  active = true,
): TimelinePlaybackState {
  const clip = clips[index];
  return {
    active,
    clipUid: clip?.uid ?? null,
    clipIndex: clip ? index : -1,
    clipStartTime: clips.slice(0, Math.max(0, index)).reduce((sum, item) => sum + item.duration, 0),
    totalTime: clip ? timelineTimeAtClip(clips, index, clipTime) : 0,
    totalDuration: timelineTotalDuration(clips),
  };
}

function timelinePlaybackStateAtTime(clips: TimelineClip[], time: number, active = false): TimelinePlaybackState {
  const totalDuration = timelineTotalDuration(clips);
  const clamped = Math.max(0, Math.min(time, totalDuration));
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const end = cursor + clips[i].duration;
    if (clamped <= end || i === clips.length - 1) {
      return makeTimelinePlaybackState(clips, i, Math.max(0, clamped - cursor), active);
    }
    cursor = end;
  }
  return idleTimelinePlaybackState(clips);
}

function idleTimelinePlaybackState(clips: TimelineClip[] = []): TimelinePlaybackState {
  return {
    active: false,
    clipUid: null,
    clipIndex: -1,
    clipStartTime: 0,
    totalTime: 0,
    totalDuration: timelineTotalDuration(clips),
  };
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

function expressionKey(name: string, file: string): string {
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
  const [timelineClips, setTimelineClips] = useState<TimelineClip[]>([]);
  const [timelinePlayback, setTimelinePlayback] = useState<TimelinePlaybackState>(() => idleTimelinePlaybackState());
  const timelineClipsRef = useRef<TimelineClip[]>([]);
  const timelinePlaybackRef = useRef<{ active: boolean; nextIndex: number }>({ active: false, nextIndex: 0 });

  useEffect(() => {
    timelineClipsRef.current = timelineClips;
    setTimelinePlayback((prev) => {
      if (prev.active) return { ...prev, totalDuration: timelineTotalDuration(timelineClips) };
      if (prev.totalTime > 0 || prev.clipUid) return timelinePlaybackStateAtTime(timelineClips, prev.totalTime, false);
      return idleTimelinePlaybackState(timelineClips);
    });
  }, [timelineClips]);

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
    const refs = timelineClipRefs(timelineClips);
    writeLive2DSession({
      modelPath,
      manualOverrides: getPersistableManualOverrides(overrides),
      motionAliases,
      timelineClipKeys: clipKeysFromRefs(refs),
      timelineClips: refs,
      importedMotions: importedMotionsRef.current,
      expressionConfigs: expressionConfigsRef.current,
    });
  }, [getPersistableManualOverrides, modelPath, motionAliases, timelineClips]);

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
          const motionPreviewActive = player.hasMotion;
          if (motionPreviewActive) {
            model.update(dt, manualOverridesRef.current, {
              // EXP preview in the launcher is applied through manualOverridesRef so
              // motion playback can compose with persistent appearance/watermark and
              // transient expression keyframes without the SDK expression manager
              // replaying model3 startup expressions over the same parameters.
              skipExpressions: true,
            });
            player.tick(dt);
            overlayRef.current.apply(model, player.currentTime);
          } else {
            model.update(dt, manualOverridesRef.current);
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
          if (motionPreviewActive) {
            setCurrentTime(player.currentTime);
            if (timelinePlaybackRef.current.active) {
              const clips = timelineClipsRef.current;
              const currentIndex = Math.max(0, timelinePlaybackRef.current.nextIndex - 1);
              setTimelinePlayback(makeTimelinePlaybackState(clips, currentIndex, player.currentTime, true));
            }
            if (player.hasMotion) setDuration(player.duration);
          }
          setIsPlaying(player.isPlaying);

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
        setTimelinePlayback(idleTimelinePlaybackState(timelineClipsRef.current));
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
    options?: { keepTimelinePositionOnFinish?: boolean },
  ) => {
    const instance = modelRef.current;
    const data = modelDataRef.current;
    if (!instance || !data) return false;
    const b64 = data.files[entry.file];
    if (!b64) return false;
    try {
      const durationSeconds = getMotionDurationSeconds(entry, instance, data.files);
      const motionBaseOverrides = getPersistableManualOverrides();
      motionSafeOverridesRef.current = stripTransientExpressionParameterOverrides(motionBaseOverrides);
      const clampedStartTime = Math.max(0, Math.min(startTime, durationSeconds || startTime));
      motionTimeRef.current = clampedStartTime;
      motionPlayerRef.current.load(entry.group, entry.index, instance, durationSeconds, loop);
      motionPlayerRef.current.scrub(clampedStartTime);
      motionPlayerRef.current.setOnFinish(() => {
        motionPlayerRef.current.unload();
        activeMotionRef.current = null;
        motionTimeRef.current = 0;
        setCurrentMotion(null);
        if (!options?.keepTimelinePositionOnFinish) {
          setCurrentTime(0);
          setTimelinePlayback(idleTimelinePlaybackState(timelineClipsRef.current));
          setDuration(0);
        }
        setIsPlaying(false);
        onFinish?.();
      });
      motionPlayerRef.current.play(clampedStartTime);
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
      setTimelinePlayback(idleTimelinePlaybackState(timelineClipsRef.current));
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
    setTimelinePlayback(idleTimelinePlaybackState(options?.keepTimeline ? timelineClipsRef.current : []));
    setParamRanges({});
    setParamValues({});
    setParamMetas([]);
    setExpressionMetas([]);
    setExpressionConfigs({});
    clearExpressionPreviewState();
    expressionConfigsRef.current = savedExpressionConfigs;
    if (!options?.keepManualOverrides) manualOverridesRef.current = {};
    if (!options?.keepManualOverrides) importedMotionsRef.current = [];
    if (!options?.keepTimeline) setTimelineClips([]);

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
    setTimelinePlayback(idleTimelinePlaybackState(timelineClipsRef.current));
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
        clipKeys: clipKeysFromRefs(timelineClipRefs(timelineClips)),
        clips: timelineClipRefs(timelineClips),
      },
      manualOverrides: getPersistableManualOverrides(),
      importedMotions: importedMotionsRef.current,
    };
  }, [expressionMetas, getPersistableManualOverrides, modelPath, timelineClips]);

  const playTimelineFromIndex = useCallback((index: number, startTime = 0) => {
    const clips = timelineClipsRef.current;
    const clip = clips[index];
    if (!clip) {
      timelinePlaybackRef.current = { active: false, nextIndex: 0 };
      setTimelinePlayback(idleTimelinePlaybackState(clips));
      returnToBasePose();
      return;
    }

    const entry = modelRef.current?.motionEntries.find((motion) => motion.group === clip.group && motion.index === clip.index);
    if (!entry) return;

    const clipStartTime = Math.max(0, Math.min(startTime, clip.duration || startTime));
    timelinePlaybackRef.current = { active: true, nextIndex: index + 1 };
    setTimelinePlayback(makeTimelinePlaybackState(clips, index, clipStartTime, true));
    setDuration(timelineTotalDuration(clips));
    setCurrentTime(timelineTimeAtClip(clips, index, clipStartTime));
    if (loadMotionIntoPlayer(entry, false, () => {
      const nextIndex = timelinePlaybackRef.current.nextIndex;
      if (!timelinePlaybackRef.current.active || nextIndex >= timelineClipsRef.current.length) {
        timelinePlaybackRef.current = { active: false, nextIndex: 0 };
        const finishedClips = timelineClipsRef.current;
        const finishedTime = timelineTotalDuration(finishedClips);
        const finishedPlayback = timelinePlaybackStateAtTime(finishedClips, finishedTime, false);
        setTimelinePlayback(finishedPlayback);
        setCurrentTime(finishedPlayback.totalTime);
        setDuration(finishedPlayback.totalDuration);
        returnToBasePose({ keepTimelinePosition: true });
        return;
      }
      playTimelineFromIndex(nextIndex);
    }, clipStartTime, { keepTimelinePositionOnFinish: true })) {
      setDuration(timelineTotalDuration(clips));
      setCurrentMotion({ group: clip.group, index: clip.index });
    }
  }, [loadMotionIntoPlayer, returnToBasePose]);

  const togglePlay = useCallback(() => {
    const active = activeMotionRef.current;
    if (active) {
      const clips = timelineClipsRef.current;
      const preserveTimeline = timelinePlaybackRef.current.active && clips.length > 0;
      const playerTime = motionPlayerRef.current.currentTime;
      const currentIndex = preserveTimeline
        ? Math.max(0, Math.min(clips.length - 1, timelinePlaybackRef.current.nextIndex - 1))
        : -1;
      timelinePlaybackRef.current = { active: false, nextIndex: 0 };
      if (preserveTimeline && currentIndex >= 0) {
        const nextPlayback = makeTimelinePlaybackState(clips, currentIndex, playerTime, false);
        setTimelinePlayback(nextPlayback);
        setCurrentTime(nextPlayback.totalTime);
        setDuration(nextPlayback.totalDuration);
      }
      motionPlayerRef.current.unload();
      modelRef.current?.stopAllMotions();
      activeMotionRef.current = null;
      setIsPlaying(false);
      return;
    }

    if (timelineClipsRef.current.length > 0) {
      const playback = timelinePlayback;
      const startIndex = playback.clipIndex >= 0
        ? playback.clipIndex
        : currentMotion
          ? Math.max(0, timelineClipsRef.current.findIndex((clip) => clip.group === currentMotion.group && clip.index === currentMotion.index))
          : 0;
      const startClipTime = playback.clipIndex >= 0
        ? Math.max(0, playback.totalTime - playback.clipStartTime)
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
    const timelineSeeking = timelineClipsRef.current.length > 0 && !motionPlayerRef.current.hasMotion;
    const total = timelinePlaybackRef.current.active || timelineSeeking
      ? timelineTotalDuration(timelineClipsRef.current)
      : duration;
    motionTimeRef.current = Math.max(0, Math.min(time, total || time));
    setCurrentTime(motionTimeRef.current);
    if (timelinePlaybackRef.current.active || timelineSeeking) {
      const clips = timelineClipsRef.current;
      setTimelinePlayback(timelinePlaybackStateAtTime(clips, motionTimeRef.current, timelinePlaybackRef.current.active));
    }
  }, [duration]);

  const seekTimeline = useCallback((time: number) => {
    const clips = timelineClipsRef.current;
    if (clips.length === 0) return;
    timelinePlaybackRef.current = { active: false, nextIndex: 0 };
    motionPlayerRef.current.unload();
    modelRef.current?.stopAllMotions();
    activeMotionRef.current = null;
    const nextPlayback = timelinePlaybackStateAtTime(clips, time, false);
    motionTimeRef.current = Math.max(0, nextPlayback.totalTime - nextPlayback.clipStartTime);
    setTimelinePlayback(nextPlayback);
    setCurrentTime(nextPlayback.totalTime);
    setDuration(nextPlayback.totalDuration);
    setCurrentMotion(
      nextPlayback.clipIndex >= 0 && clips[nextPlayback.clipIndex]
        ? { group: clips[nextPlayback.clipIndex].group, index: clips[nextPlayback.clipIndex].index }
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
        setTimelineClips((clips) => clips.map((clip) => (
          clip.group === group && clip.index === index
            ? { ...clip, label: name || `${group}#${index}` }
            : clip
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
    setTimelineClips((prev) => {
      const next = prev.filter((clip) => !(clip.group === group && clip.index === index));
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
    return {
      uid: `${group}_${index}_${uidSuffix}`,
      group,
      index,
      label,
      duration: getMotionDurationSeconds(entry, instance, data?.files),
      missingParams,
    };
  }

  const addClipToTimeline = useCallback((group: string, index: number, beforeUid?: string | null) => {
    const clip = createTimelineClip(group, index);
    if (!clip) return;
    setTimelineClips(prev => insertClip(prev, clip, beforeUid));
  }, [motionAliases]);

  const restoreTimelineClips = useCallback((refs: TimelineClipRef[]) => {
    const restoredClips = refs.flatMap((ref, index) => {
      const clip = createTimelineClip(ref.group, ref.index, `restored_${index}_${Date.now()}`);
      return clip ? [clip] : [];
    });
    setTimelineClips(restoredClips);
    setTimelinePlayback(idleTimelinePlaybackState(restoredClips));
  }, [motionAliases]);

  const moveClipInTimeline = useCallback((uid: string, beforeUid: string | null) => {
    setTimelineClips(prev => moveClip(prev, uid, beforeUid));
  }, []);

  const playClip = useCallback((uid: string) => {
    const index = timelineClipsRef.current.findIndex((clip) => clip.uid === uid);
    if (index < 0) return;
    timelinePlaybackRef.current = { active: false, nextIndex: 0 };
    setTimelinePlayback(makeTimelinePlaybackState(timelineClipsRef.current, index, 0, true));
    playTimelineFromIndex(index);
  }, [playTimelineFromIndex]);

  const removeClipFromTimeline = useCallback((uid: string) => {
    setTimelineClips((prev) => {
      const next = prev.filter(c => c.uid !== uid);
      setTimelinePlayback(idleTimelinePlaybackState(next));
      return next;
    });
  }, []);

  const clearTimeline = useCallback(() => {
    timelinePlaybackRef.current = { active: false, nextIndex: 0 };
    setTimelinePlayback(idleTimelinePlaybackState());
    setTimelineClips([]);
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
    setMotionAliases(session.motionAliases ?? {});
    pendingSessionClipRefsRef.current = session.timelineClips ?? clipRefsFromKeys(session.timelineClipKeys);
    setTimelineClips([]);
    setTimelinePlayback(idleTimelinePlaybackState());
    loadModelByPath(session.modelPath, { keepManualOverrides: true })
      .catch(console.error)
      .finally(() => setSessionReady(true));
  }, [canvasReady, clearExpressionPreviewState, loadModelByPath]);

  useEffect(() => {
    if (!sessionReady || pendingSessionClipRefsRef.current || restoringTimelineRef.current || !modelLoaded) return;
    const refs = timelineClipRefs(timelineClips);
    const nextSession = {
      modelPath,
      manualOverrides: getPersistableManualOverrides(),
      motionAliases,
      timelineClipKeys: clipKeysFromRefs(refs),
      timelineClips: refs,
      importedMotions: importedMotionsRef.current,
      expressionConfigs,
    };
    writeLive2DSession(nextSession);
  }, [modelPath, motionAliases, sessionReady, modelLoaded, timelineClips, expressionConfigs, getPersistableManualOverrides]);

  useEffect(() => {
    if (!modelLoaded || !pendingSessionClipRefsRef.current) return;
    const refs = pendingSessionClipRefsRef.current;
    pendingSessionClipRefsRef.current = null;
    restoringTimelineRef.current = true;
    restoreTimelineClips(refs);
    window.setTimeout(() => {
      restoringTimelineRef.current = false;
    }, 0);
  }, [modelLoaded, restoreTimelineClips]);

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
    moveClipInTimeline,
    playClip,
    removeClipFromTimeline,
    clearTimeline,
  };

  return (
    <EditorCtx.Provider value={ctx}>
      {children}
    </EditorCtx.Provider>
  );
}
