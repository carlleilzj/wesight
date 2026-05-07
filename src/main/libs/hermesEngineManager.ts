import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import net from 'net';
import path from 'path';

import { appendPythonRuntimeToEnv } from './pythonRuntime';
import { isSystemProxyEnabled, resolveSystemProxyUrl } from './systemProxy';

const DEFAULT_HERMES_VERSION = '2026.4.30';
const DEFAULT_GATEWAY_PORT = 18879;
const GATEWAY_PORT_SCAN_LIMIT = 80;
const GATEWAY_BOOT_TIMEOUT_MS = 180_000;
const GATEWAY_MAX_RESTART_ATTEMPTS = 5;
const GATEWAY_RESTART_DELAYS = [3_000, 5_000, 10_000, 20_000, 30_000];

export type HermesEnginePhase =
  | 'not_installed'
  | 'installing'
  | 'ready'
  | 'starting'
  | 'running'
  | 'error';

export interface HermesEngineStatus {
  phase: HermesEnginePhase;
  version: string | null;
  progressPercent?: number;
  message?: string;
  canRetry: boolean;
}

export interface HermesGatewayConnectionInfo {
  version: string | null;
  port: number | null;
  token: string | null;
  url: string | null;
}

interface HermesEngineManagerEvents {
  status: (status: HermesEngineStatus) => void;
}

type RuntimeMetadata = {
  root: string | null;
  version: string | null;
  expectedPathHint: string;
};

const ensureDir = (dirPath: string): void => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const findPath = (candidates: string[]): string | null => {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

const parseJsonFile = <T>(filePath: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

const isPortAvailable = async (port: number): Promise<boolean> => {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
};

const fetchWithTimeout = async (url: string, token: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timeout);
  }
};

const isProcessAlive = (child: ChildProcessWithoutNullStreams | null): child is ChildProcessWithoutNullStreams => {
  return Boolean(child && child.pid && child.exitCode === null);
};

export class HermesEngineManager extends EventEmitter {
  private readonly baseDir: string;
  private readonly logsDir: string;
  private readonly stateDir: string;
  private readonly configPath: string;
  private readonly envPath: string;
  private readonly gatewayTokenPath: string;
  private readonly gatewayPortPath: string;
  private readonly gatewayLogPath: string;

  private desiredVersion: string;
  private status: HermesEngineStatus;
  private gatewayProcess: ChildProcessWithoutNullStreams | null = null;
  private gatewayPort: number | null = null;
  private gatewayRestartAttempt = 0;
  private gatewayRestartTimer: NodeJS.Timeout | null = null;
  private shutdownRequested = false;
  private startGatewayPromise: Promise<HermesEngineStatus> | null = null;
  private secretEnvVars: Record<string, string> = {};

  constructor() {
    super();

    const userDataPath = app.getPath('userData');
    this.baseDir = path.join(userDataPath, 'hermes');
    this.logsDir = path.join(this.baseDir, 'logs');
    this.stateDir = path.join(this.baseDir, 'state');
    this.configPath = path.join(this.stateDir, 'config.yaml');
    this.envPath = path.join(this.stateDir, '.env');
    this.gatewayTokenPath = path.join(this.stateDir, 'gateway-token');
    this.gatewayPortPath = path.join(this.stateDir, 'gateway-port.json');
    this.gatewayLogPath = path.join(this.logsDir, 'gateway.log');

    ensureDir(this.baseDir);
    ensureDir(this.logsDir);
    ensureDir(this.stateDir);
    ensureDir(path.join(this.stateDir, 'sessions'));
    ensureDir(path.join(this.stateDir, 'memories'));
    ensureDir(path.join(this.stateDir, 'skills'));

    const runtime = this.resolveRuntimeMetadata();
    this.desiredVersion = runtime.version || DEFAULT_HERMES_VERSION;
    this.status = runtime.root
      ? {
          phase: 'ready',
          version: this.desiredVersion,
          message: 'Hermes Agent runtime is ready.',
          canRetry: false,
        }
      : {
          phase: 'not_installed',
          version: null,
          message: `Bundled Hermes Agent runtime is missing. Expected: ${runtime.expectedPathHint}`,
          canRetry: true,
        };
  }

  override on<U extends keyof HermesEngineManagerEvents>(
    event: U,
    listener: HermesEngineManagerEvents[U],
  ): this {
    return super.on(event, listener);
  }

  override emit<U extends keyof HermesEngineManagerEvents>(
    event: U,
    ...args: Parameters<HermesEngineManagerEvents[U]>
  ): boolean {
    return super.emit(event, ...args);
  }

  getStatus(): HermesEngineStatus {
    return { ...this.status };
  }

