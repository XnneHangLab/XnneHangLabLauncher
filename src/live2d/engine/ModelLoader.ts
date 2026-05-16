/**
 * Loads a Live2D model entirely from pre-fetched IPC data (no fetch/URL).
 * Converts base64 → ArrayBuffer → Cubism SDK structures.
 */

import { CubismModelSettingJson } from '@framework/cubismmodelsettingjson';
import { ICubismModelSetting } from '@framework/icubismmodelsetting';
import { CubismMoc } from '@framework/model/cubismmoc';
import { CubismModel } from '@framework/model/cubismmodel';
import { CubismUserModel } from '@framework/model/cubismusermodel';
import { CubismMotion } from '@framework/motion/cubismmotion';
import { ACubismMotion, FinishedMotionCallback } from '@framework/motion/acubismmotion';
import { CubismPose } from '@framework/effect/cubismpose';
import { CubismPhysics } from '@framework/physics/cubismphysics';
import { CubismModelUserData } from '@framework/model/cubismmodeluserdata';
import { CubismEyeBlink } from '@framework/effect/cubismeyeblink';
import { CubismBreath, BreathParameterData } from '@framework/effect/cubismbreath';
import { CubismDefaultParameterId } from '@framework/cubismdefaultparameterid';
import { CubismFramework } from '@framework/live2dcubismframework';
import { CubismModelMatrix } from '@framework/math/cubismmodelmatrix';
import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { csmVector } from '@framework/type/csmvector';
import { csmMap } from '@framework/type/csmmap';
import { CubismIdHandle } from '@framework/id/cubismid';
import { CubismTargetPoint } from '@framework/math/cubismtargetpoint';
import { CubismMotionManager } from '@framework/motion/cubismmotionmanager';
import { CubismExpressionMotionManager } from '@framework/motion/cubismexpressionmotionmanager';

import { CubismInit } from './CubismFrameworkInit';
import { createTextures, TextureInfo } from './TextureManager';

// ── helpers ──────────────────────────────────────────────────────────────────

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const byteChars = atob(base64);
  const len = byteChars.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = byteChars.charCodeAt(i);
  return bytes.buffer;
}

function base64ToUtf8ArrayBuffer(base64: string): ArrayBuffer {
  const text = atob(base64);
  const encoder = new TextEncoder();
  return encoder.encode(text).buffer;
}

// ── ModelInstance ────────────────────────────────────────────────────────────

/**
 * A lightweight wrapper around CubismUserModel for editor use.
 * Manages the update/draw loop and provides parameter access.
 */
export class ModelInstance {
  private _userModel: CubismUserModel;
  private _modelSetting: ICubismModelSetting;
  private _textureInfos: TextureInfo[] = [];
  private _loadedMotions: csmMap<string, ACubismMotion> = new csmMap();
  private _motionOriginalFadeInTimes = new Map<string, number>();
  private _motionCount = 0;
  private _motionGroupNames: string[] = [];
  private _userTimeSeconds = 0;
  private _animating = false;
  private _eyeBlinkIds: csmVector<CubismIdHandle> = new csmVector();
  private _lipSyncIds: csmVector<CubismIdHandle> = new csmVector();
  private _curveFadeBackup: Array<{ key: string; curveIndex: number; fadeIn: number; fadeOut: number }> | null = null;

  // Standard parameter ID handles
  private _idParamAngleX: CubismIdHandle | null = null;
  private _idParamAngleY: CubismIdHandle | null = null;
  private _idParamAngleZ: CubismIdHandle | null = null;
  private _idParamEyeBallX: CubismIdHandle | null = null;
  private _idParamEyeBallY: CubismIdHandle | null = null;
  private _idParamBodyAngleX: CubismIdHandle | null = null;
  private _idParamBodyAngleY: CubismIdHandle | null = null;

  /** All parameter IDs available on this model. */
  parameterIds: string[] = [];
  /** All motion entries: `{ group, index, name }` */
  motionEntries: Array<{ group: string; index: number; name: string; file: string }> = [];

