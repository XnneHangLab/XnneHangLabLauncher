/**
 * Manages Cubism Framework lifecycle and WebGL context.
 * Singleton — call getInstance().initialize(canvas) before use.
 */

import { CubismFramework, Option, LogLevel } from '@framework/live2dcubismframework';

class _CubismFrameworkInit {
  private _gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  private _initialized = false;
  private _canvas: HTMLCanvasElement | null = null;

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

  /**
   * Create WebGL context from canvas and start Cubism Framework.
   * Safe to call multiple times — idempotent.
   */
  initialize(canvas: HTMLCanvasElement): void {
    if (this._initialized && this._canvas === canvas) return;

    this._canvas = canvas;
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
  }

  /** Dispose Cubism Framework. */
  dispose(): void {
    if (this._initialized) {
      CubismFramework.dispose();
      this._initialized = false;
    }
    this._gl = null;
    this._canvas = null;
  }

  /** Resize the viewport to match canvas display size. */
  resize(): void {
    if (!this._canvas || !this._gl) return;
    const w = this._canvas.clientWidth * window.devicePixelRatio;
    const h = this._canvas.clientHeight * window.devicePixelRatio;
    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas.width = w;
      this._canvas.height = h;
      this._gl.viewport(0, 0, this._gl.drawingBufferWidth, this._gl.drawingBufferHeight);
    }
  }
}

/** Singleton instance */
export const CubismInit = new _CubismFrameworkInit();
