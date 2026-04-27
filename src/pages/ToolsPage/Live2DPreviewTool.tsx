import { useEffect, useState } from 'react';
import { readLive2DPresets, writeLive2DPresets } from '../../services/config/bridge';
import type { Live2DPreset } from '../../services/config/bridge';
import { EditorProvider, useEditor } from './EditorProvider';
import { ParameterPanel } from './ParameterPanel';
import { Timeline } from './Timeline';

interface Live2DPreviewToolProps {
  onBack: () => void;
}

export function Live2DPreviewTool({ onBack }: Live2DPreviewToolProps) {
  return (
    <EditorProvider>
      <Live2DToolInner onBack={onBack} />
    </EditorProvider>
  );
}

function Live2DToolInner({ onBack }: Live2DPreviewToolProps) {
  const { canvasRef, modelLoaded, modelError, modelPath, openImportDialog, loadModelByPath } =
    useEditor();

  const [presets, setPresets] = useState<Live2DPreset[]>([]);
  const [presetName, setPresetName] = useState('');

  useEffect(() => {
    readLive2DPresets().then(setPresets).catch(console.error);
  }, []);

  async function handleSavePreset() {
    const name = presetName.trim();
    if (!modelPath || !name) return;
    const next = [...presets.filter((p) => p.name !== name), { name, modelPath }];
    setPresets(next);
    await writeLive2DPresets(next);
    setPresetName('');
  }

  function handleSelectPreset(e: React.ChangeEvent<HTMLSelectElement>) {
    const path = e.target.value;
    if (path) loadModelByPath(path);
    e.target.value = '';
  }

  const filename = modelPath ? modelPath.split(/[/\\]/).pop() ?? modelPath : '未选择模型';

  return (
    <div className="live2d-tool">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="live2d-topbar">
        <button type="button" className="live2d-back-btn" onClick={onBack}>← 返回</button>
        <span className="live2d-model-path" title={modelPath ?? ''}>{filename}</span>
        <button type="button" className="live2d-btn" onClick={openImportDialog}>导入模型</button>
        {presets.length > 0 && (
          <select className="live2d-select" onChange={handleSelectPreset} defaultValue="">
            <option value="" disabled>预设</option>
            {presets.map((p) => (
              <option key={p.name} value={p.modelPath}>{p.name}</option>
            ))}
          </select>
        )}
        <input
          type="text"
          className="live2d-preset-input"
          placeholder="预设名称"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
        />
        <button type="button" className="live2d-btn" onClick={handleSavePreset}>保存预设</button>
      </div>

      {/* ── Main area: canvas | right column (params + timeline) ── */}
      <div className="live2d-main">
        <div className="live2d-canvas-wrap">
          {!modelPath && <div className="live2d-empty">点击「导入模型」选择 .model3.json 文件</div>}
          {modelError && <div className="live2d-error">{modelError}</div>}
          <canvas ref={canvasRef} className="live2d-canvas" />
        </div>
        <div className="live2d-right-col">
          <ParameterPanel />
          <Timeline />
        </div>
      </div>
    </div>
  );
}
