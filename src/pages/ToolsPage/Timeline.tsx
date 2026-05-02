/**
 * Timeline — single visual motion track with transport, drag/drop ordering, and validation warnings.
 */
import { useEffect, useRef, useState } from 'react';
import type { DragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEditor } from './EditorProvider';

const MOTION_DRAG_TYPE = 'application/x-live2d-motion';
const PX_PER_SECOND = 28;
const MIN_CLIP_WIDTH = 72;
const MAX_CLIP_WIDTH = 360;
const TRACK_PADDING_X = 16;

function clipWidth(duration: number): number {
  return Math.max(MIN_CLIP_WIDTH, Math.min(MAX_CLIP_WIDTH, Math.round((duration || 1) * PX_PER_SECOND)));
}

function totalTrackWidth(clips: Array<{ duration: number }>): number {
  return clips.reduce((sum, clip) => sum + clipWidth(clip.duration), 0);
}

function playheadLeft(
  clips: Array<{ duration: number }>,
  clipIndex: number,
  clipTime: number,
  totalTime: number,
  totalDuration: number,
): number {
  if (clipIndex >= 0 && clips[clipIndex]) {
    const before = clips.slice(0, clipIndex).reduce((sum, clip) => sum + clipWidth(clip.duration), 0);
    const clip = clips[clipIndex];
    const ratio = clip.duration > 0 ? Math.max(0, Math.min(1, clipTime / clip.duration)) : 0;
    return before + clipWidth(clip.duration) * ratio;
  }

  const width = totalTrackWidth(clips);
  const ratio = totalDuration > 0 ? Math.max(0, Math.min(1, totalTime / totalDuration)) : 0;
  return width * ratio;
}

