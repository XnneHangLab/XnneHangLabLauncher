/**
 * Parse, modify, and serialize .motion3.json data.
 *
 * The .motion3.json format uses flat segment arrays:
 *   Segments: [type, p0_time, p0_value, p1_time, p1_value, p2_time?, p2_value?, p3_time?, p3_value?]
 * For linear (type=0):  [0, t0, v0, t1, v1]
 * For bezier (type=1):  [1, t0, v0, cx1, cy1, cx2, cy2, t1, v1]
 * For stepped (type=2): [2, t0, v0, t1, v1]
 * For inverse-stepped (type=3): [3, t0, v0, t1, v1]
 */

import type { MotionData, MotionCurve, ParsedMotion, ParsedCurve, ParsedSegment, KeyPoint } from '../types';

const SEGMENT_POINT_COUNTS: Record<number, number> = {
  0: 1,  // linear:       first=[type,p0,p1], next=[type,p1]
  1: 3,  // bezier:       first=[type,p0,c1,c2,p1], next=[type,c1,c2,p1]
  2: 1,  // stepped:      first=[type,p0,p1], next=[type,p1]
  3: 1,  // inv-stepped:  first=[type,p0,p1], next=[type,p1]
};

/** Parse a flat segment array into structured segments. */
export function parseSegments(flat: number[]): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  if (flat.length < 6) return segments;

  let previousPoint: KeyPoint = { time: flat[0], value: flat[1] };
  let i = 2;
  while (i < flat.length) {
    const type = flat[i];
    const nextPointCount = SEGMENT_POINT_COUNTS[type] ?? 1;
    const points: KeyPoint[] = [{ ...previousPoint }];

    for (let p = 0; p < nextPointCount; p++) {
      const offset = i + 1 + p * 2;
      if (offset + 1 >= flat.length) break;
      points.push({ time: flat[offset], value: flat[offset + 1] });
    }

    i += 1 + nextPointCount * 2;
    if (points.length < 2) break;
    segments.push({ type, points });
    previousPoint = points[points.length - 1];
  }
  return segments;
}

/** Serialize parsed segments back into a flat array. */
export function serializeSegments(segments: ParsedSegment[]): number[] {
  if (segments.length === 0) return [];

  const flat: number[] = [];
  const firstPoint = segments[0].points[0];
  flat.push(firstPoint.time, firstPoint.value);
  for (const seg of segments) {
    flat.push(seg.type);
    for (const pt of seg.points.slice(1)) {
      flat.push(pt.time, pt.value);
    }
  }
  return flat;
}

/** Parse a raw MotionData into a more usable ParsedMotion. */
export function parseMotion(data: MotionData): ParsedMotion {
  const curves: ParsedCurve[] = data.Curves.map((c) => ({
    target: c.Target,
    id: c.Id,
    fadeInTime: c.FadeInTime ?? 0,
    fadeOutTime: c.FadeOutTime ?? 0,
    segments: parseSegments(c.Segments),
  }));

  return {
    duration: data.Meta.Duration,
    fps: data.Meta.Fps,
    loop: data.Meta.Loop,
    curves,
  };
}

/** Serialize a ParsedMotion back into a raw MotionData. */
export function serializeMotion(parsed: ParsedMotion): MotionData {
  const curves: MotionCurve[] = parsed.curves.map((c) => ({
    Target: c.target,
    Id: c.id,
    FadeInTime: c.fadeInTime > 0 ? c.fadeInTime : undefined,
    FadeOutTime: c.fadeOutTime > 0 ? c.fadeOutTime : undefined,
    Segments: serializeSegments(c.segments),
  }));

  const totalSegments = curves.reduce((s, c) => s + c.Segments.length, 0);
  const totalPoints = curves.reduce((s, c) => {
    const pts = parseSegments(c.Segments);
    return s + pts.reduce((ps, seg) => ps + seg.points.length, 0);
  }, 0);

  return {
    Version: 3,
    Meta: {
      Duration: parsed.duration,
      Fps: parsed.fps,
      Loop: parsed.loop,
      AreBeziersRestricted: true,
      CurveCount: curves.length,
      TotalSegmentCount: totalSegments,
      TotalPointCount: totalPoints,
      UserDataCount: 0,
      TotalUserDataSize: 0,
    },
    Curves: curves,
  };
}

/** Evaluate a parsed motion at a given time, returning paramId → value. */
export function evaluateMotion(parsed: ParsedMotion, time: number): Record<string, number> {
  const result: Record<string, number> = {};
  for (const curve of parsed.curves) {
    if (curve.target !== 'Parameter') continue;
    result[curve.id] = evaluateCurve(curve, time);
  }
  return result;
}

/** Evaluate a single curve at a given time by interpolating its segments. */
function evaluateCurve(curve: ParsedCurve, time: number): number {
  for (const seg of curve.segments) {
    const first = seg.points[0];
    const last = seg.points[seg.points.length - 1];
    if (time < first.time || time > last.time) continue;

    switch (seg.type) {
      case 0: // linear
        return lerp(first.time, first.value, last.time, last.value, time);
      case 1: // bezier
        if (seg.points.length === 4) {
          return cubicBezier(first.time, first.value, seg.points[1].time, seg.points[1].value, seg.points[2].time, seg.points[2].value, last.time, last.value, time);
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
  // Before / after the curve range — return the nearest endpoint value
  if (curve.segments.length > 0) {
    const firstSeg = curve.segments[0];
    const lastSeg = curve.segments[curve.segments.length - 1];
    if (time < firstSeg.points[0].time) return firstSeg.points[0].value;
    if (time > lastSeg.points[lastSeg.points.length - 1].time) return lastSeg.points[lastSeg.points.length - 1].value;
  }
  return 0;
}

function lerp(t0: number, v0: number, t1: number, v1: number, t: number): number {
  if (Math.abs(t1 - t0) < 1e-6) return v0;
  const r = (t - t0) / (t1 - t0);
  return v0 + (v1 - v0) * Math.max(0, Math.min(1, r));
}

function cubicBezier(p0x: number, p0y: number, p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number, x: number): number {
  if (Math.abs(p3x - p0x) < 1e-6) return p0y;
  // Newton-Raphson to find t for given x, then evaluate y
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
