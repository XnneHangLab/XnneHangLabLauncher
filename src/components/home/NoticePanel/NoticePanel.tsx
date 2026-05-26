interface NoticePanelProps {
  notices: string[];
  onOpenModels: () => void;
  onLaunchWebui: () => void;
  onStopWebui: () => void;
  webuiRunning: boolean;
  onLaunchFrontend: () => void;
  onStopFrontend: () => void;
  frontendRunning: boolean;
}

export function NoticePanel({ notices, onOpenModels, onLaunchWebui, onStopWebui, webuiRunning, onLaunchFrontend, onStopFrontend, frontendRunning }: NoticePanelProps) {
  return (
    <aside className="notice">
      <h2>公告</h2>

      {notices.map((notice) => (
        <p key={notice}>{notice}</p>
      ))}

      <div className="notice-actions">
        <button
          type="button"
          className="run-btn"
          data-state={frontendRunning ? 'running' : 'ready'}
          onClick={frontendRunning ? onStopFrontend : onLaunchFrontend}
        >
          {frontendRunning ? '停止前端' : '启动前端'}
        </button>

        <button
          type="button"
          className="run-btn"
          data-state={webuiRunning ? 'running' : 'ready'}
          onClick={webuiRunning ? onStopWebui : onLaunchWebui}
        >
          {webuiRunning ? '停止后端' : '启动后端'}
        </button>
      </div>
    </aside>
  );
}
