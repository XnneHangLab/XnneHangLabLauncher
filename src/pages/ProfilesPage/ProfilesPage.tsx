import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { SettingCard } from '../../components/settings/SettingCard/SettingCard';
import { SettingRow } from '../../components/settings/SettingRow/SettingRow';
import { ToggleSwitch } from '../../components/settings/ToggleSwitch/ToggleSwitch';
import { BrowsePath } from '../../components/settings/BrowsePath/BrowsePath';
import {
  listProfiles,
  readProfile,
  writeProfile,
  createProfile,
  deleteProfile,
  pickFileForProfile,
} from '../../services/config/profileBridge';
import { readLive2DPresets } from '../../services/config/bridge';
import type { ProfileMeta, ProfileConfig } from '../../services/config/profileConfig';
import '../../styles/settings.css';
import '../../styles/profiles.css';

const KNOWN_PLUGINS: Array<{ id: string; description: string }> = [
  { id: 'pre_tool_preview', description: '工具调用前展示简短预览文本' },
  { id: 'tool_call_integrity', description: '保证工具调用结构完整' },
  { id: 'web_fetch', description: '允许 Agent 抓取网页内容' },
  { id: 'web_search_ddg', description: 'DuckDuckGo 网络搜索' },
  { id: 'web_search_searxng', description: 'SearXNG 网络搜索' },
  { id: 'screen_shot', description: '允许 Agent 调用截图能力' },
  { id: 'diary', description: '读写日记文件' },
  { id: 'memory', description: '长期记忆检索与写入' },
  { id: 'live2d_control', description: '控制 Live2D 模型外观与动作' },
  { id: 'mood_chat', description: '主动发起情绪化对话' },
];

type PluginFieldType = 'text' | 'number' | 'textarea' | 'boolean' | 'json' | 'select';
interface PluginField { key: string; type: PluginFieldType; description?: string; defaultValue?: string | number | boolean; options?: string[]; }

