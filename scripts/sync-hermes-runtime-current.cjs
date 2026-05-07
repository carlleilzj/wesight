'use strict';

const fs = require('fs');
const path = require('path');

const targetId = process.argv[2];
if (!targetId) {
  console.error('[sync-hermes-runtime-current] Missing target id.');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const runtimeBaseDir = path.join(rootDir, 'vendor', 'hermes-runtime');
const sourceDir = path.join(runtimeBaseDir, targetId);
const currentDir = path.join(runtimeBaseDir, 'current');

if (!fs.existsSync(sourceDir)) {
  console.error(`[sync-hermes-runtime-current] Runtime not found: ${sourceDir}`);
  process.exit(1);
}

fs.rmSync(currentDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(currentDir), { recursive: true });
fs.cpSync(sourceDir, currentDir, { recursive: true });
console.log(`[sync-hermes-runtime-current] Synced ${targetId} -> vendor/hermes-runtime/current`);
