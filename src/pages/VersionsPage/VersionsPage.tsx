import '../../styles/versions.css';

interface VersionTimelineEntry {
  date: string;
  version: string;
  badge: string;
  title: string;
  summary?: string;
}

const CURRENT_VERSION = {
  version: 'v0.2.0',
  date: '2026-05-28',
  channel: '开发版',
  summary: '角色状态面板、MBTI 性格测试、运行时监控、Live2D 预设深度绑定',
};

const VERSION_TIMELINE: VersionTimelineEntry[] = [
  {
    date: '2026-05-28',
    version: 'v0.2.0',
    badge: '当前',
    title: '角色状态面板与 MBTI 性格测试',
    summary: '新增角色状态面板（心情分、天气、MBTI、社交状态）、运行时 API 轮询、城市选择器、IP 定位',
  },
  {
    date: '2026-05-26',
    version: 'v0.1.5',
    badge: '',
    title: 'ASR 控制与进程管理',
    summary: 'ASR 禁用时自动关闭麦克风、前后端停止按钮、背景图重连刷新、reasoning_content 修复',
  },
  {
    date: '2026-05-22',
    version: 'v0.1.4',
    badge: '',
    title: 'Live2D 表情系统重构',
    summary: '移除 conf_name/conf_uid、neutral 表情 sentinel、动态生成 expression/TTS 列表、format prompt 模板化',
  },
  {
    date: '2026-05-21',
    version: 'v0.1.3',
    badge: '',
    title: 'Live2D 预设保存修复与造型系统',
    summary: '修复 preset 加载丢失 label/description、默认造型 tool call、TTS 情绪编辑器、启动角色选择器',
  },
  {
    date: '2026-05-15',
    version: 'v0.1.2',
    badge: '',
    title: 'Live2D 预设统一配置',
    summary: '统一 Live2D preset 配置格式、水印/表情/造型四层管理、动作资产导入与时间线编辑',
  },
  {
    date: '2026-05-01',
    version: 'v0.1.0',
    badge: '',
    title: 'Live2D 预览工具上线',
    summary: '新增 Live2D 预览小工具、模型导入/动作播放/表情预览、CubismFramework 集成',
  },
  {
    date: '2026-04-19',
    version: 'v0.0.5',
    badge: '',
    title: '将前端由 Streamlit 迁移至 Tauri',
    summary: '新增 Tauri 桌面启动器，移除 Streamlit / WebUI Admin 页面，运行时配置由 Launcher 驱动',
  },
];

export function VersionsPage() {
  return (
    <div className="versions-page">
      <section className="versions-current-card">
        <div className="versions-current-card__body">
          <div className="versions-current-card__main">
            <p className="versions-current-card__label">当前版本</p>
            <h1>{CURRENT_VERSION.version}</h1>
            <p className="versions-current-card__summary">{CURRENT_VERSION.summary}</p>
          </div>

          <div className="versions-current-card__meta">
            <div className="versions-stat-grid">
              <div className="versions-stat-card">
                <span className="versions-stat-card__label">发布日期</span>
                <strong className="versions-stat-card__value">{CURRENT_VERSION.date}</strong>
              </div>
              <div className="versions-stat-card">
                <span className="versions-stat-card__label">版本状态</span>
                <strong className="versions-stat-card__value">{CURRENT_VERSION.channel}</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="versions-timeline-card">
        <div className="versions-section-head">
          <h2>版本时间线</h2>
          <p>将来会保留历史版本的下载链接，并按时间继续追加在这里。</p>
        </div>

        <div className="versions-timeline">
          {VERSION_TIMELINE.map((entry) => (
            <article key={entry.version} className="versions-timeline__item">
              <div className="versions-timeline__rail">
                <span className="versions-timeline__dot" />
              </div>

              <div className="versions-timeline__content">
                <div className="versions-timeline__top">
                  <span className="versions-timeline__date">{entry.date}</span>
                  <span className="versions-timeline__version">{entry.version}</span>
                  <span className="versions-timeline__badge">{entry.badge}</span>
                </div>
                <p className="versions-timeline__title">{entry.title}</p>
                {entry.summary ? <p>{entry.summary}</p> : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