  constructor(
    userModel: CubismUserModel,
    setting: ICubismModelSetting,
    textureInfos: TextureInfo[],
    motionEntries: Array<{ group: string; index: number; name: string; file: string }>,
  ) {
    this._userModel = userModel;
    this._modelSetting = setting;
    this._textureInfos = textureInfos;
    this.motionEntries = motionEntries;

    const idManager = CubismFramework.getIdManager();
    if (idManager) {
      this._idParamAngleX = idManager.getId(CubismDefaultParameterId.ParamAngleX);
      this._idParamAngleY = idManager.getId(CubismDefaultParameterId.ParamAngleY);
      this._idParamAngleZ = idManager.getId(CubismDefaultParameterId.ParamAngleZ);
      this._idParamEyeBallX = idManager.getId(CubismDefaultParameterId.ParamEyeBallX);
      this._idParamEyeBallY = idManager.getId(CubismDefaultParameterId.ParamEyeBallY);
      this._idParamBodyAngleX = idManager.getId(CubismDefaultParameterId.ParamBodyAngleX);
      this._idParamBodyAngleY = idManager.getId(CubismDefaultParameterId.ParamBodyAngleY);
    }

    // Collect parameter IDs
    this.refreshParameterIds();
    this.initializeMotionEffectIds();
  }

  private initializeMotionEffectIds(): void {
    this._eyeBlinkIds = new csmVector<CubismIdHandle>();
    this._lipSyncIds = new csmVector<CubismIdHandle>();

    for (let i = 0; i < this._modelSetting.getEyeBlinkParameterCount(); i++) {
      this._eyeBlinkIds.pushBack(this._modelSetting.getEyeBlinkParameterId(i));
    }

    for (let i = 0; i < this._modelSetting.getLipSyncParameterCount(); i++) {
      this._lipSyncIds.pushBack(this._modelSetting.getLipSyncParameterId(i));
    }

    if (this._lipSyncIds.getSize() === 0) {
      const idManager = CubismFramework.getIdManager();
      const fallbackId = idManager?.getId(CubismDefaultParameterId.ParamMouthOpenY);
      if (fallbackId && this.model.getParameterIndex(fallbackId) !== -1) {
        this._lipSyncIds.pushBack(fallbackId);
      }
    }

    this.applyEffectIdsToLoadedMotions();
  }

  private applyEffectIdsToMotion(motion: CubismMotion): void {
    motion.setEffectIds(this._eyeBlinkIds, this._lipSyncIds);
  }

  private applyEffectIdsToLoadedMotions(): void {
    let ite = this._loadedMotions.begin();
    const end = this._loadedMotions.end();
    while (ite.notEqual(end)) {
      const motion = ite.ptr().second as CubismMotion | null;
      if (motion) this.applyEffectIdsToMotion(motion);
      ite.preIncrement();
    }
  }

  get model(): CubismModel {
    return this._userModel.getModel();
  }

  get setting(): ICubismModelSetting {
    return this._modelSetting;
  }

  get textureInfos(): TextureInfo[] {
    return this._textureInfos;
  }

  get userModel(): CubismUserModel {
    return this._userModel;
  }

  // ── Parameter API ──────────────────────────────────────────────────────────

  // ── Core SDK accessor ─────────────────────────────────────────────────────

  /** Returns the native Live2DCubismCore.Model (two private hops deep). */
  private get _core(): any {
    return (this._userModel as any)?._model?._model ?? null;
  }

  private refreshParameterIds(): void {
    const core = this._core;
    const ids: string[] = core?.parameters?.ids ?? [];
    const count = this.model.getParameterCount();
    this.parameterIds = [];
    for (let i = 0; i < count; i++) {
      const id = ids[i] ?? this.model.getParameterId(i).getString().s;
      this.parameterIds.push(id);
    }
  }

  getParameterIndex(id: string): number {
    return this.model.getParameterIndex(this.resolveId(id));
  }

  getParameterValue(id: string): number {
    return this.model.getParameterValueById(this.resolveId(id));
  }

  getParameterValueAt(index: number): number {
    const core = this._core;
    if (core) return (core.parameters.values as Float32Array)[index] ?? 0;
    return this.model.getParameterValueByIndex(index);
  }

