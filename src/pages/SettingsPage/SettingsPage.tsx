import { useState } from 'react';
import { SettingCard } from '../../components/settings/SettingCard/SettingCard';
import { SettingRow } from '../../components/settings/SettingRow/SettingRow';
import { SettingsTabs } from '../../components/settings/SettingsTabs/SettingsTabs';
import { ToggleSwitch } from '../../components/settings/ToggleSwitch/ToggleSwitch';
import {
  aboutInfo,
  settingsTabs,
  type SettingsTabId,
} from '../../data/settings';
import type {
  EnvironmentProbe,
  RuntimeDriver,
} from '../../services/runtime/runtime';
import type { LabConfig } from '../../services/config/labConfig';
import { ServiceConfigPanel } from '../ServiceConfigPage/ServiceConfigPage';
import { ModelAIPanel } from '../ModelAIPage/ModelAIPage';
import { SpeechPanel } from '../SpeechPage/SpeechPage';
import '../../styles/settings.css';

interface SettingsPageProps {
  workspaceRoot: string;
  workspaceLocked: boolean;
  environmentProbe: EnvironmentProbe | null;
  onChooseWorkspaceRoot: () => void;
  onUseRepoWorkspaceRoot: () => void;
  runtimeDriver: RuntimeDriver;
  pythonExePath: string;
  onChoosePythonExe: () => Promise<string | null>;
  onSave: (driver: RuntimeDriver, pythonExePath: string) => void;
  labConfig: LabConfig | null;
  onSaveLabConfig: (config: LabConfig) => void;
}

