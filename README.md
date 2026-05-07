# WeSight

<p align="center">
  <img src="public/logo.png" alt="WeSight" width="120">
</p>

<p align="center">
  <strong>A desktop AI agent workspace for Claude Code, Codex, OpenClaw, Hermes Agent, and your own models.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <br>
  <img src="https://img.shields.io/badge/Public%20Build-macOS%20Apple%20Silicon-brightgreen?style=for-the-badge" alt="Public build">
  <br>
  <img src="https://img.shields.io/badge/Electron-40-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
</p>

<p align="center">
  English · <a href="README_zh.md">中文</a>
</p>

---

WeSight is an open-source desktop app that turns coding agents and automation runtimes into a friendly graphical workspace. It helps you start tasks, switch agent engines, configure model providers, review tool execution, manage skills, and keep long-running work organized from one place.

The goal is simple: install WeSight, choose an engine, configure your model once, then work with powerful agents through a polished chat interface.

## Download

Public desktop builds are published through GitHub Releases:

- Website: [wesight.ai](https://wesight.ai/)
- Latest release: [github.com/freestylefly/wesight/releases/latest](https://github.com/freestylefly/wesight/releases/latest)

Early public releases currently ship macOS Apple Silicon builds first. Release assets are intended for end users. CI artifacts are short-lived build outputs for maintainers to test before a release is published.

## Highlights

- **Multiple agent engines** - Use Claude Code, Codex, OpenClaw, Hermes Agent, or the built-in Claude Agent SDK runner from the same chat workspace.
- **One-click engine setup** - WeSight can install and prepare supported local CLIs/runtimes for you. Claude Code and Codex CLI setup prefers npm on macOS; OpenClaw and Hermes Agent use WeSight-managed runtime builders.
- **Use existing local CLI accounts** - If Claude Code or Codex is already installed and logged in, WeSight can reuse the local CLI configuration instead of forcing a new model setup.
- **Unified model settings** - Configure OpenAI-compatible providers, Anthropic, DeepSeek, Qwen, Gemini, Moonshot, Ollama, OpenRouter, GitHub Copilot, and custom providers from one settings page.
- **Graphical chat for CLI agents** - Claude Code and Codex feel like desktop chat apps: stream output, inspect tool calls, review command results, and continue the same session visually.
- **Engine switching in context** - Pick an engine when creating a task, then switch from the chat header when the task needs a different runtime.
- **Permission-aware execution** - File access, shell commands, and sensitive operations surface as reviewable events so you stay in control.
- **Slash command panels** - Type `/` in chat to open command suggestions and agent context panels for model, status, help, config, skills, memory, and more.
- **Skills and workflows** - Built-in skills cover web search, Office documents, spreadsheets, presentations, PDF work, Playwright automation, video generation, email, stock research, and more.
- **Scheduled tasks** - Create recurring agent jobs for research, reports, inbox cleanup, reminders, or automation workflows.
- **Memory and personalization** - WeSight can extract useful preferences from conversations and reuse them across future sessions.
- **Desktop companion** - Optional desktop pet in Appearance settings, with animated sprites and lightweight interaction.

## Agent Engines

| Engine                    | Best For                                             | Setup Path                                               |
| ------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| Built-in Claude Agent SDK | General local cowork sessions and skill execution    | Included in WeSight                                      |
| Claude Code               | Claude Code workflows in a graphical chat surface    | macOS one-click CLI install or existing local CLI config |
| Codex                     | Codex CLI workflows in a graphical chat surface      | macOS one-click CLI install or existing local CLI config |
| OpenClaw                  | Sandbox-style agent runtime and gateway integrations | WeSight-managed pinned runtime                           |
| Hermes Agent              | Local Hermes Agent runtime experiments               | WeSight-managed pinned runtime                           |

## Model Configuration

WeSight has a unified model settings layer for user-facing configuration.

- Add multiple providers and models.
- Enable or disable providers without editing terminal config files.
- Map WeSight model settings into Claude Code or Codex when using WeSight-managed configuration.
- Use local CLI configuration for Claude Code or Codex when you want to keep the account/provider setup already present on your machine.
- Configure custom OpenAI-compatible endpoints for local, private, or third-party model services.

This lets beginners avoid CLI configuration while still giving advanced users control over their local agent environment.

## Quick Start

### Requirements

- Node.js `>=24 <25`
- npm

### Development

```bash
git clone https://github.com/freestylefly/wesight.git
cd wesight
npm install
npm run electron:dev
```

The Vite dev server runs at `http://localhost:5175`.

### Development With Managed Runtimes

```bash
# Build or reuse the pinned OpenClaw runtime, then start WeSight
npm run electron:dev:openclaw

# Build or reuse the pinned Hermes Agent runtime, then start WeSight
npm run electron:dev:hermes
```

Useful runtime environment variables:

```bash
# Override OpenClaw source location
OPENCLAW_SRC=/path/to/openclaw npm run electron:dev:openclaw

# Force OpenClaw runtime rebuild
OPENCLAW_FORCE_BUILD=1 npm run electron:dev:openclaw

# Skip OpenClaw version checkout for local OpenClaw development
OPENCLAW_SKIP_ENSURE=1 npm run electron:dev:openclaw
```

## Build

```bash
# TypeScript + Vite + Electron bundle
npm run build

# ESLint
npm run lint
```

## Packaging

```bash
# macOS
npm run dist:mac
npm run dist:mac:x64
npm run dist:mac:arm64
npm run dist:mac:universal

# Windows
npm run dist:win

# Linux
npm run dist:linux
```

Runtime builders are pinned in `package.json`:

- `openclaw.version`
- `hermes.version`

Windows packages can bundle a portable Python runtime for Python-based skills. OpenClaw and Hermes runtime folders are generated under `vendor/` and ignored by Git.

## Release Workflow

WeSight uses GitHub Releases for desktop distribution.

1. Commit release-ready changes to `main`.
2. Create and push a version tag, for example:

```bash
git tag v2026.4.8-alpha.1
git push origin v2026.4.8-alpha.1
```

3. The `Build Platforms` workflow builds a macOS Apple Silicon package.
4. Build artifacts are uploaded to the workflow run for temporary testing.
5. A draft GitHub Release is created with the generated `.dmg` attached.
6. Review the draft notes and assets, then publish the release from GitHub.

The website download button can point to the latest release URL so users always land on the newest published build.

## Architecture

WeSight uses Electron process isolation. The renderer never directly accesses Node.js APIs; all privileged operations go through a typed preload bridge and IPC handlers in the main process.

### Main Process

- Window lifecycle and tray behavior
- SQLite persistence
- Agent engine routing
- Claude Code and Codex external CLI adapters
- OpenClaw and Hermes runtime managers
- Skill loading and service management
- Scheduled task engine
- IM gateway and notification integrations

### Renderer

- React + Redux Toolkit + Tailwind CSS
- Cowork chat UI
- Engine selector and model selector
- Settings, skills, scheduled tasks, agents, MCP, and appearance UI
- Stream rendering for messages, tool calls, command output, and slash command panels

### Key Directories

```text
src/main/
  main.ts                         Electron entry and IPC handlers
  preload.ts                      Safe renderer bridge
  sqliteStore.ts                  Local persistence
  coworkStore.ts                  Session and message storage
  libs/agentEngine/               Engine adapters and router
  libs/openclawEngineManager.ts   OpenClaw runtime lifecycle
  libs/hermesEngineManager.ts     Hermes runtime lifecycle
  libs/externalAgent*.ts          Claude Code and Codex CLI setup/config helpers
  im/                             IM gateway integrations

src/renderer/
  App.tsx                         App shell
  components/cowork/              Chat, engine selector, model selector, session UI
  components/Settings.tsx         Model, engine, appearance, skills, memory, and app settings
  components/pet/                 Desktop companion UI
  services/                       IPC wrappers and app services
  store/slices/                   Redux state

SKILLs/                           Built-in skills
scripts/                          Runtime, packaging, and setup scripts
src/shared/                       Shared constants and types
```

## Built-in Skills

WeSight includes a broad skills library for day-to-day agent work:

| Area           | Examples                                                           |
| -------------- | ------------------------------------------------------------------ |
| Research       | web search, tech news, stock research, film/music search           |
| Documents      | DOCX, XLSX, PPTX, PDF processing                                   |
| Automation     | Playwright, local tools, scheduled tasks                           |
| Creative       | Remotion video, frontend design, canvas design, Seedream, Seedance |
| Communication  | IMAP/SMTP email                                                    |
| Agent building | skill creator, skill vetting, custom planning                      |

Skills can be enabled, disabled, and routed from the desktop UI.

## Security Model

- Context isolation is enabled.
- Node integration is disabled in the renderer.
- Sensitive actions are routed through main-process IPC.
- Tool execution can surface permission requests before running.
- Local data is stored in SQLite under the app data directory.
- Generated runtime folders, build artifacts, and local secrets are ignored by Git.

## Roadmap Ideas

- More engine adapters and runtime profiles
- Better model migration and provider import flows
- Shareable task templates
- Richer slash command results
- More visual inspection tools for long-running agent tasks
- Plugin marketplace for community skills

## License

MIT. See [LICENSE](LICENSE).
