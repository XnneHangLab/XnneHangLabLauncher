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

type PluginFieldType = 'text' | 'number' | 'textarea' | 'boolean' | 'json';
interface PluginField { key: string; type: PluginFieldType; description?: string; }

const PLUGIN_CONFIG_FIELDS: Record<string, PluginField[]> = {
  memory: [
    { key: 'base_url', type: 'text', description: 'Memory Bench 服务基础地址' },
    { key: 'user_id', type: 'text', description: '记忆读写使用的用户 ID' },
    { key: 'agent_id', type: 'text', description: '记忆读写使用的角色 ID' },
    { key: 'search_limit', type: 'number', description: '每轮注入的最大记忆条数' },
  ],
  mood_chat: [
    { key: 'prompt', type: 'textarea', description: '主动对话时发送给 agent 的提示词' },
    { key: 'initial_mood', type: 'number', description: '启动后的初始心情分' },
    { key: 'target_mood', type: 'number', description: '心情自然回归的目标分数' },
    { key: 'response_timeout_s', type: 'number', description: '主动发言后等待用户回应的超时时间（秒）' },
    { key: 'interval_excited_s', type: 'number', description: '心情 >= 90 时的主动发言间隔（秒）' },
    { key: 'interval_normal_s', type: 'number', description: '心情 >= 80 时的主动发言间隔（秒）' },
    { key: 'interval_low_s', type: 'number', description: '心情 >= 60 时的主动发言间隔（秒）' },
    { key: 'mood_increase', type: 'number', description: '用户发言后增加的心情分' },
    { key: 'mood_decrease', type: 'number', description: '主动发言后超时未回应时扣除的心情分' },
  ],
  pre_tool_preview: [
    { key: 'preview_max_chars', type: 'number', description: '工具调用前预告的最大字数' },
    { key: 'preview_when_latency_over_ms', type: 'number', description: '预计等待超过该毫秒数时倾向输出预告' },
    { key: 'allow_skip_on_user_request', type: 'boolean', description: '用户明确要求直接执行时是否允许跳过预告' },
    { key: 'injection_position', type: 'text', description: '提示词注入位置：before_tools 或 after_tools' },
  ],
  tool_call_integrity: [
    { key: 'injection_position', type: 'text', description: '提示词注入位置：before_tools 或 after_tools' },
  ],
  web_fetch: [
    { key: 'user_agent', type: 'text', description: '抓取网页时使用的 User-Agent 头' },
    { key: 'respect_robots', type: 'boolean', description: '是否遵守目标站点的 robots.txt' },
    { key: 'robots_fail_closed', type: 'boolean', description: 'robots.txt 检查失败时是否默认拒绝' },
    { key: 'use_jina_fallback', type: 'boolean', description: '正文提取效果不佳时是否启用 Jina Reader 回退' },
    { key: 'jina_api_key', type: 'text', description: 'Jina Reader API Key，未配置时留空' },
    { key: 'timeout_s', type: 'number', description: '网页抓取默认超时时间（秒）' },
    { key: 'max_chars_default', type: 'number', description: '默认返回的最大正文字符数' },
  ],
  web_search_ddg: [
    { key: 'user_agent', type: 'text', description: '请求 DuckDuckGo 时使用的 User-Agent 头' },
    { key: 'timeout_s', type: 'number', description: 'DuckDuckGo 搜索请求超时时间（秒）' },
  ],
  web_search_searxng: [
    { key: 'searxng_url', type: 'text', description: 'SearXNG 实例基础 URL，留空时插件不会注册' },
    { key: 'user_agent', type: 'text', description: '请求 SearXNG 时使用的 User-Agent 头' },
    { key: 'timeout_s', type: 'number', description: 'SearXNG 搜索请求超时时间（秒）' },
  ],
  live2d_control: [
    { key: 'appearance_presets', type: 'json', description: '可切换的外观预设列表 [{key, description}]' },
    { key: 'idle_clips', type: 'json', description: '待机动作片段列表 [{id, url, weight}]' },
    { key: 'idle_assignments', type: 'json', description: '各状态使用的待机动作分配 {listening, speaking}' },
    { key: 'mixer_weights_by_state', type: 'json', description: '各状态的 Pose Mixer 层权重 {listening, speaking}' },
  ],
};

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

function ProfileAvatar({ name, absPath }: { name: string; absPath?: string | null }) {
  if (absPath) {
    return <img className="profile-avatar profile-avatar--img" src={convertFileSrc(absPath)} alt={name} />;
  }
  const initial = name ? name[0].toUpperCase() : '?';
  return <div className="profile-avatar">{initial}</div>;
}

interface ProfileEditorProps {
  file: string;
  config: ProfileConfig;
  onChange: (next: ProfileConfig) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
}

