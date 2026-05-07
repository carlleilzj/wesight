import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import os from 'os';

import type { CliAppType, ExternalAgentEnvironmentSnapshot } from './ccSwitchIntegration';
import { getExternalAgentEnvironmentSnapshot } from './ccSwitchIntegration';

export type ExternalAgentCliInstallPhase =
  | 'starting'
  | 'installing'
  | 'verifying'
  | 'success'
  | 'error'
  | 'unsupported';

export interface ExternalAgentCliInstallProgress {
  appType: CliAppType;
  phase: ExternalAgentCliInstallPhase;
  message: string;
  detail?: string;
}

export interface ExternalAgentCliInstallResult {
  success: boolean;
  appType: CliAppType;
  installMethod?: string;
  command?: string;
  binaryPath?: string | null;
  version?: string | null;
  snapshot?: ExternalAgentEnvironmentSnapshot;
  error?: string;
  unsupported?: boolean;
}

interface InstallMethod {
  id: string;
  packageName: string;
}

interface InstallTarget {
  appType: CliAppType;
  displayName: string;
  command: string;
  methods: InstallMethod[];
}

const MAX_OUTPUT_CHARS = 20_000;
const MAX_PROGRESS_LINE_CHARS = 300;

const INSTALL_TARGETS: Record<CliAppType, InstallTarget> = {
  claude: {
    appType: 'claude',
    displayName: 'Claude Code',
    command: 'claude',
    methods: [
      {
        id: 'npm',
        packageName: '@anthropic-ai/claude-code',
      },
    ],
  },
  codex: {
    appType: 'codex',
    displayName: 'Codex',
    command: 'codex',
    methods: [
      {
        id: 'npm',
        packageName: '@openai/codex',
      },
    ],
  },
};

