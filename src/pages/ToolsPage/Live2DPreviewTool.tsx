import { useState } from 'react';
import type { ConsoleLogEntry } from '../../services/launcher/launcher';
import { EditorProvider, useEditor } from './EditorProvider';
import { ResourcePanel } from './ResourcePanel';
import { ParameterPanel } from './ParameterPanel';
import { ExpressionPanel } from './ExpressionPanel';
import { Timeline } from './Timeline';
import { Live2DErrorDialog } from './Live2DErrorDialog';

interface Live2DPreviewToolProps {
  onBack: () => void;
  onDebugLog?: (text: string, kind?: ConsoleLogEntry['kind']) => void;
  isActive?: boolean;
}

export function Live2DPreviewTool({ onBack, onDebugLog, isActive }: Live2DPreviewToolProps) {
  return (
    <EditorProvider onDebugLog={onDebugLog} isActive={isActive}>
      <Live2DToolInner onBack={onBack} />
    </EditorProvider>
  );
}

function Live2DToolInner({ onBack }: Live2DPreviewToolProps) {
  const { canvasRef, modelPath, modelError, clearModelError } = useEditor();
  const [rightTab, setRightTab] = useState<'params' | 'expressions'>('params');

  const filename = modelPath ? modelPath.split(/[/\\]/).pop() ?? modelPath : '未选择模型';

  return (
    <div className="live2d-tool">
      {/* ── Top bar ─────────────────────────────────────────── */}
      <div className="live2d-topbar">
        <button type="button" className="live2d-back-btn" onClick={onBack}>← 返回</button>
        <span className="live2d-model-path" title={modelPath ?? ''}>{filename}</span>
      </div>

      {/* ── [3,1] main area: resources | canvas | params ──── */}
      <div className="live2d-main">
        <div className="live2d-col live2d-col--resources">
          <ResourcePanel />
        </div>

        <div className="live2d-col live2d-col--canvas">
          <div className="live2d-canvas-wrap">
            {!modelPath && <div className="live2d-empty">点击「导入模型」选择 .model3.json 文件</div>}
            <canvas ref={canvasRef} className="live2d-canvas" />
          </div>
        </div>

        <div className="live2d-col live2d-col--params">
          <div className="live2d-right-tabs">
            <button
              type="button"
              className={`live2d-right-tab${rightTab === 'params' ? ' live2d-right-tab--active' : ''}`}
              onClick={() => setRightTab('params')}
            >
              基础参数
            </button>
            <button
              type="button"
              className={`live2d-right-tab${rightTab === 'expressions' ? ' live2d-right-tab--active' : ''}`}
              onClick={() => setRightTab('expressions')}
            >
              已有表情/外观
            </button>
          </div>
          {rightTab === 'params' ? <ParameterPanel /> : <ExpressionPanel />}
        </div>
      </div>

      {/* ── Timeline row ────────────────────────────────────── */}
      <div className="live2d-timeline-row">
        <Timeline />
      </div>

      {modelError && <Live2DErrorDialog message={modelError} onClose={clearModelError} />}
    </div>
  );
}

