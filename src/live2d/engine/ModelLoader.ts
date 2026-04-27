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

function base64ToArrayBuffer(base64: string): ArrayBuffer {
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
  private _motionCount = 0;
  private _motionGroupNames: string[] = [];
  private _userTimeSeconds = 0;
  private _animating = false;

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

  private refreshParameterIds(): void {
    const m = this.model;
    if (!m) return;
    const count = m.getParameterCount();
    this.parameterIds = [];
    for (let i = 0; i < count; i++) {
      const handle = m.getParameterId(i);
      // CubismIdHandle._id is a csmString, ._id.s is the actual string
      const str = (handle as any)?._id?.s ?? String(handle);
      this.parameterIds.push(str);
    }
  }

  getParameterIndex(id: string): number {
    return this.model.getParameterIndex(this.resolveId(id));
  }

  getParameterValue(id: string): number {
    return this.model.getParameterValue(this.resolveId(id));
  }

  setParameterValue(id: string, value: number): void {
    this.model.setParameterValue(this.resolveId(id), value);
  }

  getParameterMin(id: string): number {
    return this.model.getParameterMinimumValue(this.resolveId(id));
  }

  getParameterMax(id: string): number {
    return this.model.getParameterMaximumValue(this.resolveId(id));
  }

  getParameterDefault(id: string): number {
    return this.model.getParameterDefaultValue(this.resolveId(id));
  }

  private resolveId(id: string): CubismIdHandle {
    const idManager = CubismFramework.getIdManager();
    return idManager!.getId(id);
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

  update(deltaTimeSeconds: number): void {
    const m = this.model;
    if (!m) return;

    this._userTimeSeconds += deltaTimeSeconds;

    // Motion update
    const motionMgr = this._userModel['_motionManager'] as CubismMotionManager;
    if (motionMgr) {
      m.loadParameters();
      if (!motionMgr.isFinished()) {
        motionMgr.updateMotion(m, deltaTimeSeconds);
      }
      m.saveParameters();
    }

    // Eye blink (only when no motion is driving it)
    const eyeBlink = this._userModel['_eyeBlink'] as CubismEyeBlink | null;
    if (eyeBlink) {
      eyeBlink.updateParameters(m, deltaTimeSeconds);
    }

    // Expression
    const exprMgr = this._userModel['_expressionManager'] as CubismExpressionMotionManager | null;
    if (exprMgr) {
      exprMgr.updateMotion(m, deltaTimeSeconds);
    }

    // Breath
    const breath = this._userModel['_breath'] as CubismBreath | null;
    if (breath) {
      breath.updateParameters(m, deltaTimeSeconds);
    }

    // Physics
    const physics = this._userModel['_physics'] as CubismPhysics | null;
    if (physics) {
      physics.evaluate(m, deltaTimeSeconds);
    }

    // Pose
    const pose = this._userModel['_pose'] as CubismPose | null;
    if (pose) {
      pose.updateParameters(m, deltaTimeSeconds);
    }

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
    renderer.preDraw();
    renderer.setRenderState(null, [0, 0, w, h]);
    renderer.drawModel();
    renderer.postDraw();
  }

  // ── Motion control ─────────────────────────────────────────────────────────

  startMotion(group: string, index: number): void {
    const name = `${group}_${index}`;
    const motion = this._loadedMotions.getValue(name) as CubismMotion | null;
    if (motion) {
      const motionMgr = this._userModel['_motionManager'] as CubismMotionManager;
      motionMgr.startMotionPriority(motion, false, 3);
    }
  }

  startRandomMotion(group: string): void {
    const count = this.motionEntries.filter((e) => e.group === group).length;
    if (count === 0) return;
    const idx = Math.floor(Math.random() * count);
    this.startMotion(group, idx);
  }

  stopAllMotions(): void {
    const motionMgr = this._userModel['_motionManager'] as CubismMotionManager;
    motionMgr.stopAllMotions();
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

  // Create model matrix
  // CubismModelMatrix constructor already calls setHeight(2.0) which sets the correct
  // uniform scale (2 / canvasHeight). Do NOT call scale() after this — it's a SET
  // operation that would overwrite the scale to kScale (destroying the fit).
  const modelMatrix = new CubismModelMatrix(
    coreModel.getCanvasWidth(),
    coreModel.getCanvasHeight(),
  );
  if (kScale !== 1) modelMatrix.scaleRelative(kScale, kScale);
  modelMatrix.setCenterPosition(0, 0);
  (userModel as any)['_modelMatrix'] = modelMatrix;

  // ── Load expressions ──────────────────────────────────────────────────
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
          (userModel as any)['_motions'].setValue(`${group}_${i}`, motion);
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

  // Transfer loaded motions to instance
  const motions = (userModel as any)['_motions'] as csmMap<string, ACubismMotion>;
  (instance as any)['_loadedMotions'] = motions;

  return { instance, setting };
}
