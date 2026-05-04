/**
 * Manages user-defined keyframe overlays on top of existing motions.
 *
 * The overlay system allows users to add keyframes that override specific
 * parameter values at specific times, blending with the base motion.
 */

import type { OverlayKeyframe, ParsedMotion, ParsedCurve, MotionData } from '../types';
import { parseSegments, serializeSegments, serializeMotion } from './MotionParser';
import type { ModelInstance } from './ModelLoader';

export class KeyframeOverlay {
  private _keyframes: OverlayKeyframe[] = [];

  get keyframes(): OverlayKeyframe[] {
    return this._keyframes;
  }

  /** Add or update a keyframe. */
  setKeyframe(kf: OverlayKeyframe): void {
    const idx = this._keyframes.findIndex(
      (k) => k.paramId === kf.paramId && Math.abs(k.time - kf.time) < 0.001,
    );
    if (idx >= 0) {
      this._keyframes[idx] = kf;
    } else {
      this._keyframes.push(kf);
    }
  }

  /** Remove a keyframe at a specific time for a specific parameter. */
  removeKeyframe(paramId: string, time: number): void {
    this._keyframes = this._keyframes.filter(
      (k) => !(k.paramId === paramId && Math.abs(k.time - time) < 0.001),
    );
  }

  /** Remove all keyframes. */
  clear(): void {
    this._keyframes = [];
  }

  /**
   * Apply overlay to the model ON TOP OF the current motion values.
   * Call this AFTER the motion player's tick() to override parameters.
   */
  apply(model: ModelInstance, currentTime: number): void {
    // Group keyframes by paramId
    const grouped = new Map<string, OverlayKeyframe[]>();
    for (const kf of this._keyframes) {
      const list = grouped.get(kf.paramId) ?? [];
      list.push(kf);
      grouped.set(kf.paramId, list);
    }

    for (const [paramId, kfs] of grouped) {
      if (kfs.length === 0) continue;

      // Sort by time
      kfs.sort((a, b) => a.time - b.time);

      // Find which segment we're in
      let value: number;
      if (currentTime <= kfs[0].time) {
        value = kfs[0].value;
      } else if (currentTime >= kfs[kfs.length - 1].time) {
        value = kfs[kfs.length - 1].value;
      } else {
        const nextIdx = kfs.findIndex((k) => k.time >= currentTime);
        if (nextIdx <= 0) {
          value = kfs[0].value;
        } else {
          const prev = kfs[nextIdx - 1];
          const next = kfs[nextIdx];
          const t = (currentTime - prev.time) / (next.time - prev.time);

          if (prev.easing === 'stepped') {
            value = prev.value;
          } else {
            value = prev.value + (next.value - prev.value) * t;
          }
        }
      }

      model.setParameterValue(paramId, value);
    }
  }

  /**
   * Merge the overlay into a ParsedMotion, producing a new MotionData
   * that can be serialized to .motion3.json.
   */
  exportAsMotion3(base: ParsedMotion, fps: number): MotionData {
    // Clone base curves
    const newCurves = base.curves.map((c) => ({
      target: c.target,
      id: c.id,
      fadeInTime: c.fadeInTime,
      fadeOutTime: c.fadeOutTime,
      segments: c.segments.map((s) => ({
        type: s.type,
        points: s.points.map((p) => ({ ...p })),
      })),
    }));

    const duration = base.duration;

    // Group overlay keyframes by paramId
    const grouped = new Map<string, OverlayKeyframe[]>();
    for (const kf of this._keyframes) {
      if (kf.time > duration) continue; // skip out-of-range
      const list = grouped.get(kf.paramId) ?? [];
      list.push(kf);
      grouped.set(kf.paramId, list);
    }

    // For each parameter with overlay keyframes, rebuild its curve
    for (const [paramId, kfs] of grouped) {
      kfs.sort((a, b) => a.time - b.time);

      // Check if this param already has a curve in the base motion
      const existingIdx = newCurves.findIndex((c) => c.id === paramId && c.target === 'Parameter');

      if (existingIdx >= 0) {
        // Modify existing curve
        const curve = newCurves[existingIdx];
        const basePoints: Array<{ time: number; value: number }> = [];

        // Gather all timeline points from base curve
        for (const seg of curve.segments) {
          for (const pt of seg.points) {
            if (!basePoints.some((bp) => Math.abs(bp.time - pt.time) < 0.001)) {
              basePoints.push({ time: pt.time, value: pt.value });
            }
          }
        }

        // Merge overlay keyframes — overlay values replace base values at same time
        for (const kf of kfs) {
          const bpIdx = basePoints.findIndex((bp) => Math.abs(bp.time - kf.time) < 0.001);
          if (bpIdx >= 0) {
            basePoints[bpIdx].value = kf.value;
          } else {
            basePoints.push({ time: kf.time, value: kf.value });
          }
        }

        basePoints.sort((a, b) => a.time - b.time);

        // Rebuild as linear segments
        const newSegments: Array<{ type: number; points: Array<{ time: number; value: number }> }> = [];
        for (let i = 0; i + 1 < basePoints.length; i++) {
          newSegments.push({
            type: 0, // linear
            points: [basePoints[i], basePoints[i + 1]],
          });
        }
        curve.segments = newSegments;
      } else {
        // Create a new curve for this parameter
        const points = kfs.map((k) => ({ time: k.time, value: k.value }));
        const segments: Array<{ type: number; points: Array<{ time: number; value: number }> }> = [];
        for (let i = 0; i + 1 < points.length; i++) {
          segments.push({
            type: 0,
            points: [points[i], points[i + 1]],
          });
        }
        newCurves.push({
          target: 'Parameter' as const,
          id: paramId,
          fadeInTime: 0,
          fadeOutTime: 0,
          segments,
        });
      }
    }

    // Rebuild ParsedMotion
    const parsed: ParsedMotion = {
      duration,
      fps,
      loop: base.loop,
      curves: newCurves,
    };

    return serializeMotion(parsed);
  }
}