const quoteForShell = (value: string): string => {
  return `'${value.replace(/'/g, `'\\''`)}'`;
};

const truncateOutput = (value: string): string => {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return value.slice(value.length - MAX_OUTPUT_CHARS);
};

const truncateProgressLine = (value: string): string => {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= MAX_PROGRESS_LINE_CHARS) return singleLine;
  return `${singleLine.slice(0, MAX_PROGRESS_LINE_CHARS)}...`;
};

const buildInstallScript = (target: InstallTarget): string => {
  const method = target.methods[0];

  return [
    'set -e',
    'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"',
    'if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi',
    'if [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi',
    'if ! command -v npm >/dev/null 2>&1; then',
    `  echo "Preparing npm for ${target.displayName}."`,
    '  if ! command -v brew >/dev/null 2>&1; then',
    '    echo "__WESIGHT_INSTALL_METHOD__=homebrew-bootstrap"',
    '    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    '    if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi',
    '    if [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi',
    '  fi',
    '  if ! command -v npm >/dev/null 2>&1; then',
    '    echo "__WESIGHT_INSTALL_METHOD__=homebrew-node"',
    '    brew install node',
    '  fi',
    'fi',
    'if ! command -v npm >/dev/null 2>&1; then',
    '  echo "npm was not found after preparing Node.js." >&2',
    '  exit 127',
    'fi',
    `echo "__WESIGHT_INSTALL_METHOD__=${method.id}"`,
    `npm install -g ${quoteForShell(method.packageName)}`,
    'GLOBAL_PREFIX="$(npm prefix -g 2>/dev/null || true)"',
    'BINARY_PATH=""',
    `if [ -n "$GLOBAL_PREFIX" ] && [ -x "$GLOBAL_PREFIX/bin/${target.command}" ]; then`,
    `  BINARY_PATH="$GLOBAL_PREFIX/bin/${target.command}"`,
    `elif command -v ${target.command} >/dev/null 2>&1; then`,
    `  BINARY_PATH="$(command -v ${target.command})"`,
    'else',
    `  echo "${target.command} command was not found after installation." >&2`,
    '  exit 127',
    'fi',
    'echo "__WESIGHT_BINARY_PATH__=${BINARY_PATH}"',
    'VERSION_OUTPUT=$({ "$BINARY_PATH" --version 2>&1 || true; } | head -n 1)',
    'echo "__WESIGHT_VERSION__=${VERSION_OUTPUT}"',
  ].join('\n');
};

export class ExternalAgentCliInstaller extends EventEmitter {
  private readonly activeInstalls = new Map<CliAppType, Promise<ExternalAgentCliInstallResult>>();

  install(appType: CliAppType): Promise<ExternalAgentCliInstallResult> {
    const activeInstall = this.activeInstalls.get(appType);
    if (activeInstall) {
      return activeInstall;
    }

    const task = this.runInstall(appType).finally(() => {
      this.activeInstalls.delete(appType);
    });
    this.activeInstalls.set(appType, task);
    return task;
  }

  onProgress(listener: (progress: ExternalAgentCliInstallProgress) => void): () => void {
    this.on('progress', listener);
    return () => this.off('progress', listener);
  }

  private emitProgress(progress: ExternalAgentCliInstallProgress): void {
    this.emit('progress', progress);
  }

  private async runInstall(appType: CliAppType): Promise<ExternalAgentCliInstallResult> {
    const target = INSTALL_TARGETS[appType];
    if (process.platform !== 'darwin') {
      const message = 'Automatic CLI installation currently supports macOS only.';
      this.emitProgress({
        appType,
        phase: 'unsupported',
        message,
      });
      return {
        success: false,
        appType,
        unsupported: true,
        error: message,
        snapshot: getExternalAgentEnvironmentSnapshot(),
      };
    }

    const shell = process.env.SHELL || '/bin/zsh';
    const script = buildInstallScript(target);
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let installMethod: string | undefined;
    let binaryPath: string | null = null;
    let version: string | null = null;

    this.emitProgress({
      appType,
      phase: 'starting',
      message: `Starting ${target.displayName} CLI installation.`,
    });

    return new Promise<ExternalAgentCliInstallResult>((resolve) => {
      const child = spawn(shell, ['-lc', script], {
        cwd: os.homedir(),
        env: {
          ...process.env,
          HOMEBREW_NO_ENV_HINTS: '1',
          PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const handleOutput = (chunk: Buffer, source: 'stdout' | 'stderr') => {
        const text = chunk.toString('utf8');
        if (source === 'stdout') {
          stdout = truncateOutput(stdout + text);
        } else {
          stderr = truncateOutput(stderr + text);
        }

        for (const rawLine of text.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          if (line.startsWith('__WESIGHT_INSTALL_METHOD__=')) {
            installMethod = line.slice('__WESIGHT_INSTALL_METHOD__='.length).trim() || undefined;
            this.emitProgress({
              appType,
              phase: 'installing',
              message: `Installing with ${installMethod}.`,
            });
            continue;
          }
          if (line.startsWith('__WESIGHT_BINARY_PATH__=')) {
            binaryPath = line.slice('__WESIGHT_BINARY_PATH__='.length).trim() || null;
            this.emitProgress({
              appType,
              phase: 'verifying',
              message: `Verifying ${target.command}.`,
              detail: binaryPath ?? undefined,
            });
            continue;
          }
          if (line.startsWith('__WESIGHT_VERSION__=')) {
            version = line.slice('__WESIGHT_VERSION__='.length).trim() || null;
            continue;
          }
          this.emitProgress({
            appType,
            phase: 'installing',
            message: truncateProgressLine(line),
          });
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => handleOutput(chunk, 'stdout'));
      child.stderr?.on('data', (chunk: Buffer) => handleOutput(chunk, 'stderr'));

      child.on('error', (error) => {
        const message = `Failed to start ${target.displayName} installer: ${error.message}`;
        this.emitProgress({
          appType,
          phase: 'error',
          message,
        });
        resolve({
          success: false,
          appType,
          installMethod,
          command: target.command,
          binaryPath,
          version,
          error: message,
          snapshot: getExternalAgentEnvironmentSnapshot(),
        });
      });

      child.on('close', (code, signal) => {
        if (code === 0) {
          const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          this.emitProgress({
            appType,
            phase: 'success',
            message: `${target.displayName} CLI installed in ${elapsedSeconds}s.`,
            detail: version ?? binaryPath ?? undefined,
          });
          resolve({
            success: true,
            appType,
            installMethod,
            command: target.command,
            binaryPath,
            version,
            snapshot: getExternalAgentEnvironmentSnapshot(),
          });
          return;
        }

        const output = truncateProgressLine(stderr || stdout || `Installer exited with code ${code ?? 'unknown'}.`);
        const message = signal
          ? `${target.displayName} installer stopped by ${signal}.`
          : output;
        this.emitProgress({
          appType,
          phase: 'error',
          message,
        });
        resolve({
          success: false,
          appType,
          installMethod,
          command: target.command,
          binaryPath,
          version,
          error: message,
          snapshot: getExternalAgentEnvironmentSnapshot(),
        });
      });
    });
  }
}
