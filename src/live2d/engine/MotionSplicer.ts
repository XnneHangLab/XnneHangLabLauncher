/**
 * Splice (concatenate) multiple motion curves into a single motion.
 *
 * Each motion is placed sequentially with an optional gap between them.
 * If multiple motions define curves for the same parameter, the later
 * motion's curve replaces the earlier one for its time range.
 */

import type { ParsedMotion, ParsedCurve, ParsedSegment, KeyPoint, MotionData } from '../types';
import { evaluateMotion, serializeMotion } from './MotionParser';

/**
 * Splice an array of parsed motions into one combined motion.
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
  const durations = motions.map((m) => m.duration);
  const totalDuration = durations.reduce((sum, d) => sum + d, 0) + gaps.reduce((sum, g) => sum + g, 0);

  // Collect all unique parameter IDs across all motions
  const allParamIds = new Set<string>();
  for (const motion of motions) {
    for (const curve of motion.curves) {
      if (curve.target === 'Parameter') {
        allParamIds.add(curve.id);
      }
    }
  }

  // Build a combined curve for each parameter
  const newCurves: ParsedCurve[] = [];
  let offset = 0;

  for (const paramId of allParamIds) {
    const segments: ParsedSegment[] = [];
    let localOffset = 0;

    for (let m = 0; m < motions.length; m++) {
      const motion = motions[m];
      const gap = m < gaps.length ? gaps[m] : 0;
      localOffset += gap;

      // Find this parameter's curve in this motion
      const curve = motion.curves.find(
        (c) => c.id === paramId && c.target === 'Parameter',
      );

      if (curve) {
        // Clone segments, offsetting times
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

    // Build a sample at the final endpoint if needed
    newCurves.push({
      target: 'Parameter',
      id: paramId,
      fadeInTime: 0,
      fadeOutTime: 0,
      segments,
    });
  }

  const parsed: ParsedMotion = {
    duration: totalDuration,
    fps,
    loop: false, // spliced motions do not loop by default
    curves: newCurves,
  };

  return serializeMotion(parsed);
}
