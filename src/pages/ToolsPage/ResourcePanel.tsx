import { useEffect, useState } from 'react';
import { useEditor } from './EditorProvider';
import { readLive2DPresets, writeLive2DPresets } from '../../services/config/bridge';
import type { Live2DPreset } from '../../services/config/bridge';

export function ResourcePanel() {
  const {
    modelLoaded, modelPath, motionEntries, motionAliases,
    addClipToTimeline, timelineClips, loadModelByPath, openImportDialog, openMotionImportDialog,
  } = useEditor();

  const [presets, setPresets] = useState<Live2DPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  // Clip keys queued for restoration after next model load
  const [pendingKeys, setPendingKeys] = useState<string[] | null>(null);

  useEffect(() => {
    readLive2DPresets().then(setPresets).catch(console.error);
  }, []);

  // Restore clips once a model finishes loading
  useEffect(() => {
    if (!modelLoaded || !pendingKeys) return;
    for (const key of pendingKeys) {
      const sep = key.lastIndexOf('_');
      if (sep < 1) continue;
      const group = key.slice(0, sep);
      const index = Number(key.slice(sep + 1));
      if (!Number.isNaN(index)) addClipToTimeline(group, index);
    }
    setPendingKeys(null);
  }, [modelLoaded, pendingKeys, addClipToTimeline]);

  async function handleSavePreset() {
    const name = presetName.trim();
    if (!modelPath || !name) return;
    const clipKeys = timelineClips.map(c => `${c.group}_${c.index}`);
    const next = [...presets.filter(p => p.name !== name), { name, modelPath, clipKeys }];
    setPresets(next);
    await writeLive2DPresets(next);
    setPresetName('');
  }

  async function handleLoadPreset(preset: Live2DPreset) {
    setPendingKeys(preset.clipKeys ?? []);
    await loadModelByPath(preset.modelPath);
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
              const label = motionAliases[key] ?? `${m.group}#${m.index}`;
              return (
                <div key={key} className="live2d-resource-item">
                  <span className="live2d-resource-item__name" title={m.file}>{label}</span>
                  <button
                    type="button"
                    className="live2d-resource-add"
                    title="添加到时间线"
                    onClick={() => addClipToTimeline(m.group, m.index)}
                  >
                    +
                  </button>
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
