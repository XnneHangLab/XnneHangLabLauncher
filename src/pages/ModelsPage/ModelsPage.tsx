import { ModelCard, type ModelSpec } from '../../components/models/ModelCard/ModelCard';
import type {
  EnvironmentProbe,
  FileProgress,
  ModelStatusEntry,
  ResourceStatus,
  RuntimeInspection,
  RuntimeTaskRecord,
} from '../../services/runtime/runtime';
import '../../styles/models.css';

const MODEL_GROUPS: Array<{ title: string; specs: ModelSpec[] }> = [
  {
    title: '语音识别',
    specs: [
      {
        key: 'sherpa-paraformer',
        title: 'Sherpa Paraformer ZH',
        description: 'sherpa-onnx Paraformer 中文 ASR 模型，CPU 可用，配合 Silero VAD 使用。',
        icon: '🎧',
        tags: ['ASR', 'CPU'],
        requiresGpu: false,
      },
      {
        key: 'silero-vad',
        title: 'Silero VAD',
        description: 'Silero 语音活动检测模型，Sherpa ASR 与 Qwen ASR 均依赖此模型进行断句。',
        icon: '🔉',
        tags: ['VAD', 'CPU'],
        requiresGpu: false,
      },
    ],
  },
  {
    title: '语音合成基础资源',
    specs: [
      {
        key: 'genie-base',
        title: 'Genie-TTS 基础资源',
        description: 'XnneHangLab 自研语音合成引擎所需的基础模型包，支持 CPU 与 GPU 环境。',
        icon: '🧠',
        tags: ['TTS', 'CPU', 'GPU'],
        requiresGpu: false,
      },
      {
        key: 'gsv-lite',
        title: 'GSV-Lite 数据包',
        description: '包含 HuBERT、Roberta、G2P 及 SV 共四项子资源，仅 GPU 环境可用。',
        icon: '🎙',
        tags: ['TTS', 'GPU'],
        requiresGpu: true,
      },
    ],
  },
  {
    title: '语音合成模型',
    specs: [
      {
        key: 'luming-genie-tts-v2-pro-plus',
        title: '路鸣 Genie-TTS v2 Pro+',
        description: '路鸣角色 Genie-TTS 角色模型包，CPU 推理，需配合 Genie-TTS 基础资源使用。',
        icon: '🎤',
        tags: ['TTS', 'CPU'],
        requiresGpu: false,
      },
      {
        key: 'gsv-baoqiao',
        title: '薄巧 GSV 角色模型',
        description: '薄巧角色 GPT-SoVITS 语音模型，需配合 GSV-Lite 基础包使用，仅 GPU 环境可用。',
        icon: '🎤',
        tags: ['TTS', 'GPU'],
        requiresGpu: true,
      },
      {
        key: 'qwen-tts-0.6b',
        title: 'Qwen3-TTS 0.6B',
        description: '千问语音合成轻量版，仅 GPU 环境可用。',
        icon: '🔊',
        tags: ['TTS', 'GPU', '≥ 8GB'],
        requiresGpu: true,
      },
      {
        key: 'qwen-tts-1.7b',
        title: 'Qwen3-TTS 1.7B',
        description: '千问语音合成标准版，仅 GPU 环境可用。',
        icon: '🔊',
        tags: ['TTS', 'GPU', '12~16GB'],
        requiresGpu: true,
      },
    ],
  },
  {
    title: '工具模型',
    specs: [
      {
        key: 'local-embedding',
        title: 'BGE-M3 本地嵌入模型',
        description: 'GGUF Q8_0 量化版 BGE-M3，用于本地向量嵌入与语义检索，CPU 可用。',
        icon: '🔍',
        tags: ['Embedding', 'CPU', 'Q8_0'],
        requiresGpu: false,
      },
      {
        key: 'llm-translate',
        title: 'Qwen2.5 0.5B 翻译辅助',
        description: '千问 2.5 超轻量指令模型，GGUF Q8_0，用于文本翻译辅助推理，CPU 可用。',
        icon: '🌐',
        tags: ['Translate', 'CPU', '0.5B'],
        requiresGpu: false,
      },
    ],
  },
];