const PLUGIN_CONFIG_FIELDS: Record<string, PluginField[]> = {
  memory: [
    { key: 'base_url', type: 'text', description: 'Memory Bench 服务基础地址', defaultValue: 'http://localhost:12393' },
    { key: 'user_id', type: 'text', description: '记忆读写使用的用户 ID', defaultValue: 'xnne' },
    { key: 'agent_id', type: 'text', description: '记忆读写使用的角色 ID', defaultValue: 'congyin' },
    { key: 'search_limit', type: 'number', description: '每轮注入的最大记忆条数', defaultValue: 10 },
  ],
  mood_chat: [
    { key: 'prompt', type: 'textarea', description: '主动对话时发送给 agent 的提示词', defaultValue: '请根据上下文，主动说些什么。' },
    { key: 'initial_mood', type: 'number', description: '启动后的初始心情分', defaultValue: 80 },
    { key: 'target_mood', type: 'number', description: '心情自然回归的目标分数', defaultValue: 80 },
    { key: 'response_timeout_s', type: 'number', description: '主动发言后等待用户回应的超时时间（秒）', defaultValue: 10 },
    { key: 'interval_excited_s', type: 'number', description: '心情 >= 90 时的主动发言间隔（秒）', defaultValue: 5 },
    { key: 'interval_normal_s', type: 'number', description: '心情 >= 80 时的主动发言间隔（秒）', defaultValue: 30 },
    { key: 'interval_low_s', type: 'number', description: '心情 >= 60 时的主动发言间隔（秒）', defaultValue: 120 },
    { key: 'mood_increase', type: 'number', description: '用户发言后增加的心情分', defaultValue: 5 },
    { key: 'mood_decrease', type: 'number', description: '主动发言后超时未回应时扣除的心情分', defaultValue: 10 },
  ],
  pre_tool_preview: [
    { key: 'preview_max_chars', type: 'number', description: '工具调用前预告的最大字数', defaultValue: 30 },
    { key: 'preview_when_latency_over_ms', type: 'number', description: '预计等待超过该毫秒数时倾向输出预告', defaultValue: 3000 },
    { key: 'allow_skip_on_user_request', type: 'boolean', description: '用户明确要求直接执行时是否允许跳过预告', defaultValue: true },
    { key: 'injection_position', type: 'select', description: '提示词注入位置', defaultValue: 'before_tools', options: ['before_tools', 'after_tools'] },
  ],
  tool_call_integrity: [
    { key: 'injection_position', type: 'select', description: '提示词注入位置', defaultValue: 'before_tools', options: ['before_tools', 'after_tools'] },
  ],
  web_fetch: [
    { key: 'user_agent', type: 'text', description: '抓取网页时使用的 User-Agent 头', defaultValue: 'XnneHangLab-ToolPlugin/1.0' },
    { key: 'respect_robots', type: 'boolean', description: '是否遵守目标站点的 robots.txt', defaultValue: false },
    { key: 'robots_fail_closed', type: 'boolean', description: 'robots.txt 检查失败时是否默认拒绝', defaultValue: false },
    { key: 'use_jina_fallback', type: 'boolean', description: '正文提取效果不佳时是否启用 Jina Reader 回退', defaultValue: false },
    { key: 'jina_api_key', type: 'text', description: 'Jina Reader API Key，未配置时留空', defaultValue: '' },
    { key: 'timeout_s', type: 'number', description: '网页抓取默认超时时间（秒）', defaultValue: 10.0 },
    { key: 'max_chars_default', type: 'number', description: '默认返回的最大正文字符数', defaultValue: 8000 },
  ],
  web_search_ddg: [
    { key: 'user_agent', type: 'text', description: '请求 DuckDuckGo 时使用的 User-Agent 头', defaultValue: 'XnneHangLab-ToolPlugin/1.0' },
    { key: 'timeout_s', type: 'number', description: 'DuckDuckGo 搜索请求超时时间（秒）', defaultValue: 10.0 },
  ],
  web_search_searxng: [
    { key: 'searxng_url', type: 'text', description: 'SearXNG 实例基础 URL，留空时插件不会注册', defaultValue: '' },
    { key: 'user_agent', type: 'text', description: '请求 SearXNG 时使用的 User-Agent 头', defaultValue: 'XnneHangLab-ToolPlugin/1.0' },
    { key: 'timeout_s', type: 'number', description: 'SearXNG 搜索请求超时时间（秒）', defaultValue: 10.0 },
  ],
};

