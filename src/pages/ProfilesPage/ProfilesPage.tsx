import { useEffect, useRef, useState } from 'react';
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
import { readLabConfig, readLive2DPresets, writeLabConfig } from '../../services/config/bridge';
import { readVoiceConfig, writeVoiceEmotions, scanVoiceEmotions } from '../../services/config/voiceBridge';
import type { VoiceEmotion } from '../../services/config/voiceConfig';
import type { LabConfig } from '../../services/config/labConfig';
import type { ProfileMeta, ProfileConfig } from '../../services/config/profileConfig';
import '../../styles/settings.css';
import '../../styles/profiles.css';

const KNOWN_PLUGINS: Array<{ id: string; description: string; requires?: string[]; conflicts?: string[] }> = [
  { id: 'pre_tool_preview', description: '工具调用前展示简短预览文本' },
  { id: 'tool_call_integrity', description: '保证工具调用结构完整' },
  { id: 'web_fetch', description: '允许 Agent 抓取网页内容' },
  { id: 'web_search_ddg', description: 'DuckDuckGo 网络搜索', conflicts: ['web_search_searxng'] },
  { id: 'web_search_searxng', description: 'SearXNG 网络搜索', conflicts: ['web_search_ddg'] },
  { id: 'screen_shot', description: '允许 Agent 调用截图能力' },
  { id: 'diary', description: '读写日记文件' },
  { id: 'memory', description: '长期记忆检索与写入' },
  { id: 'live2d_control', description: '控制 Live2D 模型外观与动作' },
  { id: 'mood_chat', description: '主动发起情绪化对话', requires: ['visual_observer'] },
  { id: 'visual_observer', description: '游戏陪伴模式下的后台视觉轮询与摘要' },
];

const PLUGIN_MAP = new Map(KNOWN_PLUGINS.map(p => [p.id, p]));

/** 返回启用 id 所需的完整前置链（拓扑顺序，前置在前，id 本身在最后） */
function resolveEnableChain(id: string): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  function visit(pid: string) {
    if (visited.has(pid)) return;
    visited.add(pid);
    for (const req of PLUGIN_MAP.get(pid)?.requires ?? []) visit(req);
    result.push(pid);
  }
  visit(id);
  return result;
}

/** 返回当前已启用中、依赖 id 的插件列表 */
function findDependents(id: string, enabled: string[]): string[] {
  return KNOWN_PLUGINS.filter(p => p.requires?.includes(id) && enabled.includes(p.id)).map(p => p.id);
}

/** 返回与 id 冲突、且当前已启用的插件列表 */
function findActiveConflicts(id: string, enabled: string[]): string[] {
  return (PLUGIN_MAP.get(id)?.conflicts ?? []).filter(c => enabled.includes(c));
}

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
    { key: 'game_companion_mode', type: 'boolean', description: '启用游戏陪伴模式', defaultValue: false },
    { key: 'game_mood_decrease', type: 'number', description: '游戏模式下超时扣除的心情分', defaultValue: 2 },
    { key: 'game_interval_s', type: 'number', description: '游戏模式下检查视觉摘要的间隔（秒）', defaultValue: 1 },
    { key: 'game_prompt_suffix', type: 'textarea', description: '游戏模式下追加到 prompt 的后缀', defaultValue: '根据视觉摘要简短评论，不超过两句话。不要提问。' },
    { key: 'game_require_visual_change', type: 'boolean', description: '游戏模式下是否要求有视觉变化才发言', defaultValue: true },
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
  visual_observer: [
    { key: 'poll_interval_s', type: 'number', description: '截图轮询间隔（秒）', defaultValue: 1.0 },
    { key: 'diff_ocr_threshold', type: 'number', description: '累积多少条新 OCR 后触发摘要', defaultValue: 20 },
    { key: 'ocr_max_items', type: 'number', description: '每帧保留面积最大的前 N 条 OCR', defaultValue: 10 },
    { key: 'ocr_min_confidence', type: 'number', description: 'OCR 置信度过滤阈值', defaultValue: 0.6 },
    { key: 'ocr_min_length', type: 'number', description: 'OCR 最短文字长度', defaultValue: 2 },
    { key: 'vision_boost', type: 'boolean', description: '触发摘要时同时发送截图给 VLM（需可用视觉模型）', defaultValue: false },
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
  onSetActive: () => void;
  saving: boolean;
  avatarAbsPath?: string | null;
  activeProfileFile: string | null;
}