  getBaseParameterValues(): Record<string, number> {
    const core = this._core;
    const values: Record<string, number> = {};
    for (let i = 0; i < this.parameterIds.length; i++) {
      values[this.parameterIds[i]] = core
        ? (core.parameters.defaultValues as Float32Array)[i]
        : this.model.getParameterDefaultValue(i);
    }
    return values;
  }

  private clampParameterValue(index: number, value: number): number {
    const core = this._core;
    const min = core ? (core.parameters.minimumValues as Float32Array)[index] : this.model.getParameterMinimumValue(index);
    const max = core ? (core.parameters.maximumValues as Float32Array)[index] : this.model.getParameterMaximumValue(index);
    return Math.min(Math.max(value, min), max);
  }

  setParameterValue(id: string, value: number, save = true): void {
    const idx = this.parameterIds.indexOf(id);
    if (idx >= 0) {
      const nextValue = this.clampParameterValue(idx, value);
      const core = this._core;
      if (core) (core.parameters.values as Float32Array)[idx] = nextValue;
      this.model.setParameterValueByIndex(idx, nextValue);
      if (save) this.model.saveParameters();
      return;
    }
    this.model.setParameterValueById(this.resolveId(id), value);
    if (save) this.model.saveParameters();
  }

  applyParameterValues(values: Record<string, number>, save = false): void {
    for (const [id, value] of Object.entries(values)) {
      this.setParameterValue(id, value, false);
    }
    if (save) this.model.saveParameters();
  }

  commitParameterValues(): void {
    this.model.update();
  }

  getDebugSnapshot(paramId: string): { id: string; index: number; value: number; coreValue: number; changedDrawables: number; vertexSample: number } {
    const index = this.parameterIds.indexOf(paramId);
    const core = this._core;
    let changedDrawables = 0;
    let vertexSample = 0;
    for (let i = 0; i < this.model.getDrawableCount(); i++) {
      if (this.model.getDrawableDynamicFlagVertexPositionsDidChange(i)) changedDrawables++;
      const vertices = this.model.getDrawableVertices(i);
      for (let j = 0; j < Math.min(vertices.length, 12); j++) vertexSample += vertices[j];
    }
    return {
      id: paramId,
      index,
      value: index >= 0 ? this.model.getParameterValueByIndex(index) : NaN,
      coreValue: index >= 0 && core ? (core.parameters.values as Float32Array)[index] : NaN,
      changedDrawables,
      vertexSample: Number(vertexSample.toFixed(4)),
    };
  }

  getParameterMin(id: string): number {
    return this.model.getParameterMinimumValue(this.model.getParameterIndex(this.resolveId(id)));
  }

  getParameterMax(id: string): number {
    return this.model.getParameterMaximumValue(this.model.getParameterIndex(this.resolveId(id)));
  }

  getParameterDefault(id: string): number {
    return this.model.getParameterDefaultValue(this.model.getParameterIndex(this.resolveId(id)));
  }

  getParameterRangeAt(index: number): { min: number; max: number; default: number } {
    const core = this._core;
    if (core) {
      return {
        min: (core.parameters.minimumValues as Float32Array)[index],
        max: (core.parameters.maximumValues as Float32Array)[index],
        default: (core.parameters.defaultValues as Float32Array)[index],
      };
    }
    return {
      min: this.model.getParameterMinimumValue(index),
      max: this.model.getParameterMaximumValue(index),
      default: this.model.getParameterDefaultValue(index),
    };
  }

  private resolveId(id: string): CubismIdHandle {
    const idManager = CubismFramework.getIdManager();
    return idManager!.getId(id);
  }

  addLoadedMotion(key: string, buf: ArrayBuffer): boolean {
    const motion = CubismMotion.create(buf, buf.byteLength) as CubismMotion;
    if (!motion) return false;
    this.applyEffectIdsToMotion(motion);
    this._loadedMotions.setValue(key, motion);
    this._motionOriginalFadeInTimes.set(key, motion.getFadeInTime());
    return true;
  }

  getLoadedMotion(group: string, index: number): CubismMotion | null {
    const key = `${group}_${index}`;
    return this._loadedMotions.isExist(key)
      ? this._loadedMotions.getValue(key) as CubismMotion
      : null;
  }

