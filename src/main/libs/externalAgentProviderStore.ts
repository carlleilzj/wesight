import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { type CliAppType } from './ccSwitchIntegration';

export type ExternalAgentProviderAppType = CliAppType;

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

export interface ExternalAgentProviderSummary {
  apiKey: string;
  baseUrl: string;
  model: string;
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
  appType: ExternalAgentProviderAppType;
  providers: ExternalAgentProvider[];
  currentProviderId: string | null;
  liveConfigPaths: {
    primaryConfigPath: string;
    secondaryConfigPaths: string[];
  };
}

type ExternalAgentProviderRow = {
  id: string;
  app_type: ExternalAgentProviderAppType;
  name: string;
  settings_config: string;
  category: string | null;
  is_current: number;
  created_at: number;
  updated_at: number;
};

type CcSwitchProviderRow = {
  id: string;
  name: string;
  settings_config: string;
  meta?: string | null;
  category?: string | null;
  is_current?: number | null;
  created_at?: number | null;
};

const CLAUDE_APP_TYPE: ExternalAgentProviderAppType = 'claude';
const CODEX_APP_TYPE: ExternalAgentProviderAppType = 'codex';
const INTERNAL_META_KEY = '__wesightProviderMeta';

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5';
const DEFAULT_CODEX_MODEL = 'gpt-5.4';

const homeDir = (): string => os.homedir();

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

const normalizePathSetting = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? path.resolve(trimmed.replace(/^~(?=$|\/|\\)/, homeDir())) : null;
};

const readCcSwitchSettings = (): Record<string, unknown> => {
  return readJsonObject(path.join(homeDir(), '.cc-switch', 'settings.json')) ?? {};
};

const parseJsonObject = (value: string | null | undefined): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const getClaudeConfigDir = (): string => {
  const settings = readCcSwitchSettings();
  return normalizePathSetting(settings.claudeConfigDir)
    ?? normalizePathSetting(settings.claude_config_dir)
    ?? path.join(homeDir(), '.claude');
};

const getCodexConfigDir = (): string => {
  const settings = readCcSwitchSettings();
  return normalizePathSetting(settings.codexConfigDir)
    ?? normalizePathSetting(settings.codex_config_dir)
    ?? path.join(homeDir(), '.codex');
};

const getClaudeSettingsPath = (): string => {
  const configDir = getClaudeConfigDir();
  const settingsPath = path.join(configDir, 'settings.json');
  if (fs.existsSync(settingsPath)) return settingsPath;
  const legacyPath = path.join(configDir, 'claude.json');
  if (fs.existsSync(legacyPath)) return legacyPath;
  return settingsPath;
};

const getCodexAuthPath = (): string => path.join(getCodexConfigDir(), 'auth.json');
const getCodexConfigPath = (): string => path.join(getCodexConfigDir(), 'config.toml');

const getLiveConfigPaths = (appType: ExternalAgentProviderAppType): ExternalAgentProviderListResult['liveConfigPaths'] => {
  if (appType === CLAUDE_APP_TYPE) {
    return {
      primaryConfigPath: getClaudeSettingsPath(),
      secondaryConfigPaths: [],
    };
  }
  return {
    primaryConfigPath: getCodexConfigPath(),
    secondaryConfigPaths: [getCodexAuthPath()],
  };
};

const atomicWrite = (filePath: string, content: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
};

const writeJsonFile = (filePath: string, value: unknown): void => {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const sanitizeProviderKey = (value: string): string => {
  const key = value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
  return key || 'custom';
};

const tomlString = (value: string): string => {
  return JSON.stringify(value);
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

const getNestedRecord = (value: unknown, key: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : {};
};

const getString = (value: unknown): string => {
  return typeof value === 'string' ? value : '';
};

const extractTomlString = (configText: string, key: string): string => {
  const match = configText.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, 'm'));
  return match?.[1] ?? '';
};

