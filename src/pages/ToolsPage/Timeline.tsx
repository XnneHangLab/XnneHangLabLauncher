/**
 * Timeline — single visual motion track with transport, drag/drop ordering, and validation warnings.
 */
import { useEffect, useRef, useState } from 'react';
import type { DragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEditor } from './EditorProvider';
import type { TimelineItem, TimelineClip, TimelineTransition } from './EditorProvider';

const MOTION_DRAG_TYPE = 'application/x-live2d-motion';
const PX_PER_SECOND = 28;
const MIN_CLIP_WIDTH = 72;
const MAX_CLIP_WIDTH = 360;
const TRANSITION_PX_PER_SECOND = 96;
const MIN_TRANSITION_WIDTH = 128;
const MAX_TRANSITION_WIDTH = 260;
const TRANSITION_ADD_WIDTH = 64;
const TRACK_PADDING_X = 16;

type TrimmingState = {
  uid: string;
  edge: 'start' | 'end';
  sourceStart: number;
  sourceEnd: number;
  sourceDuration: number;
  startClientX: number;
  width: number;
  previewSourceTime: number;
};

type ResizingTransitionState = {
  uid: string;
  duration: number;
  startClientX: number;
  width: number;
};

function clipWidth(duration: number): number {
  return Math.max(MIN_CLIP_WIDTH, Math.min(MAX_CLIP_WIDTH, Math.round((duration || 1) * PX_PER_SECOND)));
}

function transitionWidth(duration: number): number {
  return Math.max(MIN_TRANSITION_WIDTH, Math.min(MAX_TRANSITION_WIDTH, Math.round(duration * TRANSITION_PX_PER_SECOND)));
}

function itemWidth(item: { duration: number; kind?: string }): number {
  return item.kind === 'transition' ? transitionWidth(item.duration) : clipWidth(item.duration);
}

function trackMetrics(items: Array<{ duration: number; kind?: string }>): { slots: Array<{ duration: number; width: number; timeBearing: boolean }>; totalWidth: number } {
  const slots: Array<{ duration: number; width: number; timeBearing: boolean }> = [];
  let totalWidth = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const width = itemWidth(item);
    slots.push({ duration: item.duration, width, timeBearing: true });
    totalWidth += width;
    if (item.kind === 'motion' && items[i + 1]?.kind === 'motion') {
      slots.push({ duration: 0, width: TRANSITION_ADD_WIDTH, timeBearing: false });
      totalWidth += TRANSITION_ADD_WIDTH;
    }
  }
  return { slots, totalWidth };
}

function totalTrackWidth(items: Array<{ duration: number; kind?: string }>): number {
  return trackMetrics(items).totalWidth;
}

function visualSlots(items: Array<{ duration: number; kind?: string }>): Array<{ duration: number; width: number; timeBearing: boolean }> {
  return trackMetrics(items).slots;
}

function playheadLeft(
  clips: Array<{ duration: number; kind?: string }>,
  clipIndex: number,
  clipTime: number,
  totalTime: number,
  totalDuration: number,
): number {
  if (clipIndex >= 0 && clips[clipIndex]) {
    let before = 0;
    for (let i = 0; i < clipIndex; i++) {
      before += itemWidth(clips[i]);
      if (clips[i].kind === 'motion' && clips[i + 1]?.kind === 'motion') before += TRANSITION_ADD_WIDTH;
    }
    const clip = clips[clipIndex];
    const ratio = clip.duration > 0 ? Math.max(0, Math.min(1, clipTime / clip.duration)) : 0;
    return before + itemWidth(clip) * ratio;
  }

  const width = totalTrackWidth(clips);
  const ratio = totalDuration > 0 ? Math.max(0, Math.min(1, totalTime / totalDuration)) : 0;
  return width * ratio;
}

