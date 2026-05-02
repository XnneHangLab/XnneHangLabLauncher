/**
 * SDK motion player wrapper for resource/timeline preview.
 *
 * The launcher should evaluate .motion3.json the same way as the frontend
 * runtime/live2d-control path. Therefore this player delegates actual motion
 * evaluation to the model's CubismMotionManager via ModelInstance.startMotion()
 * instead of using the launcher-only curve evaluator.
 */

import type { ModelInstance } from './ModelLoader';

export type PlayerState = 'playing' | 'paused' | 'stopped';

export class MotionPlayer {
  private _model: ModelInstance | null = null;
  private _group: string | null = null;
  private _index = -1;
  private _state: PlayerState = 'stopped';
  private _currentTime = 0;
  private _duration = 0;
  private _speed = 1;
  private _loop = false;
  private _onFinish: (() => void) | null = null;

  get state(): PlayerState { return this._state; }
  get currentTime(): number { return this._currentTime; }
  get duration(): number { return this._duration; }
  get speed(): number { return this._speed; }
  get isPlaying(): boolean { return this._state === 'playing'; }
  get hasMotion(): boolean { return this._model !== null && this._group !== null && this._index >= 0; }

  load(group: string, index: number, model: ModelInstance, duration: number, loop?: boolean): void {
    this._model = model;
    this._group = group;
    this._index = index;
    this._duration = duration;
    this._loop = Boolean(loop);
    this._currentTime = 0;
    this._state = 'stopped';
  }

  unload(): void {
    this._model?.stopAllMotions();
    this._model = null;
    this._group = null;
    this._index = -1;
    this._state = 'stopped';
    this._currentTime = 0;
    this._duration = 0;
  }

  play(startTime = this._currentTime): void {
    if (!this._model || this._group === null || this._index < 0) return;
    this._currentTime = Math.max(0, Math.min(startTime, this._duration || startTime));
    if (!this._model.startMotion(this._group, this._index, this._loop)) return;
    this._state = 'playing';
  }

  pause(): void {
    if (this._state !== 'playing') return;
    this._model?.stopAllMotions();
    this._state = 'paused';
  }

  stop(): void {
    this._model?.stopAllMotions();
    this._state = 'stopped';
    this._currentTime = 0;
  }

  setSpeed(speed: number): void {
    this._speed = Math.max(0.01, speed);
  }

  setLoop(loop: boolean): void {
    this._loop = loop;
  }

  /** SDK manager playback is linear; scrub only updates UI time for now. */
  scrub(time: number): void {
    const d = this._duration || 0;
    this._currentTime = Math.max(0, Math.min(time, d));
  }

  setOnFinish(cb: (() => void) | null): void {
    this._onFinish = cb;
  }

  tick(dt: number): void {
    if (this._state !== 'playing') return;
    this._currentTime += dt * this._speed;

    if (this._duration > 0 && this._currentTime >= this._duration) {
      if (this._loop) {
        this._currentTime %= this._duration;
      } else {
        this._currentTime = this._duration;
        this._state = 'stopped';
        this._model?.stopAllMotions();
        this._onFinish?.();
      }
    }
  }
}