const extractCodexProviderBaseUrl = (configText: string): string => {
  const provider = extractTomlString(configText, 'model_provider');
  if (!provider) {
    return extractTomlString(configText, 'base_url');
  }
  const tableMatch = configText.match(new RegExp(`\\[model_providers\\.${provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]([\\s\\S]*?)(?:\\n\\[|$)`));
  return extractTomlString(tableMatch?.[1] ?? '', 'base_url');
};

const summarizeProvider = (
  appType: ExternalAgentProviderAppType,
  settingsConfig: Record<string, unknown>,
): ExternalAgentProviderSummary => {
  if (appType === CLAUDE_APP_TYPE) {
    const env = getNestedRecord(settingsConfig, 'env');
    return {
      apiKey: getString(env.ANTHROPIC_AUTH_TOKEN) || getString(env.ANTHROPIC_API_KEY),
      baseUrl: getString(env.ANTHROPIC_BASE_URL),
      model: getString(env.ANTHROPIC_MODEL)
        || getString(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
    };
  }

  const auth = getNestedRecord(settingsConfig, 'auth');
  const configText = getString(settingsConfig.config);
  return {
    apiKey: getString(auth.OPENAI_API_KEY),
    baseUrl: extractCodexProviderBaseUrl(configText),
    model: extractTomlString(configText, 'model'),
  };
};

const buildSettingsConfigFromInput = (input: ExternalAgentProviderInput): Record<string, unknown> => {
  if (input.settingsConfig && typeof input.settingsConfig === 'object') {
    return input.settingsConfig;
  }

  if (input.appType === CLAUDE_APP_TYPE) {
    const model = input.model?.trim() || DEFAULT_CLAUDE_MODEL;
    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: input.baseUrl?.trim() || '',
      ANTHROPIC_API_KEY: input.apiKey?.trim() || '',
      ANTHROPIC_AUTH_TOKEN: input.apiKey?.trim() || '',
      ANTHROPIC_MODEL: model,
      ANTHROPIC_REASONING_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_SMALL_FAST_MODEL: model,
    };
    return { env };
  }

  const model = input.model?.trim() || DEFAULT_CODEX_MODEL;
  return {
    auth: {
      OPENAI_API_KEY: input.apiKey?.trim() || '',
    },
    config: buildCodexConfig(input.name, input.baseUrl?.trim() || '', model),
  };
};

export const appTypeFromEngine = (engine: string): ExternalAgentProviderAppType | null => {
  if (engine === 'claude_code') return CLAUDE_APP_TYPE;
  if (engine === 'codex') return CODEX_APP_TYPE;
  return null;
};