function ProfileEditor({ file, config, onChange, onSave, onDelete, onSetActive, saving, avatarAbsPath, activeProfileFile }: ProfileEditorProps) {
  const profile = config.profile ?? { description: '' };
  const character = config.character ?? {};
  const ttsPreprocessor = character.tts_preprocessor ?? {};
  const tts = character.tts ?? {};
  const prompt = config.prompt ?? {};
  const enabledPlugins = config.plugins?.enabled ?? [];

  const [openPlugins, setOpenPlugins] = useState<Set<string>>(new Set);
  const [confirmDisable, setConfirmDisable] = useState<{ id: string; dependents: string[] } | null>(null);
  const [presetNames, setPresetNames] = useState<string[]>([]);
  const [voiceEmotions, setVoiceEmotions] = useState<VoiceEmotion[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voiceAssetDir, setVoiceAssetDir] = useState<string>('');
  const [playingClip, setPlayingClip] = useState<string | null>(null);

  useEffect(() => {
    readLive2DPresets().then(presets => setPresetNames(presets.map(p => p.name))).catch(console.error);
  }, []);

  // Load voice emotions when voice changes
  const currentVoice = tts.voice ?? '';
  useEffect(() => {
    if (!currentVoice) { setVoiceEmotions([]); setVoiceId(null); setVoiceAssetDir(''); return; }
    setVoiceId(currentVoice);
    readVoiceConfig(currentVoice)
      .then(cfg => { setVoiceEmotions(cfg.emotions); setVoiceAssetDir(cfg.assetDir); })
      .catch(() => { setVoiceEmotions([]); setVoiceAssetDir(''); });
  }, [currentVoice]);

  function updateVoiceEmotion(index: number, patch: Partial<VoiceEmotion>) {
    const next = voiceEmotions.map((e, i) => i === index ? { ...e, ...patch } : e);
    setVoiceEmotions(next);
    if (voiceId) void writeVoiceEmotions(voiceId, next);
  }

  async function handleSyncVoiceEmotions() {
    if (!voiceId) return;
    const scanned = await scanVoiceEmotions(voiceId);
    const existing = new Set(voiceEmotions.map(e => e.name));
    const newEmotions = scanned
      .filter(name => !existing.has(name))
      .map(name => ({ name, label: name, description: '', clips: [] }));
    if (newEmotions.length > 0) {
      const merged = [...voiceEmotions, ...newEmotions];
      setVoiceEmotions(merged);
      await writeVoiceEmotions(voiceId, merged);
    }
  }

  function playAudioClip(absPath: string) {
    if (playingClip === absPath) {
      setPlayingClip(null);
      return;
    }
    setPlayingClip(absPath);
    const audio = new Audio(convertFileSrc(absPath));
    audio.onended = () => setPlayingClip(null);
    audio.onerror = () => setPlayingClip(null);
    audio.play().catch(() => setPlayingClip(null));
  }

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
    if (on) {
      const activeConflicts = findActiveConflicts(id, enabledPlugins);
      const chain = resolveEnableChain(id);
      const toAdd = chain.filter(pid => !enabledPlugins.includes(pid));
      const next = [...enabledPlugins.filter(p => !activeConflicts.includes(p)), ...toAdd];
      onChange({ ...config, plugins: { ...(config.plugins ?? {}), enabled: next } });
      toAdd.forEach(pid => {
        if (PLUGIN_CONFIG_FIELDS[pid] || PLUGIN_CUSTOM_EDITORS.has(pid)) {
          setOpenPlugins(prev => new Set(prev).add(pid));
        }
      });
    } else {
      const dependents = findDependents(id, enabledPlugins);
      if (dependents.length > 0) {
        setConfirmDisable({ id, dependents });
        return;
      }
      const next = enabledPlugins.filter(p => p !== id);
      onChange({ ...config, plugins: { ...(config.plugins ?? {}), enabled: next } });
    }
  }

  function forceDisable(id: string, andDependents: boolean) {
    setConfirmDisable(null);
    const toRemove = new Set([id]);
    if (andDependents) findDependents(id, enabledPlugins).forEach(d => toRemove.add(d));
    const next = enabledPlugins.filter(p => !toRemove.has(p));
    onChange({ ...config, plugins: { ...(config.plugins ?? {}), enabled: next } });
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
        </SettingCard>

        {/* ── Location ── */}
        <div className="group-title">位置</div>
        <SettingCard>
          <SettingRow name="城市" description="用于天气查询，输入后从列表选择">
            <LocationPicker
              city={character.location_city ?? ''}
              onSelect={(city, lat, lng) => setCharacter({ location_city: city, location_lat: lat, location_lng: lng })}
            />
          </SettingRow>
        </SettingCard>

        {/* ── TTS / Voice ── */}
        <div className="group-title">语音</div>
        <SettingCard>
          <SettingRow name="character_name" description="TTS 模型目录名（models/<provider>/ 下）">
            <input className="proxy-input" value={tts.character_name ?? ''}
              onChange={e => setTts({ character_name: e.target.value })} />
          </SettingRow>
          <SettingRow name="voice" description="语音情绪配置（config/voices/ 下的文件名，不含 .toml）">
            <input className="proxy-input" value={tts.voice ?? ''}
              onChange={e => setTts({ voice: e.target.value })} />
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

        {/* ── TTS Emotions ── */}
        {voiceEmotions.length > 0 && (
          <>
            <div className="group-title">
              TTS 情绪
              <button type="button" className="l2d-add-btn" style={{ marginLeft: 8 }} onClick={handleSyncVoiceEmotions}>
                同步目录
              </button>
            </div>
            {voiceAssetDir && (
              <div className="profile-chip__file" style={{ padding: '0 2px 6px', opacity: 0.6 }}>
                资源目录: {voiceAssetDir}
              </div>
            )}
            <SettingCard>
              {voiceEmotions.map((emotion, index) => (
                <div key={emotion.name} className="tts-emotion-row">
                  <div className="tts-emotion-fields">
                    <span className="l2d-preset-key" title={`name: ${emotion.name}`}>{emotion.name}</span>
                    <input
                      className="proxy-input"
                      style={{ width: 100 }}
                      value={emotion.label}
                      placeholder={emotion.name}
                      title="label — 用于 [tts:label] 标签"
                      onChange={e => updateVoiceEmotion(index, { label: e.target.value })}
                    />
                    <input
                      className="proxy-input l2d-preset-desc"
                      value={emotion.description}
                      placeholder="说明 — 注入 prompt 引导模型选择"
                      onChange={e => updateVoiceEmotion(index, { description: e.target.value })}
                    />
                  </div>
                  {emotion.clips.length > 0 && (
                    <div className="tts-emotion-clips">
                      {emotion.clips.map(clip => (
                        <button
                          key={clip.absPath}
                          type="button"
                          className={`tts-emotion-play${playingClip === clip.absPath ? ' tts-emotion-play--active' : ''}`}
                          onClick={() => playAudioClip(clip.absPath)}
                          title={clip.fileName}
                        >
                          {playingClip === clip.absPath ? '■' : '▶'} {clip.fileName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </SettingCard>
          </>
        )}

        {/* ── Prompt ── */}
        <div className="group-title">提示词</div>
        <SettingCard>
          <SettingRow name="persona" description="人设 prompt 路径">
            <BrowsePath value={prompt.persona ?? ''} onChange={v => setPrompt({ persona: v })} onBrowse={browsePersona} wide />
          </SettingRow>
          <SettingRow name="format" description="情绪 / 格式 prompt 路径">
            <BrowsePath value={prompt.format ?? ''} onChange={v => setPrompt({ format: v })} onBrowse={browseFormat} wide />
          </SettingRow>
          <SettingRow name="show_control_tags" description="在前端显示 [tts:...][expression:...] 控制标签（调试用）">
            <ToggleSwitch label="show_control_tags" checked={prompt.show_control_tags ?? false}
              onChange={v => setPrompt({ show_control_tags: v })} />
          </SettingRow>
        </SettingCard>

        {/* ── Plugins ── */}
        <div className="group-title">插件</div>
        <div className="plugin-list">
          {KNOWN_PLUGINS.map(({ id, description, requires, conflicts }) => {
            const isOn = enabledPlugins.includes(id);
            const fields = PLUGIN_CONFIG_FIELDS[id];
            const isOpen = openPlugins.has(id);
            const cfg = getPluginCfg(id);
            const hasConfig = fields || PLUGIN_CUSTOM_EDITORS.has(id);
            const unmetDeps = (requires ?? []).filter(r => !enabledPlugins.includes(r));
            const dependents = findDependents(id, enabledPlugins);
            const activeConflicts = findActiveConflicts(id, enabledPlugins);
            const isPendingDisable = confirmDisable?.id === id;
            const hasBadges = (requires && requires.length > 0) || dependents.length > 0 || (conflicts && conflicts.length > 0);
            return (
              <div key={id} className={`plugin-item${isOn ? ' plugin-item--on' : ''}${isOpen ? ' plugin-item--open' : ''}${unmetDeps.length > 0 && isOn ? ' plugin-item--warn' : ''}`}>
                <div className="plugin-item-header">
                  <div className="plugin-item-info">
                    <span className="plugin-item-name">{id}</span>
                    <span className="plugin-item-desc">{description}</span>
                    {hasBadges ? (
                      <div className="plugin-dep-badges">
                        {(requires ?? []).map(r => (
                          <span
                            key={r}
                            className={`plugin-dep-badge plugin-dep-badge--requires${enabledPlugins.includes(r) ? ' plugin-dep-badge--ok' : ' plugin-dep-badge--missing'}`}
                            title={enabledPlugins.includes(r) ? `前置 ${r} 已启用` : `前置 ${r} 未启用，将自动启用`}
                          >
                            ↳ {r}
                          </span>
                        ))}
                        {dependents.map(d => (
                          <span key={d} className="plugin-dep-badge plugin-dep-badge--dependent" title={`${d} 依赖此插件`}>
                            ↑ {d}
                          </span>
                        ))}
                        {(conflicts ?? []).map(c => (
                          <span
                            key={c}
                            className={`plugin-dep-badge plugin-dep-badge--conflict${activeConflicts.includes(c) ? ' plugin-dep-badge--conflict-active' : ''}`}
                            title={`与 ${c} 互斥，同时只能启用一个`}
                          >
                            ✕ {c}
                          </span>
                        ))}
                      </div>
                    ) : null}
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
                {isPendingDisable && (
                  <div className="plugin-dep-confirm">
                    <span className="plugin-dep-confirm-msg">
                      ⚠ {confirmDisable.dependents.join('、')} 依赖此插件
                    </span>
                    <div className="plugin-dep-confirm-actions">
                      <button type="button" className="plugin-dep-btn plugin-dep-btn--danger" onClick={() => forceDisable(id, true)}>
                        同时禁用
                      </button>
                      <button type="button" className="plugin-dep-btn plugin-dep-btn--only" onClick={() => forceDisable(id, false)}>
                        仅禁用此项
                      </button>
                      <button type="button" className="plugin-dep-btn" onClick={() => setConfirmDisable(null)}>
                        取消
                      </button>
                    </div>
                  </div>
                )}
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

        <div className="settings-save-row">
          <button type="button" className="profile-delete-btn" onClick={onDelete}>删除</button>
          {activeProfileFile !== file && (
            <button type="button" className="settings-save-button" onClick={onSetActive}>设为启动角色</button>
          )}
          <button type="button" className="settings-save-button" onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
        <div className="footer-space" />
      </div>
    </div>
  );
}

// ── Location Picker ───────────────────────────────────────────────────────────

import cities from '../../data/cities.json';

function LocationPicker({ city, onSelect }: {
  city: string;
  onSelect: (city: string, lat: number, lng: number) => void;
}) {
  const [input, setInput] = useState(city);
  const [showDropdown, setShowDropdown] = useState(false);
  const [locating, setLocating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = input.trim()
    ? cities.filter(c => c.name.includes(input.trim())).slice(0, 8)
    : [];

  function handleSelect(c: { name: string; lat: number; lng: number }) {
    setInput(c.name);
    setShowDropdown(false);
    onSelect(c.name, c.lat, c.lng);
  }

  async function handleIpLocate() {
    setLocating(true);
    try {
      const res = await fetch('http://ip-api.com/json/?fields=city,lat,lon&lang=zh-CN');
      if (!res.ok) throw new Error('请求失败');
      const data = await res.json();
      const matched = cities.find(c => data.city?.includes(c.name) || c.name.includes(data.city ?? ''));
      if (matched) {
        handleSelect(matched);
      } else if (data.lat && data.lon) {
        setInput(data.city || '未知');
        onSelect(data.city || '未知', data.lat, data.lon);
        setShowDropdown(false);
      } else {
        setInput('定位失败');
      }
    } catch {
      setInput('无法访问定位服务');
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="location-picker">
      <div className="location-input-wrap">
        <input
          ref={inputRef}
          className={`proxy-input${input.trim() && !cities.some(c => c.name === input.trim()) && city !== input.trim() ? ' location-input--unmatched' : ''}`}
          value={input}
          placeholder="输入城市名搜索"
          onChange={e => { setInput(e.target.value); setShowDropdown(true); }}
          onFocus={() => { if (input.trim()) setShowDropdown(true); }}
          onBlur={() => {
            setTimeout(() => setShowDropdown(false), 200);
            const exact = cities.find(c => c.name === input.trim());
            if (exact && exact.name !== city) {
              handleSelect(exact);
            }
          }}
        />
        <button type="button" className="location-locate-btn" onClick={handleIpLocate} disabled={locating} title="IP 自动定位">
          {locating ? '…' : '⊕'}
        </button>
      </div>
      {showDropdown && filtered.length > 0 && inputRef.current && (() => {
        const rect = inputRef.current!.getBoundingClientRect();
        return (
          <div className="location-dropdown" style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width }}>
            {filtered.map(c => (
              <button key={c.name} type="button" className="location-option" onMouseDown={() => handleSelect(c)}>
                {c.name}
              </button>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ── Character Status Panel ────────────────────────────────────────────────────

function CharacterStatusPanel({ profileId, characterName, avatarAbsPath }: {
  profileId: string;
  characterName: string;
  avatarAbsPath: string | null;
}) {
  const [status, setStatus] = useState<{
    online: boolean;
    mood_score: number | null;
    proactive_interval_s: number | null;
    weather?: { temperature: number; windspeed: number; description: string } | null;
    weather_error?: string | null;
  } | null>(null);

  const [mbtiResult, setMbtiResult] = useState<{
    type: string;
    description: string;
    dimensions: Record<string, { dominant: string; strength: number; [k: string]: any }>;
    answers: Array<{ question_id: number; choice: string; reasoning: string; question_text?: string; option_a?: string; option_b?: string }>;
  } | null>(null);
  const [mbtiTesting, setMbtiTesting] = useState(false);
  const [mbtiError, setMbtiError] = useState('');

  const [voStatus, setVoStatus] = useState<{
    online: boolean;
    loaded?: boolean;
    game_companion_active?: boolean;
    active?: boolean;
    total_captures?: number;
    pending_ocr_count?: number;
    accumulated_ocr?: string[];
    current_frame_ocr?: string[];
    latest_summary?: string | null;
    visual_digest?: { text: string; frame_count: number; timestamp: number } | null;
    session_history?: Array<Record<string, any>>;
  } | null>(null);
  const [voExpanded, setVoExpanded] = useState(false);

  // Load MBTI result: try backend first, fallback to localStorage
  useEffect(() => {
    setMbtiResult(null);
    setMbtiError('');
    const cached = localStorage.getItem(`mbti_result_${profileId}`);
    if (cached) {
      try { setMbtiResult(JSON.parse(cached)); } catch {}
    }
    fetch('http://127.0.0.1:12393/mbti/result')
      .then(r => r.json())
      .then(data => {
        if (data.status === 'completed' && data.result) {
          setMbtiResult(data.result);
          localStorage.setItem(`mbti_result_${profileId}`, JSON.stringify(data.result));
        }
      })
      .catch(() => {});
  }, [profileId]);

  async function handleRunMbtiTest() {
    setMbtiTesting(true);
    setMbtiError('');
    try {
      const res = await fetch('http://127.0.0.1:12393/mbti/run', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        setMbtiError(data.error);
      } else if (data.result) {
        setMbtiResult(data.result);
        localStorage.setItem(`mbti_result_${profileId}`, JSON.stringify(data.result));
      }
    } catch (e) {
      setMbtiError('无法连接后端');
    } finally {
      setMbtiTesting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Load cached weather for offline display
    let cachedWeather: { temperature: number; windspeed: number; description: string } | null = null;
    try {
      const raw = localStorage.getItem(`weather_${profileId}`);
      if (raw) cachedWeather = JSON.parse(raw);
    } catch {}

    const poll = async () => {
      try {
        const res = await fetch('http://127.0.0.1:12393/status');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setStatus(data);
          if (data.weather) {
            localStorage.setItem(`weather_${profileId}`, JSON.stringify(data.weather));
          }
        }
      } catch {
        if (!cancelled) {
          setStatus(cachedWeather
            ? { online: false, mood_score: null, proactive_interval_s: null, weather: cachedWeather }
            : null
          );
        }
      }
    };
    void poll();
    const timer = setInterval(poll, 5000);

    const pollVo = async () => {
      try {
        const res = await fetch('http://127.0.0.1:12393/status/visual-observer');
        if (res.ok && !cancelled) {
          setVoStatus(await res.json());
        }
      } catch {
        if (!cancelled) setVoStatus(null);
      }
    };
    void pollVo();
    const voTimer = setInterval(pollVo, 3000);

    return () => { cancelled = true; clearInterval(timer); clearInterval(voTimer); };
  }, []);

  const online = status?.online ?? false;
  const moodScore = status?.mood_score;
  const proactiveInterval = status?.proactive_interval_s;

  const getTimeSlot = () => {
    const hour = new Date().getHours();
    if (hour < 6) return '凌晨';
    if (hour < 12) return '上午';
    if (hour < 14) return '中午';
    if (hour < 18) return '下午';
    if (hour < 22) return '晚上';
    return '深夜';
  };

  const getMoodLabel = (score: number) => {
    if (score >= 90) return '兴奋';
    if (score >= 80) return '愉快';
    if (score >= 60) return '平静';
    if (score >= 40) return '低落';
    return '消沉';
  };

  const formatInterval = (s: number) => {
    if (s < 60) return `${s.toFixed(0)}s`;
    return `${(s / 60).toFixed(1)}min`;
  };

  const getWeatherIcon = (desc: string) => {
    if (desc.includes('雷')) return '⛈️';
    if (desc.includes('雪')) return '🌨️';
    if (desc.includes('雨')) return '🌧️';
    if (desc.includes('雾')) return '🌫️';
    if (desc.includes('阴')) return '☁️';
    if (desc.includes('多云')) return '⛅';
    if (desc.includes('晴')) return '☀️';
    return '🌤️';
  };

  const getTimeSlotIcon = () => {
    const hour = new Date().getHours();
    if (hour < 6) return '🌙';
    if (hour < 12) return '🌅';
    if (hour < 14) return '☀️';
    if (hour < 18) return '🌤️';
    if (hour < 22) return '🌆';
    return '🌙';
  };

  return (
    <div className="status-panel">
      <div className="status-grid">
        {/* Row 1 */}
        <div className="status-card status-card--character">
          <div className="status-card-header">角色状态</div>
          <div className="status-card-body status-card-body--center">
            {avatarAbsPath ? (
              <img className="status-avatar-img" src={convertFileSrc(avatarAbsPath)} alt={characterName} />
            ) : (
              <div className="status-avatar-placeholder">{(characterName || profileId)[0]?.toUpperCase()}</div>
            )}
            <div className="status-character-name">{characterName || profileId}</div>
            <span className={`status-mood-badge${!online ? ' status-mood-badge--offline' : ''}`}>
              {online && moodScore != null ? getMoodLabel(moodScore) : '离线'}
            </span>
          </div>
          <div className="status-footer-row">
            <div className="status-footer-item"><span className="status-footer-label">时段</span><span className="status-footer-value">{getTimeSlot()}</span></div>
            <div className="status-footer-item"><span className="status-footer-label">状态</span><span className="status-footer-value">{online ? '在线' : '离线'}</span></div>
          </div>
        </div>

        <div className="status-card">
          <div className="status-card-header">运行时</div>
          <div className="status-card-body">
            <div className="status-kv-row">
              <span className="status-kv-label">心情分</span>
              <span className={`status-kv-value${!online ? ' status-kv-value--muted' : ''}`}>
                {online && moodScore != null ? `${moodScore}/100` : '离线'}
              </span>
            </div>
            <div className="status-kv-row">
              <span className="status-kv-label">主动发言间隔</span>
              <span className={`status-kv-value${!online ? ' status-kv-value--muted' : ''}`}>
                {online && proactiveInterval != null ? formatInterval(proactiveInterval) : online ? '已禁用' : '离线'}
              </span>
            </div>
          </div>
        </div>

        <div className="status-card">
          <div className="status-card-header">实时天气</div>
          <div className="status-card-body">
            {status?.weather ? (
              <>
                <div className="status-weather-hero">
                  <span className="status-weather-icon">{getWeatherIcon(status.weather.description)}</span>
                  <span className="status-weather-temp">{status.weather.temperature}°C</span>
                </div>
                <div className="status-weather-desc">{status.weather.description}，风速 {status.weather.windspeed} km/h</div>
                <div className="status-weather-time">{getTimeSlotIcon()} {getTimeSlot()}</div>
              </>
            ) : (
              <div className="status-weather-placeholder">{online ? (status?.weather_error || '未配置位置') : '离线'}</div>
            )}
          </div>
        </div>

        {/* Row 2 */}
        <div className="status-card">
          <div className="status-card-header">性格测试</div>
          <div className="status-card-body">
            {mbtiResult ? (
              <>
                <div className="mbti-result-hero">
                  <span className="mbti-type">{mbtiResult.type}</span>
                  <span className="mbti-desc">{mbtiResult.description}</span>
                </div>
                <div className="mbti-dimensions">
                  {Object.entries(mbtiResult.dimensions).map(([key, dim]) => {
                    const left = key[0];
                    const right = key[1];
                    const leftScore = dim[left] ?? 0;
                    const rightScore = dim[right] ?? 0;
                    const total = leftScore + rightScore || 7;
                    const leftPct = Math.round((leftScore / total) * 100);
                    return (
                      <div key={key} className="mbti-dim-row">
                        <span className="mbti-dim-pole">{left}</span>
                        <div className="mbti-dim-bar">
                          <div className="mbti-dim-bar-left" style={{ width: `${leftPct}%` }} />
                          <div className="mbti-dim-bar-right" style={{ width: `${100 - leftPct}%` }} />
                        </div>
                        <span className="mbti-dim-pole">{right}</span>
                      </div>
                    );
                  })}
                </div>
                {mbtiResult.answers && mbtiResult.answers.length > 0 && (
                  <details className="mbti-answers-detail">
                    <summary className="mbti-answers-summary">查看每题详情 ({mbtiResult.answers.length} 题)</summary>
                    <div className="mbti-answers-list">
                      {mbtiResult.answers.map((ans, i) => (
                        <div key={i} className="mbti-answer-item">
                          <div className="mbti-answer-header">
                            <span className="mbti-answer-id">Q{ans.question_id}</span>
                            <span className="mbti-answer-question">{ans.question_text || ''}</span>
                          </div>
                          <div className="mbti-answer-body">
                            <span className="mbti-answer-choice">{ans.choice.toUpperCase()}: {ans.choice === 'a' ? ans.option_a : ans.option_b}</span>
                          </div>
                          {ans.reasoning && <div className="mbti-answer-reason">{ans.reasoning}</div>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                <button type="button" className="l2d-add-btn" onClick={handleRunMbtiTest} disabled={mbtiTesting}>
                  {mbtiTesting ? '测试中…' : '重新测试'}
                </button>
              </>
            ) : (
              <>
                <div className="status-kv-row">
                  <span className="status-kv-label">MBTI</span>
                  <span className="status-kv-value status-kv-value--muted">{mbtiError || '未测试'}</span>
                </div>
                <button type="button" className="l2d-add-btn" onClick={handleRunMbtiTest} disabled={mbtiTesting || !online}>
                  {mbtiTesting ? '测试中…' : '开始测试'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="status-card">
          <div className="status-card-header">视觉观察</div>
          <div className="status-card-body">
            {voStatus?.loaded && voStatus?.active ? (
              <>
                <div className="status-kv-row">
                  <span className="status-kv-label">模式</span>
                  <span className="status-kv-value">{voStatus.game_companion_active ? '🎮 陪玩' : '正常'}</span>
                </div>
                <div className="status-kv-row">
                  <span className="status-kv-label">截图数</span>
                  <span className="status-kv-value">{voStatus.total_captures ?? 0}</span>
                </div>
                <div className="status-kv-row">
                  <span className="status-kv-label">待触发 OCR</span>
                  <span className="status-kv-value">{voStatus.pending_ocr_count ?? 0} 条新增（阈值 {voStatus.ocr_threshold ?? 20}）{voStatus.speaking ? ' ⏸ 暂停中' : ''}</span>
                </div>
                {voStatus.current_frame_ocr && voStatus.current_frame_ocr.length > 0 && (
                  <details className="mbti-answers-detail">
                    <summary className="mbti-answers-summary">当前帧 OCR ({voStatus.current_frame_ocr.length} 条)</summary>
                    <div className="mbti-answers-list">
                      {voStatus.current_frame_ocr.map((text, i) => (
                        <div key={i} className="mbti-answer-item" style={{ padding: '2px 0' }}>
                          <span style={{ fontSize: 12 }}>{text}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {voStatus.accumulated_ocr && voStatus.accumulated_ocr.length > 0 && (
                  <details className="mbti-answers-detail">
                    <summary className="mbti-answers-summary">累积新增 OCR ({voStatus.accumulated_ocr.length} 条)</summary>
                    <div className="mbti-answers-list">
                      {voStatus.accumulated_ocr.map((text, i) => (
                        <div key={i} className="mbti-answer-item" style={{ padding: '2px 0' }}>
                          <span style={{ fontSize: 12 }}>{text}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {voStatus.latest_summary && (
                  <div className="status-kv-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                    <span className="status-kv-label">最近摘要</span>
                    <span className="status-kv-value" style={{ fontSize: 12, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{voStatus.latest_summary}</span>
                  </div>
                )}
                {voStatus.session_history && voStatus.session_history.length > 0 && (
                  <details className="mbti-answers-detail">
                    <summary className="mbti-answers-summary">
                      历史总结 ({voStatus.session_history.length} 轮)
                      <button
                        type="button"
                        className="l2d-add-btn"
                        style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const text = JSON.stringify(voStatus.session_history, null, 2);
                          navigator.clipboard.writeText(text);
                        }}
                      >复制 JSON</button>
                    </summary>
                    <div className="mbti-answers-list">
                      {voStatus.session_history.map((s: any, si: number) => (
                        <div key={si} className="mbti-answer-item">
                          <div className="mbti-answer-header">
                            <span className="mbti-answer-id">轮 {si + 1}</span>
                            <span className="mbti-answer-question" style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {s.ocr_count} OCR
                            </span>
                          </div>
                          <div className="mbti-answer-body">
                            <span className="mbti-answer-choice" style={{ whiteSpace: 'pre-wrap' }}>{s.summary}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </>
            ) : (
              <div className="status-weather-placeholder">
                {!online
                  ? '离线'
                  : voStatus?.loaded
                    ? (voStatus.total_captures ?? 0) > 0
                      ? `已暂停（共 ${voStatus.total_captures} 帧）`
                      : '已加载，等待首次对话'
                    : '未启用'}
              </div>
            )}
          </div>
        </div>

        <div className="status-card">
          <div className="status-card-header">社交状态</div>
          <div className="status-card-body">
            <div className="status-kv-row"><span className="status-kv-label">关系满意度</span><span className="status-kv-value status-kv-value--muted">—</span></div>
            <div className="status-kv-row"><span className="status-kv-label">关系趋势</span><span className="status-kv-value status-kv-value--muted">—</span></div>
          </div>
        </div>
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
  const [profileTab, setProfileTab] = useState<'config' | 'status'>('config');
  const [error, setError] = useState('');
  const [labConfig, setLabConfig] = useState<LabConfig | null>(null);

  const activeProfileFile = labConfig?.agent.memory_agent_profile
    ?.replace(/^profiles\//, '').replace(/\.toml$/, '') ?? null;

  useEffect(() => {
    void (async () => {
      try {
        const [list, cfg] = await Promise.all([listProfiles(), readLabConfig()]);
        setMetas(list);
        setLabConfig(cfg);
        if (list.length > 0) {
          const profileCfg = await readProfile(list[0].file);
          setSelectedFile(list[0].file);
          setActiveConfig(profileCfg);
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

  async function handleSetActive() {
    if (!selectedFile || !labConfig) return;
    const updated = { ...labConfig, agent: { ...labConfig.agent, memory_agent_profile: `profiles/${selectedFile}.toml` } };
    try {
      await writeLabConfig(updated);
      setLabConfig(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

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
                <span className="profile-chip__name">
                  {m.character_name || m.file}
                  {activeProfileFile === m.file && <span className="profile-chip__badge">启动</span>}
                </span>
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

      {selectedFile && (
        <div className="profile-tab-bar">
          <button type="button"
            className={`profile-tab${profileTab === 'config' ? ' profile-tab--active' : ''}`}
            onClick={() => setProfileTab('config')}>
            配置
          </button>
          <button type="button"
            className={`profile-tab${profileTab === 'status' ? ' profile-tab--active' : ''}`}
            onClick={() => setProfileTab('status')}>
            状态
          </button>
        </div>
      )}

      {profileTab === 'config' && activeConfig && selectedFile ? (
        <ProfileEditor
          file={selectedFile}
          config={activeConfig}
          onChange={setActiveConfig}
          onSave={handleSave}
          onDelete={handleDelete}
          onSetActive={handleSetActive}
          saving={saving}
          avatarAbsPath={selectedMeta?.avatar_abs_path ?? null}
          activeProfileFile={activeProfileFile}
        />
      ) : profileTab === 'status' && selectedFile ? (
        <CharacterStatusPanel
          profileId={selectedFile}
          characterName={selectedMeta?.character_name ?? ''}
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