  getLoadedMotionFromKey(key: string): CubismMotion | null {
    return this._loadedMotions.isExist(key)
      ? this._loadedMotions.getValue(key) as CubismMotion
      : null;
  }

  getMotionDuration(group: string, index: number): number {
    const motion = this.getLoadedMotion(group, index);
    return motion?.getLoopDuration?.() ?? 0;
  }

  removeLoadedMotion(key: string): void {
    let ite = this._loadedMotions.begin();
    const end = this._loadedMotions.end();
    while (ite.notEqual(end)) {
      if (ite.ptr().first === key) {
        this._loadedMotions.erase(ite);
        this._motionOriginalFadeInTimes.delete(key);
        return;
      }
      ite.preIncrement();
    }
  }

  // ── Standard param accessors (for drag etc.) ─────────────────────────────

  addParamAngleX(v: number): void { if (this._idParamAngleX) this.model.addParameterValueById(this._idParamAngleX, v); }
  addParamAngleY(v: number): void { if (this._idParamAngleY) this.model.addParameterValueById(this._idParamAngleY, v); }
  addParamAngleZ(v: number): void { if (this._idParamAngleZ) this.model.addParameterValueById(this._idParamAngleZ, v); }
  addParamEyeBallX(v: number): void { if (this._idParamEyeBallX) this.model.addParameterValueById(this._idParamEyeBallX, v); }
  addParamEyeBallY(v: number): void { if (this._idParamEyeBallY) this.model.addParameterValueById(this._idParamEyeBallY, v); }
  addParamBodyAngleX(v: number): void { if (this._idParamBodyAngleX) this.model.addParameterValueById(this._idParamBodyAngleX, v); }
  addParamBodyAngleY(v: number): void { if (this._idParamBodyAngleY) this.model.addParameterValueById(this._idParamBodyAngleY, v); }

  // ── Update / Draw ──────────────────────────────────────────────────────────

  update(
    deltaTimeSeconds: number,
    parameterOverrides?: Record<string, number>,
    options?: { skipCubismMotions?: boolean; skipExpressions?: boolean; skipEffects?: boolean },
  ): void {
    const m = this.model;
    if (!m) return;

    this._userTimeSeconds += deltaTimeSeconds;

    // Match the frontend runtime order: always restore the last saved baseline,
    // let CubismMotionManager apply the active motion, then save that result for
    // secondary effects. This avoids stacking relative motion/expression values
    // frame after frame.
    let motionUpdated = false;
    const motionMgr = this._userModel['_motionManager'] as CubismMotionManager;
    m.loadParameters();
    if (motionMgr && !options?.skipCubismMotions) {
      if (!motionMgr.isFinished()) {
        motionUpdated = motionMgr.updateMotion(m, deltaTimeSeconds);
      }
    }
    if (this._curveFadeBackup) {
      this.restoreCurveFades();
    }
    m.saveParameters();

    // Eye blink (only when no motion is driving it), same as frontend runtime.
    const eyeBlink = this._userModel['_eyeBlink'] as CubismEyeBlink | null;
    if (!options?.skipEffects && !motionUpdated && eyeBlink) {
      eyeBlink.updateParameters(m, deltaTimeSeconds);
    }

    // Expressions are applied after the motion just like the frontend runtime.
    // The launcher usually keeps skipExpressions=true during editor preview
    // because EXP clips/appearance states are represented as manual overrides,
    // but leaving this path intact allows SDK expression-manager composition
    // when a caller needs exact frontend behavior.
    const exprMgr = this._userModel['_expressionManager'] as CubismExpressionMotionManager | null;
    if (exprMgr && !options?.skipExpressions) {
      exprMgr.updateMotion(m, deltaTimeSeconds);
    }

    // Breath
    const breath = this._userModel['_breath'] as CubismBreath | null;
    if (!options?.skipEffects && breath) {
      breath.updateParameters(m, deltaTimeSeconds);
    }

    // Physics
    const physics = this._userModel['_physics'] as CubismPhysics | null;
    if (!options?.skipEffects && physics) {
      physics.evaluate(m, deltaTimeSeconds);
    }

    // Pose
    const pose = this._userModel['_pose'] as CubismPose | null;
    if (!options?.skipEffects && pose) {
      pose.updateParameters(m, deltaTimeSeconds);
    }

    if (parameterOverrides) this.applyParameterValues(parameterOverrides);

    m.update();
  }