  getStateDir(): string {
    return this.stateDir;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getEnvPath(): string {
    return this.envPath;
  }

  setSecretEnvVars(vars: Record<string, string>): void {
    this.secretEnvVars = vars;
  }

  getSecretEnvVars(): Record<string, string> {
    return this.secretEnvVars;
  }

  getConnectionInfo(): HermesGatewayConnectionInfo {
    const port = this.gatewayPort ?? this.readGatewayPort();
    const token = this.readGatewayToken();
    return {
      version: this.status.version,
      port,
      token,
      url: port ? `http://127.0.0.1:${port}` : null,
    };
  }

  async ensureReady(): Promise<HermesEngineStatus> {
    const runtime = this.resolveRuntimeMetadata();
    if (!runtime.root) {
      this.setStatus({
        phase: 'not_installed',
        version: null,
        message: `Bundled Hermes Agent runtime is missing. Expected: ${runtime.expectedPathHint}`,
        canRetry: true,
      });
      return this.getStatus();
    }

    this.desiredVersion = runtime.version || DEFAULT_HERMES_VERSION;
    if (this.status.phase !== 'running' && this.status.phase !== 'starting') {
      this.setStatus({
        phase: 'ready',
        version: this.desiredVersion,
        message: 'Hermes Agent runtime is ready.',
        canRetry: false,
      });
    }
    return this.getStatus();
  }

  async startGateway(): Promise<HermesEngineStatus> {
    if (this.startGatewayPromise) {
      return this.startGatewayPromise;
    }
    this.startGatewayPromise = this.doStartGateway().finally(() => {
      this.startGatewayPromise = null;
    });
    return this.startGatewayPromise;
  }

  async restartGateway(): Promise<HermesEngineStatus> {
    await this.stopGateway();
    this.gatewayRestartAttempt = 0;
    return this.startGateway();
  }

  async stopGateway(): Promise<void> {
    this.shutdownRequested = true;
    if (this.gatewayRestartTimer) {
      clearTimeout(this.gatewayRestartTimer);
      this.gatewayRestartTimer = null;
    }
    if (this.gatewayProcess) {
      await this.stopGatewayProcess(this.gatewayProcess);
      this.gatewayProcess = null;
    }
    const runtime = this.resolveRuntimeMetadata();
    this.setStatus({
      phase: runtime.root ? 'ready' : 'not_installed',
      version: runtime.version,
      message: runtime.root
        ? 'Hermes Agent runtime is ready. Gateway is stopped.'
        : `Bundled Hermes Agent runtime is missing. Expected: ${runtime.expectedPathHint}`,
      canRetry: !runtime.root,
    });
  }

  private async doStartGateway(): Promise<HermesEngineStatus> {
    this.shutdownRequested = false;
    const ensured = await this.ensureReady();
    if (ensured.phase !== 'ready' && ensured.phase !== 'running') {
      return ensured;
    }

    if (isProcessAlive(this.gatewayProcess)) {
      const port = this.gatewayPort ?? this.readGatewayPort();
      const token = this.readGatewayToken();
      if (port && token && await this.isGatewayHealthy(port, token)) {
        this.setStatus({
          phase: 'running',
          version: this.desiredVersion,
          message: `Hermes Agent gateway is running on loopback:${port}.`,
          canRetry: false,
        });
        return this.getStatus();
      }
      await this.stopGatewayProcess(this.gatewayProcess);
      this.gatewayProcess = null;
    }

    const runtime = this.resolveRuntimeMetadata();
    if (!runtime.root) {
      this.setStatus({
        phase: 'not_installed',
        version: null,
        message: `Bundled Hermes Agent runtime is missing. Expected: ${runtime.expectedPathHint}`,
        canRetry: true,
      });
      return this.getStatus();
    }

    const hermesCommand = this.resolveHermesCommand(runtime.root);
    if (!hermesCommand) {
      this.setStatus({
        phase: 'error',
        version: runtime.version,
        message: `Hermes Agent executable is missing in runtime: ${runtime.root}.`,
        canRetry: true,
      });
      return this.getStatus();
    }

    const token = this.ensureGatewayToken();
    const port = await this.resolveGatewayPort();
    this.gatewayPort = port;
    this.writeGatewayPort(port);
    this.ensureStateFiles();

    this.setStatus({
      phase: 'starting',
      version: runtime.version,
      progressPercent: 10,
      message: 'Starting Hermes Agent gateway...',
      canRetry: false,
    });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HERMES_HOME: this.stateDir,
      HERMES_CONFIG_PATH: this.configPath,
      HERMES_DOTENV_PATH: this.envPath,
      API_SERVER_ENABLED: 'true',
      API_SERVER_HOST: '127.0.0.1',
      API_SERVER_PORT: String(port),
      API_SERVER_KEY: token,
      HERMES_GATEWAY_TOKEN: token,
      HERMES_GATEWAY_PORT: String(port),
      HERMES_LOG_LEVEL: 'INFO',
      PYTHONUNBUFFERED: '1',
      ...this.secretEnvVars,
    };
    appendPythonRuntimeToEnv(env as Record<string, string | undefined>);
    if (isSystemProxyEnabled()) {
      const proxyUrl = await resolveSystemProxyUrl('https://api.openai.com');
      if (proxyUrl) {
        env.http_proxy = proxyUrl;
        env.https_proxy = proxyUrl;
        env.HTTP_PROXY = proxyUrl;
        env.HTTPS_PROXY = proxyUrl;
      }
    }

    const child = spawn(
      hermesCommand.command,
      [...hermesCommand.prefixArgs, 'gateway'],
      {
        cwd: runtime.root,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: process.platform === 'win32',
      },
    );
    this.gatewayProcess = child;
    this.attachGatewayLogs(child);
    this.attachGatewayExitHandlers(child);

    this.setStatus({
      phase: 'starting',
      version: runtime.version,
      progressPercent: 35,
      message: 'Waiting for Hermes Agent API server...',
      canRetry: false,
    });

    const healthy = await this.waitForGatewayHealthy(port, token);
    if (!healthy) {
      this.setStatus({
        phase: 'error',
        version: runtime.version,
        message: `Hermes Agent gateway did not become ready on loopback:${port}.`,
        canRetry: true,
      });
      return this.getStatus();
    }

    this.gatewayRestartAttempt = 0;
    this.setStatus({
      phase: 'running',
      version: runtime.version,
      progressPercent: 100,
      message: `Hermes Agent gateway is running on loopback:${port}.`,
      canRetry: false,
    });
    return this.getStatus();
  }

