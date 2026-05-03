/**
 * Splice (concatenate) multiple motion curves into a single motion.
 *
 * Each motion is placed sequentially with an optional gap between them.
 * If multiple motions define curves for the same parameter, the later
 * motion's curve replaces the earlier one for its time range.
 *
 * Also provides utilities for extracting subranges from motions and
 * creating transition curves between parameter snapshots.
 */

import type { ParsedMotion, ParsedCurve, ParsedSegment, KeyPoint, MotionData } from '../types';
import { serializeMotion } from './MotionParser';

/**
 * Splice an array of parsed motions into one combined motion.
 *
 * Handles Parameter, PartOpacity, and Model curve targets.
 *
 * @param motions     Array of parsed motions to splice
 * @param gaps        Optional gaps (in seconds) between each motion. If omitted, 0.
 * @returns A single MotionData ready for serialization
 */
export function spliceMotions(
  motions: ParsedMotion[],
  gaps: number[] = [],
): MotionData {
  if (motions.length === 0) {
    throw new Error('No motions to splice');
  }

  const fps = motions[0].fps;
  const totalDuration = motions.reduce((sum, m) => sum + m.duration, 0)
    + gaps.reduce((sum, g) => sum + g, 0);

  // Collect all unique curve identities across all motions
  const paramIds = new Set<string>();
  const partIds = new Set<string>();
  const modelIds = new Set<string>();

  for (const motion of motions) {
    for (const curve of motion.curves) {
      if (curve.target === 'Parameter') paramIds.add(curve.id);
      else if (curve.target === 'PartOpacity') partIds.add(curve.id);
      else if (curve.target === 'Model') modelIds.add(curve.id);
    }
  }

  // Build combined curves for each target type
  const newCurves: ParsedCurve[] = [];

  function collectCurves(
    ids: Set<string>,
    target: ParsedCurve['target'],
  ): void {
    for (const id of ids) {
      const segments: ParsedSegment[] = [];
      let localOffset = 0;

      for (let m = 0; m < motions.length; m++) {
        const motion = motions[m];
        const gap = m < gaps.length ? gaps[m] : 0;
        localOffset += gap;

        const curve = motion.curves.find(
          (c) => c.id === id && c.target === target,
        );

        if (curve) {
          for (const seg of curve.segments) {
            const newPoints: KeyPoint[] = seg.points.map((pt) => ({
              time: pt.time + localOffset,
              value: pt.value,
            }));
            segments.push({ type: seg.type, points: newPoints });
          }
        }

        localOffset += motion.duration;
      }

      newCurves.push({
        target,
        id,
        fadeInTime: 0,
        fadeOutTime: 0,
        segments,
      });
    }
  }

  collectCurves(paramIds, 'Parameter');
  collectCurves(partIds, 'PartOpacity');
  collectCurves(modelIds, 'Model');

  const parsed: ParsedMotion = {
    duration: totalDuration,
    fps,
    loop: false, // spliced motions do not loop by default
    curves: newCurves,
  };

  return serializeMotion(parsed);
}

/**
 * Extract a time range from a parsed motion, time-shifting so the
 * extracted portion starts at time 0.
 *
 * Handles all curve target types (Parameter, PartOpacity, Model).
 * Segments that straddle boundary times get an interpolated endpoint.
 *
 * @param parsed    The source parsed motion
 * @param startTime Start of the range (seconds)
 * @param endTime   End of the range (seconds)
 * @returns A new ParsedMotion covering only [startTime, endTime)
 */
export function extractMotionSubrange(
  parsed: ParsedMotion,
  startTime: number,
  endTime: number,
): ParsedMotion {
  const duration = Math.max(0, endTime - startTime);
  if (duration <= 0) {
    return { duration: 0, fps: parsed.fps, loop: false, curves: [] };
  }

  const newCurves: ParsedCurve[] = [];

  for (const curve of parsed.curves) {
    const segments: ParsedSegment[] = [];

    for (const seg of curve.segments) {
      const first = seg.points[0];
      const last = seg.points[seg.points.length - 1];

      // Segment fully before the range — skip
      if (last.time <= startTime) continue;
      // Segment fully after the range — skip
      if (first.time >= endTime) continue;

      // Clone and clip the segment points to [startTime, endTime]
      const newPoints: KeyPoint[] = [];

      for (const pt of seg.points) {
        // Clip point time to range
        const clampedTime = Math.max(startTime, Math.min(pt.time, endTime));
        let clampedValue = pt.value;

        // If the point was pushed to a boundary, interpolate the value
        if (clampedTime !== pt.time) {
          const idx = seg.points.indexOf(pt);
          if (clampedTime === startTime) {
            // Straddles left edge — evaluate at startTime
            clampedValue = evaluateSegmentAt(seg, startTime);
          } else {
            // Straddles right edge — evaluate at endTime
            clampedValue = evaluateSegmentAt(seg, endTime);
          }
        }

        // Avoid duplicate consecutive points at the same time
        if (
          newPoints.length > 0
          && Math.abs(newPoints[newPoints.length - 1].time - clampedTime) < 1e-6
        ) {
          newPoints[newPoints.length - 1].value = clampedValue;
        } else {
          newPoints.push({ time: clampedTime, value: clampedValue });
        }
      }

      // Time-shift all points so the range starts at 0
      for (const pt of newPoints) {
        pt.time = Math.max(0, pt.time - startTime);
      }

      // Remove degenerate segments (single point)
      if (newPoints.length >= 2) {
        segments.push({ type: seg.type, points: newPoints });
      }
    }

    if (segments.length > 0) {
      newCurves.push({
        target: curve.target,
        id: curve.id,
        fadeInTime: 0,
        fadeOutTime: 0,
        segments,
      });
    }
  }

  return {
    duration,
    fps: parsed.fps,
    loop: false,
    curves: newCurves,
  };
}

