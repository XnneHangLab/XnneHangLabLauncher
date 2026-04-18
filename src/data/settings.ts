export type SettingsTabId = 'launch' | 'server' | 'model-ai' | 'speech' | 'about';

export interface SettingsTab {
  id: SettingsTabId;
  label: string;
}

export const settingsTabs: SettingsTab[] = [
  { id: 'launch', label: '启动配置' },
  { id: 'server', label: '服务配置' },
  { id: 'model-ai', label: '模型与 AI' },
  { id: 'speech', label: '语音' },
  { id: 'about', label: '关于' },
];

export const aboutInfo = [
  '这里仅仅只是一个占位，这里还什么都没有 ...',
];
