import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  type CliCoworkAgentEngine,
  CoworkAgentEngine,
  ExternalAgentConfigSource,
} from '../../../shared/cowork/constants';
import type {
  CoworkMessage,
  CoworkMessageMetadata,
  CoworkStore,
} from '../../coworkStore';
import { t } from '../../i18n';
import { getEnhancedEnvWithTmpdir } from '../coworkUtil';
import {
  applyLocalClaudeCodeEnvForPrintMode,
  type LocalClaudeCodeEnvLoadResult,
} from '../externalAgentLocalEnv';
import type {
  ExternalAgentProvider,
  ExternalAgentProviderAppType,
} from '../externalAgentProviderStore';
import type {
  CoworkContinueOptions,
  CoworkRuntime,
  CoworkRuntimeEvents,
  CoworkStartOptions,
} from './types';

const LOCAL_HISTORY_MAX_MESSAGES = 24;
const LOCAL_HISTORY_MAX_TOTAL_CHARS = 32_000;
const LOCAL_HISTORY_MAX_MESSAGE_CHARS = 4_000;
const STREAMING_TEXT_MAX_CHARS = 120_000;
const STDERR_TAIL_MAX_CHARS = 24_000;
const CLI_STARTUP_TIMEOUT_MS = 30_000;
const CLAUDE_NO_CONTENT_NOTICE_MS = 8_000;
const CLAUDE_NO_CONTENT_TIMEOUT_MS = 120_000;
const CONTENT_TRUNCATED_HINT = '\n...[truncated to prevent memory pressure]';

type ActiveCliSession = {
  child: ChildProcessWithoutNullStreams;
  sessionId: string;
  cliSessionId: string | null;
  assistantMessageId: string | null;
  assistantContent: string;
  stderrTail: string;
  sawEvent: boolean;
  sawClaudeNonInitEvent: boolean;
  startupTimer: ReturnType<typeof setTimeout> | null;
  noContentNoticeTimer: ReturnType<typeof setTimeout> | null;
  noContentTimeoutTimer: ReturnType<typeof setTimeout> | null;
  imagePaths: string[];
  localClaudeConfig: LocalClaudeCodeEnvLoadResult | null;
};

