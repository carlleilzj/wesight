import fs from 'fs';
import path from 'path';

import type { CoworkConfig } from '../coworkStore';
import { resolveRawApiConfig } from './claudeSettings';
import type { CoworkApiConfig } from './coworkConfigStore';
import type { HermesEngineManager, HermesEngineStatus } from './hermesEngineManager';

export interface HermesConfigSyncResult {
  success: boolean;
  changed: boolean;
  status?: HermesEngineStatus;
  error?: string;
}

type HermesConfigSyncDeps = {
  engineManager: HermesEngineManager;
  getCoworkConfig: () => CoworkConfig;
};

const atomicWrite = (filePath: string, content: string, mode?: number): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode });
  fs.renameSync(tmpPath, filePath);
};

const readText = (filePath: string): string => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
};

const writeIfChanged = (filePath: string, content: string, mode?: number): boolean => {
  if (readText(filePath) === content) return false;
  atomicWrite(filePath, content, mode);
  return true;
};

const yamlString = (value: string): string => JSON.stringify(value);

const normalizeBaseUrl = (baseURL: string): string => baseURL.trim().replace(/\/+$/, '');

const buildProviderName = (config: CoworkApiConfig): 'custom' | 'anthropic' => {
  return config.apiType === 'openai' ? 'custom' : 'anthropic';
};

const buildHermesConfigYaml = (
  apiConfig: CoworkApiConfig | null,
  coworkConfig: CoworkConfig,
): string => {
  const workspace = (coworkConfig.workingDirectory || '').trim();
  const provider = apiConfig ? buildProviderName(apiConfig) : 'custom';
  const model = apiConfig?.model.trim() || 'default-model';
  const baseUrl = apiConfig ? normalizeBaseUrl(apiConfig.baseURL) : '';
  const lines = [
    '# Managed by WeSight. Do not edit while WeSight is running.',
    'model:',
    `  provider: ${yamlString(provider)}`,
    `  default: ${yamlString(model)}`,
    ...(baseUrl ? [`  base_url: ${yamlString(baseUrl)}`] : []),
    'terminal:',
    '  backend: "local"',
    ...(workspace ? [`  cwd: ${yamlString(path.resolve(workspace))}`] : []),
    '  timeout: 3600',
    '  lifetime_seconds: 3600',
    'display:',
    '  compact: true',
    '  tool_progress: all',
    'compression:',
    '  enabled: true',
    'api_server:',
    '  enabled: true',
    '  host: "127.0.0.1"',
    '',
  ];
  return `${lines.join('\n')}`;
};

const buildHermesEnv = (
  apiConfig: CoworkApiConfig | null,
): Record<string, string> => {
  if (!apiConfig) {
    return {
      HERMES_SKIP_SETUP: '1',
      HERMES_NO_SETUP: '1',
    };
  }

  const provider = buildProviderName(apiConfig);
  const baseUrl = normalizeBaseUrl(apiConfig.baseURL);
  const common = {
    HERMES_SKIP_SETUP: '1',
    HERMES_NO_SETUP: '1',
    HERMES_INFERENCE_PROVIDER: provider,
    HERMES_INFERENCE_MODEL: apiConfig.model,
    HERMES_INFERENCE_BASE_URL: baseUrl,
    HERMES_INFERENCE_API_KEY: apiConfig.apiKey,
    HERMES_MODEL: apiConfig.model,
  };

  if (apiConfig.apiType === 'openai') {
    return {
      ...common,
      OPENAI_API_KEY: apiConfig.apiKey,
      OPENAI_BASE_URL: baseUrl,
    };
  }

  return {
    ...common,
    ANTHROPIC_API_KEY: apiConfig.apiKey,
    ANTHROPIC_AUTH_TOKEN: apiConfig.apiKey,
    ANTHROPIC_BASE_URL: baseUrl,
  };
};

const buildDotenv = (env: Record<string, string>): string => {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n') + '\n';
};

export class HermesConfigSync {
  private readonly engineManager: HermesEngineManager;
  private readonly getCoworkConfig: () => CoworkConfig;

  constructor(deps: HermesConfigSyncDeps) {
    this.engineManager = deps.engineManager;
    this.getCoworkConfig = deps.getCoworkConfig;
  }

  sync(_reason: string): HermesConfigSyncResult {
    try {
      const apiResolution = resolveRawApiConfig();
      const apiConfig = apiResolution.config;
      const coworkConfig = this.getCoworkConfig();
      const yaml = buildHermesConfigYaml(apiConfig, coworkConfig);
      const env = buildHermesEnv(apiConfig);
      this.engineManager.setSecretEnvVars(env);

      const changedConfig = writeIfChanged(this.engineManager.getConfigPath(), yaml);
      const changedEnv = writeIfChanged(this.engineManager.getEnvPath(), buildDotenv(env), 0o600);
      return {
        success: true,
        changed: changedConfig || changedEnv,
      };
    } catch (error) {
      return {
        success: false,
        changed: false,
        status: this.engineManager.getStatus(),
        error: error instanceof Error ? error.message : 'Failed to sync Hermes Agent config.',
      };
    }
  }
}