const PLUGIN_CUSTOM_EDITORS = new Set(['live2d_control']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function PluginJsonField({ fileKey, value, onChange }: { fileKey: string; value: unknown; onChange: (v: unknown) => void }) {
  const [raw, setRaw] = useState(() => value !== undefined ? JSON.stringify(value, null, 2) : '');
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setRaw(value !== undefined ? JSON.stringify(value, null, 2) : '');
    setHasError(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);

  function handleChange(text: string) {
    setRaw(text);
    if (!text.trim()) { onChange(undefined); setHasError(false); return; }
    try { onChange(JSON.parse(text)); setHasError(false); }
    catch { setHasError(true); }
  }

  return (
    <textarea
      className={`proxy-input plugin-textarea plugin-json-textarea${hasError ? ' plugin-json-error' : ''}`}
      value={raw}
      onChange={(e) => handleChange(e.target.value)}
      spellCheck={false}
    />
  );
}

// ── Live2D Control structured editor ─────────────────────────────────────────

type AppearancePreset = { key: string; description: string };
type StateClip = { url: string };
type StateConfig = {
  mode: 'random' | 'random_no_repeat';
  clips: StateClip[];
  idle_layer: number;
  speech_layer: number;
  backend_pose_layer: number;
  mouse_attention_layer: number;
};

const DEFAULT_STATE_CONFIG: StateConfig = {
  mode: 'random_no_repeat',
  clips: [],
  idle_layer: 1.0,
  speech_layer: 1.0,
  backend_pose_layer: 1.0,
  mouse_attention_layer: 0.35,
};

const MIXER_LAYERS: Array<[keyof StateConfig & string, string]> = [
  ['idle_layer', '待机层'],
  ['speech_layer', '说话层'],
  ['backend_pose_layer', '后端姿态层'],
  ['mouse_attention_layer', '鼠标注意力层'],
];

const ROLE_COLORS: Record<string, string> = {
  expression: '#4a9eff',
  appearance: '#8b5cf6',
  watermark: '#f59e0b',
  system: '#6b7280',
  test: '#ef4444',
  unknown: '#9ca3af',
};

const ROLE_LABELS: Record<string, string> = {
  expression: '表情',
  appearance: '造型',
  watermark: '水印',
  system: '系统',
  test: '测试',
  unknown: '未分类',
};

interface PresetExpression {
  name: string;
  label: string;
  role: string;
  file: string;
  description?: string;
}

interface PresetMotionAsset {
  name: string;
  group: string;
  index: number;
  file: string;
}

function Live2dControlEditor({ cfg, onPatch, modelName }: {
  cfg: Record<string, unknown>;
  onPatch: (patch: Record<string, unknown>) => void;
  modelName?: string;
}) {
  const [presetExpressions, setPresetExpressions] = useState<PresetExpression[]>([]);
  const [motionAssets, setMotionAssets] = useState<PresetMotionAsset[]>([]);

  const presets = (cfg.appearance_presets as AppearancePreset[] | undefined) ?? [];
  const statesRaw = (cfg.states as Record<string, unknown> | undefined) ?? {};
  const states = {
    listening: (statesRaw.listening as StateConfig | undefined) ?? { ...DEFAULT_STATE_CONFIG },
    speaking: (statesRaw.speaking as StateConfig | undefined) ?? { ...DEFAULT_STATE_CONFIG },
  };

  useEffect(() => {
    if (!modelName) return;
    readLive2DPresets().then((allPresets) => {
      const preset = allPresets.find(p => p.name === modelName);
      if (!preset) return;
      const exprs = (preset as Record<string, unknown>).expressions;
      if (Array.isArray(exprs)) setPresetExpressions(exprs as PresetExpression[]);
      // Motion assets: prefer motionAssets field, fall back to pinned importedMotions
      const assets = (preset as Record<string, unknown>).motionAssets;
      if (Array.isArray(assets) && assets.length > 0) {
        setMotionAssets(assets as PresetMotionAsset[]);
      } else {
        const imported = (preset as Record<string, unknown>).importedMotions;
        if (Array.isArray(imported)) {
          const pinned = imported
            .filter((m: any) => m.pinned)
            .map((m: any) => ({ name: m.name, group: m.group ?? 'imported', index: m.index ?? 0, file: m.fileName }));
          if (pinned.length > 0) setMotionAssets(pinned as PresetMotionAsset[]);
        }
      }
    }).catch(console.error);
  }, [modelName]);

  function setState(state: 'listening' | 'speaking', patch: Partial<StateConfig>) {
    onPatch({ states: { ...statesRaw, [state]: { ...states[state], ...patch } } });
  }
  function toggleClip(state: 'listening' | 'speaking', assetName: string) {
    const current = states[state].clips;
    const exists = current.some(c => c.url === assetName);
    const next = exists
      ? current.filter(c => c.url !== assetName)
      : [...current, { url: assetName }];
    setState(state, { clips: next });
  }

  const expressionsByRole = presetExpressions.reduce<Record<string, PresetExpression[]>>((acc, exp) => {
    const role = exp.role || 'unknown';
    (acc[role] ??= []).push(exp);
    return acc;
  }, {});

  return (
    <div className="l2d-editor">

      {/* Expressions overview from preset */}
      {presetExpressions.length > 0 && (
        <div className="l2d-section">
          <div className="l2d-section-header">
            <span className="l2d-section-title">表情/造型一览</span>
            <span className="l2d-section-desc">来自 live2d_presets.json（只读）</span>
          </div>
          <div className="l2d-exp-groups">
            {Object.entries(expressionsByRole).map(([role, exps]) => (
              <div key={role} className="l2d-exp-group">
                <span className="l2d-exp-group-label" style={{ color: ROLE_COLORS[role] ?? '#9ca3af' }}>
                  {ROLE_LABELS[role] ?? role} ({exps.length})
                </span>
                <div className="l2d-exp-chips">
                  {exps.map(exp => (
                    <span key={exp.name} className="l2d-exp-chip"
                      style={{ borderColor: ROLE_COLORS[role] ?? '#9ca3af' }}
                      title={exp.description || exp.file}>
                      {exp.label || exp.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Motion assets selection for states */}
      {motionAssets.length > 0 && (
        <div className="l2d-section">
          <div className="l2d-section-header">
            <span className="l2d-section-title">动作资产</span>
            <span className="l2d-section-desc">点击分配到 listening/speaking</span>
          </div>
          {(['listening', 'speaking'] as const).map(state => {
            const assignedUrls = new Set(states[state].clips.map(c => c.url));
            return (
              <div key={state} className="l2d-motion-assign">
                <span className="l2d-motion-assign-label">{state}</span>
                <div className="l2d-motion-chips">
                  {motionAssets.map(asset => (
                    <button key={asset.name} type="button"
                      className={`l2d-motion-chip${assignedUrls.has(asset.name) ? ' l2d-motion-chip--active' : ''}`}
                      title={asset.file}
                      onClick={() => toggleClip(state, asset.name)}>
                      {asset.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* State cards with mixer weights */}
      {(['listening', 'speaking'] as const).map(state => (
        <div key={state} className="l2d-state-card">
          <div className="l2d-state-card-header">
            <span className="l2d-state-name">{state}</span>
            <div className="driver-select-wrap">
              {(['random_no_repeat', 'random'] as const).map(m => (
                <button key={m} type="button"
                  className={`driver-option${states[state].mode === m ? ' driver-option--active' : ''}`}
                  onClick={() => setState(state, { mode: m })}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="l2d-state-card-body">
            <div className="l2d-state-section">
              <span className="l2d-state-section-title">
                已分配 clips ({states[state].clips.length})
              </span>
              <div className="l2d-clip-list">
                {states[state].clips.map((c, i) => (
                  <span key={i} className="l2d-clip-tag">
                    {c.url}
                    <button type="button" className="l2d-clip-tag-remove"
                      onClick={() => setState(state, { clips: states[state].clips.filter((_, idx) => idx !== i) })}>×</button>
                  </span>
                ))}
              </div>
            </div>
            <div className="l2d-state-section">
              <span className="l2d-state-section-title">mixer</span>
              <div className="l2d-mixer-compact">
                {MIXER_LAYERS.map(([key, label]) => (
                  <div key={key} className="l2d-mixer-compact-row">
                    <span className="l2d-mixer-label">{label}</span>
                    <input className="proxy-input l2d-mixer-input" type="number" step="0.05" min="0"
                      value={states[state][key] as number}
                      onChange={e => setState(state, { [key]: Number(e.target.value) })} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Legacy appearance_presets (hidden if preset expressions exist) */}
      {presetExpressions.length === 0 && presets.length > 0 && (
        <div className="l2d-section">
          <div className="l2d-section-header">
            <span className="l2d-section-title">appearance_presets (legacy)</span>
          </div>
          <div className="l2d-list">
            {presets.map((p, i) => (
              <div key={i} className="l2d-preset-row">
                <input className="proxy-input l2d-preset-key" placeholder="key" value={p.key}
                  onChange={e => { const next = [...presets]; next[i] = { ...next[i], key: e.target.value }; onPatch({ appearance_presets: next }); }} />
                <span className="l2d-preset-colon">:</span>
                <input className="proxy-input l2d-preset-desc" placeholder="description" value={p.description}
                  onChange={e => { const next = [...presets]; next[i] = { ...next[i], description: e.target.value }; onPatch({ appearance_presets: next }); }} />
                <button type="button" className="l2d-remove-btn"
                  onClick={() => onPatch({ appearance_presets: presets.filter((_, idx) => idx !== i) })}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Profile chip avatar ───────────────────────────────────────────────────────

function ProfileAvatar({ name, absPath }: { name: string; absPath?: string | null }) {
  if (absPath) return <img className="profile-avatar profile-avatar--img" src={convertFileSrc(absPath)} alt={name} />;
  return <div className="profile-avatar">{(name?.[0] ?? '?').toUpperCase()}</div>;
}

// ── Profile editor ────────────────────────────────────────────────────────────

interface ProfileEditorProps {
  file: string;
  config: ProfileConfig;
  onChange: (next: ProfileConfig) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  avatarAbsPath?: string | null;
}

function ProfileEditor({ file, config, onChange, onSave, onDelete, saving, avatarAbsPath }: ProfileEditorProps) {
  const profile = config.profile ?? { description: '' };
  const character = config.character ?? {};
  const ttsPreprocessor = character.tts_preprocessor ?? {};
  const tts = character.tts ?? {};
  const prompt = config.prompt ?? {};
  const enabledPlugins = config.plugins?.enabled ?? [];

  const [openPlugins, setOpenPlugins] = useState<Set<string>>(new Set);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [presetNames, setPresetNames] = useState<string[]>([]);

  useEffect(() => {
    readLive2DPresets().then(presets => setPresetNames(presets.map(p => p.name))).catch(console.error);
  }, []);

  function toggleOpen(id: string) {
    setOpenPlugins(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function setProfile(patch: Partial<typeof profile>) {
    onChange({ ...config, profile: { ...profile, ...patch } });
  }
  function setCharacter(patch: Partial<typeof character>) {
    onChange({ ...config, character: { ...character, ...patch } });
  }
  function setTtsPreprocessor(patch: Partial<typeof ttsPreprocessor>) {
    onChange({ ...config, character: { ...character, tts_preprocessor: { ...ttsPreprocessor, ...patch } } });
  }
  function setTts(patch: Partial<typeof tts>) {
    onChange({ ...config, character: { ...character, tts: { ...tts, ...patch } } });
  }
  function setPrompt(patch: Partial<typeof prompt>) {
    onChange({ ...config, prompt: { ...prompt, ...patch } });
  }
  function togglePlugin(id: string, on: boolean) {
    const current = enabledPlugins.filter((p) => p !== id);
    const next = on ? [...current, id] : current;
    onChange({ ...config, plugins: { ...(config.plugins ?? {}), enabled: next } });
    if (on && (PLUGIN_CONFIG_FIELDS[id] || PLUGIN_CUSTOM_EDITORS.has(id))) {
      setOpenPlugins(prev => new Set(prev).add(id));
    }
  }
  function getPluginCfg(id: string): Record<string, unknown> {
    const raw = config.plugins?.[id];
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  }
  function setPluginCfg(id: string, patch: Record<string, unknown>) {
    onChange({ ...config, plugins: { ...(config.plugins ?? {}), [id]: { ...getPluginCfg(id), ...patch } } });
  }

  async function browseAvatar() {
    const rel = await pickFileForProfile('选择头像', 'static/avatars');
    if (rel !== null) setCharacter({ avatar: rel.split('/').pop() ?? rel });
  }
  async function browsePersona() {
    const rel = await pickFileForProfile('选择人设文件', 'prompts');
    if (rel !== null) setPrompt({ persona: rel });
  }
  async function browseFormat() {
    const rel = await pickFileForProfile('选择格式文件', 'prompts');
    if (rel !== null) setPrompt({ format: rel });
  }

  const unknownPlugins = enabledPlugins.filter(p => !KNOWN_PLUGINS.find(k => k.id === p));
  const identityInitial = (character.character_name || file)[0]?.toUpperCase() ?? '?';

  return (
    <div className="profiles-editor settings-shell">
      <div className="settings-wrap">

        {/* ── Identity card ── */}
        <div className="profile-identity-card">
          <div className="profile-identity-avatar-col">
            {avatarAbsPath
              ? <img className="profile-identity-avatar profile-avatar--img" src={convertFileSrc(avatarAbsPath)} alt={identityInitial} />
              : <div className="profile-identity-avatar">{identityInitial}</div>
            }
            <button type="button" className="profile-avatar-browse-btn" title="更换头像" onClick={browseAvatar}>…</button>
          </div>
          <div className="profile-identity-fields">
            <div className="profile-id-group profile-id-group--full">
              <span className="profile-id-label">character_name <em>对话气泡展示名</em></span>
              <input className="profile-id-input profile-id-input--name" placeholder="（展示名）"
                value={character.character_name ?? ''} onChange={e => setCharacter({ character_name: e.target.value })} />
            </div>
            <div className="profile-id-group profile-id-group--full">
              <span className="profile-id-label">description</span>
              <input className="profile-id-input profile-id-input--dim" placeholder="（备注）"
                value={profile.description} onChange={e => setProfile({ description: e.target.value })} />
            </div>
          </div>
          <span className="profile-file-badge profile-file-badge--corner">{file}.toml</span>
        </div>

        {/* ── Character visual ── */}
        <div className="group-title">角色外观</div>
        <SettingCard>
          <SettingRow name="live2d_model_name" description="Live2D 模型预设">
            <select className="proxy-input" value={character.live2d_model_name ?? ''}
              onChange={e => setCharacter({ live2d_model_name: e.target.value })}>
              <option value="">（未选择）</option>
              {presetNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </SettingRow>
          <SettingRow name="avatar" description="static/avatars/ 下的文件名">
            <BrowsePath value={character.avatar ?? ''} onChange={v => setCharacter({ avatar: v })} onBrowse={browseAvatar} />
          </SettingRow>
          <SettingRow name="human_name" description="对话中对用户的称呼">
            <input className="proxy-input" value={character.human_name ?? ''}
              onChange={e => setCharacter({ human_name: e.target.value })} />
          </SettingRow>
          <SettingRow name="default_expression_emotion" description="默认情绪标签">
            <input className="proxy-input" value={character.default_expression_emotion ?? ''}
              onChange={e => setCharacter({ default_expression_emotion: e.target.value })} />
          </SettingRow>
        </SettingCard>

        {/* ── TTS / Voice ── */}
        <div className="group-title">语音</div>
        <SettingCard>
          <SettingRow name="character_name" description="voices/ 下的子目录名">
            <input className="proxy-input" value={tts.character_name ?? ''}
              onChange={e => setTts({ character_name: e.target.value })} />
          </SettingRow>
          <SettingRow name="预处理" description="点击开启对应文本过滤">
            <div className="tts-flags">
              {([
                ['remove_special_char', '特殊字符'],
                ['ignore_brackets', '方括号 []'],
                ['ignore_parentheses', '圆括号 ()'],
                ['ignore_asterisks', '星号 *'],
                ['ignore_angle_brackets', '尖括号 <>'],
              ] as const).map(([key, label]) => (
                <button key={key} type="button"
                  className={`tts-flag${ttsPreprocessor[key] ? ' tts-flag--on' : ''}`}
                  onClick={() => setTtsPreprocessor({ [key]: !ttsPreprocessor[key] })}>
                  {label}
                </button>
              ))}
            </div>
          </SettingRow>
        </SettingCard>

        {/* ── Prompt ── */}
        <div className="group-title">提示词</div>
        <SettingCard>
          <SettingRow name="persona" description="人设 prompt 路径">
            <BrowsePath value={prompt.persona ?? ''} onChange={v => setPrompt({ persona: v })} onBrowse={browsePersona} wide />
          </SettingRow>
          <SettingRow name="format" description="情绪 / 格式 prompt 路径">
            <BrowsePath value={prompt.format ?? ''} onChange={v => setPrompt({ format: v })} onBrowse={browseFormat} wide />
          </SettingRow>
          <SettingRow name="show_control_tags">
            <ToggleSwitch label="show_control_tags" checked={prompt.show_control_tags ?? false}
              onChange={v => setPrompt({ show_control_tags: v })} />
          </SettingRow>
        </SettingCard>

        {/* ── Plugins ── */}
        <div className="group-title">插件</div>
        <div className="plugin-list">
          {KNOWN_PLUGINS.map(({ id, description }) => {
            const isOn = enabledPlugins.includes(id);
            const fields = PLUGIN_CONFIG_FIELDS[id];
            const isOpen = openPlugins.has(id);
            const cfg = getPluginCfg(id);
            const hasConfig = fields || PLUGIN_CUSTOM_EDITORS.has(id);
            return (
              <div key={id} className={`plugin-item${isOn ? ' plugin-item--on' : ''}${isOpen ? ' plugin-item--open' : ''}`}>
                <div className="plugin-item-header">
                  <div className="plugin-item-info">
                    <span className="plugin-item-name">{id}</span>
                    <span className="plugin-item-desc">{description}</span>
                  </div>
                  <div className="plugin-item-controls">
                    <ToggleSwitch label={id} checked={isOn} onChange={(on) => togglePlugin(id, on)} />
                    {hasConfig && (
                      <button type="button"
                        className={`plugin-expand-btn${isOpen ? ' plugin-expand-btn--open' : ''}`}
                        onClick={() => toggleOpen(id)}>›</button>
                    )}
                  </div>
                </div>
                {isOpen && hasConfig && (
                  <div className="plugin-item-body">
                    {id === 'live2d_control' ? (
                      <Live2dControlEditor cfg={cfg} onPatch={(patch) => setPluginCfg(id, patch)} modelName={character.live2d_model_name} />
                    ) : fields ? fields.map(f => {
                      const val = cfg[f.key];
                      const effective = val !== undefined ? val : f.defaultValue;
                      return (
                        <div key={f.key} className={`plugin-field-row${f.type === 'json' ? ' plugin-field-row--json' : ''}`}>
                          <div className="plugin-field-meta">
                            <span className="plugin-field-key">{f.key}</span>
                            {f.description && <span className="plugin-field-desc">{f.description}</span>}
                          </div>
                          {f.type === 'json' ? (
                            <PluginJsonField fileKey={`${file}:${id}:${f.key}`} value={val}
                              onChange={(v) => setPluginCfg(id, { [f.key]: v })} />
                          ) : f.type === 'textarea' ? (
                            <textarea className="proxy-input plugin-textarea"
                              value={(effective as string) ?? ''}
                              onChange={(e) => setPluginCfg(id, { [f.key]: e.target.value })} />
                          ) : f.type === 'boolean' ? (
                            <ToggleSwitch label={f.key} checked={(effective as boolean) ?? false}
                              onChange={(v) => setPluginCfg(id, { [f.key]: v })} />
                          ) : f.type === 'select' ? (
                            <select className="proxy-input"
                              value={(effective as string) ?? ''}
                              onChange={(e) => setPluginCfg(id, { [f.key]: e.target.value })}>
                              {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input className="proxy-input" type={f.type}
                              value={(effective as string | number) ?? ''}
                              onChange={(e) => setPluginCfg(id, { [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })} />
                          )}
                        </div>
                      );
                    }) : null}
                  </div>
                )}
              </div>
            );
          })}
          {unknownPlugins.length > 0 && (
            <div className="plugin-item">
              <div className="plugin-item-header">
                <div className="plugin-item-info">
                  <span className="plugin-item-name">其他已启用插件</span>
                  <span className="plugin-item-desc">{unknownPlugins.join(', ')}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Advanced (collapsible) ── */}
        <button type="button" className="profile-advanced-toggle" onClick={() => setShowAdvanced(v => !v)}>
          高级 {showAdvanced ? '▴' : '▾'}
        </button>
        {showAdvanced && (
          <SettingCard>
            <SettingRow name="conf_name" description="Live2D 配置文件名">
              <input className="proxy-input" value={character.conf_name ?? ''}
                onChange={e => setCharacter({ conf_name: e.target.value })} />
            </SettingRow>
            <SettingRow name="conf_uid" description="Live2D 配置 UID">
              <input className="proxy-input" value={character.conf_uid ?? ''}
                onChange={e => setCharacter({ conf_uid: e.target.value })} />
            </SettingRow>
          </SettingCard>
        )}

        <div className="settings-save-row">
          <button type="button" className="profile-delete-btn" onClick={onDelete}>删除</button>
          <button type="button" className="settings-save-button" onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
        <div className="footer-space" />
      </div>
    </div>
  );
}

// ── Profiles page ─────────────────────────────────────────────────────────────

export function ProfilesPage() {
  const [metas, setMetas] = useState<ProfileMeta[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeConfig, setActiveConfig] = useState<ProfileConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const list = await listProfiles();
        setMetas(list);
        if (list.length > 0) {
          const cfg = await readProfile(list[0].file);
          setSelectedFile(list[0].file);
          setActiveConfig(cfg);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  async function reload() {
    try {
      const list = await listProfiles();
      setMetas(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSelect(file: string) {
    try {
      const cfg = await readProfile(file);
      setSelectedFile(file);
      setActiveConfig(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSave() {
    if (!selectedFile || !activeConfig) return;
    setSaving(true);
    try {
      await writeProfile(selectedFile, activeConfig);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedFile) return;
    if (!confirm(`确认删除 ${selectedFile}.toml？此操作不可撤销。`)) return;
    try {
      await deleteProfile(selectedFile);
      setSelectedFile(null);
      setActiveConfig(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      await createProfile(name);
      setNewName('');
      setShowNewInput(false);
      await reload();
      await handleSelect(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const selectedMeta = metas.find(m => m.file === selectedFile);

  return (
    <div className="profiles-page">
      <div className="profiles-topbar">
        <div className="profiles-list">
          {metas.map((m) => (
            <button key={m.file} type="button"
              className={`profile-chip${selectedFile === m.file ? ' profile-chip--active' : ''}`}
              onClick={() => handleSelect(m.file)}>
              <ProfileAvatar name={m.character_name || m.file} absPath={m.avatar_abs_path} />
              <div className="profile-chip__text">
                <span className="profile-chip__name">{m.character_name || m.file}</span>
                <span className="profile-chip__file">{m.file}</span>
              </div>
            </button>
          ))}

          {showNewInput ? (
            <div className="profile-new-inline">
              <input className="profile-new-input" placeholder="文件名（如 mychar）"
                value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                  if (e.key === 'Escape') { setShowNewInput(false); setNewName(''); }
                }}
                autoFocus />
              <button type="button" className="profile-new-confirm" onClick={handleCreate}>创建</button>
              <button type="button" className="profile-new-cancel"
                onClick={() => { setShowNewInput(false); setNewName(''); }}>取消</button>
            </div>
          ) : (
            <button type="button" className="profile-add-btn" onClick={() => setShowNewInput(true)}>＋</button>
          )}
        </div>
        {error && <span className="profile-error">{error}</span>}
      </div>

      {activeConfig && selectedFile ? (
        <ProfileEditor
          file={selectedFile}
          config={activeConfig}
          onChange={setActiveConfig}
          onSave={handleSave}
          onDelete={handleDelete}
          saving={saving}
          avatarAbsPath={selectedMeta?.avatar_abs_path ?? null}
        />
      ) : (
        <div className="profiles-empty">
          <p>选择上方角色卡片开始编辑</p>
        </div>
      )}
    </div>
  );
}
