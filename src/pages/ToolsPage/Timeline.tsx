/**
 * Timeline + Motion Panel — play/pause, scrub bar, motion list with rename.
 */
import { useState } from 'react';
import { useEditor } from './EditorProvider';

export function Timeline() {
  const {
    modelLoaded,
    isPlaying,
    currentTime,
    duration,
    motionEntries,
    currentMotion,
    playMotion,
    scrub,
    togglePlay,
    motionAliases,
    renameMotion,
  } = useEditor();

  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  if (!modelLoaded) return null;

  const pct = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;

  function resolveLabel(group: string, index: number): string {
    return motionAliases[`${group}_${index}`] ?? `${group}#${index}`;
  }

  function startRename(group: string, index: number) {
    const key = `${group}_${index}`;
    setEditingName(key);
    setEditValue(motionAliases[key] ?? `${group}#${index}`);
  }

  function commitRename() {
    if (editingName && editValue.trim()) {
      renameMotion(editingName, editValue.trim());
    }
    setEditingName(null);
  }

  return (
    <div className="live2d-timeline-panel">
      {/* ── Playback bar ─────────────────────────────────────── */}
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
      </div>

      {/* ── Motion list ─────────────────────────────────────── */}
      <div className="live2d-motion-panel">
        <div className="live2d-motion-panel__title">
          动作列表 ({motionEntries.length})
        </div>
        <div className="live2d-motion-list">
          {motionEntries.map((m) => {
            const key = `${m.group}_${m.index}`;
            const isActive = currentMotion?.group === m.group && currentMotion?.index === m.index;
            const label = resolveLabel(m.group, m.index);

            return (
              <div
                key={key}
                className={`live2d-motion-row${isActive ? ' live2d-motion-row--active' : ''}`}
              >
                <button
                  type="button"
                  className="live2d-motion-play"
                  onClick={() => playMotion(m.group, m.index)}
                >
                  {isActive ? '■' : '▶'}
                </button>

                {editingName === key ? (
                  <input
                    type="text"
                    className="live2d-motion-rename-input"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingName(null);
                    }}
                    autoFocus
                  />
                ) : (
                  <span
                    className="live2d-motion-label"
                    onDoubleClick={() => startRename(m.group, m.index)}
                    title="双击重命名"
                  >
                    {label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
