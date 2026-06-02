import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { IMStore } = require('../dist-electron/src/main/im/imStore.js');

class FakeDb {
  constructor() {
    this.imConfig = new Map();
  }

  prepare(sql) {
    return {
      run: (...params) => {
        if (
          sql.includes('INSERT INTO im_config') ||
          sql.includes('INSERT OR REPLACE INTO im_config')
        ) {
          this.imConfig.set(String(params[0]), String(params[1]));
        } else if (sql.includes('UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?')) {
          this.imConfig.set(String(params[2]), String(params[0]));
        } else if (sql.includes('DELETE FROM im_config WHERE key = ?')) {
          this.imConfig.delete(String(params[0]));
        }
      },
      get: (...params) => {
        if (sql.includes('SELECT value FROM im_config WHERE key = ?')) {
          const value = this.imConfig.get(String(params[0]));
          return value === undefined ? undefined : { value };
        }
        return undefined;
      },
      all: (...params) => {
        if (sql.includes('SELECT key FROM im_config WHERE key LIKE ?')) {
          const prefix = String(params[0]).replace(/%$/, '');
          return [...this.imConfig.keys()]
            .filter(key => key.startsWith(prefix))
            .map(key => ({ key }));
        }
        return [];
      },
    };
  }

  pragma(sql) {
    if (sql === 'table_info(im_session_mappings)') {
      return [{ name: 'agent_id' }];
    }
    return [];
  }
}

test('IMStore persists conversation reply routes by platform and conversation ID', () => {
  const db = new FakeDb();
  const store = new IMStore(db);

  assert.equal(store.getConversationReplyRoute('dingtalk', '__default__:conv-1'), null);

  store.setConversationReplyRoute('dingtalk', '__default__:conv-1', {
    channel: 'dingtalk-connector',
    to: 'group:cid-42',
    accountId: '__default__',
  });

  const reloadedStore = new IMStore(db);
  assert.deepEqual(reloadedStore.getConversationReplyRoute('dingtalk', '__default__:conv-1'), {
    channel: 'dingtalk-connector',
    to: 'group:cid-42',
    accountId: '__default__',
  });
  assert.equal(reloadedStore.getConversationReplyRoute('telegram', '__default__:conv-1'), null);
});
