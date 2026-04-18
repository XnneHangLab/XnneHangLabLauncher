import { useState } from 'react';
import { SettingCard } from '../../components/settings/SettingCard/SettingCard';
import { SettingRow } from '../../components/settings/SettingRow/SettingRow';
import { ToggleSwitch } from '../../components/settings/ToggleSwitch/ToggleSwitch';
import type { LabConfig, LlmProvider } from '../../services/config/labConfig';
import '../../styles/settings.css';

interface ModelAIPageProps {
  labConfig: LabConfig | null;
  onSaveLabConfig: (config: LabConfig) => void;
}

function ProviderCard({
  provider,
  onChange,
}: {
  provider: LlmProvider;
  onChange: (next: LlmProvider) => void;
}) {
  return (
    <SettingCard>
      <SettingRow name="名称" icon="🏷">
        <input
          className="proxy-input"
          value={provider.name}
          onChange={(e) => onChange({ ...provider, name: e.target.value })}
        />
      </SettingRow>
      <SettingRow name="API Key" icon="🔑">
        <input
          className="proxy-input"
          type="password"
          placeholder="留空则不更改"
          value={provider.llm_api_key}
          onChange={(e) => onChange({ ...provider, llm_api_key: e.target.value })}
        />
      </SettingRow>
      <SettingRow name="Base URL" icon="🌐">
        <input
          className="proxy-input"
          value={provider.llm_base_url}
          onChange={(e) => onChange({ ...provider, llm_base_url: e.target.value })}
        />
      </SettingRow>
      <SettingRow name="API 格式" icon="📐">
        <input
          className="proxy-input"
          value={provider.api_format}
          onChange={(e) => onChange({ ...provider, api_format: e.target.value })}
        />
      </SettingRow>
    </SettingCard>
  );
}

export function ModelAIPage({ labConfig, onSaveLabConfig }: ModelAIPageProps) {
  const [providers, setProviders] = useState<LlmProvider[]>(
    labConfig?.agent.llm.providers ?? [],
  );
  const [chatModel, setChatModel] = useState(
    labConfig?.agent.chat_model ?? { llm_provider: '', llm_model_name: '', support_vision: false, reasoning: true },
  );
  const [visionModel, setVisionModel] = useState(
    labConfig?.agent.vision_model ?? { llm_provider: '', llm_model_name: '', reasoning: true },
  );

  if (!labConfig) {
    return (
      <div className="settings-shell">
        <div className="settings-wrap">
          <div className="group-title group-title--standalone">模型与 AI</div>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>正在加载配置…</p>
        </div>
      </div>
    );
  }

  function handleSave() {
    if (!labConfig) return;
    onSaveLabConfig({
      ...labConfig,
      agent: {
        ...labConfig.agent,
        llm: { providers },
        chat_model: chatModel,
        vision_model: visionModel,
      },
    });
  }

  return (
    <div className="settings-shell">
      <div className="settings-wrap">
        <div className="group-title group-title--standalone">LLM 提供商</div>

        {providers.map((p, i) => (
          <div key={i}>
            <div className="group-title">{p.name || `提供商 ${i + 1}`}</div>
            <ProviderCard
              provider={p}
              onChange={(next) => {
                const updated = [...providers];
                updated[i] = next;
                setProviders(updated);
              }}
            />
          </div>
        ))}

        <div className="group-title">对话模型</div>
        <SettingCard>
          <SettingRow name="提供商" description="使用哪个 LLM 提供商" icon="🏭">
            <input
              className="proxy-input"
              value={chatModel.llm_provider}
              onChange={(e) => setChatModel({ ...chatModel, llm_provider: e.target.value })}
            />
          </SettingRow>
          <SettingRow name="模型名称" icon="🤖">
            <input
              className="proxy-input"
              value={chatModel.llm_model_name}
              onChange={(e) => setChatModel({ ...chatModel, llm_model_name: e.target.value })}
            />
          </SettingRow>
          <SettingRow name="支持视觉" description="模型是否支持图像输入" icon="👁">
            <ToggleSwitch
              label="支持视觉"
              checked={chatModel.support_vision}
              onChange={(next) => setChatModel({ ...chatModel, support_vision: next })}
            />
          </SettingRow>
          <SettingRow name="推理模式" description="启用 thinking / reasoning 模式" icon="🧠">
            <ToggleSwitch
              label="推理模式"
              checked={chatModel.reasoning}
              onChange={(next) => setChatModel({ ...chatModel, reasoning: next })}
            />
          </SettingRow>
        </SettingCard>

        <div className="group-title">视觉模型</div>
        <SettingCard>
          <SettingRow name="提供商" icon="🏭">
            <input
              className="proxy-input"
              value={visionModel.llm_provider}
              onChange={(e) => setVisionModel({ ...visionModel, llm_provider: e.target.value })}
            />
          </SettingRow>
          <SettingRow name="模型名称" icon="🤖">
            <input
              className="proxy-input"
              value={visionModel.llm_model_name}
              onChange={(e) => setVisionModel({ ...visionModel, llm_model_name: e.target.value })}
            />
          </SettingRow>
          <SettingRow name="推理模式" icon="🧠">
            <ToggleSwitch
              label="推理模式"
              checked={visionModel.reasoning}
              onChange={(next) => setVisionModel({ ...visionModel, reasoning: next })}
            />
          </SettingRow>
        </SettingCard>

        <div className="settings-save-row">
          <button type="button" className="settings-save-button" onClick={handleSave}>
            保存
          </button>
        </div>

        <div className="footer-space" />
      </div>
    </div>
  );
}
