import { useId, useState } from 'react';
import { SettingCard } from '../../components/settings/SettingCard/SettingCard';
import { SettingRow } from '../../components/settings/SettingRow/SettingRow';
import { ToggleSwitch } from '../../components/settings/ToggleSwitch/ToggleSwitch';
import type { LabConfig, LlmProvider } from '../../services/config/labConfig';
import { fetchModelList } from '../../services/config/bridge';

interface ModelAIPanelProps {
  labConfig: LabConfig | null;
  onSaveLabConfig: (config: LabConfig) => void;
}

function ModelInput({
  value,
  onChange,
  models,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  models: string[];
  placeholder?: string;
}) {
  const listId = useId();
  return (
    <>
      <input
        className="proxy-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        placeholder={placeholder ?? '手动输入或从列表选择'}
      />
      {models.length > 0 && (
        <datalist id={listId}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}
    </>
  );
}

function ProviderCard({
  provider,
  index,
  allNames,
  models,
  isSyncing,
  onChange,
  onRemove,
  onSync,
}: {
  provider: LlmProvider;
  index: number;
  allNames: string[];
  models: string[];
  isSyncing: boolean;
  onChange: (next: LlmProvider) => void;
  onRemove: () => void;
  onSync: () => void;
}) {
  const isDuplicate =
    provider.name.trim() !== '' &&
    allNames.filter((n) => n === provider.name.trim()).length > 1;

  return (
    <>
      <div className="provider-header">
        <div className="provider-name-wrap">
          <input
            className={`proxy-input provider-name-input${isDuplicate ? ' provider-name-input--error' : ''}`}
            value={provider.name}
            placeholder={`提供商 ${index + 1}`}
            onChange={(e) => onChange({ ...provider, name: e.target.value })}
          />
          {isDuplicate && (
            <span className="provider-name-error">名称重复</span>
          )}
        </div>
        <div className="provider-header-actions">
          <button
            type="button"
            className="provider-sync-btn"
            onClick={onSync}
            disabled={isSyncing || !provider.llm_api_key || !provider.llm_base_url}
            title={
              !provider.llm_api_key || !provider.llm_base_url
                ? '需要填写 Base URL 和 API Key 才能同步'
                : isSyncing
                  ? '正在同步…'
                  : `已缓存 ${models.length} 个模型，点击重新同步`
            }
          >
            {isSyncing ? '同步中…' : models.length > 0 ? `已同步 ${models.length}` : '同步模型'}
          </button>
          <button type="button" className="provider-remove-btn" onClick={onRemove}>
            删除
          </button>
        </div>
      </div>
      <SettingCard>
        <SettingRow name="API Key" icon="🔑">
          <input
            className="proxy-input"
            type="password"
            placeholder="sk-…"
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
    </>
  );
}

export function ModelAIPanel({ labConfig, onSaveLabConfig }: ModelAIPanelProps) {
  const [providers, setProviders] = useState<LlmProvider[]>(
    labConfig?.agent.llm.providers ?? [],
  );
  const [chatModel, setChatModel] = useState(
    labConfig?.agent.chat_model ?? {
      llm_provider: '',
      llm_model_name: '',
      support_vision: false,
      reasoning: true,
    },
  );
  const [visionModel, setVisionModel] = useState(
    labConfig?.agent.vision_model ?? {
      llm_provider: '',
      llm_model_name: '',
      reasoning: true,
    },
  );
  const [modelCache, setModelCache] = useState<Record<string, string[]>>({});
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<Record<string, string>>({});

  if (!labConfig) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>正在加载配置…</p>;
  }

  async function handleSync(provider: LlmProvider) {
    const key = provider.name || String(providers.indexOf(provider));
    setSyncingProvider(key);
    setSyncError((prev) => { const next = { ...prev }; delete next[key]; return next; });
    try {
      const models = await fetchModelList(provider.llm_base_url, provider.llm_api_key);
      setModelCache((prev) => ({ ...prev, [key]: models }));
    } catch (e) {
      setSyncError((prev) => ({ ...prev, [key]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSyncingProvider(null);
    }
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

  const allNames = providers.map((p) => p.name.trim());

  const allModels = Object.values(modelCache).flat();
  const chatProviderModels =
    modelCache[chatModel.llm_provider] ?? allModels;
  const visionProviderModels =
    modelCache[visionModel.llm_provider] ?? allModels;

  return (
    <>
      <div className="group-title group-title--standalone">LLM 提供商</div>

      {providers.map((p, i) => {
        const key = p.name || String(i);
        return (
          <ProviderCard
            key={i}
            provider={p}
            index={i}
            allNames={allNames}
            models={modelCache[key] ?? []}
            isSyncing={syncingProvider === key}
            onChange={(next) => {
              const updated = [...providers];
              updated[i] = next;
              setProviders(updated);
            }}
            onRemove={() => setProviders(providers.filter((_, idx) => idx !== i))}
            onSync={() => handleSync(p)}
          />
        );
      })}

      {Object.entries(syncError).map(([k, msg]) => (
        <p key={k} style={{ color: '#ff6b6b', fontSize: 12, margin: '4px 0 0' }}>
          {k}: {msg}
        </p>
      ))}

      <button
        type="button"
        className="provider-add-btn"
        onClick={() =>
          setProviders([
            ...providers,
            { name: '', llm_api_key: '', llm_base_url: '', api_format: 'chat_completion' },
          ])
        }
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>＋</span>
        新增提供商
      </button>

      <div className="group-title">对话模型</div>
      <SettingCard>
        <SettingRow name="提供商" description="使用哪个 LLM 提供商" icon="🏭">
          <ModelInput
            value={chatModel.llm_provider}
            onChange={(v) => setChatModel({ ...chatModel, llm_provider: v })}
            models={providers.map((p) => p.name).filter(Boolean)}
            placeholder="填写提供商名称"
          />
        </SettingRow>
        <SettingRow name="模型名称" icon="🤖">
          <ModelInput
            value={chatModel.llm_model_name}
            onChange={(v) => setChatModel({ ...chatModel, llm_model_name: v })}
            models={chatProviderModels}
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
          <ModelInput
            value={visionModel.llm_provider}
            onChange={(v) => setVisionModel({ ...visionModel, llm_provider: v })}
            models={providers.map((p) => p.name).filter(Boolean)}
            placeholder="填写提供商名称"
          />
        </SettingRow>
        <SettingRow name="模型名称" icon="🤖">
          <ModelInput
            value={visionModel.llm_model_name}
            onChange={(v) => setVisionModel({ ...visionModel, llm_model_name: v })}
            models={visionProviderModels}
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
    </>
  );
}
