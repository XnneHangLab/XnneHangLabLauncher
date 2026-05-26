import type { ReactElement } from 'react';
import { HomePage } from '../pages/HomePage/HomePage';
import { ConsolePage } from '../pages/ConsolePage/ConsolePage';
import { ModelsPage } from '../pages/ModelsPage/ModelsPage';
import { SettingsPage } from '../pages/SettingsPage/SettingsPage';
import { ProfilesPage } from '../pages/ProfilesPage/ProfilesPage';
import { TroubleshootingPage } from '../pages/TroubleshootingPage/TroubleshootingPage';
import { VersionsPage } from '../pages/VersionsPage/VersionsPage';
import { CommunityPage } from '../pages/CommunityPage/CommunityPage';
import { ToolsPage } from '../pages/ToolsPage/ToolsPage';
import type { PageId } from '../data/nav';
import type { ConsoleLogEntry } from '../services/launcher/launcher';
import type {
  EnvironmentProbe,
  FileProgress,
  ManagedFolderItem,
  RuntimeInspection,
  RuntimeDriver,
  RuntimeTaskRecord,
} from '../services/runtime/runtime';
import type { LabConfig } from '../services/config/labConfig';

interface RenderPageOptions {
  inspection: RuntimeInspection | null;
  tasks: RuntimeTaskRecord[];
  fileProgress: FileProgress | null;
  folders: ManagedFolderItem[];
  logs: ConsoleLogEntry[];
  autoScroll: boolean;
  wrapLines: boolean;
  latestMessage: string;
  onOpenModels: () => void;
  onDownloadGenieBase: () => void;
  onDownloadGsvLite: () => void;
  onDownloadQwenTts06b: () => void;
  onDownloadQwenTts17b: () => void;
  onDownloadLumingGenieTts: () => void;
  onDownloadGsvBaoqiao: () => void;
  onDownloadLocalEmbedding: () => void;
  onDownloadLlmTranslate: () => void;
  onDownloadSherpaParaformer: () => void;
  onDownloadSileroVad: () => void;
  modelStatuses: Record<string, string>;
  onOpenPath: (pathKey: string) => void;
  onLaunchWebui: () => void;
  onStopWebui: () => void;
  webuiRunning: boolean;
  onLaunchFrontend: () => void;
  onStopFrontend: () => void;
  frontendRunning: boolean;
  runtimeDriver: RuntimeDriver;
  runtimeMode: string;
  scriptsReady: boolean;
  workspaceLocked: boolean;
  workspaceRoot: string;
  environmentProbe: EnvironmentProbe | null;
  onChooseWorkspaceRoot: () => void;
  onUseRepoWorkspaceRoot: () => void;
  pythonExePath: string;
  onChoosePythonExe: () => Promise<string | null>;
  onSave: (driver: RuntimeDriver, pythonExePath: string) => void;
  labConfig: LabConfig | null;
  onSaveLabConfig: (config: LabConfig) => void;
  onSetAutoScroll: (next: boolean) => void;
  onSetWrapLines: (next: boolean) => void;
  onClearLogs: () => void;
  onExportLogs: () => void;
}

export function renderPage(
  pageId: PageId,
  options: RenderPageOptions,
): ReactElement {
  switch (pageId) {
    case 'home':
      return (
        <HomePage
          folders={options.folders}
          onOpenPath={options.onOpenPath}
          onOpenModels={options.onOpenModels}
          onLaunchWebui={options.onLaunchWebui}
          onStopWebui={options.onStopWebui}
          webuiRunning={options.webuiRunning}
          onLaunchFrontend={options.onLaunchFrontend}
          onStopFrontend={options.onStopFrontend}
          frontendRunning={options.frontendRunning}
        />
      );
    case 'settings':
      return (
        <SettingsPage
          workspaceRoot={options.workspaceRoot}
          workspaceLocked={options.workspaceLocked}
          environmentProbe={options.environmentProbe}
          onChooseWorkspaceRoot={options.onChooseWorkspaceRoot}
          onUseRepoWorkspaceRoot={options.onUseRepoWorkspaceRoot}
          runtimeDriver={options.runtimeDriver}
          pythonExePath={options.pythonExePath}
          onChoosePythonExe={options.onChoosePythonExe}
          onSave={options.onSave}
          labConfig={options.labConfig}
          onSaveLabConfig={options.onSaveLabConfig}
        />
      );
    case 'profiles':
      return <ProfilesPage />;
    case 'troubleshooting':
      return <TroubleshootingPage />;
    case 'versions':
      return <VersionsPage />;
    case 'models':
      return (
        <ModelsPage
          inspection={options.inspection}
          environmentProbe={options.environmentProbe}
          tasks={options.tasks}
          fileProgress={options.fileProgress}
          onDownloadGenieBase={options.onDownloadGenieBase}
          onDownloadGsvLite={options.onDownloadGsvLite}
          onDownloadQwenTts06b={options.onDownloadQwenTts06b}
          onDownloadQwenTts17b={options.onDownloadQwenTts17b}
          onDownloadLumingGenieTts={options.onDownloadLumingGenieTts}
          onDownloadGsvBaoqiao={options.onDownloadGsvBaoqiao}
          onDownloadLocalEmbedding={options.onDownloadLocalEmbedding}
          onDownloadLlmTranslate={options.onDownloadLlmTranslate}
          onDownloadSherpaParaformer={options.onDownloadSherpaParaformer}
          onDownloadSileroVad={options.onDownloadSileroVad}
          modelStatuses={options.modelStatuses}
          scriptsReady={options.scriptsReady}
        />
      );
    case 'tools':
      return <ToolsPage />;
    case 'community':
      return <CommunityPage />;
    case 'console':
      return (
        <ConsolePage
          runtimeDriver={options.runtimeDriver}
          tasks={options.tasks}
          logs={options.logs}
          autoScroll={options.autoScroll}
          wrapLines={options.wrapLines}
          onSetAutoScroll={options.onSetAutoScroll}
          onSetWrapLines={options.onSetWrapLines}
          onClearLogs={options.onClearLogs}
          onExportLogs={options.onExportLogs}
        />
      );
    default: {
      const exhaustiveCheck: never = pageId;
      throw new Error(`Unhandled page id: ${exhaustiveCheck}`);
    }
  }
}