  draw(): void {
    const m = this.model;
    const renderer = this._userModel.getRenderer();
    if (!m || !renderer) return;

    const gl = CubismInit.gl;
    const canvas = CubismInit.canvas;
    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) return;

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const ratio = w / h;
    const modelAspect = m.getCanvasWidth() / m.getCanvasHeight();
    const projection = new CubismMatrix44();
    if (modelAspect <= ratio) {
      // model narrower than canvas: fit by height, pillarbox sides
      projection.scale(1.0 / ratio, 1.0);
    } else {
      // model wider than canvas: fit by width, letterbox top/bottom
      projection.scale(1.0 / modelAspect, ratio / modelAspect);
    }

    const modelMtx = this._userModel.getModelMatrix() as CubismModelMatrix;
    projection.multiplyByMatrix(modelMtx);

    renderer.setMvpMatrix(projection);
    renderer.setRenderState(gl.getParameter(gl.FRAMEBUFFER_BINDING), [0, 0, w, h]);
    renderer.drawModel();
  }

  // ── Motion control ─────────────────────────────────────────────────────────

  previewMotionParameters(group: string, index: number, timeSeconds: number, parameterOverrides?: Record<string, number>): Record<string, number> | null {
    const motion = this.getLoadedMotion(group, index);
    const m = this.model;
    if (!motion || !m) return null;

    const motionMgr = this._userModel['_motionManager'] as CubismMotionManager;
    const clampedTime = Math.max(0, timeSeconds);
    const originalLoop = motion.isLoop();
    const originalFadeIn = motion.getFadeInTime();
    const originalFadeOut = motion.getFadeOutTime();
    motionMgr.stopAllMotions();
    motion.setIsLoop(false);
    motion.setFadeInTime(0);
    motion.setFadeOutTime(0);
    motion.setOffsetTime(clampedTime);
    motionMgr.setReservePriority(3);
    motionMgr.startMotionPriority(motion, false, 3);

    m.loadParameters();
    if (!motionMgr.isFinished()) motionMgr.updateMotion(m, 0);
    if (parameterOverrides) this.applyParameterValues(parameterOverrides);

    const values: Record<string, number> = {};
    for (let i = 0; i < this.parameterIds.length; i++) {
      values[this.parameterIds[i]] = this.getParameterValueAt(i);
    }

    motionMgr.stopAllMotions();
    motion.setIsLoop(originalLoop);
    motion.setFadeInTime(originalFadeIn);
    motion.setFadeOutTime(originalFadeOut);
    m.loadParameters();
    if (parameterOverrides) this.applyParameterValues(parameterOverrides, true);
    m.update();
    return values;
  }

  startMotion(group: string, index: number, loop?: boolean, offsetSeconds = 0, fadeInSeconds?: number, zeroCurveFades?: boolean, preserveCurrentMotion?: boolean): boolean {
    const motion = this.getLoadedMotion(group, index);
    if (!motion) return false;

    const key = `${group}_${index}`;
    if (!this._motionOriginalFadeInTimes.has(key)) {
      this._motionOriginalFadeInTimes.set(key, motion.getFadeInTime());
    }
    const originalFadeIn = this._motionOriginalFadeInTimes.get(key) ?? motion.getFadeInTime();

    if (zeroCurveFades && (motion as any)._motionData) {
      const cubismMotion = motion as any;
      const data = cubismMotion._motionData;
      this._curveFadeBackup = [];
      for (let c = 0; c < data.curveCount; c++) {
        const curve = data.curves.at(c);
        this._curveFadeBackup.push({ key, curveIndex: c, fadeIn: curve.fadeInTime, fadeOut: curve.fadeOutTime });
        curve.fadeInTime = 0;
        curve.fadeOutTime = 0;
      }
    }

    motion.setIsLoop(Boolean(loop));
    motion.setOffsetTime(Math.max(0, offsetSeconds));
    motion.setFadeInTime(fadeInSeconds !== undefined ? Math.max(0, fadeInSeconds) : originalFadeIn);
    motion.setFinishedMotionHandler(() => undefined);

    const motionMgr = this._userModel['_motionManager'] as CubismMotionManager;
    if (!preserveCurrentMotion) {
      motionMgr.stopAllMotions();
    }
    motionMgr.setReservePriority(3);
    motionMgr.startMotionPriority(motion, false, 3);
    return true;
  }

  startRandomMotion(group: string): void {
    const count = this.motionEntries.filter((e) => e.group === group).length;
    if (count === 0) return;
    const idx = Math.floor(Math.random() * count);
    this.startMotion(group, idx);
  }

  stopAllMotions(): void {
    // Guard against partially-constructed user models: when loadModelFromData
    // throws partway through (e.g. unsupported format) modelRef may still be
    // set to an instance whose `_userModel` was never wired up, and any
    // caller cleanup path (MotionPlayer.unload, returnToBasePose, ...) used
    // to crash here. Skip both the motion stop and parameter save when the
    // underlying SDK state is missing.
    const userModel = this._userModel as unknown as { _motionManager?: CubismMotionManager } | null;
    const motionMgr = userModel?._motionManager ?? null;
    if (!motionMgr) return;
    motionMgr.stopAllMotions();
    // CubismModel.saveParameters() dereferences an internal `_model` handle
    // that is null when moc.createModel() never ran (e.g. unsupported format
    // throw'd earlier). Gate the call on a sentinel field that only exists
    // on a fully constructed CubismModel.
    const coreModel = this.model as unknown as { _model?: unknown } | null;
    if (coreModel?._model) {
      this.model.saveParameters();
    }
  }

  /** Restore per-curve fade times after the first updateMotion frame. */
  restoreCurveFades(): void {
    const backup = this._curveFadeBackup;
    if (!backup) return;
    this._curveFadeBackup = null;
    for (const entry of backup) {
      const motion = this.getLoadedMotionFromKey(entry.key) as CubismMotion | null;
      if (!motion || !motion._motionData || entry.curveIndex >= motion._motionData.curveCount) {
        continue;
      }
      const curve = motion._motionData.curves.at(entry.curveIndex);
      curve.fadeInTime = entry.fadeIn;
      curve.fadeOutTime = entry.fadeOut;
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  release(): void {
    this._userModel.release();
  }
}

// ── ModelLoader ──────────────────────────────────────────────────────────────

export interface ModelLoadResult {
  instance: ModelInstance;
  setting: ICubismModelSetting;
}

/**
 * Load a model entirely from pre-fetched IPC data.
 *
 * @param modelJson     Parsed model3.json object
 * @param base64Files   Map of relative path → base64 content
 * @param kScale        Optional scale factor
 */
export async function loadModelFromData(
  modelJson: Record<string, unknown>,
  base64Files: Record<string, string>,
  kScale = 1,
): Promise<ModelLoadResult> {
  const gl = CubismInit.gl;

  // Early format detection — Cubism Web SDK only supports Cubism 3+ models
  // (model3.json + moc3). Older Cubism 2 models declare top-level `model` /
  // `textures` instead of a `FileReferences` object, and ship a `.moc` (not
  // `.moc3`) binary that this SDK cannot parse. Surface a friendly error
  // here so users see a clear message instead of a confusing
  // `Cannot read properties of undefined (reading 'Moc')` TypeError.
  if (!modelJson.FileReferences) {
    if ('model' in modelJson || 'textures' in modelJson) {
      throw new Error(
        '不支持 Cubism 2 模型（.model.json + .moc）。Live2D 预览工具仅支持 Cubism 3 及以上版本（需 .model3.json + .moc3）。',
      );
    }
    throw new Error('无效的模型配置：model3.json 缺少 FileReferences 字段');
  }
  const fr = modelJson.FileReferences as Record<string, unknown>;

  // ── Create CubismModelSetting from the model3.json text ───────────────
  // The model3.json text is not in base64Files, so re-serialize it.
  const model3Text = JSON.stringify(modelJson);
  const model3Buffer = new TextEncoder().encode(model3Text).buffer;
  const setting = new CubismModelSettingJson(model3Buffer, model3Text.length);

  // ── Load MOC3 ─────────────────────────────────────────────────────────
  const mocPath = fr.Moc as string;
  const mocBase64 = base64Files[mocPath];
  if (!mocBase64) throw new Error(`Missing moc3 file: ${mocPath}`);
  const mocBuffer = base64ToArrayBuffer(mocBase64);
  const moc = CubismMoc.create(mocBuffer, false);
  if (!moc) throw new Error('Failed to create CubismMoc');

  const coreModel = moc.createModel();
  if (!coreModel) throw new Error('Failed to create CubismModel');

  coreModel.saveParameters();

  // ── Create the user model wrapper ─────────────────────────────────────
  const userModel = new CubismUserModel();
  // Wire up the moc and model (normally done by loadModel())
  (userModel as any)['_moc'] = moc;
  (userModel as any)['_model'] = coreModel;

  // Some CubismUserModel build paths leave `_motionManager` /
  // `_expressionManager` as null (we bypass the constructor branch that
  // news them up). Without these, calls like stopAllMotions() crash with
  // `Cannot read properties of null`. Initialise them defensively here so
  // every loaded model has a usable motion/expression manager regardless
  // of which model3.json shape we feed in.
  if (!(userModel as any)['_motionManager']) {
    (userModel as any)['_motionManager'] = new CubismMotionManager();
  }
  if (!(userModel as any)['_expressionManager']) {
    (userModel as any)['_expressionManager'] = new CubismExpressionMotionManager();
  }

  // Create model matrix
  // Cubism model origin is at center: (0,0) in model space = center of canvas.
  // setHeight(2.0) sets scale = 2/canvasHeight. With no translation, center maps to NDC(0,0).
  // DO NOT call setCenterPosition — it assumes canvas origin is top-left and adds tx=-1,ty=-1,
  // which pushes the model center to NDC(-1,-1) = bottom-left corner.
  const modelMatrix = new CubismModelMatrix(
    coreModel.getCanvasWidth(),
    coreModel.getCanvasHeight(),
  );
  if (kScale !== 1) modelMatrix.scaleRelative(kScale, kScale);
  (userModel as any)['_modelMatrix'] = modelMatrix;

  // ── Load expressions ──────────────────────────────────────────────────
  // Some model3.json files declare Expressions but the underlying
  // CubismUserModel did not initialise its `_expressions` map (it only gets
  // populated through SDK paths we are bypassing). Make sure the bucket
  // exists before we push entries into it, otherwise
  // `setValue` blows up with `Cannot read properties of undefined`.
  if (!(userModel as any)['_expressions']) {
    (userModel as any)['_expressions'] = new csmMap<string, ACubismMotion>();
  }
  for (let i = 0; i < setting.getExpressionCount(); i++) {
    const expName = setting.getExpressionName(i);
    const expFile = setting.getExpressionFileName(i);
    const b64 = base64Files[expFile];
    if (b64) {
      const buf = base64ToArrayBuffer(b64);
      const motion = userModel.loadExpression(buf, buf.byteLength, expName);
      if (motion) {
        (userModel as any)['_expressions'].setValue(expName, motion);
      }
    }
  }

  // ── Load physics ──────────────────────────────────────────────────────
  const physicsFile = setting.getPhysicsFileName();
  if (physicsFile) {
    const b64 = base64Files[physicsFile];
    if (b64) {
      const buf = base64ToArrayBuffer(b64);
      userModel.loadPhysics(buf, buf.byteLength);
    }
  }

  // ── Load pose ─────────────────────────────────────────────────────────
  const poseFile = setting.getPoseFileName();
  if (poseFile) {
    const b64 = base64Files[poseFile];
    if (b64) {
      const buf = base64ToArrayBuffer(b64);
      userModel.loadPose(buf, buf.byteLength);
    }
  }

  // ── Load user data ────────────────────────────────────────────────────
  const userDataFile = setting.getUserDataFile();
  if (userDataFile) {
    const b64 = base64Files[userDataFile];
    if (b64) {
      const buf = base64ToArrayBuffer(b64);
      userModel.loadUserData(buf, buf.byteLength);
    }
  }

  // ── Create renderer ───────────────────────────────────────────────────
  userModel.createRenderer(1);
  userModel.getRenderer().initialize(coreModel, 1);
  userModel.getRenderer().startUp(gl);

  // ── Load textures ─────────────────────────────────────────────────────
  const texNames: string[] = [];
  for (let i = 0; i < setting.getTextureCount(); i++) {
    const name = setting.getTextureFileName(i);
    if (name) texNames.push(name);
  }
  const textureInfos = await createTextures(texNames, base64Files);

  // Bind textures to renderer
  for (let i = 0; i < textureInfos.length; i++) {
    userModel.getRenderer().bindTexture(i, textureInfos[i].id);
  }

  // ── Collect motion entries & load motions ────────────────────────────
  const motionEntries: Array<{ group: string; index: number; name: string; file: string }> = [];
  const loadedMotions = new csmMap<string, ACubismMotion>();
  const loadedMotionOriginalFadeInTimes = new Map<string, number>();
  const groupCount = setting.getMotionGroupCount();
  for (let g = 0; g < groupCount; g++) {
    const group = setting.getMotionGroupName(g);
    const count = setting.getMotionCount(group);
    for (let i = 0; i < count; i++) {
      const fileName = setting.getMotionFileName(group, i);
      motionEntries.push({ group, index: i, name: `${group}_${i}`, file: fileName });

      const b64 = base64Files[fileName];
      if (b64) {
        const buf = base64ToArrayBuffer(b64);
        const motion = CubismMotion.create(buf, buf.byteLength) as CubismMotion;
        if (motion) {
          // Set fade times from setting
          const fadeIn = setting.getMotionFadeInTimeValue(group, i);
          if (fadeIn >= 0) motion.setFadeInTime(fadeIn);
          const fadeOut = setting.getMotionFadeOutTimeValue(group, i);
          if (fadeOut >= 0) motion.setFadeOutTime(fadeOut);
          const key = `${group}_${i}`;
          loadedMotions.setValue(key, motion);
          loadedMotionOriginalFadeInTimes.set(key, motion.getFadeInTime());
        }
      }
    }
  }

  // ── Setup eye blink ──────────────────────────────────────────────────
  if (setting.getEyeBlinkParameterCount() > 0) {
    (userModel as any)['_eyeBlink'] = CubismEyeBlink.create(setting);
  }

  // ── Setup breath ──────────────────────────────────────────────────────
  const breath = CubismBreath.create();
  const breathParams = new csmVector<BreathParameterData>();
  const idManager = CubismFramework.getIdManager();
  if (idManager) {
    breathParams.pushBack(new BreathParameterData(idManager.getId(CubismDefaultParameterId.ParamAngleX), 0, 15, 6.5345, 0.5));
    breathParams.pushBack(new BreathParameterData(idManager.getId(CubismDefaultParameterId.ParamAngleY), 0, 8, 3.5345, 0.5));
    breathParams.pushBack(new BreathParameterData(idManager.getId(CubismDefaultParameterId.ParamAngleZ), 0, 10, 5.5345, 0.5));
    breathParams.pushBack(new BreathParameterData(idManager.getId(CubismDefaultParameterId.ParamBodyAngleX), 0, 4, 15.5345, 0.5));
    breath.setParameters(breathParams);
  }
  (userModel as any)['_breath'] = breath;

  // ── Mark initialized ──────────────────────────────────────────────────
  userModel.setUpdating(true);
  userModel.setInitialized(true);

  const instance = new ModelInstance(userModel, setting, textureInfos, motionEntries);
  (instance as any)['_loadedMotions'] = loadedMotions;
  (instance as any)['_motionOriginalFadeInTimes'] = loadedMotionOriginalFadeInTimes;
  (instance as any).applyEffectIdsToLoadedMotions();

  return { instance, setting };
}
