'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const targetId = process.argv[2] || `${process.platform}-${process.arch}`;
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const hermesConfig = pkg.hermes || {};
const desiredVersion = hermesConfig.version || 'v2026.4.30';
const repoUrl = hermesConfig.repo || 'https://github.com/NousResearch/hermes-agent.git';
const sourceDir = process.env.HERMES_SRC || path.resolve(rootDir, '..', 'hermes-agent');
const outDir = process.env.OUT_DIR || path.join(rootDir, 'vendor', 'hermes-runtime', targetId);

function log(message) {
  console.log(`[hermes-runtime] ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    env: options.env || process.env,
    stdio: options.stdio || 'inherit',
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}`);
  }
  return result;
}

function output(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    env: options.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

function ensureSource() {
  if (!fs.existsSync(sourceDir)) {
    log(`Cloning ${repoUrl} -> ${sourceDir}`);
    fs.mkdirSync(path.dirname(sourceDir), { recursive: true });
    run('git', ['clone', '--branch', desiredVersion, '--depth', '1', repoUrl, sourceDir]);
    return;
  }
  if (!fs.existsSync(path.join(sourceDir, '.git'))) {
    throw new Error(`${sourceDir} exists but is not a git repository.`);
  }
  const dirty = spawnSync('git', ['diff', '--quiet', 'HEAD'], { cwd: sourceDir, shell: process.platform === 'win32' });
  if (dirty.status !== 0) {
    throw new Error(`${sourceDir} has local changes. Commit/stash them or set HERMES_SRC to a clean checkout.`);
  }
  run('git', ['fetch', '--tags', 'origin'], { cwd: sourceDir });
  run('git', ['checkout', desiredVersion], { cwd: sourceDir });
}

function copySource() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(sourceDir, outDir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(sourceDir, src);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      return !parts.some((part) => [
        '.git',
        '.venv',
        'venv',
        '__pycache__',
        '.mypy_cache',
        '.pytest_cache',
        'node_modules',
      ].includes(part));
    },
  });
}

function resolvePython() {
  for (const command of ['python3', 'python']) {
    const result = spawnSync(command, ['--version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (result.status === 0) return command;
  }
  throw new Error('Python 3 is required to build Hermes Agent runtime.');
}

function buildVenv() {
  const python = resolvePython();
  const venvDir = path.join(outDir, 'venv');
  run(python, ['-m', 'venv', venvDir], { cwd: outDir });
  const venvPython = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
  run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'], { cwd: outDir });
  run(venvPython, ['-m', 'pip', 'install', '.'], { cwd: outDir });
}

function writeBuildInfo() {
  const commit = output('git', ['rev-parse', 'HEAD'], { cwd: sourceDir });
  const info = {
    hermesVersion: desiredVersion,
    version: desiredVersion.replace(/^v/, ''),
    hermesCommit: commit,
    targetId,
    builtAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    host: os.hostname(),
  };
  fs.writeFileSync(path.join(outDir, 'runtime-build-info.json'), `${JSON.stringify(info, null, 2)}\n`, 'utf8');
}

ensureSource();
log(`Pinned version: ${desiredVersion}`);
log(`Output directory: ${outDir}`);
copySource();
buildVenv();
writeBuildInfo();
log('Done.');