export class ExternalAgentProviderStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  listProviders(appType: ExternalAgentProviderAppType): ExternalAgentProviderListResult {
    this.syncConfiguredProviders(appType);
    const rows = this.db
      .prepare(
        `
        SELECT id, app_type, name, settings_config, category, is_current, created_at, updated_at
        FROM external_agent_providers
        WHERE app_type = ?
        ORDER BY is_current DESC, updated_at DESC, created_at DESC
      `,
      )
      .all(appType) as ExternalAgentProviderRow[];
    const providers = rows.map((row) => this.mapProviderRow(row));
    return {
      appType,
      providers,
      currentProviderId: providers.find((provider) => provider.isCurrent)?.id ?? null,
      liveConfigPaths: getLiveConfigPaths(appType),
    };
  }

  saveProvider(input: ExternalAgentProviderInput): ExternalAgentProvider {
    const now = Date.now();
    const id = input.id?.trim() || crypto.randomUUID();
    const name = input.name.trim();
    if (!name) {
      throw new Error('Provider name is required.');
    }
    const settingsConfig = buildSettingsConfigFromInput(input);
    const existing = this.db
      .prepare('SELECT created_at FROM external_agent_providers WHERE app_type = ? AND id = ?')
      .get(input.appType, id) as { created_at: number } | undefined;
    this.db
      .prepare(
        `
        INSERT INTO external_agent_providers (
          id, app_type, name, settings_config, category, is_current, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id, app_type) DO UPDATE SET
          name = excluded.name,
          settings_config = excluded.settings_config,
          category = excluded.category,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        id,
        input.appType,
        name,
        JSON.stringify(settingsConfig),
        input.category ?? null,
        existing?.created_at ?? now,
        now,
      );

    if (input.setCurrent) {
      this.setCurrentProvider(input.appType, id);
    }

    const provider = this.getProvider(input.appType, id);
    if (!provider) {
      throw new Error('Provider was not saved.');
    }
    return provider;
  }

  deleteProvider(appType: ExternalAgentProviderAppType, id: string): void {
    const current = this.getProvider(appType, id)?.isCurrent ?? false;
    this.db
      .prepare('DELETE FROM external_agent_providers WHERE app_type = ? AND id = ?')
      .run(appType, id);
    if (current) {
      const fallback = this.db
        .prepare(
          `
          SELECT id FROM external_agent_providers
          WHERE app_type = ?
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        `,
        )
        .get(appType) as { id: string } | undefined;
      if (fallback?.id) {
        this.setCurrentProvider(appType, fallback.id);
      }
    }
  }

  setCurrentProvider(appType: ExternalAgentProviderAppType, id: string): ExternalAgentProvider {
    const provider = this.getProvider(appType, id);
    if (!provider) {
      throw new Error('Provider not found.');
    }
    const transaction = this.db.transaction(() => {
      this.db
        .prepare('UPDATE external_agent_providers SET is_current = 0 WHERE app_type = ?')
        .run(appType);
      this.db
        .prepare('UPDATE external_agent_providers SET is_current = 1, updated_at = ? WHERE app_type = ? AND id = ?')
        .run(Date.now(), appType, id);
    });
    transaction();
    this.applyProviderToLive(provider);
    const updated = this.getProvider(appType, id);
    if (!updated) {
      throw new Error('Provider not found after switch.');
    }
    return updated;
  }

  getCurrentProvider(appType: ExternalAgentProviderAppType): ExternalAgentProvider | null {
    this.syncConfiguredProviders(appType);
    const row = this.db
      .prepare(
        `
        SELECT id, app_type, name, settings_config, category, is_current, created_at, updated_at
        FROM external_agent_providers
        WHERE app_type = ? AND is_current = 1
        LIMIT 1
      `,
      )
      .get(appType) as ExternalAgentProviderRow | undefined;
    return row ? this.mapProviderRow(row) : null;
  }

  applyCurrentProvider(appType: ExternalAgentProviderAppType): void {
    const row = this.db
      .prepare(
        `
        SELECT id, app_type, name, settings_config, category, is_current, created_at, updated_at
        FROM external_agent_providers
        WHERE app_type = ? AND is_current = 1
        LIMIT 1
      `,
      )
      .get(appType) as ExternalAgentProviderRow | undefined;
    if (row) {
      this.applyProviderToLive(this.mapProviderRow(row));
    }
  }

  importLiveProvider(appType: ExternalAgentProviderAppType): ExternalAgentProvider | null {
    const settingsConfig = this.readLiveSettingsConfig(appType);
    if (!settingsConfig) return null;
    const existing = this.getProvider(appType, 'local-live');
    return this.saveProvider({
      appType,
      id: existing?.id ?? 'local-live',
      name: appType === CLAUDE_APP_TYPE ? 'Local Claude Code' : 'Local Codex',
      settingsConfig,
      category: 'local',
      setCurrent: !this.getCurrentProviderId(appType),
    });
  }

  importCcSwitchProviders(appType: ExternalAgentProviderAppType, options: { seedCurrent?: boolean } = {}): number {
    const dbPath = path.join(homeDir(), '.cc-switch', 'cc-switch.db');
    if (!fs.existsSync(dbPath)) return 0;
    let sourceDb: Database.Database | null = null;
    try {
      sourceDb = new Database(dbPath, { readonly: true, fileMustExist: true });
      const currentProviderId = this.getCcSwitchCurrentProviderId(appType);
      let shouldSeedCurrent = Boolean(options.seedCurrent && !this.getCurrentProviderId(appType));
      const rows = sourceDb
        .prepare(
          `
          SELECT id, name, settings_config, meta, category, is_current, created_at
          FROM providers
          WHERE app_type = ?
          ORDER BY COALESCE(sort_index, 999999), created_at ASC, id ASC
        `,
        )
        .all(appType) as CcSwitchProviderRow[];
      let imported = 0;
      for (const row of rows) {
        const settingsConfig = JSON.parse(row.settings_config || '{}') as Record<string, unknown>;
        const meta = parseJsonObject(row.meta);
        if (Object.keys(meta).length > 0) {
          settingsConfig[INTERNAL_META_KEY] = meta;
        }
        const isCurrent = currentProviderId
          ? row.id === currentProviderId
          : Boolean(row.is_current);
        this.saveProvider({
          appType,
          id: `ccswitch-${row.id}`,
          name: row.name,
          settingsConfig,
          category: row.category ?? 'cc-switch',
          setCurrent: shouldSeedCurrent && isCurrent,
        });
        if (shouldSeedCurrent && isCurrent) {
          shouldSeedCurrent = false;
        }
        imported += 1;
      }
      if (shouldSeedCurrent && rows[0]?.id) {
        this.setCurrentProvider(appType, `ccswitch-${rows[0].id}`);
      }
      return imported;
    } finally {
      try {
        sourceDb?.close();
      } catch {
        // Ignore snapshot close failures.
      }
    }
  }

  private getProvider(appType: ExternalAgentProviderAppType, id: string): ExternalAgentProvider | null {
    const row = this.db
      .prepare(
        `
        SELECT id, app_type, name, settings_config, category, is_current, created_at, updated_at
        FROM external_agent_providers
        WHERE app_type = ? AND id = ?
      `,
      )
      .get(appType, id) as ExternalAgentProviderRow | undefined;
    return row ? this.mapProviderRow(row) : null;
  }

  private getCcSwitchCurrentProviderId(appType: ExternalAgentProviderAppType): string | null {
    const settings = readCcSwitchSettings();
    const value = appType === CLAUDE_APP_TYPE
      ? settings.currentProviderClaude ?? settings.current_provider_claude
      : settings.currentProviderCodex ?? settings.current_provider_codex;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private getCurrentProviderId(appType: ExternalAgentProviderAppType): string | null {
    const row = this.db
      .prepare('SELECT id FROM external_agent_providers WHERE app_type = ? AND is_current = 1 LIMIT 1')
      .get(appType) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private deleteLiveProviderSnapshot(appType: ExternalAgentProviderAppType): boolean {
    const row = this.db
      .prepare('SELECT is_current FROM external_agent_providers WHERE app_type = ? AND id = ? LIMIT 1')
      .get(appType, 'local-live') as { is_current?: number } | undefined;
    if (!row) return false;
    this.db
      .prepare('DELETE FROM external_agent_providers WHERE app_type = ? AND id = ?')
      .run(appType, 'local-live');
    return Boolean(row.is_current);
  }

  private stripInternalSettingsConfig(settingsConfig: Record<string, unknown>): Record<string, unknown> {
    const next = { ...settingsConfig };
    delete next[INTERNAL_META_KEY];
    return next;
  }

  private getCcSwitchProviderId(provider: ExternalAgentProvider): string | null {
    if (!provider.id.startsWith('ccswitch-')) return null;
    return provider.id.slice('ccswitch-'.length);
  }

  private writeCcSwitchCurrentProvider(appType: ExternalAgentProviderAppType, provider: ExternalAgentProvider): void {
    const providerId = this.getCcSwitchProviderId(provider);
    if (!providerId) return;

    const appDir = path.join(homeDir(), '.cc-switch');
    const settingsPath = path.join(appDir, 'settings.json');
    const dbPath = path.join(appDir, 'cc-switch.db');
    const settings = readJsonObject(settingsPath) ?? {};
    if (appType === CLAUDE_APP_TYPE) {
      settings.currentProviderClaude = providerId;
      if (Object.prototype.hasOwnProperty.call(settings, 'current_provider_claude')) {
        settings.current_provider_claude = providerId;
      }
    } else {
      settings.currentProviderCodex = providerId;
      if (Object.prototype.hasOwnProperty.call(settings, 'current_provider_codex')) {
        settings.current_provider_codex = providerId;
      }
    }
    writeJsonFile(settingsPath, settings);

    if (!fs.existsSync(dbPath)) return;
    let sourceDb: Database.Database | null = null;
    try {
      sourceDb = new Database(dbPath);
      sourceDb
        .prepare('UPDATE providers SET is_current = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE app_type = ?')
        .run(providerId, appType);
    } finally {
      try {
        sourceDb?.close();
      } catch {
        // Ignore close errors after syncing the local provider pointer.
      }
    }
  }

  private selectCcSwitchCurrentProvider(appType: ExternalAgentProviderAppType): void {
    const currentProviderId = this.getCcSwitchCurrentProviderId(appType);
    const currentProvider = currentProviderId
      ? this.getProvider(appType, `ccswitch-${currentProviderId}`)
      : null;
    if (currentProvider) {
      this.setCurrentProvider(appType, currentProvider.id);
      return;
    }

    const row = this.db
      .prepare(
        `
        SELECT id FROM external_agent_providers
        WHERE app_type = ? AND id LIKE 'ccswitch-%'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      )
      .get(appType) as { id: string } | undefined;
    if (row?.id) {
      this.setCurrentProvider(appType, row.id);
    }
  }

  private importLiveProviderIfEmpty(appType: ExternalAgentProviderAppType): void {
    const row = this.db
      .prepare('SELECT id FROM external_agent_providers WHERE app_type = ? LIMIT 1')
      .get(appType);
    if (!row) {
      this.importLiveProvider(appType);
    }
  }

  private syncConfiguredProviders(appType: ExternalAgentProviderAppType): void {
    const hasCurrent = Boolean(this.getCurrentProviderId(appType));
    const imported = this.importCcSwitchProviders(appType, { seedCurrent: !hasCurrent });
    if (imported > 0) {
      const deletedCurrentLiveSnapshot = this.deleteLiveProviderSnapshot(appType);
      if (deletedCurrentLiveSnapshot || !this.getCurrentProviderId(appType)) {
        this.selectCcSwitchCurrentProvider(appType);
      }
    }
    const hasAnyProvider = Boolean(this.db
      .prepare('SELECT id FROM external_agent_providers WHERE app_type = ? LIMIT 1')
      .get(appType));
    if (!hasAnyProvider || imported === 0) {
      this.importLiveProviderIfEmpty(appType);
    }
  }

  private mapProviderRow(row: ExternalAgentProviderRow): ExternalAgentProvider {
    let settingsConfig: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.settings_config);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settingsConfig = parsed as Record<string, unknown>;
      }
    } catch {
      settingsConfig = {};
    }
    return {
      id: row.id,
      appType: row.app_type,
      name: row.name,
      settingsConfig,
      category: row.category,
      isCurrent: Boolean(row.is_current),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      summary: summarizeProvider(row.app_type, settingsConfig),
    };
  }

  private readLiveSettingsConfig(appType: ExternalAgentProviderAppType): Record<string, unknown> | null {
    if (appType === CLAUDE_APP_TYPE) {
      return readJsonObject(getClaudeSettingsPath());
    }
    const auth = readJsonObject(getCodexAuthPath()) ?? {};
    const configPath = getCodexConfigPath();
    const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
    if (!config.trim() && Object.keys(auth).length === 0) return null;
    return { auth, config };
  }

  private applyProviderToLive(provider: ExternalAgentProvider): void {
    const settingsConfig = this.stripInternalSettingsConfig(provider.settingsConfig);
    this.writeCcSwitchCurrentProvider(provider.appType, provider);
    if (provider.appType === CLAUDE_APP_TYPE) {
      writeJsonFile(getClaudeSettingsPath(), settingsConfig);
      return;
    }

    const auth = getNestedRecord(settingsConfig, 'auth');
    const config = getString(settingsConfig.config);
    writeJsonFile(getCodexAuthPath(), auth);
    atomicWrite(getCodexConfigPath(), config.endsWith('\n') ? config : `${config}\n`);
  }
}
