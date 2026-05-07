# WeSight

<p align="center">
  <img src="public/logo.png" alt="WeSight" width="120">
</p>

<p align="center">
  <strong>把 Claude Code、Codex、OpenClaw、Hermes Agent 和自定义大模型统一到一个桌面 Agent 工作台。</strong>
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
  <a href="README.md">English</a> · 中文
</p>

---

WeSight 是一个开源桌面 AI Agent 工作台。它把常见的编码 Agent、自动化运行时、模型配置、工具执行、技能系统和任务管理整合到一个图形化界面里，让用户不用反复切换终端、配置文件和多个 CLI。

目标很直接：安装 WeSight，选择 Agent 引擎，配置一次模型，然后在桌面 Chat 里把任务交给 Agent 完成。

## 下载

公开桌面安装包通过 GitHub Releases 发布：

- 官网：[wesight.ai](https://wesight.ai/)
- 最新版本：[github.com/freestylefly/wesight/releases/latest](https://github.com/freestylefly/wesight/releases/latest)

早期公开版本优先提供 macOS Apple Silicon 安装包。Release assets 面向最终用户下载。CI artifacts 作为维护者测试构建产物的临时入口。

## 产品亮点

- **多 Agent 引擎统一入口**：支持 Claude Code、Codex、OpenClaw、Hermes Agent，以及内置 Claude Agent SDK runner。
- **一键安装和准备运行环境**：Claude Code / Codex CLI 在 macOS 上优先使用 npm 自动安装；OpenClaw / Hermes Agent 由 WeSight 维护固定版本 runtime。
- **复用本机 CLI 登录态**：如果用户本机已经安装并登录 Claude Code 或 Codex，可以直接使用本机配置。
- **统一模型配置**：在 WeSight 设置里集中配置 OpenAI-compatible、Anthropic、DeepSeek、Qwen、Gemini、Moonshot、Ollama、OpenRouter、GitHub Copilot 和自定义供应商。
- **新手友好的模型映射**：选择跟随 WeSight 模型设置时，WeSight 会把模型信息映射到对应 Agent 引擎所需配置。
- **CLI Agent 图形化 Chat**：Claude Code 和 Codex 的运行过程会以桌面对话呈现，包含流式回复、工具调用、命令执行和结果面板。
- **任务内快速切换引擎**：新建任务时可选择引擎，Chat 右上角也可以快速切换适合当前任务的引擎。
- **权限门控**：文件访问、Shell 命令、敏感工具调用都会通过可见事件呈现，方便用户确认和追踪。
- **Slash 指令面板**：在输入框输入 `/` 可以呼出模型、上下文、状态、配置、技能、记忆等指令入口。
- **内置技能系统**：支持 Web 搜索、Office 文档、表格、PPT、PDF、Playwright 自动化、视频生成、邮件、股票研究等技能。
- **定时任务**：可以通过对话或 GUI 创建周期性 Agent 任务，如研究报告、新闻摘要、邮箱整理、自动提醒。
- **记忆系统**：自动提取用户偏好和长期信息，跨会话延续个人化上下文。
- **桌面宠物**：在设置-外观中开启桌面宠物，支持动画、移动和简单互动。

## Agent 引擎

| 引擎                  | 适合场景                                     | 准备方式                                |
| --------------------- | -------------------------------------------- | --------------------------------------- |
| 内置 Claude Agent SDK | 通用 Cowork 任务、技能执行、本地工具调用     | WeSight 内置                            |
| Claude Code           | Claude Code 编码工作流的图形化使用           | macOS 一键安装 CLI，或复用本机 CLI 配置 |
| Codex                 | Codex CLI 编码工作流的图形化使用             | macOS 一键安装 CLI，或复用本机 CLI 配置 |
| OpenClaw              | 沙箱式 Agent runtime、gateway 集成、隔离执行 | WeSight 固定版本 runtime                |
| Hermes Agent          | 本地 Hermes Agent runtime 实验和集成         | WeSight 固定版本 runtime                |

## 模型配置

WeSight 提供统一的模型设置层，尽量把复杂的 CLI 配置收进图形化界面。

- 可以添加多个供应商和多个模型。
- 可以启用或停用某个供应商。
- 可以为 Claude Code / Codex 选择“跟随 WeSight 模型设置”。
- 可以为 Claude Code / Codex 选择“使用本机 CLI 配置”。
- 可以配置任意 OpenAI-compatible 接口，用于本地模型、私有模型服务或第三方 API。

这样新手可以少接触终端配置，高级用户也能保留本机已有 Agent 环境。

## 快速开始

### 环境要求

- Node.js `>=24 <25`
- npm

### 本地开发

```bash
git clone https://github.com/freestylefly/wesight.git
cd wesight
npm install
npm run electron:dev
```

开发服务器默认运行在 `http://localhost:5175`。

### 带 runtime 启动

```bash
# 构建或复用固定版本 OpenClaw runtime，然后启动 WeSight
npm run electron:dev:openclaw

# 构建或复用固定版本 Hermes Agent runtime，然后启动 WeSight
npm run electron:dev:hermes
```

常用 OpenClaw 环境变量：

```bash
# 指定 OpenClaw 源码路径
OPENCLAW_SRC=/path/to/openclaw npm run electron:dev:openclaw

# 强制重建 OpenClaw runtime
OPENCLAW_FORCE_BUILD=1 npm run electron:dev:openclaw

# 本地开发 OpenClaw 时跳过版本切换
OPENCLAW_SKIP_ENSURE=1 npm run electron:dev:openclaw
```

## 构建

```bash
# TypeScript + Vite + Electron bundle
npm run build

# ESLint
npm run lint
```

## 打包

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

runtime 版本在 `package.json` 里声明：

- `openclaw.version`
- `hermes.version`

Windows 安装包可以内置便携 Python runtime，用于 Python 类技能。OpenClaw 和 Hermes 生成目录位于 `vendor/`，该目录已加入 Git 忽略。

## 发布流程

WeSight 使用 GitHub Releases 分发桌面安装包。

1. 将准备发布的改动提交到 `main`。
2. 创建并推送版本 tag，例如：

```bash
git tag v2026.4.8-alpha.1
git push origin v2026.4.8-alpha.1
```

3. `Build Platforms` workflow 会构建 macOS Apple Silicon 安装包。
4. 构建产物会先上传为 workflow artifacts，方便临时测试。
5. workflow 会创建一个 draft GitHub Release，并附上 `.dmg` 安装包。
6. 在 GitHub 上检查草稿说明和安装包，确认后发布 Release。

官网的下载按钮可以指向 latest release 地址，让用户始终进入最新公开版本。

## 架构概览

WeSight 使用 Electron 进程隔离架构。Renderer 不直接访问 Node.js 能力，所有高权限操作都通过 preload bridge 和 main process IPC 完成。

### Main Process

- 窗口生命周期和托盘
- SQLite 本地持久化
- Agent 引擎路由
- Claude Code / Codex 外部 CLI adapter
- OpenClaw / Hermes runtime 管理
- 技能加载和服务管理
- 定时任务引擎
- IM gateway 和通知集成

### Renderer

- React + Redux Toolkit + Tailwind CSS
- Cowork Chat UI
- Agent 引擎选择器和模型选择器
- 设置、技能、定时任务、Agent、MCP、外观界面
- 消息、工具调用、命令输出、Slash 指令面板的流式渲染

### 关键目录

```text
src/main/
  main.ts                         Electron 入口和 IPC handlers
  preload.ts                      安全桥接
  sqliteStore.ts                  本地持久化
  coworkStore.ts                  会话和消息存储
  libs/agentEngine/               引擎 adapter 和 router
  libs/openclawEngineManager.ts   OpenClaw runtime 生命周期
  libs/hermesEngineManager.ts     Hermes runtime 生命周期
  libs/externalAgent*.ts          Claude Code / Codex CLI 安装与配置辅助
  im/                             IM gateway 集成

src/renderer/
  App.tsx                         应用外壳
  components/cowork/              Chat、引擎选择、模型选择、会话 UI
  components/Settings.tsx         模型、引擎、外观、技能、记忆和应用设置
  components/pet/                 桌面宠物 UI
  services/                       IPC wrapper 和应用服务
  store/slices/                   Redux 状态

SKILLs/                           内置技能
scripts/                          runtime、打包和安装脚本
src/shared/                       共享常量和类型
```

## 内置技能

WeSight 内置了一组覆盖日常 Agent 工作的技能：

| 方向       | 示例                                                     |
| ---------- | -------------------------------------------------------- |
| 研究       | Web 搜索、科技新闻、股票研究、影视/音乐搜索              |
| 文档       | DOCX、XLSX、PPTX、PDF 处理                               |
| 自动化     | Playwright、本地工具、定时任务                           |
| 创作       | Remotion 视频、前端设计、Canvas 设计、Seedream、Seedance |
| 通信       | IMAP/SMTP 邮件                                           |
| Agent 构建 | Skill 创建、Skill 审查、自定义规划                       |

技能可以在桌面 UI 中启用、停用和路由。

## 安全设计

- Renderer 开启 context isolation。
- Renderer 禁用 Node integration。
- 高权限动作统一经过 main process IPC。
- 工具执行过程可展示权限确认事件。
- 本地数据存储在应用数据目录中的 SQLite。
- runtime、构建产物和本地密钥文件已加入 Git 忽略。

## Roadmap Ideas

- 更多 Agent 引擎 adapter 和 runtime profile
- 更完整的模型迁移和 provider 导入
- 可分享的任务模板
- 更丰富的 Slash 指令结果
- 长任务可视化检查工具
- 社区技能插件市场

## License

MIT. See [LICENSE](LICENSE).