/**
 * Create a motion containing linear transition curves between two
 * parameter value snapshots.
 *
 * Each parameter gets a single linear segment from (0, fromValue)
 * to (duration, toValue). Parameters only present on one side get
 * a flat hold at the available value.
 *
 * @param fromValues  Parameter values at transition start
 * @param toValues    Parameter values at transition end
 * @param duration    Transition duration in seconds
 * @param fps         Frames per second (inherited from source motions)
 * @returns A ParsedMotion with only Parameter curves
 */
export function createTransitionMotion(
  fromValues: Record<string, number>,
  toValues: Record<string, number>,
  duration: number,
  fps: number,
): ParsedMotion {
  const allKeys = new Set([
    ...Object.keys(fromValues),
    ...Object.keys(toValues),
  ]);

  const curves: ParsedCurve[] = [];

  for (const id of allKeys) {
    const fromVal = id in fromValues ? fromValues[id] : (toValues[id] ?? 0);
    const toVal = id in toValues ? toValues[id] : (fromValues[id] ?? 0);

    // Flat hold if both values are identical
    if (Math.abs(fromVal - toVal) < 1e-6) {
      curves.push({
        target: 'Parameter',
        id,
        fadeInTime: 0,
        fadeOutTime: 0,
        segments: [
          {
            type: 0, // linear
            points: [
              { time: 0, value: fromVal },
              { time: duration, value: fromVal },
            ],
          },
        ],
      });
    } else {
      curves.push({
        target: 'Parameter',
        id,
        fadeInTime: 0,
        fadeOutTime: 0,
        segments: [
          {
            type: 0, // linear
            points: [
              { time: 0, value: fromVal },
              { time: duration, value: toVal },
            ],
          },
        ],
      });
    }
  }

  return {
    duration: Math.max(0, duration),
    fps,
    loop: false,
    curves,
  };
}

// ── Internal helpers ────────────────────────────────────────────────

/** Evaluate a segment's value at a given time. */
function evaluateSegmentAt(seg: ParsedSegment, time: number): number {
  const first = seg.points[0];
  const last = seg.points[seg.points.length - 1];
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;

  switch (seg.type) {
    case 0: // linear
      return lerp(first.time, first.value, last.time, last.value, time);
    case 1: // bezier
      if (seg.points.length === 4) {
        return cubicBezier(
          first.time, first.value,
          seg.points[1].time, seg.points[1].value,
          seg.points[2].time, seg.points[2].value,
          last.time, last.value,
          time,
        );
      }
      return lerp(first.time, first.value, last.time, last.value, time);
    case 2: // stepped
      return time >= last.time ? last.value : first.value;
    case 3: // inverse-stepped
      return time <= last.time ? first.value : last.value;
    default:
      return last.value;
  }
}

function lerp(t0: number, v0: number, t1: number, v1: number, t: number): number {
  if (Math.abs(t1 - t0) < 1e-6) return v0;
  const r = (t - t0) / (t1 - t0);
  return v0 + (v1 - v0) * Math.max(0, Math.min(1, r));
}

function cubicBezier(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
  x: number,
): number {
  if (Math.abs(p3x - p0x) < 1e-6) return p0y;
  let t = (x - p0x) / (p3x - p0x);
  for (let i = 0; i < 8; i++) {
    const tx = cubicN(p0x, p1x, p2x, p3x, t);
    const dx = cubicND(p0x, p1x, p2x, p3x, t);
    if (Math.abs(dx) < 1e-6) break;
    t -= (tx - x) / dx;
    t = Math.max(0, Math.min(1, t));
  }
  return cubicN(p0y, p1y, p2y, p3y, t);
}

function cubicN(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function cubicND(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}