type ExternalCliRuntimeAdapterDeps = {
  engine: CliCoworkAgentEngine;
  store: CoworkStore;
  getCurrentProvider?: (appType: ExternalAgentProviderAppType) => ExternalAgentProvider | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const truncateLargeContent = (content: string, maxChars: number): string => {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}${CONTENT_TRUNCATED_HINT}`;
};

const stringifyPayload = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
};

export class ExternalCliRuntimeAdapter extends EventEmitter implements CoworkRuntime {
  private readonly engine: CliCoworkAgentEngine;
  private readonly store: CoworkStore;
  private readonly getCurrentProvider?: (appType: ExternalAgentProviderAppType) => ExternalAgentProvider | null;
  private readonly activeSessions = new Map<string, ActiveCliSession>();
  private readonly stoppedSessions = new Set<string>();

  constructor(deps: ExternalCliRuntimeAdapterDeps) {
    super();
    this.engine = deps.engine;
    this.store = deps.store;
    this.getCurrentProvider = deps.getCurrentProvider;
  }

  override on<U extends keyof CoworkRuntimeEvents>(
    event: U,
    listener: CoworkRuntimeEvents[U],
  ): this {
    return super.on(event, listener);
  }

  override off<U extends keyof CoworkRuntimeEvents>(
    event: U,
    listener: CoworkRuntimeEvents[U],
  ): this {
    return super.off(event, listener);
  }

  async startSession(sessionId: string, prompt: string, options: CoworkStartOptions = {}): Promise<void> {
    await this.runTurn(sessionId, prompt, options, !options.skipInitialUserMessage);
  }

  async continueSession(sessionId: string, prompt: string, options: CoworkContinueOptions = {}): Promise<void> {
    await this.runTurn(sessionId, prompt, options, true);
  }

  stopSession(sessionId: string): void {
    this.stoppedSessions.add(sessionId);
    const active = this.activeSessions.get(sessionId);
    if (active) {
      this.clearSessionTimers(active);
      active.child.kill('SIGTERM');
      this.cleanupImagePaths(active.imagePaths);
      this.activeSessions.delete(sessionId);
    }
    this.store.updateSession(sessionId, { status: 'idle' });
    this.emit('sessionStopped', sessionId);
  }

  stopAllSessions(): void {
    for (const sessionId of Array.from(this.activeSessions.keys())) {
      this.stopSession(sessionId);
    }
  }

  respondToPermission(_requestId: string, _result: PermissionResult): void {
    // External CLI engines run in non-interactive mode. Their approval behavior
    // is controlled by the CLI config and flags.
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  getSessionConfirmationMode(_sessionId: string): 'modal' | 'text' | null {
    return null;
  }

  onSessionDeleted(sessionId: string): void {
    this.stopSession(sessionId);
    this.stoppedSessions.delete(sessionId);
  }

  private async runTurn(
    sessionId: string,
    prompt: string,
    options: CoworkStartOptions | CoworkContinueOptions,
    shouldAddUserMessage: boolean,
  ): Promise<void> {
    if (this.activeSessions.has(sessionId)) {
      throw new Error('This session is already running.');
    }
    this.stoppedSessions.delete(sessionId);
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.store.updateSession(sessionId, { status: 'running' });

    if (shouldAddUserMessage) {
      const metadata: Record<string, unknown> = {};
      if (options.skillIds?.length) {
        metadata.skillIds = options.skillIds;
      }
      if (options.imageAttachments?.length) {
        metadata.imageAttachments = options.imageAttachments;
      }
      const message = this.store.addMessage(sessionId, {
        type: 'user',
        content: prompt,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      this.emit('message', sessionId, message);
    }

    const currentSession = this.store.getSession(sessionId);
    const cwd = path.resolve(currentSession?.cwd || this.store.getConfig().workingDirectory || os.homedir());
    if (!fs.existsSync(cwd)) {
      this.handleError(sessionId, `Working directory does not exist: ${cwd}`);
      return;
    }
    const systemPrompt = options.systemPrompt ?? currentSession?.systemPrompt ?? '';
    const effectivePrompt = this.buildEffectivePrompt(sessionId, prompt, systemPrompt);
    const imagePaths = this.materializeImageAttachments(sessionId, options.imageAttachments);
    const env = await getEnhancedEnvWithTmpdir(cwd, 'local', {
      injectCoworkModelConfig: this.shouldInjectCoworkModelConfig(),
    });
    let localClaudeConfig: LocalClaudeCodeEnvLoadResult | null = null;
    const selectedProvider = this.getSelectedProviderForLocalCli();
    if (this.engine === CoworkAgentEngine.ClaudeCode && this.getConfigSource() === ExternalAgentConfigSource.LocalCli) {
      localClaudeConfig = applyLocalClaudeCodeEnvForPrintMode(env, selectedProvider);
    }
    if (this.engine === CoworkAgentEngine.Codex && this.getConfigSource() === ExternalAgentConfigSource.LocalCli) {
      this.applyCodexProviderEnvForExecMode(env, selectedProvider);
    }
    const command = this.engine === CoworkAgentEngine.ClaudeCode ? 'claude' : 'codex';
    const args = this.buildCommandArgs(cwd, effectivePrompt, imagePaths, selectedProvider);
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: process.platform === 'win32',
    });

    const active: ActiveCliSession = {
      child,
      sessionId,
      cliSessionId: currentSession?.claudeSessionId ?? null,
      assistantMessageId: null,
      assistantContent: '',
      stderrTail: '',
      sawEvent: false,
      sawClaudeNonInitEvent: false,
      startupTimer: null,
      noContentNoticeTimer: null,
      noContentTimeoutTimer: null,
      imagePaths,
      localClaudeConfig,
    };
    active.startupTimer = setTimeout(() => {
      if (active.sawEvent) return;
      active.stderrTail = this.appendStderrTail(active.stderrTail, 'CLI startup timed out before producing output.');
      child.kill('SIGTERM');
    }, CLI_STARTUP_TIMEOUT_MS);
    this.activeSessions.set(sessionId, active);
    if (this.engine === CoworkAgentEngine.ClaudeCode) {
      this.scheduleClaudeNoContentDiagnostics(active);
    }

    await new Promise<void>((resolve) => {
      let stdoutBuffer = '';
      let spawnFailed = false;

      child.stdout.on('data', (chunk: Buffer) => {
        active.sawEvent = true;
        stdoutBuffer += chunk.toString('utf8');
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          this.handleOutputLine(active, line);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        active.stderrTail = this.appendStderrTail(active.stderrTail, chunk.toString('utf8'));
      });

      child.on('error', (error) => {
        spawnFailed = true;
        this.clearSessionTimers(active);
        this.cleanupImagePaths(active.imagePaths);
        this.activeSessions.delete(sessionId);
        this.handleError(sessionId, `${this.getEngineDisplayName()} failed to start: ${error.message}`);
        resolve();
      });
      child.on('close', (code, signal) => {
        if (spawnFailed) {
          return;
        }
        if (stdoutBuffer.trim()) {
          this.handleOutputLine(active, stdoutBuffer);
        }
        this.clearSessionTimers(active);
        this.finalizeAssistant(active);
        this.cleanupImagePaths(active.imagePaths);
        this.activeSessions.delete(sessionId);

        if (this.stoppedSessions.has(sessionId)) {
          this.store.updateSession(sessionId, { status: 'idle' });
          this.emit('sessionStopped', sessionId);
          resolve();
          return;
        }

        if (code === 0) {
          const latestSession = this.store.getSession(sessionId);
          if (latestSession?.status === 'error') {
            resolve();
            return;
          }
          this.store.updateSession(sessionId, { status: 'completed', claudeSessionId: active.cliSessionId });
          this.applyTurnMemoryUpdates(sessionId);
          this.emit('complete', sessionId, active.cliSessionId);
          resolve();
          return;
        }

        const detail = [
          `${this.getEngineDisplayName()} exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.`,
          active.stderrTail.trim() ? `Process stderr:\n${active.stderrTail.trim()}` : '',
        ].filter(Boolean).join('\n\n');
        this.handleError(sessionId, detail);
        resolve();
      });
    });
  }

  private buildCommandArgs(
    cwd: string,
    prompt: string,
    imagePaths: string[],
    selectedProvider: ExternalAgentProvider | null,
  ): string[] {
    if (this.engine === CoworkAgentEngine.ClaudeCode) {
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--permission-mode',
        'auto',
      ];
      args.push(prompt);
      return args;
    }

    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--cd',
      cwd,
      '--sandbox',
      'workspace-write',
      '-c',
      'approval_policy="never"',
    ];
    args.push(...this.buildCodexProviderOverrideArgs(selectedProvider));
    for (const imagePath of imagePaths) {
      args.push('--image', imagePath);
    }
    args.push(prompt);
    return args;
  }

  private shouldInjectCoworkModelConfig(): boolean {
    return this.getConfigSource() !== ExternalAgentConfigSource.LocalCli;
  }

  private getConfigSource(): ExternalAgentConfigSource {
    const config = this.store.getConfig();
    if (this.engine === CoworkAgentEngine.ClaudeCode) {
      return config.claudeCodeConfigSource;
    }
    if (this.engine === CoworkAgentEngine.Codex) {
      return config.codexConfigSource;
    }
    return ExternalAgentConfigSource.WesightModel;
  }

  private getSelectedProviderForLocalCli(): ExternalAgentProvider | null {
    if (this.getConfigSource() !== ExternalAgentConfigSource.LocalCli) {
      return null;
    }
    if (this.engine === CoworkAgentEngine.ClaudeCode) {
      return this.getCurrentProvider?.('claude') ?? null;
    }
    if (this.engine === CoworkAgentEngine.Codex) {
      return this.getCurrentProvider?.('codex') ?? null;
    }
    return null;
  }

  private applyCodexProviderEnvForExecMode(
    env: Record<string, string | undefined>,
    provider: ExternalAgentProvider | null,
  ): void {
    if (!provider || provider.appType !== 'codex') return;
    const auth = this.getNestedRecord(provider.settingsConfig, 'auth');
    const apiKey = this.getString(auth.OPENAI_API_KEY);
    if (apiKey) {
      env.OPENAI_API_KEY = apiKey;
    }
  }

  private buildCodexProviderOverrideArgs(provider: ExternalAgentProvider | null): string[] {
    if (!provider || provider.appType !== 'codex') return [];
    const providerKey = this.sanitizeCodexProviderKey(provider.id || provider.name);
    const model = provider.summary.model.trim();
    const baseUrl = provider.summary.baseUrl.trim();
    const args: string[] = [
      '-c',
      `model_provider=${this.tomlString(providerKey)}`,
    ];
    if (model) {
      args.push('-c', `model=${this.tomlString(model)}`);
    }
    args.push('-c', `model_providers.${providerKey}.name=${this.tomlString(provider.name)}`);
    if (baseUrl) {
      args.push('-c', `model_providers.${providerKey}.base_url=${this.tomlString(baseUrl)}`);
    }
    args.push('-c', `model_providers.${providerKey}.wire_api="responses"`);
    args.push('-c', `model_providers.${providerKey}.requires_openai_auth=true`);
    return args;
  }

  private sanitizeCodexProviderKey(value: string): string {
    const key = value
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '');
    return key || 'local_provider';
  }

  private tomlString(value: string): string {
    return JSON.stringify(value);
  }

  private getNestedRecord(value: unknown, key: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const nested = (value as Record<string, unknown>)[key];
    return nested && typeof nested === 'object' && !Array.isArray(nested)
      ? nested as Record<string, unknown>
      : {};
  }

  private getString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private buildEffectivePrompt(sessionId: string, prompt: string, systemPrompt: string): string {
    const history = this.buildHistoryContext(sessionId, prompt);
    const runtimeNote = [
      'Runtime note:',
      '- Use the user-level CLI configuration that the local engine already loads.',
      '- Project memory files such as SOUL.md, USER.md, MEMORY.md, and memory/YYYY-MM-DD.md are optional.',
      '- If an optional memory file is missing, skip it silently and continue.',
      '- Create memory files only when the user explicitly asks to remember or persist information.',
    ].join('\n');
    return [
      runtimeNote,
      systemPrompt.trim() ? `System instructions:\n${systemPrompt.trim()}` : '',
      history,
      `Current user request:\n${prompt}`,
    ].filter(Boolean).join('\n\n---\n\n');
  }

  private buildHistoryContext(sessionId: string, prompt: string): string {
    const session = this.store.getSession(sessionId);
    const messages = session?.messages ?? [];
    const historyMessages = [...messages];
    const lastMessage = historyMessages[historyMessages.length - 1];
    if (lastMessage?.type === 'user' && lastMessage.content === prompt) {
      historyMessages.pop();
    }

    const selected = historyMessages
      .filter((message) => message.type === 'user' || message.type === 'assistant' || message.type === 'system')
      .slice(-LOCAL_HISTORY_MAX_MESSAGES);
    if (selected.length === 0) return '';

    let total = 0;
    const lines: string[] = [];
    for (const message of selected) {
      const role = message.type === 'assistant' ? 'Assistant' : message.type === 'system' ? 'System' : 'User';
      const clipped = truncateLargeContent(message.content, LOCAL_HISTORY_MAX_MESSAGE_CHARS);
      const next = `${role}: ${clipped}`;
      if (total + next.length > LOCAL_HISTORY_MAX_TOTAL_CHARS) break;
      lines.push(next);
      total += next.length;
    }
    return lines.length > 0 ? `Conversation history:\n${lines.join('\n\n')}` : '';
  }

  private clearSessionTimers(active: ActiveCliSession): void {
    if (active.startupTimer) {
      clearTimeout(active.startupTimer);
      active.startupTimer = null;
    }
    if (active.noContentNoticeTimer) {
      clearTimeout(active.noContentNoticeTimer);
      active.noContentNoticeTimer = null;
    }
    if (active.noContentTimeoutTimer) {
      clearTimeout(active.noContentTimeoutTimer);
      active.noContentTimeoutTimer = null;
    }
  }

  private scheduleClaudeNoContentDiagnostics(active: ActiveCliSession): void {
    active.noContentNoticeTimer = setTimeout(() => {
      if (!this.activeSessions.has(active.sessionId)) return;
      if (active.sawClaudeNonInitEvent || active.assistantMessageId) return;
      this.addSystemMessage(active.sessionId, t('externalCliClaudeWaitingForOutput', {
        provider: this.describeLocalClaudeConfig(active.localClaudeConfig),
      }));
    }, CLAUDE_NO_CONTENT_NOTICE_MS);

    active.noContentTimeoutTimer = setTimeout(() => {
      if (!this.activeSessions.has(active.sessionId)) return;
      if (active.sawClaudeNonInitEvent || active.assistantMessageId) return;
      active.stderrTail = this.appendStderrTail(active.stderrTail, t('externalCliClaudeNoOutputTimeout', {
        seconds: Math.round(CLAUDE_NO_CONTENT_TIMEOUT_MS / 1000),
        provider: this.describeLocalClaudeConfig(active.localClaudeConfig),
      }));
      active.child.kill('SIGTERM');
    }, CLAUDE_NO_CONTENT_TIMEOUT_MS);
  }

  private markClaudeNonInitEvent(active: ActiveCliSession): void {
    if (active.sawClaudeNonInitEvent) return;
    active.sawClaudeNonInitEvent = true;
    if (active.noContentNoticeTimer) {
      clearTimeout(active.noContentNoticeTimer);
      active.noContentNoticeTimer = null;
    }
    if (active.noContentTimeoutTimer) {
      clearTimeout(active.noContentTimeoutTimer);
      active.noContentTimeoutTimer = null;
    }
  }

  private describeLocalClaudeConfig(config: LocalClaudeCodeEnvLoadResult | null): string {
    if (!config) {
      return t('externalCliClaudeLocalConfigUnknown');
    }
    const details = [
      config.sourceName,
      config.model,
      config.baseUrl,
      config.credentialSource,
    ].filter(Boolean);
    return details.join(' · ');
  }

  private materializeImageAttachments(
    sessionId: string,
    imageAttachments?: CoworkStartOptions['imageAttachments'],
  ): string[] {
    if (!imageAttachments?.length) return [];
    if (this.engine === CoworkAgentEngine.ClaudeCode) {
      this.addSystemMessage(sessionId, t('externalCliClaudeImageUnsupported'));
      return [];
    }
    const dir = path.join(os.tmpdir(), 'wesight-cli-images', sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const paths: string[] = [];
    for (const attachment of imageAttachments) {
      const ext = this.extensionFromMimeType(attachment.mimeType);
      const filePath = path.join(dir, `${randomUUID()}${ext}`);
      fs.writeFileSync(filePath, Buffer.from(attachment.base64Data, 'base64'));
      paths.push(filePath);
    }
    return paths;
  }

  private cleanupImagePaths(imagePaths: string[]): void {
    for (const imagePath of imagePaths) {
      try {
        fs.unlinkSync(imagePath);
      } catch {
        // Temporary image cleanup is best effort.
      }
    }
  }

  private extensionFromMimeType(mimeType: string): string {
    if (mimeType === 'image/png') return '.png';
    if (mimeType === 'image/webp') return '.webp';
    if (mimeType === 'image/gif') return '.gif';
    return '.jpg';
  }

  private handleOutputLine(active: ActiveCliSession, line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed);
      if (this.engine === CoworkAgentEngine.Codex) {
        this.handleCodexEvent(active, event);
      } else {
        this.handleClaudeCliEvent(active, event);
      }
    } catch {
      if (this.engine === CoworkAgentEngine.ClaudeCode) {
        this.markClaudeNonInitEvent(active);
      }
      this.appendAssistant(active, line);
    }
  }

  private handleCodexEvent(active: ActiveCliSession, event: unknown): void {
    if (!isRecord(event)) return;
    const type = String(event.type ?? '');
    if (type === 'thread.started' && typeof event.thread_id === 'string') {
      active.cliSessionId = event.thread_id;
      this.store.updateSession(active.sessionId, { claudeSessionId: event.thread_id });
      return;
    }
    if (type === 'error') {
      this.handleError(active.sessionId, firstString(event.message, event.error) ?? 'Codex CLI returned an error.');
      return;
    }
    if (type === 'item.started' && isRecord(event.item)) {
      this.handleCodexItem(active, event.item, false);
      return;
    }
    if (type === 'item.completed' && isRecord(event.item)) {
      this.handleCodexItem(active, event.item, true);
      return;
    }
    if (type === 'item.agent_message.delta') {
      const delta = firstString(event.delta, event.text, isRecord(event.params) ? event.params.delta : null);
      if (delta) this.appendAssistant(active, delta);
      return;
    }
    if (type === 'turn.failed') {
      this.handleError(active.sessionId, firstString(event.message, event.error) ?? 'Codex turn failed.');
    }
  }

  private handleCodexItem(active: ActiveCliSession, item: Record<string, unknown>, completed: boolean): void {
    const itemType = String(item.type ?? '');
    if (itemType === 'agent_message') {
      const text = firstString(item.text, item.message, item.content);
      if (text) {
        this.replaceAssistant(active, text, completed);
      }
      return;
    }
    if (!completed && itemType === 'command_execution') {
      const command = firstString(item.command) ?? 'command';
      this.addToolMessage(active.sessionId, {
        type: 'tool_use',
        content: `Using tool: ${command}`,
        metadata: {
          toolName: 'Bash',
          toolInput: { command },
        },
      });
      return;
    }
    if (completed && itemType === 'command_execution') {
      const output = firstString(item.output, item.aggregated_output, item.text)
        ?? stringifyPayload(item);
      this.addToolMessage(active.sessionId, {
        type: 'tool_result',
        content: output,
        metadata: {
          toolName: 'Bash',
          toolResult: output,
          isError: item.status === 'failed',
        },
      });
      return;
    }
    if (completed && itemType === 'file_change') {
      const text = firstString(item.text, item.summary) ?? stringifyPayload(item);
      this.addToolMessage(active.sessionId, {
        type: 'tool_use',
        content: text,
        metadata: {
          toolName: 'FileChange',
          toolInput: item,
        },
      });
    }
  }

  private handleClaudeCliEvent(active: ActiveCliSession, event: unknown): void {
    if (!isRecord(event)) return;
    const type = String(event.type ?? '');
    if (type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
      active.cliSessionId = event.session_id;
      this.store.updateSession(active.sessionId, { claudeSessionId: event.session_id });
      return;
    }
    this.markClaudeNonInitEvent(active);
    if (type === 'stream_event' && isRecord(event.event)) {
      this.handleClaudeStreamEvent(active, event.event);
      return;
    }
    if (type === 'assistant' && isRecord(event.message)) {
      this.handleClaudeMessage(active, event.message);
      return;
    }
    if (type === 'result') {
      const result = firstString(event.result);
      if (result) {
        this.replaceAssistant(active, result, true);
      }
      if (String(event.subtype ?? 'success') !== 'success') {
        this.handleError(active.sessionId, firstString(event.error) ?? 'Claude Code CLI run failed.');
      }
    }
  }

  private handleClaudeStreamEvent(active: ActiveCliSession, event: Record<string, unknown>): void {
    const type = String(event.type ?? '');
    if (type !== 'content_block_delta' || !isRecord(event.delta)) return;
    const delta = event.delta;
    const text = firstString(delta.text, delta.thinking);
    if (text) {
      this.appendAssistant(active, text);
    }
  }

  private handleClaudeMessage(active: ActiveCliSession, message: Record<string, unknown>): void {
    const content = message.content;
    if (!Array.isArray(content)) {
      const text = firstString(content);
      if (text) this.replaceAssistant(active, text, true);
      return;
    }
    for (const block of content) {
      if (!isRecord(block)) continue;
      const blockType = String(block.type ?? '');
      if (blockType === 'text') {
        const text = firstString(block.text);
        if (text) this.replaceAssistant(active, text, true);
      } else if (blockType === 'tool_use') {
        const toolName = firstString(block.name) ?? 'Tool';
        const toolInput = isRecord(block.input) ? block.input : {};
        this.addToolMessage(active.sessionId, {
          type: 'tool_use',
          content: `Using tool: ${toolName}`,
          metadata: {
            toolName,
            toolInput,
            toolUseId: firstString(block.id),
          },
        });
      }
    }
  }

  private appendAssistant(active: ActiveCliSession, delta: string): void {
    const next = truncateLargeContent(`${active.assistantContent}${delta}`, STREAMING_TEXT_MAX_CHARS);
    this.replaceAssistant(active, next, false);
  }

  private replaceAssistant(active: ActiveCliSession, content: string, isFinal: boolean): void {
    const safeContent = truncateLargeContent(content, STREAMING_TEXT_MAX_CHARS);
    active.assistantContent = safeContent;
    if (!active.assistantMessageId) {
      const message = this.store.addMessage(active.sessionId, {
        type: 'assistant',
        content: safeContent,
        metadata: { isStreaming: !isFinal, isFinal },
      });
      active.assistantMessageId = message.id;
      this.emit('message', active.sessionId, message);
      return;
    }
    this.store.updateMessage(active.sessionId, active.assistantMessageId, {
      content: safeContent,
      metadata: { isStreaming: !isFinal, isFinal },
    });
    this.emit('messageUpdate', active.sessionId, active.assistantMessageId, safeContent);
  }

  private finalizeAssistant(active: ActiveCliSession): void {
    if (!active.assistantMessageId) return;
    this.store.updateMessage(active.sessionId, active.assistantMessageId, {
      content: active.assistantContent,
      metadata: { isStreaming: false, isFinal: true },
    });
    this.emit('messageUpdate', active.sessionId, active.assistantMessageId, active.assistantContent);
  }

  private addToolMessage(
    sessionId: string,
    input: { type: CoworkMessage['type']; content: string; metadata?: CoworkMessageMetadata },
  ): void {
    const message = this.store.addMessage(sessionId, input);
    this.emit('message', sessionId, message);
  }

  private addSystemMessage(sessionId: string, content: string): void {
    const message = this.store.addMessage(sessionId, {
      type: 'system',
      content,
    });
    this.emit('message', sessionId, message);
  }

  private handleError(sessionId: string, error: string): void {
    if (this.stoppedSessions.has(sessionId)) return;
    if (this.store.getSession(sessionId)?.status === 'error') return;
    this.store.updateSession(sessionId, { status: 'error' });
    this.emit('error', sessionId, error);
  }

  private appendStderrTail(previous: string, next: string): string {
    const combined = `${previous}${next}`;
    return combined.length > STDERR_TAIL_MAX_CHARS
      ? combined.slice(-STDERR_TAIL_MAX_CHARS)
      : combined;
  }

  private applyTurnMemoryUpdates(sessionId: string): void {
    const config = this.store.getConfig();
    if (!config.memoryEnabled) return;
    const session = this.store.getSession(sessionId);
    if (!session) return;
    const lastUser = [...session.messages].reverse().find((message) => message.type === 'user');
    const lastAssistant = [...session.messages].reverse().find((message) => message.type === 'assistant');
    if (!lastUser || !lastAssistant) return;
    void this.store.applyTurnMemoryUpdates({
      sessionId,
      userText: lastUser.content,
      assistantText: lastAssistant.content,
      implicitEnabled: config.memoryImplicitUpdateEnabled,
      memoryLlmJudgeEnabled: config.memoryLlmJudgeEnabled,
      guardLevel: config.memoryGuardLevel,
      userMessageId: lastUser.id,
      assistantMessageId: lastAssistant.id,
    });
  }

  private getEngineDisplayName(): string {
    return this.engine === CoworkAgentEngine.ClaudeCode ? 'Claude Code CLI' : 'Codex CLI';
  }
}
