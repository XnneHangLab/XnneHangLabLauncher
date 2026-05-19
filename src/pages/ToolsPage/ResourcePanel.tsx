import { useEffect, useState } from 'react';
import { useEditor } from './EditorProvider';
import { readLive2DPresets, writeLive2DPresets } from '../../services/config/bridge';
import type { Live2DPreset } from '../../services/config/bridge';
import type { TimelineClip } from './EditorProvider';

export function ResourcePanel() {
  const {
    modelLoaded, modelPath, motionEntries, motionAssets, toggleMotionAsset,
    motionAliases, currentMotion,
    addClipToTimeline, timelineClips, loadModelByPath, loadPreset, openImportDialog, openMotionImportDialog,
    renameMotion, deleteMotion, playMotion,
    buildAdaptedPreset,
  } = useEditor();

  const [presets, setPresets] = useState<Live2DPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [pendingRefs, setPendingRefs] = useState<Array<{ group: string; index: number }> | null>(null);

  const clipRefs = (clips: TimelineClip[]) => clips.map((clip) => ({ group: clip.group, index: clip.index }));
  const clipRefsFromKeys = (keys?: string[]) => (keys ?? []).flatMap((key) => {
    const sep = key.lastIndexOf('_');
    if (sep < 1) return [];
    const group = key.slice(0, sep);
    const index = Number(key.slice(sep + 1));
    return Number.isNaN(index) ? [] : [{ group, index }];
  });

  useEffect(() => {
    readLive2DPresets().then(setPresets).catch(console.error);
  }, []);

  useEffect(() => {
    if (!modelLoaded || !pendingRefs) return;
    for (const ref of pendingRefs) addClipToTimeline(ref.group, ref.index);
    setPendingRefs(null);
  }, [modelLoaded, pendingRefs, addClipToTimeline]);

  async function handleSavePreset(overrideName?: string) {
    const name = (overrideName ?? presetName).trim();
    if (!modelPath || !name) return;
    const refs = clipRefs(timelineClips);
    const clipKeys = refs.map(c => `${c.group}_${c.index}`);
    const adaptedPreset = buildAdaptedPreset(name);
    const nextPreset: Live2DPreset = adaptedPreset
      ? {
        ...adaptedPreset,
        modelPath,
        clipKeys,
        timeline: {
          ...adaptedPreset.timeline,
          clipKeys,
          clips: refs,
        },
      }
      : { name, modelPath, clipKeys, timeline: { clipKeys, clips: refs } };
    const next = [...presets.filter(p => p.name !== name), nextPreset];
    setPresets(next);
    await writeLive2DPresets(next);
    setPresetName('');
  }

  async function handleLoadPreset(preset: Live2DPreset) {
    setPendingRefs(preset.timeline?.clips ?? clipRefsFromKeys(preset.timeline?.clipKeys ?? preset.clipKeys));
    await loadPreset(preset);
  }

  async function handleDeletePreset(name: string) {
    const next = presets.filter(p => p.name !== name);
    setPresets(next);
    await writeLive2DPresets(next);
  }

  return (
    <div className="live2d-resource-panel">
      <div className="live2d-resource-section">
        <div className="live2d-panel-title">模型</div>
        <button type="button" className="live2d-btn live2d-btn--full" onClick={openImportDialog}>
          导入模型…
        </button>
        {modelPath && (
          <div className="live2d-resource-path" title={modelPath}>
            {modelPath.split(/[/\\]/).pop()}
          </div>
        )}
      </div>

      <div className="live2d-resource-section live2d-resource-section--scroll">
        <div className="live2d-resource-section-header">
          <div className="live2d-panel-title">动作 ({motionEntries.length})</div>
          {modelLoaded && (
            <button type="button" className="live2d-btn live2d-btn--xs" onClick={openMotionImportDialog}>
              + 导入
            </button>
          )}
        </div>
        <div className="live2d-resource-list">
          {!modelLoaded ? (
            <div className="live2d-panel-empty">未加载模型</div>
          ) : (
            motionEntries.map((m) => {
              const key = `${m.group}_${m.index}`;
              const defaultLabel = m.name || `${m.group}#${m.index}`;
              const label = motionAliases[key] ?? defaultLabel;
              const isImported = m.group === 'imported';
              const isFixed = motionAssets.some(a => a.group === m.group && a.index === m.index);
              const isPreviewing = currentMotion?.group === m.group && currentMotion.index === m.index;
              return (
                <div
                  key={key}
                  className="live2d-resource-item live2d-resource-item--motion"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData('application/x-live2d-motion', JSON.stringify({ group: m.group, index: m.index }));
                    event.dataTransfer.setData('text/plain', label);
                  }}
                >
                  <button
                    type="button"
                    className={`live2d-resource-motion-name${isPreviewing ? ' live2d-resource-motion-name--active' : ''}`}
                    title={`预览动作：${m.file}`}
                    onMouseDownCapture={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      playMotion(m.group, m.index);
                    }}
                    onPointerDownCapture={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      playMotion(m.group, m.index);
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <span className="live2d-resource-motion-icon">{isPreviewing ? '■' : '▶'}</span>
                    <span className="live2d-resource-motion-label">{label}</span>
                  </button>
                  <button
                    type="button"
                    className="live2d-resource-rename"
                    title={`编辑别名，不会修改源文件：${m.file}`}
                    onMouseDown={(event) => event.stopPropagation()}
                    draggable={false}
                  >
                    <input
                      type="text"
                      className="live2d-resource-alias"
                      value={label}
                      title={`别名，不会修改源文件：${m.file}`}
                      onDragStart={(event) => event.preventDefault()}
                      onChange={(event) => renameMotion(key, event.target.value)}
                      onBlur={(event) => {
                        if (!event.target.value.trim()) renameMotion(key, defaultLabel);
                      }}
                    />
                  </button>
                  <button
                    type="button"
                    className="live2d-resource-add"
                    title="添加到时间线"
                    onClick={() => addClipToTimeline(m.group, m.index)}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className={`live2d-resource-pin${isFixed ? ' live2d-resource-pin--active' : ''}`}
                    title={isFixed ? '从固有资产中移除' : '加入固有资产（随预设保存）'}
                    onClick={() => toggleMotionAsset(m)}
                  >
                    ★
                  </button>
                  {isImported && (
                    <button
                      type="button"
                      className="live2d-resource-del"
                      title="删除导入动作（不删除源文件）"
                      onClick={() => deleteMotion(m.group, m.index)}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="live2d-resource-section live2d-resource-section--presets">
        <div className="live2d-panel-title">预设</div>
        {presets.length > 0 && (
          <div className="live2d-resource-list">
            {presets.map(p => (
              <div key={p.name} className="live2d-resource-item">
                <span
                  className="live2d-resource-item__name live2d-resource-item__name--link"
                  title={p.modelPath}
                  onClick={() => handleLoadPreset(p)}
                >
                  {p.name}
                </span>
                <button
                  type="button"
                  className="live2d-resource-add"
                  title="覆盖更新此预设"
                  onClick={() => handleSavePreset(p.name)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="live2d-resource-del"
                  title="删除预设"
                  onClick={() => handleDeletePreset(p.name)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="live2d-resource-save">
          <input
            type="text"
            className="live2d-preset-input"
            placeholder="预设名称"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); }}
          />
          <button type="button" className="live2d-btn" onClick={handleSavePreset}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
