import { EventEmitter } from 'events';
import { expect, test } from 'vitest';

import type { CoworkMessage, CoworkStore } from '../coworkStore';
import type { CoworkRuntime } from '../libs/agentEngine/types';
import { IMCoworkHandler } from './imCoworkHandler';
import type { IMMessage, IMSessionMapping, Platform } from './types';

class FakeRuntime extends EventEmitter {
  startCalls: Array<{ sessionId: string; prompt: string }> = [];

  async startSession(sessionId: string, prompt: string): Promise<void> {
    this.startCalls.push({ sessionId, prompt });
  }

  async continueSession(): Promise<void> {}

  stopSession(): void {}
  stopAllSessions(): void {}
  respondToPermission(): void {}
  isSessionActive(): boolean {
    return false;
  }
  getSessionConfirmationMode(): string {
    return 'text';
  }
}

interface FakeSession {
  id: string;
  title: string;
  cwd: string;
  systemPrompt: string;
  executionMode: string;
  claudeSessionId: string | null;
  status: string;
  messages: CoworkMessage[];
}

class FakeCoworkStore {
  private sessionCounter = 0;
  private messageCounter = 0;
  sessions = new Map<string, FakeSession>();

  getConfig() {
    return {
      workingDirectory: process.cwd(),
      systemPrompt: '',
      executionMode: 'auto',
      agentEngine: 'codex',
    };
  }

  createSession(
    title: string,
    cwd: string,
    systemPrompt: string,
    executionMode: string,
  ): FakeSession {
    const session: FakeSession = {
      id: `session-${++this.sessionCounter}`,
      title,
      cwd,
      systemPrompt,
      executionMode,
      claudeSessionId: null,
      status: 'idle',
      messages: [],
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): FakeSession | null {
    return this.sessions.get(id) ?? null;
  }

  getAgent(id: string) {
    return {
      id,
      name: id,
      description: '',
      systemPrompt: '',
      identity: '',
      model: '',
      agentEngine: 'codex',
      icon: '',
      skillIds: [],
      enabled: true,
      isDefault: id === 'main',
      source: 'preset',
      presetId: id,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  updateSession(id: string, updates: Partial<FakeSession>): void {
    const session = this.sessions.get(id);
    if (session) {
      Object.assign(session, updates);
    }
  }

  addMessage(sessionId: string, message: Omit<CoworkMessage, 'id' | 'timestamp'>): CoworkMessage {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    const created: CoworkMessage = {
      id: `message-${++this.messageCounter}`,
      timestamp: Date.now(),
      ...message,
    };
    session.messages.push(created);
    return created;
  }
}

class FakeIMStore {
  private mappings: IMSessionMapping[] = [];

  getIMSettings() {
    return { skillsEnabled: false };
  }

  listSessionMappings(): IMSessionMapping[] {
    return [...this.mappings];
  }

  getSessionMapping(imConversationId: string, platform: Platform): IMSessionMapping | null {
    return (
      this.mappings.find(
        entry => entry.imConversationId === imConversationId && entry.platform === platform,
      ) ?? null
    );
  }

  getSessionMappingByCoworkSessionId(coworkSessionId: string): IMSessionMapping | null {
    return this.mappings.find(entry => entry.coworkSessionId === coworkSessionId) ?? null;
  }

  createSessionMapping(
    imConversationId: string,
    platform: Platform,
    coworkSessionId: string,
  ): IMSessionMapping {
    const mapping: IMSessionMapping = {
      imConversationId,
      platform,
      coworkSessionId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    this.mappings.push(mapping);
    return mapping;
  }

  updateSessionLastActive(imConversationId: string, platform: Platform): void {
    const mapping = this.getSessionMapping(imConversationId, platform);
    if (mapping) {
      mapping.lastActiveAt = Date.now();
    }
  }

  deleteSessionMapping(imConversationId: string, platform: Platform): void {
    this.mappings = this.mappings.filter(
      entry => entry.imConversationId !== imConversationId || entry.platform !== platform,
    );
  }
}

function createFeishuMessage(content: string): IMMessage {
  return {
    platform: 'feishu',
    messageId: `im-${Date.now()}`,
    conversationId: 'feishu-app:direct:chat-1',
    senderId: 'user-1',
    senderName: 'Tester',
    content,
    chatType: 'direct',
    timestamp: Date.now(),
  };
}

test('IM completion replies with only the current turn for a reused Feishu session', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const session = coworkStore.createSession('[飞书] Tester/chat-1', process.cwd(), '', 'auto');
  imStore.createSessionMapping('feishu-app:direct:chat-1', 'feishu', session.id);

  coworkStore.addMessage(session.id, {
    type: 'user',
    content: '旧问题',
    metadata: {},
  });
  coworkStore.addMessage(session.id, {
    type: 'assistant',
    content: '旧回复',
    metadata: {},
  });

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime as unknown as CoworkRuntime,
    coworkStore: coworkStore as unknown as CoworkStore,
    imStore,
  });

  const pendingReply = handler.processMessage(createFeishuMessage('你好'));
  await new Promise(resolve => setImmediate(resolve));

  coworkStore.addMessage(session.id, {
    type: 'user',
    content: '你好',
    metadata: {},
  });
  coworkStore.addMessage(session.id, {
    type: 'assistant',
    content: '你好，我是 WeSight。',
    metadata: {},
  });
  runtime.emit('complete', session.id);

  await expect(pendingReply).resolves.toBe('你好，我是 WeSight。');
  handler.destroy();
});