function ProfileEditor({ file, config, onChange, onSave, onDelete, saving }: ProfileEditorProps) {
  const profile = config.profile ?? { name: '', description: '', agent_name: '' };
  const character = config.character ?? {};
  const ttsPreprocessor = character.tts_preprocessor ?? {};
  const tts = character.tts ?? {};
  const prompt = config.prompt ?? {};
  const enabledPlugins = config.plugins?.enabled ?? [];

  const [openPlugins, setOpenPlugins] = useState<Set<string>>(new Set);

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
    if (on && PLUGIN_CONFIG_FIELDS[id]) setOpenPlugins(prev => new Set(prev).add(id));
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
    if (rel !== null) {
      setCharacter({ avatar: rel.split('/').pop() ?? rel });
    }
  }
  async function browsePersona() {
    const rel = await pickFileForProfile('选择人设文件', 'prompts');
    if (rel !== null) setPrompt({ persona: rel });
  }
  async function browseFormat() {
    const rel = await pickFileForProfile('选择格式文件', 'prompts');
    if (rel !== null) setPrompt({ format: rel });
  }

  const unknownPlugins = enabledPlugins.filter(
    (p) => !KNOWN_PLUGINS.find((k) => k.id === p),
  );

  return (
    <div className="profiles-editor settings-shell">
      <div className="settings-wrap">
        <div className="group-title group-title--standalone">
          {profile.name || file} <span className="profile-file-badge">{file}.toml</span>
        </div>

        <SettingCard>
          <SettingRow name="name" description="角色的显示名称" icon="🏷">
            <input className="proxy-input" value={profile.name}
              onChange={(e) => setProfile({ name: e.target.value })} />
          </SettingRow>
          <SettingRow name="description" icon="📝">
            <input className="proxy-input" value={profile.description}
              onChange={(e) => setProfile({ description: e.target.value })} />
          </SettingRow>
          <SettingRow name="agent_name" description="后端路由使用的标识符" icon="🤖">
            <input className="proxy-input" value={profile.agent_name}
              onChange={(e) => setProfile({ agent_name: e.target.value })} />
          </SettingRow>
        </SettingCard>

        <div className="group-title">角色配置</div>

        <SettingCard>
          <SettingRow name="character_name" icon="👤">
            <input className="proxy-input" value={character.character_name ?? ''}
              onChange={(e) => setCharacter({ character_name: e.target.value })} />
          </SettingRow>
          <SettingRow name="live2d_model_name" icon="🖼">
            <input className="proxy-input" value={character.live2d_model_name ?? ''}
              onChange={(e) => setCharacter({ live2d_model_name: e.target.value })} />
          </SettingRow>
          <SettingRow name="avatar" description="static/avatars/ 目录下的文件名" icon="🖼">
            <BrowsePath
              value={character.avatar ?? ''}
              onChange={(v) => setCharacter({ avatar: v })}
              onBrowse={browseAvatar}
            />
          </SettingRow>
          <SettingRow name="human_name" description="对话中对用户的称呼" icon="🙋">
            <input className="proxy-input" value={character.human_name ?? ''}
              onChange={(e) => setCharacter({ human_name: e.target.value })} />
          </SettingRow>
          <SettingRow name="default_expression_emotion" icon="😊">
            <input className="proxy-input" value={character.default_expression_emotion ?? ''}
              onChange={(e) => setCharacter({ default_expression_emotion: e.target.value })} />
          </SettingRow>
        </SettingCard>

        <div className="group-title">TTS 预处理</div>

        <SettingCard>
          {([
            ['remove_special_char', '移除特殊字符'],
            ['ignore_brackets', '忽略方括号 []'],
            ['ignore_parentheses', '忽略圆括号 ()'],
            ['ignore_asterisks', '忽略星号 *'],
            ['ignore_angle_brackets', '忽略尖括号 <>'],
          ] as const).map(([key, desc]) => (
            <SettingRow key={key} name={key} description={desc}>
              <ToggleSwitch
                label={key}
                checked={ttsPreprocessor[key] ?? false}
                onChange={(v) => setTtsPreprocessor({ [key]: v })}
              />
            </SettingRow>
          ))}
          <SettingRow name="character_name" description="对应 voices/ 下的子目录名" icon="🔊">
            <input className="proxy-input" value={tts.character_name ?? ''}
              onChange={(e) => setTts({ character_name: e.target.value })} />
          </SettingRow>
        </SettingCard>

        <div className="group-title">提示词</div>

        <SettingCard>
          <SettingRow name="persona" description="相对于项目根目录的 .md 路径" icon="📄">
            <BrowsePath
              value={prompt.persona ?? ''}
              onChange={(v) => setPrompt({ persona: v })}
              onBrowse={browsePersona}
              wide
            />
          </SettingRow>
          <SettingRow name="format" description="情绪括号等格式 prompt 路径" icon="📐">
            <BrowsePath
              value={prompt.format ?? ''}
              onChange={(v) => setPrompt({ format: v })}
              onBrowse={browseFormat}
              wide
            />
          </SettingRow>
          <SettingRow name="show_control_tags" icon="🏷">
            <ToggleSwitch
              label="show_control_tags"
              checked={prompt.show_control_tags ?? false}
              onChange={(v) => setPrompt({ show_control_tags: v })}
            />
          </SettingRow>
        </SettingCard>

        <div className="group-title">插件</div>

        <div className="plugin-list">
          {KNOWN_PLUGINS.map(({ id, description }) => {
            const isOn = enabledPlugins.includes(id);
            const fields = PLUGIN_CONFIG_FIELDS[id];
            const isOpen = openPlugins.has(id);
            const cfg = getPluginCfg(id);
            return (
              <div key={id} className={`plugin-item${isOn ? ' plugin-item--on' : ''}${isOpen ? ' plugin-item--open' : ''}`}>
                <div className="plugin-item-header">
                  <div className="plugin-item-info">
                    <span className="plugin-item-name">{id}</span>
                    <span className="plugin-item-desc">{description}</span>
                  </div>
                  <div className="plugin-item-controls">
                    <ToggleSwitch label={id} checked={isOn} onChange={(on) => togglePlugin(id, on)} />
                    {fields && (
                      <button
                        type="button"
                        className={`plugin-expand-btn${isOpen ? ' plugin-expand-btn--open' : ''}`}
                        onClick={() => toggleOpen(id)}
                      >›</button>
                    )}
                  </div>
                </div>
                {isOpen && fields && (
                  <div className="plugin-item-body">
                    {fields.map(f => {
                      const val = cfg[f.key];
                      return (
                        <div key={f.key} className={`plugin-field-row${f.type === 'json' ? ' plugin-field-row--json' : ''}`}>
                          <div className="plugin-field-meta">
                            <span className="plugin-field-key">{f.key}</span>
                            {f.description && <span className="plugin-field-desc">{f.description}</span>}
                          </div>
                          {f.type === 'json' ? (
                            <PluginJsonField
                              fileKey={`${file}:${id}:${f.key}`}
                              value={val}
                              onChange={(v) => setPluginCfg(id, { [f.key]: v })}
                            />
                          ) : f.type === 'textarea' ? (
                            <textarea
                              className="proxy-input plugin-textarea"
                              value={(val as string) ?? ''}
                              onChange={(e) => setPluginCfg(id, { [f.key]: e.target.value })}
                            />
                          ) : f.type === 'boolean' ? (
                            <ToggleSwitch
                              label={f.key}
                              checked={(val as boolean) ?? false}
                              onChange={(v) => setPluginCfg(id, { [f.key]: v })}
                            />
                          ) : (
                            <input
                              className="proxy-input"
                              type={f.type}
                              value={(val as string | number) ?? ''}
                              onChange={(e) => setPluginCfg(id, { [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
                            />
                          )}
                        </div>
                      );
                    })}
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
          <button type="button" className="profile-delete-btn" onClick={onDelete}>
            删除
          </button>
          <button type="button" className="settings-save-button" onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>

        <div className="footer-space" />
      </div>
    </div>
  );
}

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
      const config = await readProfile(file);
      setSelectedFile(file);
      setActiveConfig(config);
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

  return (
    <div className="profiles-page">
      <div className="profiles-topbar">
        <div className="profiles-list">
          {metas.map((m) => (
            <button
              key={m.file}
              type="button"
              className={`profile-chip${selectedFile === m.file ? ' profile-chip--active' : ''}`}
              onClick={() => handleSelect(m.file)}
            >
              <ProfileAvatar name={m.character_name || m.name} absPath={m.avatar_abs_path} />
              <div className="profile-chip__text">
                <span className="profile-chip__name">{m.character_name || m.name}</span>
                <span className="profile-chip__file">{m.file}</span>
              </div>
            </button>
          ))}

          {showNewInput ? (
            <div className="profile-new-inline">
              <input
                className="profile-new-input"
                placeholder="文件名（如 mychar）"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                  if (e.key === 'Escape') { setShowNewInput(false); setNewName(''); }
                }}
                autoFocus
              />
              <button type="button" className="profile-new-confirm" onClick={handleCreate}>创建</button>
              <button type="button" className="profile-new-cancel"
                onClick={() => { setShowNewInput(false); setNewName(''); }}>取消</button>
            </div>
          ) : (
            <button type="button" className="profile-add-btn" onClick={() => setShowNewInput(true)}>
              ＋
            </button>
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
        />
      ) : (
        <div className="profiles-empty">
          <p>选择上方角色卡片开始编辑</p>
        </div>
      )}
    </div>
  );
}
