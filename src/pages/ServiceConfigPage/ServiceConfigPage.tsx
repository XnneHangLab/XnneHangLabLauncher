import { useState } from 'react';
import { SettingCard } from '../../components/settings/SettingCard/SettingCard';
import { SettingRow } from '../../components/settings/SettingRow/SettingRow';
import type { LabConfig } from '../../services/config/labConfig';
import '../../styles/settings.css';

interface ServiceConfigPageProps {
  labConfig: LabConfig | null;
  onSaveLabConfig: (config: LabConfig) => void;
}

export function ServiceConfigPage({ labConfig, onSaveLabConfig }: ServiceConfigPageProps) {
  const [local, setLocal] = useState<LabConfig['server'] | null>(
    labConfig?.server ?? null,
  );

  if (!labConfig || !local) {
    return (
      <div className="settings-shell">
        <div className="settings-wrap">
          <div className="group-title group-title--standalone">服务配置</div>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>正在加载配置…</p>
        </div>
      </div>
    );
  }

  function handleSave() {
    if (!labConfig || !local) return;
    onSaveLabConfig({ ...labConfig, server: local });
  }

  return (
    <div className="settings-shell">
      <div className="settings-wrap">
        <div className="group-title group-title--standalone">服务器</div>

        <SettingCard>
          <SettingRow name="监听地址" description="后端 HTTP 服务绑定的主机名或 IP" icon="🌐">
            <input
              className="proxy-input"
              value={local.host}
              onChange={(e) => setLocal({ ...local, host: e.target.value })}
            />
          </SettingRow>

          <SettingRow name="端口" description="后端服务端口（默认 12393）" icon="🔌">
            <input
              className="proxy-input"
              type="number"
              value={local.port}
              onChange={(e) => setLocal({ ...local, port: Number(e.target.value) })}
            />
          </SettingRow>

          <SettingRow name="角色配置目录" description="存放角色 TOML 的子目录名" icon="📁">
            <input
              className="proxy-input"
              value={local.config_alts_dir}
              onChange={(e) => setLocal({ ...local, config_alts_dir: e.target.value })}
            />
          </SettingRow>

          <SettingRow name="Uvicorn 日志级别" description="warning / info / debug / error" icon="📋">
            <div className="driver-select-wrap">
              {(['warning', 'info', 'debug', 'error'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`driver-option${local.uvicorn_log_level === level ? ' driver-option--active' : ''}`}
                  onClick={() => setLocal({ ...local, uvicorn_log_level: level })}
                >
                  {level}
                </button>
              ))}
            </div>
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
