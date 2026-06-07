import { useEffect, useState } from 'react';
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
import { listProfiles } from '../../services/config/profileBridge';
import type { ProfileMeta } from '../../services/config/profileConfig';
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
  const [profileMetas, setProfileMetas] = useState<ProfileMeta[]>([]);

  useEffect(() => {
    listProfiles().then(setProfileMetas).catch(() => {});
  }, []);

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
                  <SettingRow name="启动角色" description="后端启动时加载的角色配置，切换后需重启后端生效">
                    <select
                      className="proxy-input"
                      value={labConfig.agent.memory_agent_profile}
                      onChange={(e) => onSaveLabConfig({ ...labConfig, agent: { ...labConfig.agent, memory_agent_profile: e.target.value } })}
                    >
                      {profileMetas.map((m) => (
                        <option key={m.file} value={`profiles/${m.file}.toml`}>
                          {m.character_name || m.file}
                        </option>
                      ))}
                    </select>
                  </SettingRow>
                  <SettingRow name="TTS 引擎" description="语音合成后端，关闭则禁用 TTS">
                    <div className="driver-select-wrap">
                      {(['none', 'gsv_lite', 'genie_tts', 'qwen_tts'] as const).map((p) => (
                        <button key={p} type="button"
                          className={`driver-option${(labConfig.agent.tts?.provider ?? 'genie_tts') === p ? ' driver-option--active' : ''}`}
                          onClick={() => onSaveLabConfig({ ...labConfig, agent: { ...labConfig.agent, tts: { ...labConfig.agent.tts, provider: p } } })}>
                          {p === 'none' ? '关闭' : p === 'gsv_lite' ? 'GSV-Lite' : p === 'genie_tts' ? 'Genie' : 'Qwen'}
                        </button>
                      ))}
                    </div>
                  </SettingRow>
                  <SettingRow name="ASR 引擎" description="语音识别后端，关闭则仅支持文字输入">
                    <div className="driver-select-wrap">
                      {(['none', 'sherpa', 'qwen'] as const).map((p) => (
                        <button key={p} type="button"
                          className={`driver-option${(labConfig.asr?.asr_model_provider ?? 'sherpa') === p ? ' driver-option--active' : ''}`}
                          onClick={() => onSaveLabConfig({ ...labConfig, asr: { ...labConfig.asr, asr_model_provider: p } })}>
                          {p === 'none' ? '关闭' : p === 'sherpa' ? 'Sherpa' : 'Qwen'}
                        </button>
                      ))}
                    </div>
                  </SettingRow>
                  <SettingRow name="翻译引擎" description="用户语言与角色语言不同时的翻译方式">
                    <div className="driver-select-wrap">
                      {(['none', 'deeplx', 'llm'] as const).map((p) => (
                        <button key={p} type="button"
                          className={`driver-option${(labConfig.agent?.translate_provider ?? 'none') === p ? ' driver-option--active' : ''}`}
                          onClick={() => onSaveLabConfig({
                            ...labConfig,
                            agent: { ...labConfig.agent, translate_provider: p },
                            package: { ...labConfig.package, llm_translate: p === 'llm' },
                          })}>
                          {p === 'none' ? '关闭' : p === 'deeplx' ? 'DeepLX' : 'LLM 本地'}
                        </button>
                      ))}
                    </div>
                  </SettingRow>
                  {(
                    [
                      ['local_embedding', '本地向量嵌入', 'BGE-M3 GGUF 向量化，用于记忆搜索'],
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
