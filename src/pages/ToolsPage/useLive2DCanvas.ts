import { useEffect, useRef, useCallback, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';

export interface MotionEntry {
  group: string;
  index: number;
  file: string;
}

interface UseLive2DCanvasResult {
  motions: MotionEntry[];
  currentMotion: { group: string; index: number } | null;
  progress: number;
  isPlaying: boolean;
  playMotion: (group: string, index: number) => void;
  modelLoaded: boolean;
  modelError: string | null;
}

export function useLive2DCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  modelUrl: string | null,
): UseLive2DCanvasResult {
  const appRef = useRef<PIXI.Application | null>(null);
  const modelRef = useRef<InstanceType<typeof Live2DModel> | null>(null);
  const rafRef = useRef<number>(0);
  const startedAtRef = useRef(0);
  const durationRef = useRef(0);

  const [motions, setMotions] = useState<MotionEntry[]>([]);
  const [currentMotion, setCurrentMotion] = useState<{ group: string; index: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      if (startedAtRef.current > 0 && durationRef.current > 0) {
        const elapsed = (performance.now() - startedAtRef.current) / 1000;
        setProgress(Math.min(elapsed / durationRef.current, 1));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !modelUrl) return;

    (window as Record<string, unknown>).PIXI = PIXI;

    let cancelled = false;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;

    const app = new PIXI.Application({
      view: canvas,
      backgroundAlpha: 0,
      width: parent?.clientWidth ?? 600,
      height: parent?.clientHeight ?? 400,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    appRef.current = app;

    setModelLoaded(false);
    setModelError(null);
    setMotions([]);
    setCurrentMotion(null);
    setProgress(0);
    setIsPlaying(false);
    startedAtRef.current = 0;
    durationRef.current = 0;

    const baseDir = modelUrl.substring(0, modelUrl.lastIndexOf('/') + 1);

    Live2DModel.from(modelUrl, { autoInteract: false })
      .then((model) => {
        if (cancelled) {
          model.destroy();
          return;
        }

        modelRef.current = model;

        const scale =
          Math.min(app.screen.width / model.width, app.screen.height / model.height) * 0.8;
        model.scale.set(scale);
        model.x = app.screen.width / 2;
        model.y = app.screen.height / 2;
        model.anchor.set(0.5, 0.5);

        app.stage.addChild(model as unknown as PIXI.DisplayObject);

        const defs = (
          model.internalModel.motionManager as unknown as {
            definitions: Record<string, Array<{ File?: string; file?: string }>>;
          }
        ).definitions;

        const entries: MotionEntry[] = Object.entries(defs).flatMap(([group, arr]) =>
          (arr ?? []).map((item, index) => ({
            group,
            index,
            file: item?.File ?? item?.file ?? '',
          })),
        );
        setMotions(entries);
        setModelLoaded(true);

        const mm = model.internalModel.motionManager as unknown as {
          on: (event: string, cb: (...args: unknown[]) => void) => void;
          off: (event: string, cb: (...args: unknown[]) => void) => void;
        };

        const onStart = (group: unknown, index: unknown) => {
          const g = String(group);
          const i = Number(index);
          setCurrentMotion({ group: g, index: i });
          setIsPlaying(true);
          setProgress(0);
          startedAtRef.current = performance.now();
          durationRef.current = 0;
          const entry = entries.find((e) => e.group === g && e.index === i);
          if (entry?.file) {
            fetch(baseDir + entry.file)
              .then((r) => r.json())
              .then((j: unknown) => {
                const meta = (j as Record<string, Record<string, number>>)?.Meta;
                durationRef.current = meta?.Duration ?? 0;
              })
              .catch(() => {
                durationRef.current = 0;
              });
          }
        };

        const onFinish = () => {
          setIsPlaying(false);
          startedAtRef.current = 0;
        };

        mm.on('motionStart', onStart);
        mm.on('motionFinish', onFinish);

        const idleGroup =
          Object.keys(defs).find((k) => k.toLowerCase().includes('idle')) ??
          Object.keys(defs)[0];
        if (idleGroup) {
          void model.motion(idleGroup, 0);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setModelError(String(err));
      });

    return () => {
      cancelled = true;
      if (modelRef.current) {
        modelRef.current.destroy();
        modelRef.current = null;
      }
      app.destroy(false);
      appRef.current = null;
    };
  }, [modelUrl]);

  const playMotion = useCallback((group: string, index: number) => {
    void modelRef.current?.motion(group, index);
  }, []);

  return { motions, currentMotion, progress, isPlaying, playMotion, modelLoaded, modelError };
}
