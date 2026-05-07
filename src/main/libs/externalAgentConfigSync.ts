import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  CoworkAgentEngine,
  type CoworkAgentEngine as CoworkAgentEngineType,
  ExternalAgentConfigSource,
  type ExternalAgentConfigSource as ExternalAgentConfigSourceType,
} from '../../shared/cowork/constants';
import type { SqliteStore } from '../sqliteStore';
import { type CliAppType, getExternalAgentEnvironmentSnapshot } from './ccSwitchIntegration';
import { resolveCurrentApiConfig, resolveRawApiConfig } from './claudeSettings';
import type { CoworkApiConfig } from './coworkConfigStore';

type ModelProviderConfig = {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  apiFormat?: 'anthropic' | 'openai' | 'gemini';
  displayName?: string;
  models?: Array<{ id: string; name: string; supportsImage?: boolean }>;
};

type AppConfigForModelImport = {
  providers?: Record<string, ModelProviderConfig>;
};

type CcSwitchProviderRow = {
  id: string;
  name: string;
  settings_config: string;
  meta: string;
  category: string | null;
  created_at: number | null;
  sort_index: number | null;
  is_current: number;
};

type CcSwitchProviderRecord = {
  id: string;
  name: string;
  settingsConfig: Record<string, unknown>;
  meta: Record<string, unknown>;
  category: string | null;
  createdAt: number | null;
  sortIndex: number | null;
  isCurrent: boolean;
  baseUrl: string;
  endpoints: string[];
};

export interface ExternalAgentModelImportResult {
  success: boolean;
  appType?: CliAppType;
  imported?: boolean;
  duplicate?: boolean;
  providerKey?: string;
  providerName?: string;
  modelId?: string;
  providerConfig?: ModelProviderConfig;
  error?: string;
}

const CUSTOM_PROVIDER_KEYS = [
  'custom_0',
  'custom_1',
  'custom_2',
  'custom_3',
  'custom_4',
  'custom_5',
  'custom_6',
  'custom_7',
  'custom_8',
  'custom_9',
] as const;

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5';
const DEFAULT_CODEX_MODEL = 'gpt-5.4';
const CC_SWITCH_CLAUDE_COMMON_CONFIG_KEY = 'common_config_claude';
const CLAUDE_MODEL_ENV_KEYS = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_REASONING_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
] as const;

const homeDir = (): string => os.homedir();

const expandHome = (value: string): string => {
  return value.replace(/^~(?=$|\/|\\)/, homeDir());
};

const ensureParentDir = (filePath: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const atomicWrite = (filePath: string, content: string): void => {
  ensureParentDir(filePath);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
};

const readJsonObject = (filePath: string): Record<string, unknown> | null => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const writeJsonObject = (filePath: string, value: Record<string, unknown>): void => {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const getNestedRecord = (value: unknown, key: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : {};
};

const getString = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const parseJsonObject = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const normalizeBaseUrlForMatch = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed.toLowerCase();
  }
};

const normalizeProviderName = (value: string): string => {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
};

const baseUrlsMatch = (left: string, right: string): boolean => {
  const normalizedLeft = normalizeBaseUrlForMatch(left);
  const normalizedRight = normalizeBaseUrlForMatch(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const tomlString = (value: string): string => {
  return JSON.stringify(value);
};

const sanitizeProviderKey = (value: string): string => {
  const key = value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
  return key || 'wesight';
};

const buildCodexConfig = (providerName: string, baseUrl: string, model: string): string => {
  const providerKey = sanitizeProviderKey(providerName);
  return [
    `model_provider = ${tomlString(providerKey)}`,
    `model = ${tomlString(model || DEFAULT_CODEX_MODEL)}`,
    'model_reasoning_effort = "high"',
    'disable_response_storage = true',
    '',
    `[model_providers.${providerKey}]`,
    `name = ${tomlString(providerName || providerKey)}`,
    baseUrl.trim() ? `base_url = ${tomlString(baseUrl.trim())}` : '',
    'wire_api = "responses"',
    'requires_openai_auth = true',
    '',
  ].filter((line) => line !== '').join('\n');
};

const extractTomlString = (configText: string, key: string): string => {
  const match = configText.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, 'm'));
  return match?.[1]?.trim() ?? '';
};

