interface NoticePanelProps {
  notices: string[];
  onOpenModels: () => void;
  onLaunchWebui: () => void;
  webuiRunning: boolean;
  onLaunchFrontend: () => void;
  frontendRunning: boolean;
}

export function NoticePanel({ notices, onOpenModels, onLaunchWebui, webuiRunning, onLaunchFrontend, frontendRunning }: NoticePanelProps) {
  return (
    <aside className="notice">
      <h2>公告</h2>

      {notices.map((notice) => (
        <p key={notice}>{notice}</p>
      ))}

      <button
        type="button"
        className="run-btn"
        data-state={frontendRunning ? 'running' : 'ready'}
        disabled={frontendRunning}
        onClick={onLaunchFrontend}
      >
        {frontendRunning ? '前端运行中…' : '启动前端'}
      </button>

      <button
        type="button"
        className="run-btn"
        data-state={webuiRunning ? 'running' : 'ready'}
        disabled={webuiRunning}
        onClick={onLaunchWebui}
      >
        {webuiRunning ? '后端运行中…' : '启动后端'}
      </button>
    </aside>
  );
}
