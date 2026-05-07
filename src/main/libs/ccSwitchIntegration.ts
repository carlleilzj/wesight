import Database from 'better-sqlite3';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  type CliCoworkAgentEngine,
  CoworkAgentEngine,
} from '../../shared/cowork/constants';

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
  engine: CliCoworkAgentEngine;
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

type CcSwitchSettings = {
  claude_config_dir?: unknown;
  codex_config_dir?: unknown;
  current_provider_claude?: unknown;
  current_provider_codex?: unknown;
  claudeConfigDir?: unknown;
  codexConfigDir?: unknown;
  currentProviderClaude?: unknown;
  currentProviderCodex?: unknown;
};

type ProviderRow = {
  id: string;
  name: string;
};

const homeDir = (): string => os.homedir();

const ccSwitchAppDir = (): string => path.join(homeDir(), '.cc-switch');

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

const readCcSwitchSettings = (settingsPath: string): CcSwitchSettings => {
  return readJsonObject(settingsPath) ?? {};
};

const normalizedPathSetting = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? path.resolve(trimmed.replace(/^~(?=$|\/|\\)/, homeDir())) : null;
};

const getConfigDirSetting = (settings: CcSwitchSettings, appType: CliAppType): string | null => {
  if (appType === 'claude') {
    return normalizedPathSetting(settings.claudeConfigDir)
      ?? normalizedPathSetting(settings.claude_config_dir);
  }
  return normalizedPathSetting(settings.codexConfigDir)
    ?? normalizedPathSetting(settings.codex_config_dir);
};

const getCurrentProviderSetting = (settings: CcSwitchSettings, appType: CliAppType): string | null => {
  const value = appType === 'claude'
    ? settings.currentProviderClaude ?? settings.current_provider_claude
    : settings.currentProviderCodex ?? settings.current_provider_codex;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const resolveClaudeMcpPath = (configDir: string, hasOverride: boolean): string => {
  if (!hasOverride) {
    return path.join(homeDir(), '.claude.json');
  }
  const parent = path.dirname(configDir);
  const basename = path.basename(configDir);
  return path.join(parent, `${basename}.json`);
};

const resolveClaudeSettingsPath = (configDir: string): string => {
  const settingsPath = path.join(configDir, 'settings.json');
  if (fs.existsSync(settingsPath)) return settingsPath;
  const legacyPath = path.join(configDir, 'claude.json');
  if (fs.existsSync(legacyPath)) return legacyPath;
  return settingsPath;
};

const countProviders = (db: Database.Database, appType: CliAppType): number => {
  try {
    const row = db
      .prepare('SELECT COUNT(*) as total FROM providers WHERE app_type = ?')
      .get(appType) as { total?: number } | undefined;
    return Number(row?.total ?? 0);
  } catch {
    return 0;
  }
};

const readCurrentProviderFromDb = (
  dbPath: string,
  appType: CliAppType,
  settingsCurrentProviderId: string | null,
): { provider: ProviderRow | null; count: number } => {
  if (!fs.existsSync(dbPath)) {
    return { provider: null, count: 0 };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const count = countProviders(db, appType);
    const provider = settingsCurrentProviderId
      ? db
        .prepare('SELECT id, name FROM providers WHERE app_type = ? AND id = ? LIMIT 1')
        .get(appType, settingsCurrentProviderId) as ProviderRow | undefined
      : db
        .prepare('SELECT id, name FROM providers WHERE app_type = ? AND is_current = 1 LIMIT 1')
        .get(appType) as ProviderRow | undefined;
    return { provider: provider ?? null, count };
  } catch {
    return { provider: null, count: 0 };
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close errors from a read-only snapshot.
    }
  }
};

