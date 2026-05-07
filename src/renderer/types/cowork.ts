import type { CoworkAgentEngine, ExternalAgentConfigSource } from '@shared/cowork/constants';

// Cowork image attachment for vision-capable models
export interface CoworkImageAttachment {
  name: string;
  mimeType: string;
  base64Data: string;
}

// Cowork session status
export type CoworkSessionStatus = 'idle' | 'running' | 'completed' | 'error';

// Cowork message types
export type CoworkMessageType = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';

// Cowork execution mode
export type CoworkExecutionMode = 'auto' | 'local' | 'sandbox';
export type { CoworkAgentEngine, ExternalAgentConfigSource };

// Cowork message metadata
export interface CoworkMessageMetadata {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolUseId?: string | null;
  error?: string;
  isError?: boolean;
  isStreaming?: boolean;
  isFinal?: boolean;
  isThinking?: boolean;
  skillIds?: string[];  // Skills used for this message
  [key: string]: unknown;
}

// Cowork message
export interface CoworkMessage {
  id: string;
  type: CoworkMessageType;
  content: string;
  timestamp: number;
  metadata?: CoworkMessageMetadata;
}

// Cowork session
export interface CoworkSession {
  id: string;
  title: string;
  claudeSessionId: string | null;
  status: CoworkSessionStatus;
  pinned: boolean;
  cwd: string;
  systemPrompt: string;
  executionMode: CoworkExecutionMode;
  activeSkillIds: string[];
  agentId: string;
  messages: CoworkMessage[];
  createdAt: number;
  updatedAt: number;
}

// Cowork configuration
export interface CoworkConfig {
  workingDirectory: string;
  systemPrompt: string;
  executionMode: CoworkExecutionMode;
  agentEngine: CoworkAgentEngine;
  claudeCodeConfigSource: ExternalAgentConfigSource;
  codexConfigSource: ExternalAgentConfigSource;
  memoryEnabled: boolean;
  memoryImplicitUpdateEnabled: boolean;
  memoryLlmJudgeEnabled: boolean;
  memoryGuardLevel: 'strict' | 'standard' | 'relaxed';
  memoryUserMemoriesMaxItems: number;
}

export type CoworkConfigUpdate = Partial<Pick<
  CoworkConfig,
  | 'workingDirectory'
  | 'executionMode'
  | 'agentEngine'
  | 'claudeCodeConfigSource'
  | 'codexConfigSource'
  | 'memoryEnabled'
  | 'memoryImplicitUpdateEnabled'
  | 'memoryLlmJudgeEnabled'
  | 'memoryGuardLevel'
  | 'memoryUserMemoriesMaxItems'
>>;

export interface CoworkApiConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  apiType?: 'anthropic' | 'openai';
}

export type OpenClawEnginePhase =
  | 'not_installed'
  | 'installing'
  | 'ready'
  | 'starting'
  | 'running'
  | 'error';

export interface OpenClawEngineStatus {
  phase: OpenClawEnginePhase;
  version: string | null;
  progressPercent?: number;
  message?: string;
  canRetry: boolean;
}

export type HermesEngineStatus = OpenClawEngineStatus;

export interface CoworkUserMemoryEntry {
  id: string;
  text: string;
}

export interface CoworkMemoryStats {
  total: number;
  created: number;
  stale: number;
  deleted: number;
  explicit: number;
  implicit: number;
}

// Cowork pending permission request
export interface CoworkPermissionRequest {
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  requestId: string;
  toolUseId?: string | null;
}

export type CoworkPermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: Record<string, unknown>[];
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };

// Cowork permission response
export interface CoworkPermissionResponse {
  requestId: string;
  result: CoworkPermissionResult;
}

// Session summary for list display (without full messages)
export interface CoworkSessionSummary {
  id: string;
  title: string;
  status: CoworkSessionStatus;
  pinned: boolean;
  agentId?: string;
  createdAt: number;
  updatedAt: number;
}

// Start session options
export interface CoworkStartOptions {
  prompt: string;
  cwd?: string;
  systemPrompt?: string;
  title?: string;
  activeSkillIds?: string[];
  agentId?: string;
  imageAttachments?: CoworkImageAttachment[];
}

// Continue session options
export interface CoworkContinueOptions {
  sessionId: string;
  prompt: string;
  systemPrompt?: string;
  activeSkillIds?: string[];
  imageAttachments?: CoworkImageAttachment[];
}

