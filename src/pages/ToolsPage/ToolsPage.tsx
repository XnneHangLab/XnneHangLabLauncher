import { useEffect, useState } from 'react';
import type { ConsoleLogEntry } from '../../services/launcher/launcher';
import '../../styles/tools.css';
import '../../styles/live2d.css';
import { Live2DPreviewTool } from './Live2DPreviewTool';

type ToolId = 'live2d';

interface ToolDef {
  id: ToolId;
  icon: string;
  name: string;
  desc: string;
}

const TOOLS: ToolDef[] = [
  { id: 'live2d', icon: '◈', name: 'Live2D 预览', desc: '导入并预览 Live2D 模型，播放动作动画' },
];

interface ToolsPageProps {
  onDebugLog?: (text: string, kind?: ConsoleLogEntry['kind']) => void;
  isActive?: boolean;
}

export function ToolsPage({ onDebugLog, isActive = false }: ToolsPageProps) {
  const [activeTool, setActiveTool] = useState<ToolId | null>(() => {
    return window.localStorage.getItem('live2d.activeTool') === 'live2d' ? 'live2d' : null;
  });

  useEffect(() => {
    if (activeTool) window.localStorage.setItem('live2d.activeTool', activeTool);
    else window.localStorage.removeItem('live2d.activeTool');
  }, [activeTool]);

  if (activeTool === 'live2d') {
    return <Live2DPreviewTool onBack={() => setActiveTool(null)} onDebugLog={onDebugLog} isActive={isActive} />;
  }

  return (
    <div className="tools-page">
      <h2 className="tools-page__title">小工具</h2>
      <p className="tools-page__hint">各类辅助工具，点击卡片进入。</p>
      <div className="tools-grid">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="tool-card"
            onClick={() => setActiveTool(tool.id)}
          >
            <span className="tool-card__icon">{tool.icon}</span>
            <span className="tool-card__name">{tool.name}</span>
            <span className="tool-card__desc">{tool.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
