/**
 * Manages Cubism Framework lifecycle and WebGL context.
 * Singleton — call getInstance().initialize(canvas) before use.
 */

import { CubismFramework, Option, LogLevel } from '@framework/live2dcubismframework';

class _CubismFrameworkInit {
  private _gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  private _initialized = false;
  private _canvas: HTMLCanvasElement | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _renderScale = 1.0;

  /** Get the WebGL context (only valid after initialize()). */
  get gl(): WebGL2RenderingContext | WebGLRenderingContext {
    if (!this._gl) throw new Error('CubismFramework not initialized');
    return this._gl;
  }

  get canvas(): HTMLCanvasElement {
    if (!this._canvas) throw new Error('CubismFramework not initialized');
    return this._canvas;
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  private _contextLostCallbacks: Array<() => void> = [];
  private _contextRestoredCallbacks: Array<() => void> = [];

  /** Register a callback for when WebGL context is lost. */
  onContextLost(cb: () => void): void {
    this._contextLostCallbacks.push(cb);
  }

  /** Register a callback for when WebGL context is restored. */
  onContextRestored(cb: () => void): void {
    this._contextRestoredCallbacks.push(cb);
  }

  /** Remove all context loss/restore callbacks. */
  clearContextCallbacks(): void {
    this._contextLostCallbacks = [];
    this._contextRestoredCallbacks = [];
  }

  /**
   * Create WebGL context from canvas and start Cubism Framework.
   * Safe to call multiple times — idempotent.
   */
  initialize(canvas: HTMLCanvasElement): void {
    if (this._initialized && this._canvas === canvas) return;

    // If switching to a new canvas, dispose the old context first
    if (this._initialized && this._canvas !== canvas) {
      this.dispose();
    }

    this._canvas = canvas;

    // Handle WebGL context loss (e.g. HMR, GPU reset, sleep/wake)
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this._initialized = false;
      this._gl = null;
      for (const cb of this._contextLostCallbacks) cb();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.initialize(canvas);
      for (const cb of this._contextRestoredCallbacks) cb();
    });

    this._gl =
      (canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true }) as WebGL2RenderingContext) ??
      (canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true }) as WebGLRenderingContext);

    if (!this._gl) throw new Error('WebGL not available');

    // Enable blending (transparency)
    this._gl.enable(this._gl.BLEND);
    this._gl.blendFunc(this._gl.SRC_ALPHA, this._gl.ONE_MINUS_SRC_ALPHA);

    // Start Cubism Framework
    if (!CubismFramework.isStarted()) {
      const option = new Option();
      option.logFunction = null; // or a custom logger
      option.loggingLevel = LogLevel.LogLevel_Verbose;
      CubismFramework.startUp(option);
    }
    CubismFramework.initialize();

    this._initialized = true;

    // Observe canvas size so we react to layout settling on cold start,
    // window resize, tab visibility changes, devtools toggles, etc.
    // The animation loop also calls resize() each frame, but that only
    // helps after the first paint — if the canvas mounts with
    // clientWidth/Height = 0 we still need an explicit trigger once layout
    // produces a real size.
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver?.disconnect();
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(canvas);
    }
  }

  /** Dispose Cubism Framework. */
  dispose(): void {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._initialized) {
      CubismFramework.dispose();
      this._initialized = false;
    }
    this._gl = null;
    this._canvas = null;
  }

  get renderScale(): number {
    return this._renderScale;
  }

  set renderScale(scale: number) {
    this._renderScale = Math.max(0.25, Math.min(1.0, scale));
    this.resize(true);
  }

  /**
   * Resize the viewport to match canvas display size.
   * Safe to call repeatedly — no-ops if dimensions are unchanged or zero.
   */
  resize(force = false): void {
    if (!this._canvas || !this._gl) return;
    const dpr = Math.min(window.devicePixelRatio, 2) * this._renderScale;
    const w = Math.floor(this._canvas.clientWidth * dpr);
    const h = Math.floor(this._canvas.clientHeight * dpr);
    if (w === 0 || h === 0) return;
    if (!force && this._canvas.width === w && this._canvas.height === h) return;
    this._canvas.width = w;
    this._canvas.height = h;
    this._gl.viewport(0, 0, this._gl.drawingBufferWidth, this._gl.drawingBufferHeight);
  }
}

/** Singleton instance */
export const CubismInit = new _CubismFrameworkInit();
