export const CoworkAgentEngine = {
  YdCowork: 'yd_cowork',
  OpenClaw: 'openclaw',
  Hermes: 'hermes',
  ClaudeCode: 'claude_code',
  Codex: 'codex',
} as const;

export type CoworkAgentEngine = typeof CoworkAgentEngine[keyof typeof CoworkAgentEngine];

export const CoworkAgentEngineValues = [
  CoworkAgentEngine.YdCowork,
  CoworkAgentEngine.OpenClaw,
  CoworkAgentEngine.Hermes,
  CoworkAgentEngine.ClaudeCode,
  CoworkAgentEngine.Codex,
] as const;

export const CliCoworkAgentEngines = [
  CoworkAgentEngine.ClaudeCode,
  CoworkAgentEngine.Codex,
] as const;

export type CliCoworkAgentEngine = typeof CliCoworkAgentEngines[number];

export const ExternalAgentConfigSource = {
  WesightModel: 'wesight_model',
  LocalCli: 'local_cli',
} as const;

export type ExternalAgentConfigSource = typeof ExternalAgentConfigSource[keyof typeof ExternalAgentConfigSource];

export const ExternalAgentConfigSourceValues = [
  ExternalAgentConfigSource.WesightModel,
  ExternalAgentConfigSource.LocalCli,
] as const;

export function isCoworkAgentEngine(value: unknown): value is CoworkAgentEngine {
  return typeof value === 'string'
    && CoworkAgentEngineValues.includes(value as CoworkAgentEngine);
}

export function isExternalAgentConfigSource(value: unknown): value is ExternalAgentConfigSource {
  return typeof value === 'string'
    && ExternalAgentConfigSourceValues.includes(value as ExternalAgentConfigSource);
}

export function isCliCoworkAgentEngine(value: unknown): value is CliCoworkAgentEngine {
  return typeof value === 'string'
    && CliCoworkAgentEngines.includes(value as CliCoworkAgentEngine);
}

export function isOpenClawCoworkAgentEngine(value: unknown): boolean {
  return value === CoworkAgentEngine.OpenClaw;
}

export const CoworkIpcChannel = {
  AgentProvidersList: 'cowork:agentProviders:list',
  AgentProvidersSave: 'cowork:agentProviders:save',
  AgentProvidersDelete: 'cowork:agentProviders:delete',
  AgentProvidersSetCurrent: 'cowork:agentProviders:setCurrent',
  AgentProvidersImportLive: 'cowork:agentProviders:importLive',
  AgentConfigImportLocalToModelSettings: 'cowork:agentConfig:importLocalToModelSettings',
  AgentCliInstall: 'cowork:agentCli:install',
  AgentCliInstallProgress: 'cowork:agentCli:installProgress',
} as const;
export type CoworkIpcChannel = typeof CoworkIpcChannel[keyof typeof CoworkIpcChannel];