function formatTime(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

function timeFromTrackX(clips: Array<{ duration: number; kind?: string }>, x: number): number {
  const clampedX = Math.max(0, x);
  let cursorX = 0;
  let cursorTime = 0;
  for (const slot of visualSlots(clips)) {
    if (clampedX <= cursorX + slot.width) {
      if (!slot.timeBearing) return cursorTime;
      const ratio = slot.width > 0 ? Math.max(0, Math.min(1, (clampedX - cursorX) / slot.width)) : 0;
      return cursorTime + slot.duration * ratio;
    }
    cursorX += slot.width;
    cursorTime += slot.duration;
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
    timelineItems,
    togglePlay,
    scrub,
    seekTimeline,
    addClipToTimeline,
    addTransitionAfter,
    resizeTransition,
    splitClipAtTimelineTime,
    moveClipInTimeline,
    trimClip,
    playClip,
    removeClipFromTimeline,
    clearTimeline,
  } = useEditor();
  const [draggingUid, setDraggingUid] = useState<string | null>(null);
  const [insertBeforeUid, setInsertBeforeUid] = useState<string | null>(null);
  const [seeking, setSeeking] = useState(false);
  const [trimming, setTrimming] = useState<TrimmingState | null>(null);
  const [resizingTransition, setResizingTransition] = useState<ResizingTransitionState | null>(null);
  const [transitionResizePreview, setTransitionResizePreview] = useState<Record<string, number>>({});
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
  const totalDuration = timelinePlayback.totalDuration || timelineItems.reduce((sum, item) => sum + item.duration, 0);
  const hasTimelinePosition = timelineItems.length > 0 && timelinePlayback.itemUid !== null;
  const itemPlaybackTime = hasTimelinePosition
    ? Math.max(0, timelinePlayback.totalTime - timelinePlayback.itemStartTime)
    : 0;
  const cursorLeft = playheadLeft(
    timelineItems,
    timelinePlayback.itemIndex,
    itemPlaybackTime,
    timelinePlayback.totalTime,
    totalDuration,
  );
  const trackWidth = Math.max(totalTrackWidth(timelineItems) + TRACK_PADDING_X, 1);
  const transportDuration = timelinePlayback.active || hasTimelinePosition ? totalDuration : duration;
  const transportTime = timelinePlayback.active || hasTimelinePosition ? timelinePlayback.totalTime : currentTime;
  const transportPct = transportDuration > 0 ? Math.round((transportTime / transportDuration) * 100) : pct;
  const playbackLabel = timelinePlayback.active ? '剪辑区' : hasTimelinePosition ? '剪辑区定位' : '预览';
  const currentTimelineItem = timelineItems[timelinePlayback.itemIndex];
  const canSplitClip = currentTimelineItem?.kind === 'motion'
    && itemPlaybackTime > 0.05
    && itemPlaybackTime < currentTimelineItem.duration - 0.05;

  function seekFromClientX(clientX: number, lane: HTMLDivElement) {
    const rect = lane.getBoundingClientRect();
    const x = clientX - rect.left - 8;
    seekTimeline(timeFromTrackX(timelineItems, x));
  }

  function handleLanePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || timelineItems.length === 0) return;
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
    if (target.closest('button') || target.closest('.live2d-clip__trim')) return;
    setDraggingUid(uid);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateDragInsertFromClientX(event.clientX);
  }

  function handleTrimPointerDown(event: ReactPointerEvent<HTMLButtonElement>, clip: typeof timelineClips[number], edge: 'start' | 'end') {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingUid(null);
    setInsertBeforeUid(null);
    setTrimming({
      uid: clip.uid,
      edge,
      sourceStart: clip.sourceStart,
      sourceEnd: clip.sourceEnd,
      sourceDuration: clip.sourceDuration,
      startClientX: event.clientX,
      width: clipWidth(clip.duration),
      previewSourceTime: edge === 'start' ? clip.sourceStart : clip.sourceEnd,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleTrimPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!trimming) return;
    event.preventDefault();
    event.stopPropagation();
    const secondsPerPixel = (trimming.sourceEnd - trimming.sourceStart) / Math.max(1, trimming.width);
    const deltaSeconds = (event.clientX - trimming.startClientX) * secondsPerPixel;
    const nextSourceTime = trimming.edge === 'start'
      ? Math.max(0, Math.min(trimming.sourceEnd, trimming.sourceStart + deltaSeconds))
      : Math.max(trimming.sourceStart, Math.min(trimming.sourceDuration, trimming.sourceEnd + deltaSeconds));
    setTrimming((prev) => prev ? { ...prev, previewSourceTime: nextSourceTime } : prev);
    trimClip(trimming.uid, trimming.edge, nextSourceTime);
  }

  function handleTrimPointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!trimming) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    setTrimming(null);
  }

  function handleTransitionResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>, transition: TimelineTransition) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setResizingTransition({
      uid: transition.uid,
      duration: transition.duration,
      startClientX: event.clientX,
      width: transitionWidth(transition.duration),
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleTransitionResizePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!resizingTransition) return;
    event.preventDefault();
    event.stopPropagation();
    const secondsPerPixel = resizingTransition.duration / Math.max(1, resizingTransition.width);
    const nextDuration = Math.max(0.1, resizingTransition.duration + (event.clientX - resizingTransition.startClientX) * secondsPerPixel);
    setTransitionResizePreview((prev) => ({ ...prev, [resizingTransition.uid]: nextDuration }));
    resizeTransition(resizingTransition.uid, nextDuration);
  }

  function handleTransitionResizePointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!resizingTransition) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    setTransitionResizePreview((prev) => {
      const next = { ...prev };
      delete next[resizingTransition.uid];
      return next;
    });
    setResizingTransition(null);
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
        <button
          type="button"
          className="live2d-timeline-btn"
          onClick={() => splitClipAtTimelineTime(timelinePlayback.totalTime)}
          disabled={!canSplitClip}
          title={canSplitClip ? '在播放头位置切开当前片段' : '播放头需要位于 motion 片段内部'}
        >
          ✂
        </button>
        {timelineItems.length > 0 && (
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
          {timelineItems.length > 0 && (
            <div
              className={`live2d-playhead${timelinePlayback.active ? ' live2d-playhead--active' : ''}`}
              style={{ left: cursorLeft + 8 }}
              title={`播放头：${formatTime(timelinePlayback.totalTime)} / ${formatTime(totalDuration)}`}
            />
          )}
          {timelineItems.length === 0 && (
            <div className="live2d-track-empty">拖入 motion 或点击 + 添加到剪辑轨道</div>
          )}
          {timelineItems.map((item, itemIndex) => {
            if (item.kind === 'transition') {
              const previewDuration = transitionResizePreview[item.uid] ?? item.duration;
              return (
                <div key={item.uid} className="live2d-clip-slot" data-clip-uid={item.uid}>
                  <div
                    className="live2d-transition"
                    style={{ width: transitionWidth(previewDuration) }}
                    title={`过渡 ${previewDuration.toFixed(2)}s`}
                  >
                    <span className="live2d-transition__label">过渡</span>
                    <span className="live2d-transition__duration">{previewDuration.toFixed(1)}s</span>
                    <button
                      type="button"
                      className="live2d-transition__remove"
                      onClick={() => removeClipFromTimeline(item.uid)}
                      draggable={false}
                    >
                      ×
                    </button>
                    <button
                      type="button"
                      className="live2d-transition__resize"
                      title="拖拽调整过渡时长"
                      onPointerDown={(event) => handleTransitionResizePointerDown(event, item)}
                      onPointerMove={handleTransitionResizePointerMove}
                      onPointerUp={handleTransitionResizePointerEnd}
                      onPointerCancel={handleTransitionResizePointerEnd}
                      draggable={false}
                    />
                  </div>
                </div>
              );
            }

            const clip: TimelineClip = item;
            const active = timelinePlayback.active
              ? timelinePlayback.clipUid === clip.uid
              : currentMotion?.group === clip.group && currentMotion?.index === clip.index;
            const showMarker = insertBeforeUid === clip.uid;
            const leftTrimPreview = trimming?.uid === clip.uid && trimming.edge === 'start'
              ? Math.round(Math.max(0, trimming.previewSourceTime - trimming.sourceStart) * PX_PER_SECOND)
              : 0;
            return (
              <div key={clip.uid} className="live2d-item-group">
                <div
                  className="live2d-clip-slot"
                  data-clip-uid={clip.uid}
                  style={leftTrimPreview > 0 ? { paddingLeft: leftTrimPreview } : undefined}
                >
                  {showMarker && <div className="live2d-drop-marker" />}
                  <div
                    className={`live2d-clip${active ? ' live2d-clip--active' : ''}${clip.missingParams.length > 0 ? ' live2d-clip--warn' : ''}${draggingUid === clip.uid ? ' live2d-clip--dragging' : ''}`}
                    style={{ width: clipWidth(clip.duration) }}
                    title={
                      clip.missingParams.length > 0
                        ? `警告：以下参数不在模型中\n${clip.missingParams.join('\n')}`
                        : `${clip.label}\n${clip.sourceStart.toFixed(2)}s–${clip.sourceEnd.toFixed(2)}s / ${clip.sourceDuration.toFixed(2)}s`
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
                      className="live2d-clip__trim live2d-clip__trim--left"
                      title="拖拽左端缩减/扩张片段"
                      onPointerDown={(event) => handleTrimPointerDown(event, clip, 'start')}
                      onPointerMove={handleTrimPointerMove}
                      onPointerUp={handleTrimPointerEnd}
                      onPointerCancel={handleTrimPointerEnd}
                      draggable={false}
                    />
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
                      <span className="live2d-clip__duration">
                        {clip.sourceStart.toFixed(1)}–{clip.sourceEnd.toFixed(1)}s
                      </span>
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
                    <button
                      type="button"
                      className="live2d-clip__trim live2d-clip__trim--right"
                      title="拖拽右端缩减/扩张片段"
                      onPointerDown={(event) => handleTrimPointerDown(event, clip, 'end')}
                      onPointerMove={handleTrimPointerMove}
                      onPointerUp={handleTrimPointerEnd}
                      onPointerCancel={handleTrimPointerEnd}
                      draggable={false}
                    />
                  </div>
                </div>
                {timelineItems[itemIndex + 1]?.kind === 'motion' && (
                  <button
                    type="button"
                    className="live2d-transition-add"
                    title="在两个片段之间加入过渡"
                    onClick={() => addTransitionAfter(clip.uid)}
                  >
                    +过渡
                  </button>
                )}
              </div>
            );
          })}
          {timelineItems.length > 0 && insertBeforeUid === null && draggingUid && <div className="live2d-drop-marker" />}
        </div>
      </div>
    </div>
  );
}
