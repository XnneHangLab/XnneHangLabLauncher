import '../../styles/troubleshooting.css';

interface FaqEntry {
  title: string;
  tags: string[];
  content: string;
}

const FAQ_ENTRIES: FaqEntry[] = [
  {
    title: 'ASR 禁用后麦克风仍然亮起',
    tags: ['ASR', '配置'],
    content: '在启动设置中将 ASR 引擎设为"关闭"后，需要重启后端才能生效。重启后麦克风按钮将自动禁用，点击时会提示"ASR 未启用"。',
  },
  {
    title: 'uv 与 conda 的区别',
    tags: ['环境', '启动'],
    content: 'uv 是轻量级 Python 包管理器，启动速度快，推荐使用。conda 适合需要特定 CUDA 版本或复杂依赖的场景。在启动设置中可以切换运行时驱动。',
  },
  {
    title: '后端启动失败：配置校验错误',
    tags: ['启动', '配置'],
    content: '常见原因：1) chat_model 引用了不存在的 provider — 检查 [agent.chat_model].llm_provider 是否在 [[agent.llm.providers]] 中定义；2) 插件依赖未启用 — 如 memory 插件需要 memory_bench = true。',
  },
  {
    title: 'Live2D 模型预览白屏',
    tags: ['Live2D', '小工具'],
    content: '首次打开小工具页面时需要等待 WebGL 初始化。如果长时间白屏，尝试切换到其他页面再切回来。确保显卡驱动正常且浏览器支持 WebGL2。',
  },
  {
    title: 'TTS 语音合成无声音',
    tags: ['TTS', '语音'],
    content: '检查：1) 启动设置中 TTS 引擎是否已选择（非"关闭"）；2) 对应的模型文件是否已下载（模型管理页面）；3) 控制台是否有 TTS 相关错误日志。',
  },
  {
    title: 'Tool Call 报错 400: reasoning_content',
    tags: ['LLM', 'DeepSeek'],
    content: '使用 DeepSeek V4 等支持 thinking mode 的模型时，如果 tool call 报 400 错误提示 reasoning_content 未传回，请确保后端已更新到最新版本（已修复此问题）。',
  },
  {
    title: '天气显示"请求超时"',
    tags: ['天气', '网络'],
    content: '天气数据来自 Open-Meteo API，需要能访问外网。如果使用代理，确保代理已开启。天气数据有 10 分钟缓存，首次请求超时后会在下次轮询时重试。',
  },
  {
    title: '文件夹卡片一直显示加载动画',
    tags: ['启动', 'UI'],
    content: '通常是后端首次启动失败导致。检查控制台日志中的错误信息，修复配置问题后重新启动后端即可恢复。',
  },
];

export function TroubleshootingPage() {
  return (
    <div className="troubleshooting-page">
      <h2 className="troubleshooting-section-title">疑难解答</h2>
      <p className="troubleshooting-desc">
        常见问题与解决方案汇总。点击卡片展开详细说明。
      </p>

      <div className="troubleshooting-grid">
        {FAQ_ENTRIES.map((entry) => (
          <details key={entry.title} className="troubleshooting-card">
            <summary className="troubleshooting-card__header">
              <span className="troubleshooting-card__title">{entry.title}</span>
              <div className="troubleshooting-card__tags">
                {entry.tags.map((tag) => (
                  <span key={tag} className="troubleshooting-tag">{tag}</span>
                ))}
              </div>
            </summary>
            <div className="troubleshooting-card__body">
              <p>{entry.content}</p>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