// IPC result types
export interface CoworkSessionResult {
  success: boolean;
  session?: CoworkSession;
  error?: string;
}

export interface CoworkSessionListResult {
  success: boolean;
  sessions?: CoworkSessionSummary[];
  error?: string;
}

export interface CoworkConfigResult {
  success: boolean;
  config?: CoworkConfig;
  error?: string;
}

export type CliAppType = 'claude' | 'codex';

export interface CliAppConfigSnapshot {
  appType: CliAppType;
  configDir: string;
  primaryConfigPath: string;
  secondaryConfigPaths: string[];
  configExists: boolean;
  currentProviderId: string | null;
  currentProviderName: string | null;
  providerCount: number;
}

export interface CliCommandStatus {
  engine: Extract<CoworkAgentEngine, 'claude_code' | 'codex'>;
  appType: CliAppType;
  command: string;
  found: boolean;
  path: string | null;
  version: string | null;
  error: string | null;
  config: CliAppConfigSnapshot;
}

export interface CcSwitchSnapshot {
  installed: boolean;
  appDir: string;
  dbPath: string;
  settingsPath: string;
  settingsExists: boolean;
  databaseExists: boolean;
  claudeConfigDirOverride: string | null;
  codexConfigDirOverride: string | null;
}

export interface ExternalAgentEnvironmentSnapshot {
  ccSwitch: CcSwitchSnapshot;
  engines: CliCommandStatus[];
}

export type ExternalAgentProviderAppType = CliAppType;

export type ExternalAgentCliInstallPhase =
  | 'starting'
  | 'installing'
  | 'verifying'
  | 'success'
  | 'error'
  | 'unsupported';

export interface ExternalAgentCliInstallProgress {
  appType: ExternalAgentProviderAppType;
  phase: ExternalAgentCliInstallPhase;
  message: string;
  detail?: string;
}

export interface ExternalAgentCliInstallResult {
  success: boolean;
  appType?: ExternalAgentProviderAppType;
  installMethod?: string;
  command?: string;
  binaryPath?: string | null;
  version?: string | null;
  snapshot?: ExternalAgentEnvironmentSnapshot;
  error?: string;
  unsupported?: boolean;
}

export interface ExternalAgentProviderSummary {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ExternalAgentProvider {
  id: string;
  appType: ExternalAgentProviderAppType;
  name: string;
  settingsConfig: Record<string, unknown>;
  category: string | null;
  isCurrent: boolean;
  createdAt: number;
  updatedAt: number;
  summary: ExternalAgentProviderSummary;
}

export interface ExternalAgentProviderInput {
  appType: ExternalAgentProviderAppType;
  id?: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  settingsConfig?: Record<string, unknown>;
  category?: string | null;
  setCurrent?: boolean;
}

export interface ExternalAgentProviderListResult {
  success: boolean;
  appType?: ExternalAgentProviderAppType;
  providers?: ExternalAgentProvider[];
  currentProviderId?: string | null;
  liveConfigPaths?: {
    primaryConfigPath: string;
    secondaryConfigPaths: string[];
  };
  provider?: ExternalAgentProvider | null;
  imported?: number;
  error?: string;
}

export interface ExternalAgentModelImportResult {
  success: boolean;
  appType?: ExternalAgentProviderAppType;
  imported?: boolean;
  duplicate?: boolean;
  providerKey?: string;
  providerName?: string;
  modelId?: string;
  providerConfig?: {
    enabled: boolean;
    apiKey: string;
    baseUrl: string;
    apiFormat: 'anthropic' | 'openai';
    displayName?: string;
    models: Array<{ id: string; name: string; supportsImage?: boolean }>;
  };
  error?: string;
}

export interface CoworkAgentEngineListResult {
  success: boolean;
  snapshot?: ExternalAgentEnvironmentSnapshot;
  error?: string;
}

// Stream event types for IPC communication
export type CoworkStreamEventType =
  | 'message'
  | 'tool_use'
  | 'tool_result'
  | 'permission_request'
  | 'complete'
  | 'error';

export interface CoworkStreamEvent {
  type: CoworkStreamEventType;
  sessionId: string;
  data: {
    message?: CoworkMessage;
    permission?: CoworkPermissionRequest;
    error?: string;
    claudeSessionId?: string;
  };
}
