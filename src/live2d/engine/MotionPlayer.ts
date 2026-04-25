/**
 * Custom motion player with play/pause/scrub support.
 * Does NOT use CubismMotionManager because it cannot handle non-linear time (scrubbing).
 *
 * Instead, it pre-evaluates all curves at the current time and pushes
 * values directly to the model via setParameterValue().
 */

import type { ParsedMotion } from '../types';
import { evaluateMotion } from './MotionParser';
import type { ModelInstance } from './ModelLoader';

export type PlayerState = 'playing' | 'paused' | 'stopped';

export class MotionPlayer {
  private _parsed: ParsedMotion | null = null;
  private _model: ModelInstance | null = null;
  private _state: PlayerState = 'stopped';
  private _currentTime = 0;
  private _speed = 1;
  private _loop = false;
  private _onFinish: (() => void) | null = null;

  get state(): PlayerState { return this._state; }
  get currentTime(): number { return this._currentTime; }
  get duration(): number { return this._parsed?.duration ?? 0; }
  get speed(): number { return this._speed; }
  get isPlaying(): boolean { return this._state === 'playing'; }

  /** Load a new motion and reset. */
  load(motion: ParsedMotion, model: ModelInstance, loop?: boolean): void {
    this._parsed = motion;
    this._model = model;
    this._loop = loop ?? motion.loop;
    this._currentTime = 0;
    this._state = 'stopped';
  }

  /** Unload current motion. */
  unload(): void {
    this._parsed = null;
    this._model = null;
    this._state = 'stopped';
    this._currentTime = 0;
  }

  play(): void {
    if (!this._parsed || !this._model) return;
    if (this._state === 'stopped') this._currentTime = 0;
    this._state = 'playing';
  }

  pause(): void {
    if (this._state === 'playing') this._state = 'paused';
  }

  stop(): void {
    this._state = 'stopped';
    this._currentTime = 0;
  }

  setSpeed(speed: number): void {
    this._speed = Math.max(0.01, speed);
  }

  setLoop(loop: boolean): void {
    this._loop = loop;
  }

  /** Seek to a specific time (scrubbing). */
  scrub(time: number): void {
    const d = this._parsed?.duration ?? 1;
    this._currentTime = Math.max(0, Math.min(time, d));
  }

  setOnFinish(cb: (() => void) | null): void {
    this._onFinish = cb;
  }

  /**
   * Advance the player by dt seconds.
   * Call this from your rAF loop when state === 'playing'.
   */
  tick(dt: number): void {
    if (this._state !== 'playing') return;
    if (!this._parsed || !this._model) return;

    this._currentTime += dt * this._speed;

    const d = this._parsed.duration;
    if (this._currentTime >= d) {
      if (this._loop) {
        this._currentTime %= d;
      } else {
        this._currentTime = d;
        this._state = 'stopped';
        this._onFinish?.();
        // Still evaluate at the end time
      }
    }

    // Evaluate and push values to the model
    const values = evaluateMotion(this._parsed, this._currentTime);
    for (const [id, val] of Object.entries(values)) {
      this._model.setParameterValue(id, val);
    }
  }
}
