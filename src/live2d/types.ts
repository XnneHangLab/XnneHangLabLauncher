/**
 * Type definitions for the motion3.json data model.
 */
export interface MotionMeta {
  Duration: number;
  Fps: number;
  Loop: boolean;
  AreBeziersRestricted: boolean;
  CurveCount: number;
  TotalSegmentCount: number;
  TotalPointCount: number;
  UserDataCount: number;
  TotalUserDataSize: number;
}

export interface MotionCurve {
  Target: 'Parameter' | 'PartOpacity' | 'Model';
  Id: string;
  FadeInTime?: number;
  FadeOutTime?: number;
  /** Flattened segment data: [segmentType, v0, v1, v2, v3, ...] */
  Segments: number[];
}

export interface MotionEvent {
  Time: number;
  Value: string;
}

export interface MotionData {
  Version: number;
  Meta: MotionMeta;
  Curves: MotionCurve[];
  UserData?: MotionEvent[];
}

/** A single key-point within a segment, parsed from the flat array. */
export interface KeyPoint {
  time: number;
  value: number;
}

export interface ParsedSegment {
  type: number; // 0=linear, 1=bezier, 2=stepped, 3=inverse-stepped
  points: KeyPoint[];
}

export interface ParsedCurve {
  target: 'Parameter' | 'PartOpacity' | 'Model';
  id: string;
  fadeInTime: number;
  fadeOutTime: number;
  segments: ParsedSegment[];
}

export interface ParsedMotion {
  duration: number;
  fps: number;
  loop: boolean;
  curves: ParsedCurve[];
}

/** User-overlay keyframe (for the keyframe editor). */
export interface OverlayKeyframe {
  paramId: string;
  time: number;
  value: number;
  easing: 'linear' | 'stepped';
}
