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
  timeline: { clipKeys: string[] };
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
  previewExpression: (name: string) => void;
  updateExpressionConfig: (name: string, patch: Partial<Omit<ExpressionPresetConfig, 'name' | 'file'>>) => void;
  buildAdaptedPreset: (name: string) => Live2DAdaptedPreset | null;
  togglePlay: () => void;
  scrub: (time: number) => void;
  renameMotion: (key: string, name: string) => void;
  deleteMotion: (group: string, index: number) => void;
  addClipToTimeline: (group: string, index: number) => void;
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
  const pendingSessionClipKeysRef = useRef<string[] | null>(null);
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
    writeLive2DSession({
      modelPath,
      manualOverrides: getPersistableManualOverrides(overrides),
      motionAliases,
      timelineClipKeys: Array.from(new Set(timelineClips.map((clip) => clipKey(clip.group, clip.index)))),
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

  const stripExpressionParameterOverrides = useCallback((overrides: Record<string, number>) => {
    const next = { ...overrides };
    const expressionParamIds = new Set<string>();
    for (const meta of expressionMetasRef.current) {
      for (const operation of meta.parameters) expressionParamIds.add(operation.id);
    }
    for (const id of expressionParamIds) delete next[id];
    return next;
  }, []);

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
            model.update(dt, motionSafeOverridesRef.current, {
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
          setCurrentTime(player.currentTime);
          if (player.hasMotion) setDuration(player.duration);
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
        motionSafeOverridesRef.current = stripExpressionParameterOverrides(getPersistableManualOverrides());
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

  const loadMotionIntoPlayer = useCallback((entry: MotionEntry, loop: boolean, onFinish?: () => void) => {
    const instance = modelRef.current;
    const data = modelDataRef.current;
    if (!instance || !data) return false;
    const b64 = data.files[entry.file];
    if (!b64) return false;
    try {
      const durationSeconds = getMotionDurationSeconds(entry, instance, data.files);
      const motionSafeOverrides = stripExpressionParameterOverrides(getPersistableManualOverrides());
      restoreExpressionPreviewBaseline();
      motionSafeOverridesRef.current = motionSafeOverrides;
      instance.stopAllMotions();
      instance.applyParameterValues({ ...baseParameterValuesRef.current, ...motionSafeOverrides }, true);
      motionTimeRef.current = 0;
      motionPlayerRef.current.load(entry.group, entry.index, instance, durationSeconds, loop);
      motionPlayerRef.current.setOnFinish(() => {
        motionPlayerRef.current.unload();
        activeMotionRef.current = null;
        motionTimeRef.current = 0;
        setCurrentMotion(null);
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(false);
        onFinish?.();
      });
      motionPlayerRef.current.play();
      activeMotionRef.current = { group: entry.group, index: entry.index, loop, onFinish };
      setDuration(durationSeconds);
      setCurrentTime(0);
      setIsPlaying(true);
      return true;
    } catch (error) {
      console.error('[Live2D] Motion preview parse error:', error);
      return false;
    }
  }, [getPersistableManualOverrides, restoreExpressionPreviewBaseline, stripExpressionParameterOverrides]);

  const returnToBasePose = useCallback(() => {
    const instance = modelRef.current;
    motionPlayerRef.current.unload();
    instance?.stopAllMotions();
    activeMotionRef.current = null;
    motionTimeRef.current = 0;
    motionSafeOverridesRef.current = stripExpressionParameterOverrides(getPersistableManualOverrides());
    if (instance) {
      instance.applyParameterValues({ ...baseParameterValuesRef.current, ...motionSafeOverridesRef.current }, true);
    }
    setCurrentMotion(null);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
  }, [getPersistableManualOverrides, stripExpressionParameterOverrides]);

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
      motionSafeOverridesRef.current = stripExpressionParameterOverrides(getPersistableManualOverrides());
      motionPlayerRef.current.unload();
      modelRef.current?.stopAllMotions();
      activeMotionRef.current = null;
      motionTimeRef.current = 0;
      for (const imported of importedMotionsRef.current) {
        const usedIndices = instance.motionEntries
          .filter(e => e.group === 'imported')
          .map(e => e.index);
        const nextIndex = imported.index ?? (usedIndices.length > 0 ? Math.max(...usedIndices) + 1 : 0);
        const key = `imported_${nextIndex}`;
        const buf = base64ToArrayBuffer(imported.base64);
        if (!instance.addLoadedMotion(key, buf)) continue;
        if (modelDataRef.current) modelDataRef.current.files[imported.fileName] = imported.base64;
        instance.motionEntries.push({ group: 'imported', index: nextIndex, name: imported.name, file: imported.fileName });
        imported.index = nextIndex;
        imported.group = 'imported';
      }
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
  }, [clearExpressionPreviewState, getPersistableManualOverrides, startIdlePreview, stripExpressionParameterOverrides]);

  const openImportDialog = useCallback(async () => {
    const path = await pickAnyFile('选择 Live2D 模型文件 (.model3.json)');
    if (path) await loadModelByPath(path);
  }, [loadModelByPath]);

  const openMotionImportDialog = useCallback(async () => {
    const instance = modelRef.current;
    if (!instance) return;
    const path = await pickAnyFile('选择动作文件 (.motion3.json)');
    if (!path) return;
    try {
      const b64 = await readFileBase64(path);
      const fileName = path.split(/[/\\]/).pop() ?? path;
      const group = 'imported';
      const usedIndices = instance.motionEntries
        .filter(e => e.group === group)
        .map(e => e.index);
      const nextIndex = usedIndices.length > 0 ? Math.max(...usedIndices) + 1 : 0;
      const key = `${group}_${nextIndex}`;
      const buf = base64ToArrayBuffer(b64);
      const ok = instance.addLoadedMotion(key, buf);
      if (!ok) {
        console.error('[Live2D] Failed to create motion from', fileName);
        return;
      }
      if (modelDataRef.current) modelDataRef.current.files[fileName] = b64;
      const motionName = fileName.replace(/\.motion3\.json$/i, '');
      importedMotionsRef.current = [
        ...importedMotionsRef.current,
        { path, fileName, name: motionName, base64: b64, group, index: nextIndex },
      ];
      const entry = { group, index: nextIndex, name: motionName, file: fileName };
      instance.motionEntries.push(entry);
      setMotionAliases(prev => ({ ...prev, [key]: motionName }));
      setMotionEntries(prev => [...prev, entry]);
    } catch (err) {
      console.error('[Live2D] Motion import error:', err);
    }
  }, []);

  const playMotion = useCallback((group: string, index: number) => {
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
      timeline: { clipKeys: Array.from(new Set(timelineClips.map((clip) => clipKey(clip.group, clip.index)))) },
      manualOverrides: getPersistableManualOverrides(),
      importedMotions: importedMotionsRef.current,
    };
  }, [expressionMetas, getPersistableManualOverrides, modelPath, timelineClips]);

  const togglePlay = useCallback(() => {
    const active = activeMotionRef.current;
    if (active) {
      motionPlayerRef.current.unload();
      modelRef.current?.stopAllMotions();
      activeMotionRef.current = null;
      setIsPlaying(false);
      return;
    }

    if (!currentMotion) {
      startIdlePreview();
      return;
    }

    const entry = modelRef.current?.motionEntries.find(e => e.group === currentMotion.group && e.index === currentMotion.index);
    if (entry) loadMotionIntoPlayer(entry, false, returnToBasePose);
  }, [currentMotion, loadMotionIntoPlayer, returnToBasePose, startIdlePreview]);

  const scrub = useCallback((time: number) => {
    // SDK-driven preview is intentionally used for correctness (same as frontend).
    // Precise non-linear scrubbing will need a separate verified evaluator/export path.
    motionTimeRef.current = Math.max(0, Math.min(time, duration || time));
    setCurrentTime(motionTimeRef.current);
  }, [duration]);

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
    importedMotionsRef.current = importedMotionsRef.current.filter((motion) => !(
      (motion.group ?? 'imported') === group && motion.index === index
    ));
    setMotionEntries((prev) => prev.filter((entry) => !(entry.group === group && entry.index === index)));
    setMotionAliases((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setTimelineClips((prev) => prev.filter((clip) => !(clip.group === group && clip.index === index)));
    setCurrentMotion((current) => (
      current?.group === group && current.index === index ? null : current
    ));
  }, [currentMotion, returnToBasePose]);

  // ── Timeline clip management ─────────────────────────────────────────────

  const addClipToTimeline = useCallback((group: string, index: number) => {
    const instance = modelRef.current;
    const data = modelDataRef.current;
    if (!instance) return;

    const entry = instance.motionEntries.find(e => e.group === group && e.index === index);
    if (!entry) return;

    const paramSet = new Set(instance.parameterIds);
    const missingParams = data
      ? validateMotion(entry.file, paramSet, data.files)
      : [];

    setMotionAliases(aliases => {
      const label = aliases[`${group}_${index}`] ?? `${group}#${index}`;
      const uid = `${group}_${index}_${Date.now()}`;
      setTimelineClips(prev => [
        ...prev,
        { uid, group, index, label, duration: getMotionDurationSeconds(entry, instance, data?.files), missingParams },
      ]);
      return aliases;
    });
  }, []);

  const restoreClipToTimeline = useCallback((group: string, index: number) => {
    const instance = modelRef.current;
    const data = modelDataRef.current;
    if (!instance) return;

    const entry = instance.motionEntries.find(e => e.group === group && e.index === index);
    if (!entry) return;

    const paramSet = new Set(instance.parameterIds);
    const missingParams = data
      ? validateMotion(entry.file, paramSet, data.files)
      : [];

    setMotionAliases(aliases => {
      const label = aliases[`${group}_${index}`] ?? `${group}#${index}`;
      setTimelineClips(prev => {
        if (prev.some((clip) => clip.group === group && clip.index === index)) return prev;
        return [
          ...prev,
          {
            uid: `${group}_${index}_restored`,
            group,
            index,
            label,
            duration: getMotionDurationSeconds(entry, instance, data?.files),
            missingParams,
          },
        ];
      });
      return aliases;
    });
  }, []);

  const removeClipFromTimeline = useCallback((uid: string) => {
    setTimelineClips(prev => prev.filter(c => c.uid !== uid));
  }, []);

  const clearTimeline = useCallback(() => setTimelineClips([]), []);

  useEffect(() => {
    if (!canvasReady || restoredSessionRef.current) return;
    restoredSessionRef.current = true;
    const session = readLive2DSession();
    if (!session?.modelPath) {
      setSessionReady(true);
      return;
    }

    manualOverridesRef.current = session.manualOverrides ?? {};
    importedMotionsRef.current = session.importedMotions ?? [];
    expressionConfigsRef.current = session.expressionConfigs ?? {};
    clearExpressionPreviewState();
    setExpressionConfigs(session.expressionConfigs ?? {});
    setMotionAliases(session.motionAliases ?? {});
    pendingSessionClipKeysRef.current = session.timelineClipKeys ?? [];
    loadModelByPath(session.modelPath, { keepManualOverrides: true })
      .catch(console.error)
      .finally(() => setSessionReady(true));
  }, [canvasReady, clearExpressionPreviewState, loadModelByPath]);

  useEffect(() => {
    if (!sessionReady || pendingSessionClipKeysRef.current) return;
    const nextSession = {
      modelPath,
      manualOverrides: getPersistableManualOverrides(),
      motionAliases,
      timelineClipKeys: Array.from(new Set(timelineClips.map((clip) => clipKey(clip.group, clip.index)))),
      importedMotions: importedMotionsRef.current,
      expressionConfigs,
    };
    writeLive2DSession(nextSession);
  }, [modelPath, motionAliases, sessionReady, timelineClips, expressionConfigs, getPersistableManualOverrides]);

  useEffect(() => {
    if (!modelLoaded || !pendingSessionClipKeysRef.current) return;
    const keys = Array.from(new Set(pendingSessionClipKeysRef.current));
    pendingSessionClipKeysRef.current = null;
    for (const key of keys) {
      const sep = key.lastIndexOf('_');
      if (sep < 1) continue;
      const group = key.slice(0, sep);
      const index = Number(key.slice(sep + 1));
      if (!Number.isNaN(index)) restoreClipToTimeline(group, index);
    }
  }, [modelLoaded, restoreClipToTimeline]);

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
    previewExpression,
    updateExpressionConfig,
    buildAdaptedPreset,
    togglePlay,
    scrub,
    renameMotion,
    deleteMotion,
    addClipToTimeline,
    removeClipFromTimeline,
    clearTimeline,
  };

  return (
    <EditorCtx.Provider value={ctx}>
      {children}
    </EditorCtx.Provider>
  );
}
