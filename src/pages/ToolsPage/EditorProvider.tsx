/**
 * Live2D animation editor context and provider.
 * Manages the Cubism model lifecycle, animation loop, and shared state.
 */

import React, { useEffect, useRef, useState, useCallback, createContext, useContext } from 'react';
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

export interface TimelineClip {
  uid: string;
  group: string;
  index: number;
  /** Display label (alias if set, else "group#index") */
  label: string;
  /** Parameters in this motion that are absent from the loaded model */
  missingParams: string[];
}

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

// ── Provider ─────────────────────────────────────────────────────────────────

export function EditorProvider({ children }: { children: React.ReactNode }) {
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
  const [currentMotion, setCurrentMotion] = useState<{ group: string; index: number } | null>(null);
  const [motionAliases, setMotionAliases] = useState<Record<string, string>>({});
  const [timelineClips, setTimelineClips] = useState<TimelineClip[]>([]);

  // ── Init Cubism on canvas mount ──────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cubismReadyRef.current) return;
    CubismInit.initialize(canvas);
    cubismReadyRef.current = true;
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
        model.update(dt);
        CubismInit.resize();
        model.draw();
        setCurrentTime(player.currentTime);
        setDuration(player.duration);
        setIsPlaying(player.isPlaying);

        const ids = model.parameterIds;
        if (ids.length > 0) {
          const vals: Record<string, number> = {};
          for (let i = 0; i < ids.length; i++) vals[ids[i]] = model.getParameterValueAt(i);
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
      const json = JSON.parse(atob(b64));
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

  const loadModelByPath = useCallback(async (path: string) => {
    setModelLoaded(false);
    setModelError(null);
    setModelPath(path);
    setParamRanges({});
    setTimelineClips([]);

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
      setMotionEntries(instance.motionEntries);
      setModelLoaded(true);

      // Collect parameter ranges from model by index (avoids ID-handle lookup issues)
      const ranges: Record<string, ParamRange> = {};
      for (let i = 0; i < instance.parameterIds.length; i++) {
        ranges[instance.parameterIds[i]] = instance.getParameterRangeAt(i);
      }
      setParamRanges(ranges);

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
            const text = atob(b64);
            const motionJson = JSON.parse(text);
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
    modelRef.current?.setParameterValue(id, value);
  }, []);

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