const extractCodexProviderBaseUrl = (configText: string, provider: string): string => {
  if (!provider) return '';
  const escaped = provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tableMatch = configText.match(new RegExp(`\\[model_providers\\.${escaped}\\]([\\s\\S]*?)(?:\\n\\[|$)`));
  if (!tableMatch?.[1]) return '';
  return extractTomlString(tableMatch[1], 'base_url');
};

const getCliConfigPaths = (appType: CliAppType): { primaryConfigPath: string; secondaryConfigPaths: string[] } => {
  const snapshot = getExternalAgentEnvironmentSnapshot();
  const engine = snapshot.engines.find((item) => item.appType === appType);
  if (engine) {
    return {
      primaryConfigPath: engine.config.primaryConfigPath,
      secondaryConfigPaths: engine.config.secondaryConfigPaths,
    };
  }
  const configDir = appType === 'claude'
    ? path.join(homeDir(), '.claude')
    : path.join(homeDir(), '.codex');
  return {
    primaryConfigPath: appType === 'claude'
      ? path.join(configDir, 'settings.json')
      : path.join(configDir, 'config.toml'),
    secondaryConfigPaths: appType === 'claude'
      ? [path.join(homeDir(), '.claude.json')]
      : [path.join(configDir, 'auth.json')],
  };
};

const requireApiConfig = (resolution: ReturnType<typeof resolveRawApiConfig>): CoworkApiConfig => {
  if (!resolution.config) {
    throw new Error(resolution.error || 'No WeSight model is configured.');
  }
  return resolution.config;
};

const buildClaudeEnvForConfig = (
  existingEnv: Record<string, unknown>,
  config: CoworkApiConfig,
): Record<string, unknown> => {
  return {
    ...existingEnv,
    ANTHROPIC_AUTH_TOKEN: config.apiKey,
    ANTHROPIC_API_KEY: config.apiKey,
    ANTHROPIC_BASE_URL: config.baseURL,
    ANTHROPIC_MODEL: config.model,
    ANTHROPIC_REASONING_MODEL: config.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: config.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: config.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: config.model,
    ANTHROPIC_SMALL_FAST_MODEL: config.model,
  };
};

const mergeClaudeSettingsWithProvider = (
  existingSettings: Record<string, unknown>,
  commonConfig: Record<string, unknown>,
  providerSettingsConfig: Record<string, unknown>,
): Record<string, unknown> => {
  const existingEnv = getNestedRecord(existingSettings, 'env');
  const commonEnv = getNestedRecord(commonConfig, 'env');
  const providerEnv = getNestedRecord(providerSettingsConfig, 'env');
  const env = {
    ...existingEnv,
    ...commonEnv,
    ...providerEnv,
  };

  for (const key of CLAUDE_MODEL_ENV_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(commonEnv, key)
      && !Object.prototype.hasOwnProperty.call(providerEnv, key)) {
      delete env[key];
    }
  }

  return {
    ...existingSettings,
    ...commonConfig,
    ...providerSettingsConfig,
    env,
  };
};

const buildClaudeSettingsForConfig = (
  existingSettings: Record<string, unknown>,
  config: CoworkApiConfig,
): Record<string, unknown> => {
  return {
    ...existingSettings,
    env: buildClaudeEnvForConfig(getNestedRecord(existingSettings, 'env'), config),
  };
};

const getCcSwitchPaths = (): { dbPath: string; settingsPath: string } => {
  const appDir = path.join(homeDir(), '.cc-switch');
  return {
    dbPath: path.join(appDir, 'cc-switch.db'),
    settingsPath: path.join(appDir, 'settings.json'),
  };
};

