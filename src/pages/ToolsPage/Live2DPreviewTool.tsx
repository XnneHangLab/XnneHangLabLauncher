import { EditorProvider, useEditor } from './EditorProvider';
import { ResourcePanel } from './ResourcePanel';
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
  const { canvasRef, modelPath, modelError } = useEditor();

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
            {modelError && <div className="live2d-error">{modelError}</div>}
            <canvas ref={canvasRef} className="live2d-canvas" />
          </div>
        </div>

        <div className="live2d-col live2d-col--params">
          <ParameterPanel />
        </div>
      </div>

      {/* ── Timeline row ────────────────────────────────────── */}
      <div className="live2d-timeline-row">
        <Timeline />
      </div>
    </div>
  );
}
