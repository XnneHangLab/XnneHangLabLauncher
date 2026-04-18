export type SettingsTabId = 'general' | 'about';

export interface SettingsTab {
  id: SettingsTabId;
  label: string;
}

export const settingsTabs: SettingsTab[] = [
  { id: 'general', label: '运行配置' },
  { id: 'about', label: '关于' },
];

export const aboutInfo = [
  '这里仅仅只是一个占位，这里还什么都没有 ...',
];