  private resolveRuntimeMetadata(): RuntimeMetadata {
    const candidateRoots = app.isPackaged
      ? [path.join(process.resourcesPath, 'hermes-runtime')]
      : [
          path.join(app.getAppPath(), 'vendor', 'hermes-runtime', 'current'),
          path.join(process.cwd(), 'vendor', 'hermes-runtime', 'current'),
        ];
    const runtimeRoot = findPath(candidateRoots);
    const expectedPathHint = app.isPackaged
      ? path.join(process.resourcesPath, 'hermes-runtime')
      : path.join(app.getAppPath(), 'vendor', 'hermes-runtime', 'current');

    if (!runtimeRoot) {
      return { root: null, version: null, expectedPathHint };
    }
    return {
      root: runtimeRoot,
      version: this.readRuntimeVersion(runtimeRoot) || DEFAULT_HERMES_VERSION,
      expectedPathHint,
    };
  }

  private readRuntimeVersion(runtimeRoot: string): string | null {
    const buildInfo = parseJsonFile<{ version?: string }>(path.join(runtimeRoot, 'runtime-build-info.json'));
    if (typeof buildInfo?.version === 'string' && buildInfo.version.trim()) {
      return buildInfo.version.trim();
    }
    try {
      const pyproject = fs.readFileSync(path.join(runtimeRoot, 'pyproject.toml'), 'utf8');
      const match = pyproject.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
      return match?.[1]?.trim() || null;
    } catch {
      return null;
    }
  }

  private resolveHermesCommand(runtimeRoot: string): { command: string; prefixArgs: string[] } | null {
    const moduleCandidates = [
      path.join(runtimeRoot, 'venv', 'bin', 'python'),
      path.join(runtimeRoot, '.venv', 'bin', 'python'),
      path.join(runtimeRoot, 'venv', 'Scripts', 'python.exe'),
      path.join(runtimeRoot, '.venv', 'Scripts', 'python.exe'),
    ];
    const python = findPath(moduleCandidates);
    if (python) {
      return { command: python, prefixArgs: ['-m', 'hermes_cli.main'] };
    }

    const directCandidates = [
      path.join(runtimeRoot, 'venv', 'bin', 'hermes'),
      path.join(runtimeRoot, '.venv', 'bin', 'hermes'),
      path.join(runtimeRoot, 'bin', 'hermes'),
      path.join(runtimeRoot, 'hermes'),
      path.join(runtimeRoot, 'venv', 'Scripts', 'hermes.exe'),
      path.join(runtimeRoot, '.venv', 'Scripts', 'hermes.exe'),
      path.join(runtimeRoot, 'Scripts', 'hermes.exe'),
    ];
    const direct = findPath(directCandidates);
    if (direct) {
      return { command: direct, prefixArgs: [] };
    }
    return null;
  }

