/**
 * Live2D animation editor context and provider.
 * Manages the Cubism model lifecycle, animation loop, and shared state.
 */

import React, { useEffect, useRef, useState, useCallback, createContext, useContext } from 'react';
import { CubismInit } from '../../live2d/engine/CubismFrameworkInit';
import { loadModelFromData } from '../../live2d/engine/ModelLoader';
import type { ModelInstance } from '../../live2d/engine/ModelLoader';
import { MotionPlayer } from '../../live2d/engine/MotionPlayer';
import { KeyframeOverlay } from '../../live2d/engine/KeyframeOverlay';
import { parseMotion } from '../../live2d/engine/MotionParser';
import { readLive2DModelData, pickAnyFile } from '../../services/config/bridge';
import type { Live2DModelData } from '../../services/config/bridge';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MotionEntry {
  group: string;
  index: number;
  name: string;
  file: string;
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
  /** Parameter values snapshot (updated each frame) */
  paramValues: Record<string, number>;
  /** Currently playing motion, if tracked */
  currentMotion: { group: string; index: number } | null;
  /** Motion rename map: "group_index" → display name */
  motionAliases: Record<string, string>;

  loadModelByPath: (path: string) => Promise<void>;
  openImportDialog: () => Promise<void>;
  playMotion: (group: string, index: number) => void;
  setParameter: (id: string, value: number) => void;
  togglePlay: () => void;
  scrub: (time: number) => void;
  renameMotion: (key: string, name: string) => void;
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

  const [modelPath, setModelPath] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [motionEntries, setMotionEntries] = useState<MotionEntry[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [currentMotion, setCurrentMotion] = useState<{ group: string; index: number } | null>(null);
  const [motionAliases, setMotionAliases] = useState<Record<string, string>>({});

  // ── Init Cubism on canvas mount ────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cubismReadyRef.current) return;
    CubismInit.initialize(canvas);
    cubismReadyRef.current = true;
  }, []);

  // ── Animation loop ─────────────────────────────────────────────────────────

  useEffect(() => {
    const loop = (now: number) => {
      const dt = lastTimeRef.current ? Math.min((now - lastTimeRef.current) / 1000, 0.05) : 0.016;
      lastTimeRef.current = now;

      const model = modelRef.current;
      if (model) {
        const player = motionPlayerRef.current;
        player.tick(dt);

        // Apply keyframe overlay
        overlayRef.current.apply(model, player.currentTime);

        model.update(dt);

        CubismInit.resize();
        model.draw();

        // Sync UI state (throttled — only every ~3 frames)
        setCurrentTime(player.currentTime);
        setDuration(player.duration);
        setIsPlaying(player.isPlaying);

        // Read parameter values
        const ids = model.parameterIds;
        if (ids.length > 0) {
          const vals: Record<string, number> = {};
          for (let i = 0; i < ids.length; i++) {
            vals[ids[i]] = model.getParameterValue(ids[i]);
          }
          setParamValues(vals);
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Model loading ─────────────────────────────────────────────────────────

  const loadModelByPath = useCallback(async (path: string) => {
    setModelLoaded(false);
    setModelError(null);
    setModelPath(path);

    try {
      const data: Live2DModelData = await readLive2DModelData(path);
      const { instance } = await loadModelFromData(
        data.modelJson as Record<string, unknown>,
        data.files,
      );

      if (modelRef.current) modelRef.current.release();
      modelRef.current = instance;
      motionPlayerRef.current.unload();
      setMotionEntries(instance.motionEntries);
      setModelLoaded(true);

      // Auto-start Idle motion
      const idle = instance.motionEntries.find((e) => e.group.toLowerCase().includes('idle'));
      if (idle) {
        instance.startMotion(idle.group, idle.index);

        // Try loading motion into player for scrubbing
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

  const playMotion = useCallback((group: string, index: number) => {
    modelRef.current?.startMotion(group, index);
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

  // ── Context value ─────────────────────────────────────────────────────────

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
    currentMotion,
    motionAliases,
    loadModelByPath,
    openImportDialog,
    playMotion,
    setParameter,
    togglePlay,
    scrub,
    renameMotion,
  };

  return (
    <EditorCtx.Provider value={ctx}>
      {children}
    </EditorCtx.Provider>
  );
}
