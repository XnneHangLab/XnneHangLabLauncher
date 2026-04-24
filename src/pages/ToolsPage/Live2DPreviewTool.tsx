import { useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { pickAnyFile, readLive2DPresets, writeLive2DPresets } from '../../services/config/bridge';
import type { Live2DPreset } from '../../services/config/bridge';
import { useLive2DCanvas } from './useLive2DCanvas';

interface Live2DPreviewToolProps {
  onBack: () => void;
}

export function Live2DPreviewTool({ onBack }: Live2DPreviewToolProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [modelPath, setModelPath] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [presets, setPresets] = useState<Live2DPreset[]>([]);
  const [presetName, setPresetName] = useState('');

  const { motions, currentMotion, progress, isPlaying, playMotion, modelLoaded, modelError } =
    useLive2DCanvas(canvasRef, modelUrl);

  useEffect(() => {
    readLive2DPresets().then(setPresets).catch(console.error);
  }, []);

  useEffect(() => {
    if (modelPath) {
      setModelUrl(convertFileSrc(modelPath));
    } else {
      setModelUrl(null);
    }
  }, [modelPath]);

  async function handleImport() {
    const path = await pickAnyFile('选择 Live2D 模型文件 (.model3.json)');
    if (path) setModelPath(path);
  }

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
    if (path) setModelPath(path);
    e.target.value = '';
  }

  const filename = modelPath ? modelPath.split(/[/\\]/).pop() ?? modelPath : '未选择模型';

  const progressPct = Math.round(progress * 100);

  return (
    <div className="live2d-tool">
      <div className="live2d-topbar">
        <button type="button" className="live2d-back-btn" onClick={onBack}>
          ← 返回
        </button>
        <span className="live2d-model-path" title={modelPath ?? ''}>
          {filename}
        </span>
        <button type="button" className="live2d-btn" onClick={handleImport}>
          导入模型
        </button>
        {presets.length > 0 && (
          <select className="live2d-select" onChange={handleSelectPreset} defaultValue="">
            <option value="" disabled>
              预设
            </option>
            {presets.map((p) => (
              <option key={p.name} value={p.modelPath}>
                {p.name}
              </option>
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
        <button type="button" className="live2d-btn" onClick={handleSavePreset}>
          保存预设
        </button>
      </div>

      <div className="live2d-main">
        <div className="live2d-canvas-wrap">
          {!modelPath && (
            <div className="live2d-empty">点击「导入模型」选择 .model3.json 文件</div>
          )}
          {modelError && <div className="live2d-error">{modelError}</div>}
          <canvas ref={canvasRef} className="live2d-canvas" />
        </div>

        {modelLoaded && motions.length > 0 && (
          <div className="live2d-motion-panel">
            <div className="live2d-motion-panel__title">动作列表</div>
            <div className="live2d-motion-list">
              {motions.map((m) => (
                <button
                  key={`${m.group}-${m.index}`}
                  type="button"
                  className={`live2d-motion-item${
                    currentMotion?.group === m.group && currentMotion?.index === m.index
                      ? ' live2d-motion-item--active'
                      : ''
                  }`}
                  onClick={() => playMotion(m.group, m.index)}
                >
                  <span className="live2d-motion-item__group">{m.group}</span>
                  <span className="live2d-motion-item__index">#{m.index}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {modelLoaded && (
        <div className="live2d-timeline">
          <span className="live2d-timeline__status">{isPlaying ? '▶' : '■'}</span>
          <span className="live2d-timeline__label">
            {currentMotion ? `${currentMotion.group} #${currentMotion.index}` : '—'}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={progressPct}
            className="live2d-timeline__bar"
            onChange={() => {
              if (currentMotion) playMotion(currentMotion.group, currentMotion.index);
            }}
          />
        </div>
      )}
    </div>
  );
}
