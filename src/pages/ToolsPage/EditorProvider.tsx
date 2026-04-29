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
import { parseMotion } from '../../live2d/engine/MotionParser';
import { readLive2DModelData, pickAnyFile, readFileBase64 } from '../../services/config/bridge';
import type { Live2DModelData } from '../../services/config/bridge';

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

export interface TimelineClip {
  uid: string;
  group: string;
  index: number;
  /** Display label (alias if set, else "group#index") */
  label: string;
  /** Parameters in this motion that are absent from the loaded model */
  missingParams: string[];
}

interface ImportedMotionState {
  path: string;
  fileName: string;
  name: string;
  base64: string;
}

interface Live2DSessionState {
  modelPath: string | null;
  manualOverrides: Record<string, number>;
  motionAliases: Record<string, string>;
  timelineClipKeys: string[];
  importedMotions?: ImportedMotionState[];
}

const live2dSessionKey = 'live2d.previewSession';

export interface EditorContextValue {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  modelInstance: ModelInstance | null;
  motionPlayer: MotionPlayer;
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
  currentMotion: { group: string; index: number } | null;
  motionAliases: Record<string, string>;
  timelineClips: TimelineClip[];

  loadModelByPath: (path: string) => Promise<void>;
  openImportDialog: () => Promise<void>;
  openMotionImportDialog: () => Promise<void>;
  playMotion: (group: string, index: number) => void;
  setParameter: (id: string, value: number) => void;
  togglePlay: () => void;
  scrub: (time: number) => void;
  renameMotion: (key: string, name: string) => void;
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
      const cdi = parseBase64Json(files[cdiFile]);
      const params: Array<{ Id: string; Name?: string }> = cdi?.Parameters ?? [];
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
      const exp = parseBase64Json(files[expression.File]);
      const params: Array<{ Id: string }> = exp?.Parameters ?? [];
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
        const motion = parseBase64Json(files[entry.File]);
        const curves: Array<{ Target?: string; Id?: string }> = motion?.Curves ?? [];
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
  const manualOverridesRef = useRef<Record<string, number>>({});
  const importedMotionsRef = useRef<ImportedMotionState[]>([]);
  const pendingSessionClipKeysRef = useRef<string[] | null>(null);
  const restoredSessionRef = useRef(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const debugParamRef = useRef<string | null>(null);
  const debugFrameRef = useRef(0);
  const debugLogRef = useRef(onDebugLog);
  const [currentMotion, setCurrentMotion] = useState<{ group: string; index: number } | null>(null);
  const [motionAliases, setMotionAliases] = useState<Record<string, string>>({});
  const [timelineClips, setTimelineClips] = useState<TimelineClip[]>([]);

  // ── Init Cubism on canvas mount ──────────────────────────────────────────

  useEffect(() => {
    debugLogRef.current = onDebugLog;
  }, [onDebugLog]);

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

      const model = modelRef.current;
      if (model) {
        const player = motionPlayerRef.current;
        player.tick(dt);
        overlayRef.current.apply(model, player.currentTime);
        model.update(dt, manualOverridesRef.current);
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
        setDuration(player.duration);
        setIsPlaying(player.isPlaying);

        const ids = model.parameterIds;
        if (ids.length > 0) {
          const vals: Record<string, number> = {};
          for (let i = 0; i < ids.length; i++) vals[ids[i]] = model.getParameterValueAt(i);
          for (const [id, value] of Object.entries(manualOverridesRef.current)) vals[id] = value;
          setParamValues(vals);
        }
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
      const json = parseBase64Json(b64);
      const curves: Array<{ Target: string; Id: string }> = json?.Curves ?? [];
      return curves
        .filter(c => c.Target === 'Parameter' && !paramIds.has(c.Id))
        .map(c => c.Id)
        .filter((v, i, a) => a.indexOf(v) === i); // dedupe
    } catch {
      return [];
    }
  }

  // ── Model loading ────────────────────────────────────────────────────────

