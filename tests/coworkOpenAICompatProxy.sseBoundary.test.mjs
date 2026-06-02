import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return {
      session: {
        defaultSession: {
          fetch: async () => {
            throw new Error('unexpected electron fetch in test');
          },
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const proxyModule = require('../dist-electron/src/main/libs/coworkOpenAICompatProxy.js');
const testUtils = proxyModule.__openAICompatProxyTestUtils;
Module._load = originalLoad;

if (!testUtils?.findSSEPacketBoundary) {
  throw new Error('findSSEPacketBoundary is not available in __openAICompatProxyTestUtils');
}

test('findSSEPacketBoundary detects LF packet separator', () => {
  const boundary = testUtils.findSSEPacketBoundary('data: 1\n\ndata: 2\n\n');
  assert.ok(boundary);
  assert.equal(boundary.index, 7);
  assert.equal(boundary.separatorLength, 2);
});

test('findSSEPacketBoundary detects CRLF packet separator', () => {
  const boundary = testUtils.findSSEPacketBoundary('data: 1\r\n\r\ndata: 2\r\n\r\n');
  assert.ok(boundary);
  assert.equal(boundary.index, 7);
  assert.equal(boundary.separatorLength, 4);
});

test('findSSEPacketBoundary returns earliest separator in mixed input', () => {
  const boundary = testUtils.findSSEPacketBoundary('data: 1\r\n\r\ndata: 2\n\n');
  assert.ok(boundary);
  assert.equal(boundary.index, 7);
  assert.equal(boundary.separatorLength, 4);
});