function formatTime(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

function timeFromTrackX(clips: Array<{ duration: number }>, x: number): number {
  const clampedX = Math.max(0, x);
  let cursorX = 0;
  let cursorTime = 0;
  for (const clip of clips) {
    const width = clipWidth(clip.duration);
    if (clampedX <= cursorX + width) {
      const ratio = width > 0 ? Math.max(0, Math.min(1, (clampedX - cursorX) / width)) : 0;
      return cursorTime + clip.duration * ratio;
    }
    cursorX += width;
    cursorTime += clip.duration;
  }
  return cursorTime;
}

function readMotionPayload(data: string): { group: string; index: number } | null {
  try {
    const payload = JSON.parse(data) as { group?: unknown; index?: unknown };
    if (typeof payload.group !== 'string' || typeof payload.index !== 'number') return null;
    return { group: payload.group, index: payload.index };
  } catch {
    return null;
  }
}

export function Timeline() {
  const {
    modelLoaded,
    isPlaying,
    currentTime,
    duration,
    timelinePlayback,
    currentMotion,
    timelineClips,
    togglePlay,
    scrub,
    seekTimeline,
    addClipToTimeline,
    moveClipInTimeline,
    playClip,
    removeClipFromTimeline,
    clearTimeline,
  } = useEditor();
  const [draggingUid, setDraggingUid] = useState<string | null>(null);
  const [insertBeforeUid, setInsertBeforeUid] = useState<string | null>(null);
  const [seeking, setSeeking] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!modelLoaded) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      togglePlay();
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [modelLoaded, togglePlay]);

  if (!modelLoaded) return null;

  const pct = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;
  const totalDuration = timelinePlayback.totalDuration || timelineClips.reduce((sum, clip) => sum + clip.duration, 0);
  const hasTimelinePosition = timelineClips.length > 0 && timelinePlayback.clipUid !== null;
  const clipPlaybackTime = hasTimelinePosition
    ? Math.max(0, timelinePlayback.totalTime - timelinePlayback.clipStartTime)
    : 0;
  const cursorLeft = playheadLeft(
    timelineClips,
    timelinePlayback.clipIndex,
    clipPlaybackTime,
    timelinePlayback.totalTime,
    totalDuration,
  );
  const trackWidth = Math.max(totalTrackWidth(timelineClips) + TRACK_PADDING_X, 1);
  const transportDuration = timelinePlayback.active || hasTimelinePosition ? totalDuration : duration;
  const transportTime = timelinePlayback.active || hasTimelinePosition ? timelinePlayback.totalTime : currentTime;
  const transportPct = transportDuration > 0 ? Math.round((transportTime / transportDuration) * 100) : pct;
  const playbackLabel = timelinePlayback.active ? '剪辑区' : hasTimelinePosition ? '剪辑区定位' : '预览';

  function seekFromClientX(clientX: number, lane: HTMLDivElement) {
    const rect = lane.getBoundingClientRect();
    const x = clientX - rect.left - 8;
    seekTimeline(timeFromTrackX(timelineClips, x));
  }

  function handleLanePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || timelineClips.length === 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('.live2d-clip')) return;
    event.preventDefault();
    setSeeking(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromClientX(event.clientX, event.currentTarget);
  }

  function handleLanePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!seeking) return;
    event.preventDefault();
    seekFromClientX(event.clientX, event.currentTarget);
  }

  function handleLanePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!seeking) return;
    event.preventDefault();
    setSeeking(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleClipMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    const lane = event.currentTarget.closest('.live2d-track-lane') as HTMLDivElement | null;
    if (!lane) return;
    seekFromClientX(event.clientX, lane);
  }

  function updateDragInsertFromClientX(clientX: number) {
    const track = trackRef.current;
    if (!track) {
      setInsertBeforeUid(null);
      return;
    }

    const slots = [...track.querySelectorAll<HTMLElement>('.live2d-clip-slot[data-clip-uid]')];
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      if (clientX < midpoint) {
        setInsertBeforeUid(slot.dataset.clipUid ?? null);
        return;
      }
    }
    setInsertBeforeUid(null);
  }

  function allowTimelineDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const isMotionDrop = [...event.dataTransfer.types].includes(MOTION_DRAG_TYPE);
    event.dataTransfer.dropEffect = isMotionDrop ? 'copy' : 'none';
  }

  function setDragInsertFromTrack(event: DragEvent<HTMLElement>) {
    allowTimelineDrop(event);
    updateDragInsertFromClientX(event.clientX);
  }

  function handleClipPointerDown(event: ReactPointerEvent<HTMLDivElement>, uid: string) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    setDraggingUid(uid);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateDragInsertFromClientX(event.clientX);
  }

  function handleClipPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingUid) return;
    event.preventDefault();
    updateDragInsertFromClientX(event.clientX);
  }

  function handleClipPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingUid) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture(event.pointerId);
    moveClipInTimeline(draggingUid, insertBeforeUid);
    setDraggingUid(null);
    setInsertBeforeUid(null);
  }

  function handleExternalDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const motion = readMotionPayload(event.dataTransfer.getData(MOTION_DRAG_TYPE));

    if (motion) {
      addClipToTimeline(motion.group, motion.index, insertBeforeUid);
    }

    setDraggingUid(null);
    setInsertBeforeUid(null);
  }

  function handleTrackWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.currentTarget.scrollWidth || event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
    event.preventDefault();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    event.currentTarget.scrollLeft += delta;
  }

  return (
    <div className="live2d-timeline-panel">
      {/* ── Transport ─────────────────────────────────────────────── */}
      <div className="live2d-playback">
        <button type="button" className="live2d-timeline-btn" onClick={togglePlay}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="live2d-timeline-time">
          {playbackLabel} · {formatTime(transportTime)} / {formatTime(transportDuration)}
        </span>
        <input
          type="range"
          className="live2d-timeline-bar"
          min={0}
          max={transportDuration || 1}
          step={0.01}
          value={transportTime}
          onChange={(e) => scrub(Number(e.target.value))}
        />
        <span className="live2d-timeline-progress">{transportPct}%</span>
        {timelineClips.length > 0 && (
          <button type="button" className="live2d-timeline-btn" onClick={clearTimeline} title="清空时间线">
            ✕
          </button>
        )}
      </div>

      {/* ── Single visual clip track ──────────────────────────────── */}
      <div
        ref={trackRef}
        className="live2d-edit-track"
        onDragEnter={setDragInsertFromTrack}
        onDragOver={setDragInsertFromTrack}
        onDrop={handleExternalDrop}
        onWheel={handleTrackWheel}
      >
        <div className="live2d-track-ruler">
          <span>0s</span>
          <span>{formatTime(totalDuration)}</span>
        </div>
        <div
          className={`live2d-track-lane${seeking ? ' live2d-track-lane--seeking' : ''}`}
          style={{ width: trackWidth }}
          onDragEnter={setDragInsertFromTrack}
          onDragOver={setDragInsertFromTrack}
          onPointerDown={handleLanePointerDown}
          onPointerMove={handleLanePointerMove}
          onPointerUp={handleLanePointerEnd}
          onPointerCancel={handleLanePointerEnd}
        >
          {timelineClips.length > 0 && (
            <div
              className={`live2d-playhead${timelinePlayback.active ? ' live2d-playhead--active' : ''}`}
              style={{ left: cursorLeft + 8 }}
              title={`播放头：${formatTime(timelinePlayback.totalTime)} / ${formatTime(totalDuration)}`}
            />
          )}
          {timelineClips.length === 0 && (
            <div className="live2d-track-empty">拖入 motion 或点击 + 添加到剪辑轨道</div>
          )}
          {timelineClips.map((clip) => {
            const active = timelinePlayback.active
              ? timelinePlayback.clipUid === clip.uid
              : currentMotion?.group === clip.group && currentMotion?.index === clip.index;
            const showMarker = insertBeforeUid === clip.uid;
            return (
              <div key={clip.uid} className="live2d-clip-slot" data-clip-uid={clip.uid}>
                {showMarker && <div className="live2d-drop-marker" />}
                <div
                  className={`live2d-clip${active ? ' live2d-clip--active' : ''}${clip.missingParams.length > 0 ? ' live2d-clip--warn' : ''}${draggingUid === clip.uid ? ' live2d-clip--dragging' : ''}`}
                  style={{ width: clipWidth(clip.duration) }}
                  title={
                    clip.missingParams.length > 0
                      ? `警告：以下参数不在模型中\n${clip.missingParams.join('\n')}`
                      : `${clip.label}\n${clip.duration.toFixed(2)}s`
                  }
                  onMouseDown={handleClipMouseDown}
                  onPointerDown={(event) => handleClipPointerDown(event, clip.uid)}
                  onPointerMove={handleClipPointerMove}
                  onPointerUp={handleClipPointerEnd}
                  onPointerCancel={handleClipPointerEnd}
                  onDoubleClick={() => playClip(clip.uid)}
                >
                  <button
                    type="button"
                    className="live2d-clip__play"
                    onClick={() => playClip(clip.uid)}
                    draggable={false}
                  >
                    {active ? '■' : '▶'}
                  </button>
                  <span className="live2d-clip__body">
                    <span className="live2d-clip__label">{clip.label}</span>
                    <span className="live2d-clip__duration">{clip.duration.toFixed(1)}s</span>
                  </span>
                  {clip.missingParams.length > 0 && (
                    <span className="live2d-clip__warn" title={`缺失参数：${clip.missingParams.join(', ')}`}>
                      ⚠
                    </span>
                  )}
                  <button
                    type="button"
                    className="live2d-clip__remove"
                    onClick={() => removeClipFromTimeline(clip.uid)}
                    draggable={false}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
          {timelineClips.length > 0 && insertBeforeUid === null && draggingUid && <div className="live2d-drop-marker" />}
        </div>
      </div>
    </div>
  );
}