const getCurrentCcSwitchProviderId = (settings: Record<string, unknown>): string | null => {
  const value = settings.currentProviderClaude ?? settings.current_provider_claude;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const writeCcSwitchCurrentProviderId = (settingsPath: string, providerId: string): void => {
  const settings = readJsonObject(settingsPath) ?? {};
  settings.currentProviderClaude = providerId;
  if (Object.prototype.hasOwnProperty.call(settings, 'current_provider_claude')) {
    settings.current_provider_claude = providerId;
  }
  writeJsonObject(settingsPath, settings);
};

const readCcSwitchCommonClaudeConfig = (db: Database.Database): Record<string, unknown> => {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ? LIMIT 1')
    .get(CC_SWITCH_CLAUDE_COMMON_CONFIG_KEY) as { value?: string } | undefined;
  return row?.value ? parseJsonObject(row.value) : {};
};

const readCcSwitchProviderEndpoints = (
  db: Database.Database,
  providerId: string,
): string[] => {
  try {
    const rows = db
      .prepare('SELECT url FROM provider_endpoints WHERE app_type = ? AND provider_id = ? ORDER BY id ASC')
      .all('claude', providerId) as Array<{ url?: string }>;
    return rows.map((row) => getString(row.url)).filter(Boolean);
  } catch {
    return [];
  }
};

const readCcSwitchClaudeProviders = (db: Database.Database): CcSwitchProviderRecord[] => {
  const rows = db
    .prepare(
      `
      SELECT id, name, settings_config, meta, category, created_at, sort_index, is_current
      FROM providers
      WHERE app_type = ?
      ORDER BY is_current DESC, COALESCE(sort_index, 999999), created_at ASC, id ASC
    `,
    )
    .all('claude') as CcSwitchProviderRow[];

  return rows.map((row) => {
    const settingsConfig = parseJsonObject(row.settings_config || '{}');
    const env = getNestedRecord(settingsConfig, 'env');
    return {
      id: row.id,
      name: row.name,
      settingsConfig,
      meta: parseJsonObject(row.meta || '{}'),
      category: row.category,
      createdAt: row.created_at,
      sortIndex: row.sort_index,
      isCurrent: Boolean(row.is_current),
      baseUrl: getString(env.ANTHROPIC_BASE_URL),
      endpoints: readCcSwitchProviderEndpoints(db, row.id),
    };
  });
};

const ccSwitchProviderMatchesBaseUrl = (
  provider: CcSwitchProviderRecord,
  baseUrl: string,
): boolean => {
  if (baseUrlsMatch(provider.baseUrl, baseUrl)) {
    return true;
  }
  return provider.endpoints.some((endpoint) => baseUrlsMatch(endpoint, baseUrl));
};

const formatProviderDisplayName = (providerName: string | undefined): string => {
  const normalized = providerName?.trim() || 'model';
  const knownNames: Record<string, string> = {
    anthropic: 'Anthropic',
    deepseek: 'DeepSeek',
    gemini: 'Gemini',
    kimi: 'Kimi',
    openai: 'OpenAI',
    qwen: 'Qwen',
    zhipu: 'Zhipu GLM',
  };
  return knownNames[normalized.toLowerCase()]
    ?? normalized
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const buildWesightCcSwitchProviderName = (providerName: string | undefined): string => {
  return `WeSight - ${formatProviderDisplayName(providerName)}`;
};

const findCcSwitchProviderForConfig = (
  providers: CcSwitchProviderRecord[],
  config: CoworkApiConfig,
  settingsCurrentProviderId: string | null,
  providerName: string | undefined,
): CcSwitchProviderRecord | null => {
  const currentProvider = providers.find((provider) => provider.id === settingsCurrentProviderId)
    ?? providers.find((provider) => provider.isCurrent)
    ?? null;
  if (currentProvider && ccSwitchProviderMatchesBaseUrl(currentProvider, config.baseURL)) {
    return currentProvider;
  }

  const baseUrlProvider = providers.find((provider) => ccSwitchProviderMatchesBaseUrl(provider, config.baseURL));
  if (baseUrlProvider) {
    return baseUrlProvider;
  }

  const wesightProviderName = normalizeProviderName(buildWesightCcSwitchProviderName(providerName));
  const existingWesightProvider = providers.find((provider) => {
    return normalizeProviderName(provider.name) === wesightProviderName
      || getString(provider.meta.managedBy) === 'wesight';
  });
  if (existingWesightProvider) {
    return existingWesightProvider;
  }

  const displayName = normalizeProviderName(formatProviderDisplayName(providerName));
  if (!displayName) {
    return null;
  }
  return providers.find((provider) => normalizeProviderName(provider.name) === displayName) ?? null;
};

const ensureCcSwitchProviderEndpoint = (
  db: Database.Database,
  providerId: string,
  baseUrl: string,
): void => {
  const normalizedBaseUrl = normalizeBaseUrlForMatch(baseUrl);
  if (!normalizedBaseUrl) return;
  const existingEndpoints = readCcSwitchProviderEndpoints(db, providerId);
  if (existingEndpoints.some((endpoint) => baseUrlsMatch(endpoint, normalizedBaseUrl))) {
    return;
  }
  db
    .prepare(
      `
      INSERT INTO provider_endpoints (provider_id, app_type, url, added_at)
      VALUES (?, ?, ?, ?)
    `,
    )
    .run(providerId, 'claude', normalizedBaseUrl, Date.now());
};

const upsertCcSwitchClaudeProvider = (
  db: Database.Database,
  config: CoworkApiConfig,
  providerName: string | undefined,
  settingsCurrentProviderId: string | null,
): { providerId: string; settingsConfig: Record<string, unknown> } => {
  const providers = readCcSwitchClaudeProviders(db);
  const targetProvider = findCcSwitchProviderForConfig(providers, config, settingsCurrentProviderId, providerName);
  const now = Date.now();
  const settingsConfig = buildClaudeSettingsForConfig(targetProvider?.settingsConfig ?? {}, config);
  const providerId = targetProvider?.id ?? randomUUID();
  const existingMeta = targetProvider?.meta ?? {};
  const meta = {
    ...existingMeta,
    commonConfigEnabled: true,
    endpointAutoSelect: true,
    apiFormat: 'anthropic',
    ...(targetProvider ? {} : { managedBy: 'wesight' }),
  };

  if (targetProvider) {
    db
      .prepare(
        `
        UPDATE providers
        SET name = ?, settings_config = ?, meta = ?, is_current = 1
        WHERE app_type = ? AND id = ?
      `,
      )
      .run(
        targetProvider.name,
        JSON.stringify(settingsConfig),
        JSON.stringify(meta),
        'claude',
        providerId,
      );
  } else {
    const maxSortIndex = providers.reduce((max, provider) => Math.max(max, provider.sortIndex ?? 0), 0);
    db
      .prepare(
        `
        INSERT INTO providers (
          id, app_type, name, settings_config, category, created_at, sort_index, meta, is_current, in_failover_queue
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
      `,
      )
      .run(
        providerId,
        'claude',
        buildWesightCcSwitchProviderName(providerName),
        JSON.stringify(settingsConfig),
        'wesight',
        now,
        maxSortIndex + 1,
        JSON.stringify(meta),
      );
  }

  db
    .prepare('UPDATE providers SET is_current = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE app_type = ?')
    .run(providerId, 'claude');
  ensureCcSwitchProviderEndpoint(db, providerId, config.baseURL);

  return { providerId, settingsConfig };
};

const trySyncClaudeCodeThroughCcSwitchProviders = (
  config: CoworkApiConfig,
  providerName: string | undefined,
  primaryConfigPath: string,
): boolean => {
  const { dbPath, settingsPath } = getCcSwitchPaths();
  if (!fs.existsSync(dbPath)) {
    return false;
  }

  let db: Database.Database | null = null;
  try {
    const ccSwitchSettings = readJsonObject(settingsPath) ?? {};
    db = new Database(dbPath, { fileMustExist: true });
    const settingsCurrentProviderId = getCurrentCcSwitchProviderId(ccSwitchSettings);
    let providerId = '';
    let providerSettingsConfig: Record<string, unknown> = {};

    const transaction = db.transaction(() => {
      const result = upsertCcSwitchClaudeProvider(db as Database.Database, config, providerName, settingsCurrentProviderId);
      providerId = result.providerId;
      providerSettingsConfig = result.settingsConfig;
    });
    transaction();

    const commonConfig = readCcSwitchCommonClaudeConfig(db);
    const liveSettings = mergeClaudeSettingsWithProvider(
      readJsonObject(primaryConfigPath) ?? {},
      commonConfig,
      providerSettingsConfig,
    );
    writeJsonObject(primaryConfigPath, liveSettings);
    writeCcSwitchCurrentProviderId(settingsPath, providerId);
    return true;
  } catch (error) {
    console.warn('[ExternalAgentConfigSync] cc-switch provider sync failed, falling back to direct Claude config sync:', error);
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close errors after config sync.
    }
  }
};

const syncClaudeCodeFromWesightModel = (): void => {
  const resolved = resolveCurrentApiConfig('local');
  const config = requireApiConfig(resolved);
  const paths = getCliConfigPaths('claude');
  if (trySyncClaudeCodeThroughCcSwitchProviders(
    config,
    resolved.providerMetadata?.providerName,
    paths.primaryConfigPath,
  )) {
    return;
  }

  const settings = readJsonObject(paths.primaryConfigPath) ?? {};
  writeJsonObject(paths.primaryConfigPath, buildClaudeSettingsForConfig(settings, config));
};

const syncCodexFromWesightModel = (): void => {
  const resolved = resolveRawApiConfig();
  const config = requireApiConfig(resolved);
  if (config.apiType === 'anthropic') {
    throw new Error('Codex 引擎跟随 WeSight 模型设置时，需要选择 OpenAI 兼容的模型配置。');
  }

  const providerName = resolved.providerMetadata?.providerName || 'wesight';
  const paths = getCliConfigPaths('codex');
  const authPath = paths.secondaryConfigPaths[0] || path.join(path.dirname(paths.primaryConfigPath), 'auth.json');
  const auth = readJsonObject(authPath) ?? {};

  atomicWrite(paths.primaryConfigPath, buildCodexConfig(providerName, config.baseURL, config.model));
  writeJsonObject(authPath, {
    ...auth,
    OPENAI_API_KEY: config.apiKey,
  });
};

export const applyExternalAgentConfigForEngine = (
  engine: CoworkAgentEngineType,
  source: ExternalAgentConfigSourceType,
): void => {
  if (source === ExternalAgentConfigSource.LocalCli) {
    return;
  }
  if (engine === CoworkAgentEngine.ClaudeCode) {
    syncClaudeCodeFromWesightModel();
    return;
  }
  if (engine === CoworkAgentEngine.Codex) {
    syncCodexFromWesightModel();
  }
};

const buildProviderConfig = (
  appType: CliAppType,
  input: { apiKey: string; baseUrl: string; model: string },
): ModelProviderConfig => {
  const displayName = appType === 'claude'
    ? 'Claude Code 本机配置'
    : 'Codex 本机配置';
  const modelId = input.model || (appType === 'claude' ? DEFAULT_CLAUDE_MODEL : DEFAULT_CODEX_MODEL);
  return {
    enabled: true,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    apiFormat: appType === 'claude' ? 'anthropic' : 'openai',
    displayName,
    models: [
      {
        id: modelId,
        name: modelId,
        supportsImage: false,
      },
    ],
  };
};

const readClaudeLocalConfig = (): { apiKey: string; baseUrl: string; model: string } => {
  const paths = getCliConfigPaths('claude');
  const settings = readJsonObject(expandHome(paths.primaryConfigPath));
  const env = getNestedRecord(settings, 'env');
  const apiKey = getString(env.ANTHROPIC_AUTH_TOKEN) || getString(env.ANTHROPIC_API_KEY);
  const baseUrl = getString(env.ANTHROPIC_BASE_URL);
  const model = getString(env.ANTHROPIC_MODEL)
    || getString(env.ANTHROPIC_DEFAULT_SONNET_MODEL)
    || getString(env.ANTHROPIC_DEFAULT_OPUS_MODEL)
    || getString(env.ANTHROPIC_DEFAULT_HAIKU_MODEL)
    || DEFAULT_CLAUDE_MODEL;

  if (!apiKey || !baseUrl) {
    throw new Error('本机 Claude Code 配置缺少可导入的 API Key 或 Base URL。');
  }
  return { apiKey, baseUrl, model };
};

const readCodexLocalConfig = (): { apiKey: string; baseUrl: string; model: string } => {
  const paths = getCliConfigPaths('codex');
  const configText = fs.existsSync(paths.primaryConfigPath)
    ? fs.readFileSync(paths.primaryConfigPath, 'utf8')
    : '';
  const authPath = paths.secondaryConfigPaths[0] || path.join(path.dirname(paths.primaryConfigPath), 'auth.json');
  const auth = readJsonObject(authPath) ?? {};
  const provider = extractTomlString(configText, 'model_provider');
  const apiKey = getString(auth.OPENAI_API_KEY);
  const baseUrl = extractCodexProviderBaseUrl(configText, provider);
  const model = extractTomlString(configText, 'model') || DEFAULT_CODEX_MODEL;

  if (!apiKey) {
    throw new Error('本机 Codex 配置看起来使用登录态，无法直接导入为 WeSight API 模型配置。可继续使用“本机 CLI 配置”模式。');
  }
  if (!baseUrl) {
    throw new Error('本机 Codex 配置缺少可导入的 Base URL。');
  }
  return { apiKey, baseUrl, model };
};

const valuesMatch = (left: string | undefined, right: string | undefined): boolean => {
  return (left ?? '').trim() === (right ?? '').trim();
};

const findDuplicateProvider = (
  providers: Record<string, ModelProviderConfig>,
  candidate: ModelProviderConfig,
): string | null => {
  const candidateModel = candidate.models?.[0]?.id ?? '';
  for (const [providerKey, providerConfig] of Object.entries(providers)) {
    const providerModel = providerConfig.models?.[0]?.id ?? '';
    if (
      valuesMatch(providerConfig.apiKey, candidate.apiKey)
      && valuesMatch(providerConfig.baseUrl, candidate.baseUrl)
      && valuesMatch(providerConfig.apiFormat, candidate.apiFormat)
      && valuesMatch(providerModel, candidateModel)
    ) {
      return providerKey;
    }
  }
  return null;
};

const findFreeCustomProviderKey = (providers: Record<string, ModelProviderConfig>): string | null => {
  return CUSTOM_PROVIDER_KEYS.find((key) => !providers[key]) ?? null;
};

export const importLocalAgentConfigToModelSettings = (
  store: SqliteStore,
  appType: CliAppType,
): ExternalAgentModelImportResult => {
  const localConfig = appType === 'claude'
    ? readClaudeLocalConfig()
    : readCodexLocalConfig();
  const providerConfig = buildProviderConfig(appType, localConfig);
  const appConfig = store.get<AppConfigForModelImport>('app_config') ?? {};
  const providers = { ...(appConfig.providers ?? {}) };
  const duplicateProviderKey = findDuplicateProvider(providers, providerConfig);
  const modelId = providerConfig.models?.[0]?.id ?? '';

  if (duplicateProviderKey) {
    return {
      success: true,
      appType,
      imported: false,
      duplicate: true,
      providerKey: duplicateProviderKey,
      providerName: providers[duplicateProviderKey]?.displayName,
      modelId,
      providerConfig: providers[duplicateProviderKey],
    };
  }

  const providerKey = findFreeCustomProviderKey(providers);
  if (!providerKey) {
    throw new Error('自定义模型配置槽位已满，请先删除一个自定义配置。');
  }

  providers[providerKey] = providerConfig;
  store.set('app_config', {
    ...appConfig,
    providers,
  });

  return {
    success: true,
    appType,
    imported: true,
    duplicate: false,
    providerKey,
    providerName: providerConfig.displayName,
    modelId,
    providerConfig,
  };
};