export function SettingsPage({
  workspaceRoot,
  workspaceLocked,
  environmentProbe,
  onChooseWorkspaceRoot,
  onUseRepoWorkspaceRoot,
  runtimeDriver,
  pythonExePath,
  onChoosePythonExe,
  onSave,
  labConfig,
  onSaveLabConfig,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('launch');
  const [localDriver, setLocalDriver] = useState<RuntimeDriver>(runtimeDriver);
  const [localPythonExePath, setLocalPythonExePath] = useState(pythonExePath);

  const environmentLabel = environmentProbe
    ? formatEnvironmentStatus(environmentProbe.status)
    : '正在检测';

  const envReady =
    environmentProbe?.status === 'torch-cpu-ready' ||
    environmentProbe?.status === 'torch-gpu-ready';

  const driverDisplayLabel =
    localDriver === 'conda' ? 'conda / 直接 Python' : 'uv';

  async function handleBrowsePythonExe() {
    const picked = await onChoosePythonExe();
    if (picked) {
      setLocalPythonExePath(picked);
    }
  }

  function renderTabContent() {
    switch (activeTab) {
      case 'launch':
        return (
          <div id="settings-panel-launch" role="tabpanel" aria-labelledby="settings-tab-launch">
            <div className="group-title group-title--standalone">运行环境</div>

            <div className="env-info-card">
              <div className="env-info-row">
                <span className="env-info-label">环境状态</span>
                <span className={`env-info-badge ${envReady ? 'env-info-badge--ready' : 'env-info-badge--warn'}`}>
                  {environmentLabel}
                </span>
              </div>
              {environmentProbe?.message ? (
                <div className="env-info-row">
                  <span className="env-info-label">详情</span>
                  <span className="env-info-value">{environmentProbe.message}</span>
                </div>
              ) : null}
              <div className="env-info-row">
                <span className="env-info-label">运行驱动</span>
                <span className="env-info-value env-info-mono">{driverDisplayLabel}</span>
              </div>
            </div>

            <div className="group-title">环境配置</div>

            <SettingCard>
              <SettingRow
                name="根目录"
                description={workspaceLocked ? '有任务进行中，暂时锁定' : '模型等资源路径均相对此目录'}
                icon="📂"
              >
                <div className="workspace-actions">
                  <input
                    className="proxy-input workspace-input"
                    aria-label="工作目录路径"
                    value={workspaceRoot}
                    disabled
                    readOnly
                  />
                  <button
                    type="button"
                    className="workspace-button"
                    onClick={onChooseWorkspaceRoot}
                    disabled={workspaceLocked}
                  >
                    更改目录
                  </button>
                  <button
                    type="button"
                    className="workspace-button workspace-button--secondary"
                    onClick={onUseRepoWorkspaceRoot}
                    disabled={workspaceLocked}
                  >
                    重置为项目目录
                  </button>
                </div>
              </SettingRow>

              <SettingRow
                name="Python 运行方式"
                description="uv 为推荐方式；conda 可指定自有环境"
                icon="🐍"
              >
                <div className="driver-select-wrap">
                  <button
                    type="button"
                    className={`driver-option ${localDriver === 'uv' ? 'driver-option--active' : ''}`}
                    onClick={() => setLocalDriver('uv')}
                  >
                    uv
                  </button>
                  <button
                    type="button"
                    className={`driver-option ${localDriver === 'conda' ? 'driver-option--active' : ''}`}
                    onClick={() => setLocalDriver('conda')}
                  >
                    conda
                  </button>
                </div>
              </SettingRow>

              {localDriver === 'conda' ? (
                <SettingRow
                  name="Python 可执行文件"
                  description="指定 conda 环境中的 python 或 python.exe 路径"
                  icon="🐍"
                >
                  <div className="workspace-actions">
                    <input
                      className="proxy-input workspace-input"
                      aria-label="Python 可执行文件路径"
                      value={localPythonExePath}
                      onChange={(event) => setLocalPythonExePath(event.target.value)}
                      placeholder="例：/home/user/miniconda3/envs/tts/bin/python"
                    />
                    <button
                      type="button"
                      className="workspace-button"
                      onClick={handleBrowsePythonExe}
                    >
                      浏览
                    </button>
                  </div>
                </SettingRow>
              ) : null}
            </SettingCard>

            <div className="settings-save-row">
              <button
                type="button"
                className="settings-save-button"
                onClick={() => onSave(localDriver, localPythonExePath)}
              >
                保存并重新检测
              </button>
            </div>

            {labConfig ? (
              <>
                <div className="group-title">功能开关</div>
                <SettingCard>
                  {(
                    [
                      ['sherpa_asr', 'Sherpa ASR', '本地离线语音识别（Sherpa-ONNX Paraformer）'],
                      ['qwen_asr', 'Qwen ASR', '通义千问本地语音识别（OpenVINO）'],
                      ['llm_translate', 'LLM 翻译', '使用本地 GGUF 模型执行翻译'],
                      ['local_embedding', '本地向量嵌入', 'BGE-M3 GGUF 向量化，用于记忆搜索'],
                      ['gsv_lite', 'GSV-Lite TTS', 'GPT-SoVITS Lite 语音合成'],
                      ['genie_tts', 'Genie TTS', 'Genie TTS ONNX 推理引擎'],
                      ['qwen_tts', 'Qwen TTS', '通义千问语音合成（0.6B / 1.7B）'],
                      ['memory_bench', 'Memory Bench', '记忆压测工具'],
                    ] as Array<[keyof LabConfig['package'], string, string]>
                  ).map(([key, name, description]) => (
                    <SettingRow key={key} name={name} description={description}>
                      <ToggleSwitch
                        label={name}
                        checked={labConfig.package[key]}
                        onChange={(next) => {
                          onSaveLabConfig({
                            ...labConfig,
                            package: { ...labConfig.package, [key]: next },
                          });
                        }}
                      />
                    </SettingRow>
                  ))}
                </SettingCard>
              </>
            ) : null}

            <div className="footer-space" />
          </div>
        );

      case 'server':
        return (
          <div id="settings-panel-server" role="tabpanel" aria-labelledby="settings-tab-server">
            <ServiceConfigPanel labConfig={labConfig} onSaveLabConfig={onSaveLabConfig} />
          </div>
        );

      case 'model-ai':
        return (
          <div id="settings-panel-model-ai" role="tabpanel" aria-labelledby="settings-tab-model-ai">
            <ModelAIPanel labConfig={labConfig} onSaveLabConfig={onSaveLabConfig} />
          </div>
        );

      case 'speech':
        return (
          <div id="settings-panel-speech" role="tabpanel" aria-labelledby="settings-tab-speech">
            <SpeechPanel labConfig={labConfig} onSaveLabConfig={onSaveLabConfig} />
          </div>
        );

      case 'about':
        return (
          <div id="settings-panel-about" role="tabpanel" aria-labelledby="settings-tab-about">
            <div className="about-card">
              {aboutInfo.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
        );
    }
  }

  return (
    <div className="settings-shell">
      <SettingsTabs
        items={settingsTabs}
        activeTab={activeTab}
        onSelect={setActiveTab}
      />
      <div className="settings-wrap">
        {renderTabContent()}
      </div>
    </div>
  );
}

function formatEnvironmentStatus(status: EnvironmentProbe['status']) {
  switch (status) {
    case 'workspace-invalid':
      return '工作目录无效';
    case 'uv-unavailable':
      return 'uv 不可用';
    case 'python-unavailable':
      return 'Python 不可用';
    case 'torch-unavailable':
      return 'torch 不可用';
    case 'torch-cpu-ready':
      return 'CPU 就绪';
    case 'torch-gpu-ready':
      return 'GPU 就绪';
    default:
      return status;
  }
}