const taskStatusLabel: Record<string, string> = {
  queued: '排队中',
  preparing: '准备中',
  downloading: '下载中',
  verifying: '校验中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

interface ModelsPageProps {
  inspection: RuntimeInspection | null;
  environmentProbe: EnvironmentProbe | null;
  tasks: RuntimeTaskRecord[];
  fileProgress: FileProgress | null;
  onDownloadGenieBase: () => void;
  onDownloadGsvLite: () => void;
  onDownloadQwenTts06b: () => void;
  onDownloadQwenTts17b: () => void;
  onDownloadLumingGenieTts: () => void;
  onDownloadGsvBaoqiao: () => void;
  onDownloadLocalEmbedding: () => void;
  onDownloadLlmTranslate: () => void;
  onDownloadSherpaParaformer: () => void;
  onDownloadSileroVad: () => void;
  modelStatuses: Record<string, ModelStatusEntry>;
  scriptsReady: boolean;
}

export function ModelsPage({
  inspection,
  environmentProbe,
  tasks,
  fileProgress,
  onDownloadGenieBase,
  onDownloadGsvLite,
  onDownloadQwenTts06b,
  onDownloadQwenTts17b,
  onDownloadLumingGenieTts,
  onDownloadGsvBaoqiao,
  onDownloadLocalEmbedding,
  onDownloadLlmTranslate,
  onDownloadSherpaParaformer,
  onDownloadSileroVad,
  modelStatuses,
  scriptsReady,
}: ModelsPageProps) {
  const gpuReady =
    inspection?.environment.mode === 'gpu' ||
    environmentProbe?.status === 'torch-gpu-ready';

  function handleDownload(key: string) {
    if (key === 'genie-base') {
      onDownloadGenieBase();
    } else if (key === 'luming-genie-tts-v2-pro-plus') {
      onDownloadLumingGenieTts();
    } else if (key === 'gsv-lite') {
      onDownloadGsvLite();
    } else if (key === 'gsv-baoqiao') {
      onDownloadGsvBaoqiao();
    } else if (key === 'qwen-tts-0.6b') {
      onDownloadQwenTts06b();
    } else if (key === 'qwen-tts-1.7b') {
      onDownloadQwenTts17b();
    } else if (key === 'local-embedding') {
      onDownloadLocalEmbedding();
    } else if (key === 'llm-translate') {
      onDownloadLlmTranslate();
    } else if (key === 'sherpa-paraformer') {
      onDownloadSherpaParaformer();
    } else if (key === 'silero-vad') {
      onDownloadSileroVad();
    }
  }

  return (
    <div className="models-page">
      <header className="models-page__header">
        <h1>模型管理</h1>
        <p>按需下载运行时所需的模型资源，下载任务自动进入串行队列。</p>
        {!scriptsReady ? (
          <p className="models-page__header-warn">运行环境未就绪，暂时无法执行下载。</p>
        ) : null}
      </header>

      <div className="models-page__groups">
        {MODEL_GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="models-page__section-title">{group.title}</h2>
            <div className="models-page__cards">
              {group.specs.map((spec) => (
                <ModelCard
                  key={spec.key}
                  spec={spec}
                  status={(modelStatuses[spec.key]?.status as ResourceStatus) ?? null}
                  resolvedPath={modelStatuses[spec.key]?.path}
                  scriptsReady={scriptsReady}
                  gpuReady={gpuReady}
                  onDownload={() => handleDownload(spec.key)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="models-page__queue">
        <h2>下载队列</h2>
        {tasks.length === 0 ? (
          <p className="models-page__queue-empty">暂无下载任务</p>
        ) : (
          <div className="models-page__task-list">
            {tasks.map((task) => {
              const fp =
                task.status === 'downloading' && fileProgress?.target === task.target
                  ? fileProgress
                  : null;
              const showProgress =
                task.status === 'downloading' || task.status === 'preparing';
              return (
                <div key={task.taskId} className="models-page__task">
                  <div className="models-page__task-info">
                    <div className="models-page__task-label">{task.label}</div>
                    <div className="models-page__task-msg">{task.message}</div>
                  </div>
                  <div className="models-page__task-right">
                    <span
                      className={`models-page__task-status models-page__task-status--${task.status}`}
                    >
                      {taskStatusLabel[task.status] ?? task.status}
                    </span>
                    <span className="models-page__task-progress">
                      {task.progressCurrent} / {task.progressTotal}
                    </span>
                  </div>
                  {showProgress && (
                    <div className="models-page__file-progress">
                      <div className="models-page__file-progress-bar">
                        <div
                          className={`models-page__file-progress-fill${!fp || fp.percent === 0 ? ' models-page__file-progress-fill--indeterminate' : ''}`}
                          style={fp && fp.percent > 0 ? { width: `${fp.percent}%` } : undefined}
                        />
                      </div>
                      <div className="models-page__file-progress-meta">
                        {fp ? (
                          <>
                            <span className="models-page__file-progress-desc">
                              {fp.desc.split('/').pop()}
                            </span>
                            <span className="models-page__file-progress-info">
                              {fp.percent}%
                              {fp.downloaded && fp.total && ` · ${fp.downloaded} / ${fp.total}`}
                            </span>
                          </>
                        ) : (
                          <span className="models-page__file-progress-desc">
                            正在下载，详细进度请查看控制台
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
