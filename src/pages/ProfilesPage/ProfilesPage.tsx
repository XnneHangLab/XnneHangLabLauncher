import { useEffect, useState } from 'react';
import { SettingCard } from '../../components/settings/SettingCard/SettingCard';
import { SettingRow } from '../../components/settings/SettingRow/SettingRow';
import { ToggleSwitch } from '../../components/settings/ToggleSwitch/ToggleSwitch';
import {
  listProfiles,
  readProfile,
  writeProfile,
  createProfile,
  deleteProfile,
} from '../../services/config/profileBridge';
import type { ProfileMeta, ProfileConfig } from '../../services/config/profileConfig';
import '../../styles/profiles.css';

const KNOWN_PLUGINS: Array<{ id: string; label: string; description: string }> = [
  { id: 'pre_tool_preview', label: '工具调用预览', description: '工具调用前展示简短预览文本' },
  { id: 'tool_call_integrity', label: '工具完整性检查', description: '保证工具调用结构完整' },
  { id: 'web_fetch', label: '网页抓取', description: '允许 Agent 抓取网页内容' },
  { id: 'web_search_ddg', label: 'DDG 搜索', description: 'DuckDuckGo 网络搜索' },
  { id: 'screen_shot', label: '截图', description: '允许 Agent 调用截图能力' },
  { id: 'diary', label: '日记', description: '读写日记文件' },
  { id: 'memory', label: '记忆', description: '长期记忆检索与写入' },
  { id: 'live2d_control', label: 'Live2D 控制', description: '控制 Live2D 模型外观与动作' },
  { id: 'mood_chat', label: '情绪聊天', description: '主动发起情绪化对话' },
];

function ProfileAvatar({ name }: { name: string }) {
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
  }

  const unknownPlugins = enabledPlugins.filter(
    (p) => !KNOWN_PLUGINS.find((k) => k.id === p),
  );

  return (
    <div className="profiles-editor">
      <div className="profiles-editor__inner">
        <div className="group-title group-title--standalone">
          基本信息 <span className="profile-file-badge">{file}.toml</span>
        </div>

        <SettingCard>
          <SettingRow name="显示名称" icon="🏷">
            <input className="proxy-input" value={profile.name}
              onChange={(e) => setProfile({ name: e.target.value })} />
          </SettingRow>
          <SettingRow name="描述" icon="📝">
            <input className="proxy-input" value={profile.description}
              onChange={(e) => setProfile({ description: e.target.value })} />
          </SettingRow>
          <SettingRow name="Agent 名称" description="后端路由使用的标识符" icon="🤖">
            <input className="proxy-input" value={profile.agent_name}
              onChange={(e) => setProfile({ agent_name: e.target.value })} />
          </SettingRow>
        </SettingCard>

        <div className="group-title">角色配置</div>

        <SettingCard>
          <SettingRow name="角色名" icon="👤">
            <input className="proxy-input" value={character.character_name ?? ''}
              onChange={(e) => setCharacter({ character_name: e.target.value })} />
          </SettingRow>
          <SettingRow name="Live2D 模型名" icon="🖼">
            <input className="proxy-input" value={character.live2d_model_name ?? ''}
              onChange={(e) => setCharacter({ live2d_model_name: e.target.value })} />
          </SettingRow>
          <SettingRow name="头像文件名" description="相对于 voices/ 的路径" icon="🖼">
            <input className="proxy-input" value={character.avatar ?? ''}
              onChange={(e) => setCharacter({ avatar: e.target.value })} />
          </SettingRow>
          <SettingRow name="用户称呼" description="对话中对用户的称呼" icon="🙋">
            <input className="proxy-input" value={character.human_name ?? ''}
              onChange={(e) => setCharacter({ human_name: e.target.value })} />
          </SettingRow>
          <SettingRow name="默认表情" icon="😊">
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
          ] as const).map(([key, label]) => (
            <SettingRow key={key} name={label}>
              <ToggleSwitch
                label={label}
                checked={ttsPreprocessor[key] ?? false}
                onChange={(v) => setTtsPreprocessor({ [key]: v })}
              />
            </SettingRow>
          ))}
          <SettingRow name="TTS 角色名" description="对应 voices/ 下的子目录名" icon="🔊">
            <input className="proxy-input" value={tts.character_name ?? ''}
              onChange={(e) => setTts({ character_name: e.target.value })} />
          </SettingRow>
        </SettingCard>

        <div className="group-title">提示词</div>

        <SettingCard>
          <SettingRow name="人设文件" description="相对于项目根目录的 .md 路径" icon="📄">
            <input className="proxy-input workspace-input" value={prompt.persona ?? ''}
              onChange={(e) => setPrompt({ persona: e.target.value })} />
          </SettingRow>
          <SettingRow name="格式文件" description="情绪括号等格式 prompt 路径" icon="📐">
            <input className="proxy-input workspace-input" value={prompt.format ?? ''}
              onChange={(e) => setPrompt({ format: e.target.value })} />
          </SettingRow>
          <SettingRow name="显示控制标签" icon="🏷">
            <ToggleSwitch
              label="显示控制标签"
              checked={prompt.show_control_tags ?? false}
              onChange={(v) => setPrompt({ show_control_tags: v })}
            />
          </SettingRow>
        </SettingCard>

        <div className="group-title">插件</div>

        <SettingCard>
          {KNOWN_PLUGINS.map(({ id, label, description }) => (
            <SettingRow key={id} name={label} description={description}>
              <ToggleSwitch
                label={label}
                checked={enabledPlugins.includes(id)}
                onChange={(on) => togglePlugin(id, on)}
              />
            </SettingRow>
          ))}
          {unknownPlugins.length > 0 && (
            <SettingRow name="其他已启用插件" description={unknownPlugins.join(', ')} />
          )}
        </SettingCard>

        <div className="profiles-editor__actions">
          <button type="button" className="settings-save-button" onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button type="button" className="profile-delete-btn" onClick={onDelete}>
            删除此卡片
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
    reload();
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
      <aside className="profiles-list">
        <div className="profiles-list__inner">
          {metas.map((m) => (
            <button
              key={m.file}
              type="button"
              className={`profile-card${selectedFile === m.file ? ' profile-card--active' : ''}`}
              onClick={() => handleSelect(m.file)}
            >
              <ProfileAvatar name={m.character_name || m.name} />
              <div className="profile-card__text">
                <div className="profile-card__name">{m.character_name || m.name}</div>
                <div className="profile-card__desc">{m.description}</div>
              </div>
            </button>
          ))}

          {showNewInput ? (
            <div className="profile-new-form">
              <input
                className="profile-new-input"
                placeholder="文件名（如 mychar）"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
                autoFocus
              />
              <div className="profile-new-actions">
                <button type="button" className="profile-new-confirm" onClick={handleCreate}>创建</button>
                <button type="button" className="profile-new-cancel"
                  onClick={() => { setShowNewInput(false); setNewName(''); }}>取消</button>
              </div>
            </div>
          ) : (
            <button type="button" className="profile-add-btn"
              onClick={() => setShowNewInput(true)}>
              <span style={{ fontSize: 16 }}>＋</span> 新建角色卡片
            </button>
          )}
        </div>

        {error && <p className="profile-error">{error}</p>}
      </aside>

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
          <p>选择左侧卡片开始编辑</p>
        </div>
      )}
    </div>
  );
}
