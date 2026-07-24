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
  private _listenerCanvas: HTMLCanvasElement | null = null;

  // Stable, bound handlers so the identical reference can be removed later.
  // The old code added a fresh anonymous listener on every initialize() call,
  // and since initialize() is re-invoked from webglcontextrestored, those
  // duplicate, unremovable handlers multiplied on each context restore.
  private readonly _handleContextLost = (e: Event): void => {
    e.preventDefault();
    this._initialized = false;
    this._gl = null;
    for (const cb of this._contextLostCallbacks) cb();
  };

  private readonly _handleContextRestored = (): void => {
    const canvas = this._canvas;
    if (!canvas) return;
    try {
      this.initialize(canvas);
    } catch (e) {
      // Re-init failed (e.g. getContext returned null). Leave the framework
      // uninitialized so the render loop keeps idling, and do NOT run the
      // restored callbacks — there is no usable GL context to reload into.
      // The host's restore-timeout path surfaces the failure to the user.
      console.error('[Live2D] WebGL 上下文恢复后重新初始化失败:', e);
      return;
    }
    for (const cb of this._contextRestoredCallbacks) cb();
  };

  private attachContextListeners(canvas: HTMLCanvasElement): void {
    if (this._listenerCanvas === canvas) return;
    this.detachContextListeners();
    canvas.addEventListener('webglcontextlost', this._handleContextLost);
    canvas.addEventListener('webglcontextrestored', this._handleContextRestored);
    this._listenerCanvas = canvas;
  }

  private detachContextListeners(): void {
    const canvas = this._listenerCanvas;
    if (!canvas) return;
    canvas.removeEventListener('webglcontextlost', this._handleContextLost);
    canvas.removeEventListener('webglcontextrestored', this._handleContextRestored);
    this._listenerCanvas = null;
  }

  /** Register a callback for when WebGL context is lost. */
  onContextLost(cb: () => void): void {
    this._contextLostCallbacks.push(cb);
  }

  /** Unregister a previously registered context-lost callback. */
  offContextLost(cb: () => void): void {
    this._contextLostCallbacks = this._contextLostCallbacks.filter((c) => c !== cb);
  }

  /** Register a callback for when WebGL context is restored. */
  onContextRestored(cb: () => void): void {
    this._contextRestoredCallbacks.push(cb);
  }

  /** Unregister a previously registered context-restored callback. */
  offContextRestored(cb: () => void): void {
    this._contextRestoredCallbacks = this._contextRestoredCallbacks.filter((c) => c !== cb);
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

    // Handle WebGL context loss (e.g. HMR, GPU reset, sleep/wake). Attached via
    // stable named handlers and only once per canvas, so the re-init that
    // webglcontextrestored triggers does not stack duplicate listeners.
    this.attachContextListeners(canvas);

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
    this.detachContextListeners();
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