  const loadModelByPath = useCallback(async (path: string, options?: { keepManualOverrides?: boolean; keepTimeline?: boolean }) => {
    setModelLoaded(false);
    setModelError(null);
    setModelPath(path);
    setParamRanges({});
    setParamValues({});
    setParamMetas([]);
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
      motionPlayerRef.current.unload();
      for (const imported of importedMotionsRef.current) {
        const nextIndex = instance.motionEntries.filter(e => e.group === 'imported').length;
        const key = `imported_${nextIndex}`;
        const buf = base64ToArrayBuffer(imported.base64);
        if (!instance.addLoadedMotion(key, buf)) continue;
        if (modelDataRef.current) modelDataRef.current.files[imported.fileName] = imported.base64;
        instance.motionEntries.push({ group: 'imported', index: nextIndex, name: imported.name, file: imported.fileName });
      }
      setMotionEntries(instance.motionEntries);

      const values: Record<string, number> = {};
      const ranges: Record<string, ParamRange> = {};
      for (let i = 0; i < instance.parameterIds.length; i++) {
        const id = instance.parameterIds[i];
        values[id] = instance.getParameterValueAt(i);
        ranges[id] = instance.getParameterRangeAt(i);
      }
      instance.applyParameterValues(manualOverridesRef.current);
      for (const [id, value] of Object.entries(manualOverridesRef.current)) values[id] = value;
      setParamValues(values);
      setParamRanges(ranges);
      setParamMetas(collectParamMetas(instance.parameterIds, data.modelJson as Record<string, unknown>, data.files));
      CubismInit.resize();
      setModelLoaded(true);

      // Auto-start Idle motion
      const idle = instance.motionEntries.find((e) => e.group.toLowerCase().includes('idle'));
      if (idle) {
        instance.startMotion(idle.group, idle.index);
        const fr = (data.modelJson as Record<string, unknown>).FileReferences as Record<string, unknown>;
        const motions = fr.Motions as Record<string, Array<Record<string, unknown>>>;
        const groupArr = motions?.[idle.group];
        if (groupArr?.[idle.index]) {
          const file = groupArr[idle.index].File as string;
          const b64 = data.files[file];
          if (b64) {
            const motionJson = parseBase64Json(b64);
            const parsed = parseMotion(motionJson);
            motionPlayerRef.current.load(parsed, instance, true);
            motionPlayerRef.current.play();
          }
        }
      }
    } catch (err: unknown) {
      setModelError(String(err));
    }
  }, []);

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
      const nextIndex = instance.motionEntries.filter(e => e.group === 'imported').length;
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
        { path, fileName, name: motionName, base64: b64 },
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
    modelRef.current?.startMotion(group, index);
    setCurrentMotion({ group, index });
  }, []);

  const setParameter = useCallback((id: string, value: number) => {
    const range = paramRanges[id];
    const nextValue = range
      ? Math.min(Math.max(value, range.min), range.max)
      : value;
    const defaultValue = range?.default ?? 0;
    if (Math.abs(nextValue - defaultValue) <= 0.001) delete manualOverridesRef.current[id];
    else manualOverridesRef.current[id] = nextValue;
    writeLive2DSession({
      modelPath,
      manualOverrides: manualOverridesRef.current,
      motionAliases,
      timelineClipKeys: timelineClips.map((clip) => clipKey(clip.group, clip.index)),
      importedMotions: importedMotionsRef.current,
    });
    debugParamRef.current = id;
    debugFrameRef.current = 0;
    modelRef.current?.setParameterValue(id, nextValue);
    const rangeText = range ? ` range=[${range.min},${range.max}] default=${range.default}` : '';
    debugLogRef.current?.(
      `[Live2D:param-set] id=${id} value=${nextValue}${rangeText} overrides=${Object.keys(manualOverridesRef.current).length}`,
      'system',
    );
    setParamValues(prev => ({ ...prev, [id]: nextValue }));
  }, [modelPath, motionAliases, paramRanges, timelineClips]);

  const togglePlay = useCallback(() => {
    const p = motionPlayerRef.current;
    if (p.isPlaying) p.pause();
    else p.play();
  }, []);

  const scrub = useCallback((time: number) => {
    motionPlayerRef.current.scrub(time);
  }, []);

  const renameMotion = useCallback((key: string, name: string) => {
    setMotionAliases((prev) => ({ ...prev, [key]: name }));
  }, []);

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
        { uid, group, index, label, missingParams },
      ]);
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
    setMotionAliases(session.motionAliases ?? {});
    pendingSessionClipKeysRef.current = session.timelineClipKeys ?? [];
    loadModelByPath(session.modelPath, { keepManualOverrides: true })
      .catch(console.error)
      .finally(() => setSessionReady(true));
  }, [canvasReady, loadModelByPath]);

  useEffect(() => {
    if (!sessionReady || pendingSessionClipKeysRef.current) return;
    const nextSession = {
      modelPath,
      manualOverrides: manualOverridesRef.current,
      motionAliases,
      timelineClipKeys: timelineClips.map((clip) => clipKey(clip.group, clip.index)),
      importedMotions: importedMotionsRef.current,
    };
    writeLive2DSession(nextSession);
  }, [modelPath, motionAliases, sessionReady, timelineClips]);

  useEffect(() => {
    if (!modelLoaded || !pendingSessionClipKeysRef.current) return;
    const keys = pendingSessionClipKeysRef.current;
    pendingSessionClipKeysRef.current = null;
    for (const key of keys) {
      const sep = key.lastIndexOf('_');
      if (sep < 1) continue;
      const group = key.slice(0, sep);
      const index = Number(key.slice(sep + 1));
      if (!Number.isNaN(index)) addClipToTimeline(group, index);
    }
  }, [modelLoaded, addClipToTimeline]);

  // ── Context value ────────────────────────────────────────────────────────

  const ctx: EditorContextValue = {
    canvasRef,
    modelInstance: modelRef.current,
    motionPlayer: motionPlayerRef.current,
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
    currentMotion,
    motionAliases,
    timelineClips,
    loadModelByPath,
    openImportDialog,
    openMotionImportDialog,
    playMotion,
    setParameter,
    togglePlay,
    scrub,
    renameMotion,
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