  private ensureGatewayToken(): string {
    const existing = this.readGatewayToken();
    if (existing) return existing;
    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(this.gatewayTokenPath, token, { encoding: 'utf8', mode: 0o600 });
    return token;
  }

  private readGatewayToken(): string | null {
    try {
      const raw = fs.readFileSync(this.gatewayTokenPath, 'utf8').trim();
      return raw || null;
    } catch {
      return null;
    }
  }

  private async resolveGatewayPort(): Promise<number> {
    const saved = this.readGatewayPort();
    if (saved && await isPortAvailable(saved)) {
      return saved;
    }
    for (let offset = 0; offset < GATEWAY_PORT_SCAN_LIMIT; offset += 1) {
      const port = DEFAULT_GATEWAY_PORT + offset;
      if (await isPortAvailable(port)) {
        return port;
      }
    }
    throw new Error('No available loopback port found for Hermes Agent gateway.');
  }

  private readGatewayPort(): number | null {
    const parsed = parseJsonFile<{ port?: number }>(this.gatewayPortPath);
    return typeof parsed?.port === 'number' && Number.isFinite(parsed.port)
      ? parsed.port
      : null;
  }

  private writeGatewayPort(port: number): void {
    fs.writeFileSync(this.gatewayPortPath, `${JSON.stringify({ port }, null, 2)}\n`, 'utf8');
  }

  private ensureStateFiles(): void {
    ensureDir(path.dirname(this.configPath));
    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(this.configPath, 'model:\n  provider: custom\n  default: default-model\n', 'utf8');
    }
    if (!fs.existsSync(this.envPath)) {
      fs.writeFileSync(this.envPath, '', { encoding: 'utf8', mode: 0o600 });
    }
  }

  private async waitForGatewayHealthy(port: number, token: string): Promise<boolean> {
    const deadline = Date.now() + GATEWAY_BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!isProcessAlive(this.gatewayProcess)) {
        return false;
      }
      if (await this.isGatewayHealthy(port, token)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }

  private async isGatewayHealthy(port: number, token: string): Promise<boolean> {
    const urls = [
      `http://127.0.0.1:${port}/health`,
      `http://127.0.0.1:${port}/v1/models`,
    ];
    for (const url of urls) {
      try {
        const response = await fetchWithTimeout(url, token, 1500);
        if (response.ok || response.status === 401 || response.status === 403) {
          return true;
        }
      } catch {
        // Try the next known health endpoint.
      }
    }
    return false;
  }

  private attachGatewayLogs(child: ChildProcessWithoutNullStreams): void {
    const append = (source: string, text: string) => {
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) return;
      const payload = lines.map((line) => `[${new Date().toISOString()}] [${source}] ${line}`).join('\n') + '\n';
      fs.appendFile(this.gatewayLogPath, payload, () => {});
    };
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk.toString('utf8')));
  }

  private attachGatewayExitHandlers(child: ChildProcessWithoutNullStreams): void {
    child.on('error', (error) => {
      this.setStatus({
        phase: 'error',
        version: this.desiredVersion,
        message: `Hermes Agent gateway failed to start: ${error.message}`,
        canRetry: true,
      });
    });

    child.on('exit', (code, signal) => {
      if (this.gatewayProcess === child) {
        this.gatewayProcess = null;
      }
      if (this.shutdownRequested) {
        return;
      }
      const message = `Hermes Agent gateway exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.`;
      if (this.gatewayRestartAttempt >= GATEWAY_MAX_RESTART_ATTEMPTS) {
        this.setStatus({
          phase: 'error',
          version: this.desiredVersion,
          message,
          canRetry: true,
        });
        return;
      }
      const delay = GATEWAY_RESTART_DELAYS[Math.min(this.gatewayRestartAttempt, GATEWAY_RESTART_DELAYS.length - 1)];
      this.gatewayRestartAttempt += 1;
      this.setStatus({
        phase: 'starting',
        version: this.desiredVersion,
        message: `${message} Restarting in ${Math.round(delay / 1000)}s...`,
        canRetry: false,
      });
      this.gatewayRestartTimer = setTimeout(() => {
        this.gatewayRestartTimer = null;
        void this.startGateway();
      }, delay);
    });
  }

  private async stopGatewayProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (!isProcessAlive(child)) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore shutdown races.
        }
        resolve();
      }, 5000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  private setStatus(status: HermesEngineStatus): void {
    this.status = status;
    this.emit('status', this.getStatus());
  }
}