const quoteForShell = (value: string): string => {
  return `'${value.replace(/'/g, `'\\''`)}'`;
};

const resolveCommand = (command: string): { found: boolean; path: string | null; error: string | null } => {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.status === 0) {
    const commandPath = result.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? null;
    return { found: Boolean(commandPath), path: commandPath, error: null };
  }

  if (process.platform !== 'win32') {
    const shellPath = process.env.SHELL || '/bin/zsh';
    const shellResult = spawnSync(shellPath, ['-lc', `command -v ${quoteForShell(command)}`], {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          process.env.PATH ?? '',
        ].join(path.delimiter),
      },
    });
    if (shellResult.status === 0) {
      const commandPath = shellResult.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? null;
      return { found: Boolean(commandPath), path: commandPath, error: null };
    }
    const error = (shellResult.stderr || shellResult.stdout || result.stderr || result.stdout || '').trim();
    return { found: false, path: null, error: error || `${command} was not found in PATH.` };
  }

  if (result.status !== 0) {
    const error = (result.stderr || result.stdout || '').trim();
    return { found: false, path: null, error: error || `${command} was not found in PATH.` };
  }
  return { found: false, path: null, error: `${command} was not found in PATH.` };
};

const readCommandVersion = (command: string): string | null => {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    shell: false,
    timeout: 10_000,
  });
  if (result.status !== 0) return null;
  return (result.stdout || result.stderr || '').trim() || null;
};

const buildCliConfigSnapshot = (
  appType: CliAppType,
  settings: CcSwitchSettings,
  dbPath: string,
): CliAppConfigSnapshot => {
  const claudeOverride = getConfigDirSetting(settings, 'claude');
  const codexOverride = getConfigDirSetting(settings, 'codex');
  const configDir = appType === 'claude'
    ? claudeOverride ?? path.join(homeDir(), '.claude')
    : codexOverride ?? path.join(homeDir(), '.codex');
  const primaryConfigPath = appType === 'claude'
    ? resolveClaudeSettingsPath(configDir)
    : path.join(configDir, 'config.toml');
  const secondaryConfigPaths = appType === 'claude'
    ? [resolveClaudeMcpPath(configDir, Boolean(claudeOverride))]
    : [path.join(configDir, 'auth.json')];
  const settingsCurrentProviderId = getCurrentProviderSetting(settings, appType);
  const { provider, count } = readCurrentProviderFromDb(dbPath, appType, settingsCurrentProviderId);

  return {
    appType,
    configDir,
    primaryConfigPath,
    secondaryConfigPaths,
    configExists: fs.existsSync(primaryConfigPath),
    currentProviderId: provider?.id ?? settingsCurrentProviderId,
    currentProviderName: provider?.name ?? null,
    providerCount: count,
  };
};

const buildCommandStatus = (
  engine: CliCoworkAgentEngine,
  appType: CliAppType,
  command: string,
  settings: CcSwitchSettings,
  dbPath: string,
): CliCommandStatus => {
  const resolution = resolveCommand(command);
  return {
    engine,
    appType,
    command,
    found: resolution.found,
    path: resolution.path,
    version: resolution.found ? readCommandVersion(resolution.path ?? command) : null,
    error: resolution.error,
    config: buildCliConfigSnapshot(appType, settings, dbPath),
  };
};

export function getExternalAgentEnvironmentSnapshot(): ExternalAgentEnvironmentSnapshot {
  const appDir = ccSwitchAppDir();
  const settingsPath = path.join(appDir, 'settings.json');
  const dbPath = path.join(appDir, 'cc-switch.db');
  const settings = readCcSwitchSettings(settingsPath);
  const claudeOverride = getConfigDirSetting(settings, 'claude');
  const codexOverride = getConfigDirSetting(settings, 'codex');

  return {
    ccSwitch: {
      installed: fs.existsSync(appDir),
      appDir,
      dbPath,
      settingsPath,
      settingsExists: fs.existsSync(settingsPath),
      databaseExists: fs.existsSync(dbPath),
      claudeConfigDirOverride: claudeOverride,
      codexConfigDirOverride: codexOverride,
    },
    engines: [
      buildCommandStatus(CoworkAgentEngine.ClaudeCode, 'claude', 'claude', settings, dbPath),
      buildCommandStatus(CoworkAgentEngine.Codex, 'codex', 'codex', settings, dbPath),
    ],
  };
}
