/**
 * Timeline — single track of queued clips, play/scrub, validation warnings.
 */
import { useEditor } from './EditorProvider';

export function Timeline() {
  const {
    modelLoaded,
    isPlaying,
    currentTime,
    duration,
    currentMotion,
    timelineClips,
    togglePlay,
    scrub,
    playMotion,
    removeClipFromTimeline,
    clearTimeline,
  } = useEditor();

  if (!modelLoaded) return null;

  const pct = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;

  return (
    <div className="live2d-timeline-panel">
      {/* ── Transport ─────────────────────────────────────────────── */}
      <div className="live2d-playback">
        <button type="button" className="live2d-timeline-btn" onClick={togglePlay}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="live2d-timeline-time">
          {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
        </span>
        <input
          type="range"
          className="live2d-timeline-bar"
          min={0}
          max={duration || 1}
          step={0.01}
          value={currentTime}
          onChange={(e) => scrub(Number(e.target.value))}
        />
        <span className="live2d-timeline-progress">{pct}%</span>
        {timelineClips.length > 0 && (
          <button type="button" className="live2d-timeline-btn" onClick={clearTimeline} title="清空时间线">
            ✕
          </button>
        )}
      </div>

      {/* ── Clip track ────────────────────────────────────────────── */}
      {timelineClips.length > 0 && (
        <div className="live2d-clip-track">
          {timelineClips.map((clip) => {
            const active =
              currentMotion?.group === clip.group && currentMotion?.index === clip.index;
            return (
              <div
                key={clip.uid}
                className={`live2d-clip${active ? ' live2d-clip--active' : ''}${clip.missingParams.length > 0 ? ' live2d-clip--warn' : ''}`}
                title={
                  clip.missingParams.length > 0
                    ? `警告：以下参数不在模型中\n${clip.missingParams.join('\n')}`
                    : clip.label
                }
              >
                <button
                  type="button"
                  className="live2d-clip__play"
                  onClick={() => playMotion(clip.group, clip.index)}
                >
                  {active ? '■' : '▶'}
                </button>
                <span className="live2d-clip__label">{clip.label} · {clip.duration.toFixed(1)}s</span>
                {clip.missingParams.length > 0 && (
                  <span className="live2d-clip__warn" title={`缺失参数：${clip.missingParams.join(', ')}`}>
                    ⚠
                  </span>
                )}
                <button
                  type="button"
                  className="live2d-clip__remove"
                  onClick={() => removeClipFromTimeline(clip.uid)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
