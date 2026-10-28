# MarkFlow 开发与调试

[返回首页](../README.md) · [使用指南](USAGE.md) · [验证记录](VALIDATION.md)

当前主目标是 Windows 桌面版。以下命令均从仓库根目录执行。源码包含最新界面与 Mark 引擎；`release` 中原有的 0.1.0 安装包对应较早的首版验收，不能用它判断当前源码功能。

## 准备环境

- Node.js **22.12+**；建议与 [`.nvmrc`](../.nvmrc) 一致，使用 **24.15.0**。
- Git for Windows，确认 `git --version` 可运行。开发版通过 PATH 调用本机 Git。
- Electron 45 首次使用需要下载运行时；网络受限时先完成该下载。

```powershell
git clone https://github.com/goldenccar/MarkFlow.git
cd MarkFlow
npm ci
npm exec --no -- install-electron
npm run dev
```

已安装依赖的开发机只需 `npm run dev`。它会打开 Electron 窗口：renderer 修改热更新，主进程和 preload 修改会重新构建、重启窗口。依赖版本由 `package-lock.json` 锁定，不要混用旧版本依赖或从另一台电脑复制 `node_modules`。

文件和 Git 能力依赖 Electron 主进程；只在普通浏览器打开 Vite 地址不能完成这些调试。

## 使用独立测试配置

建议用测试文件夹和独立 profile，隔离日常设置、最近文档与草稿：

```powershell
$env:MARKFLOW_USER_DATA = "$PWD\.test-data\manual-profile"
npm run dev
```

停止开发进程后，在同一终端移除本次环境变量：

```powershell
Remove-Item Env:MARKFLOW_USER_DATA
```

默认设备数据继续使用旧版目录，Windows 为 `%APPDATA%\oopsmd`，保留已有设置、草稿和项目记录。`MARKFLOW_USER_DATA` 可指定独立目录；旧变量 `OOPSMD_USER_DATA` 仍兼容，两者同时设置时优先使用 `MARKFLOW_USER_DATA`。设备设置、草稿和归档索引不进入文档 Git 仓库。独立 profile 只隔离应用状态；请选择专门的测试文档文件夹，避免修改日常文件。

## 调试入口

### 界面与编辑器

在开发窗口按 **F12** 打开 DevTools，通过 Console 检查错误，在 Sources 为 TypeScript / React 源码设置断点。

| 位置 | 主要职责 |
| --- | --- |
| [`src/renderer/App.tsx`](../src/renderer/App.tsx) | 项目、标签、当前文档、保存和 UI 状态 |
| [`src/renderer/BlockEditor.tsx`](../src/renderer/BlockEditor.tsx) | 富文本与源码编辑、共享撤销、Mark 操作 |
| [`src/renderer/Preview.tsx`](../src/renderer/Preview.tsx) | Markdown / 数学预览 |
| [`src/shared/blocks.ts`](../src/shared/blocks.ts) | Markdown 原文节点边界 |
| [`src/shared/richMarkdown.ts`](../src/shared/richMarkdown.ts) | 富文本与 Markdown 原文保真桥接 |
| [`src/shared/marks.ts`](../src/shared/marks.ts) | Markdown Mark 身份与局部样式适配 |
| [`src/renderer/documentSession.ts`](../src/renderer/documentSession.ts) | 会话内容初始化与干净基线 |

### 文件、Git 与 IPC

```powershell
npm run debug
```

然后在 VS Code 运行 **MarkFlow: attach main process**，连接 `9229`。配置已在 [`.vscode/launch.json`](../.vscode/launch.json)。在 [`src/main/index.ts`](../src/main/index.ts) 的 `files:save` 处理处下断点，可依次检查内容快照、磁盘 revision、写盘结果与 Git 结果。

文件安全逻辑在 [`src/main/files.ts`](../src/main/files.ts)，版本与同步在 [`src/main/git.ts`](../src/main/git.ts)。[`src/preload/index.ts`](../src/preload/index.ts) 是最小桥接层，接口类型在 [`src/shared/types.ts`](../src/shared/types.ts)。文件/Git 调用绑定项目，切换前排队的旧调用会被拒绝；应用没有暴露任意命令执行或通用 IPC 接口。

保存和提交分开报告结果：写盘失败不得提交，Git 失败不得让用户误以为正文未保存。修改此流程时，需保留外部 revision 检查、选定快照、暂存隔离及保存期间后续输入保护。详细行为见 [使用指南](USAGE.md#保存本地版本与远端同步)。

## 最短人工验证路径

1. 在新文档输入 Markdown 和 `$E=mc^2$`；Ctrl+S 选择测试文件夹并命名 `说明.md`。
2. 切换实时预览、源码、对照，以及 Markdown / Formula，检查正文、光标与撤销；Formula 只渲染数学片段。
3. 保存后查看磁盘文件，关闭再打开应用，检查标签会话、继续上次项目、新建文档与恢复草稿。
4. 在“Git 与同步”填写作者，明确启用 Git 并建立基线；确认只读打开不会创建仓库。
5. 将默认 500 的自动版本阈值临时改为 10。一次粘贴超过阈值应只记录一个快照；无新内容保存不创建空提交。
6. 输入不足阈值的内容，同时在另一编辑器修改磁盘文件，检查冲突提示、备份和草稿恢复。

不要把实体输入法、真实 GitHub 私有账号认证或跨设备联网往返写成自动测试已通过；这些边界见 [验证记录](VALIDATION.md)。

## 检查与测试

日常修改先运行类型检查和单元测试；运行 Electron 专项前构建当前应用：

```powershell
npm run typecheck
npm test
npm run build
```

`npm test` 覆盖字符计数、Mark 引擎与身份、渲染安全、文件/草稿保护、原生 Git 暂存隔离及两份工作副本同步。按改动选择桌面专项，不必每次全部运行：

| 检查方向 | 命令 |
| --- | --- |
| 基础编辑、保存与打开 | `npm run test:smoke` |
| 保存与 Git 安全 | `npm run test:safety` |
| 实际开发 / 调试启动 | `npm run test:dev` |
| 项目、首次保存、草稿与竞态 | `node scripts/project-smoke.mjs` |
| 富文本及视图切换 | `node scripts/rich-smoke.mjs` |
| Mark 局部排版 | `node scripts/mark-style-smoke.mjs` |
| Mark 身份、移动、复制、拆分合并 | `node scripts/mark-identity-smoke.mjs` |
| 标签、快捷键及工具栏 | `node scripts/tabs-toolbar-smoke.mjs` |
| 归档 | `node scripts/archive-smoke.mjs` |
| 保存后的恢复信息故障 | `node scripts/save-recovery-smoke.mjs` |
| 关闭与保存竞态 | `node scripts/close-save-race-smoke.mjs` |
| 代码复制 | `node scripts/clipboard-smoke.mjs` |
| 主题、菜单、拖动和文件操作 | `node scripts/design-smoke.mjs` |
| 三种窗口尺寸、四种模式主题 | `node scripts/visual-design-smoke.mjs` |
| 编辑输入性能 | `node scripts/editor-performance.mjs` |

Electron 专项在 `.test-data` 下建立独立文档库和配置，不使用日常文档。复制专项在内存中捕获原生接口调用，不读写系统剪贴板。视觉脚本设置 `OOPSMD_VISUAL_DETAILS=1` 可增加菜单、搜索焦点等截图；`OOPSMD_VISUAL_LABEL` 可为输出目录添加标签。性能测量应在其他测试窗口退出后独占执行。

测试结果、测量条件和人工验收边界见 [VALIDATION.md](VALIDATION.md)。不要将历史测试记录或本机速度视为对所有设备与任意文档的保证。

## 独立 Mark 引擎

[`src/engine`](../src/engine) 是零运行依赖的 TypeScript 引擎，提供有序树、稳定 ID、编辑/移动/复制/拆分/合并/插入/删除的原子事务，以及共享快照撤销。公共入口为 [`src/engine/index.ts`](../src/engine/index.ts)。

```powershell
npm run build --prefix src/engine
```

命令生成 `@oops/mark-engine` 的 ESM 与类型声明，不依赖 Electron、Markdown 或 DOM。当前 `private: true` 阻止该包被意外发布到 npm。实际应用通过 [`src/shared/marks.ts`](../src/shared/marks.ts) 接入 Markdown；引擎与适配器边界见 [架构文档](OOPS-ENGINE-ARCHITECTURE.md)。

适配器可显式声明同文档 Mark 引用，复制时重映射被复制子树内的引用，并在事务结束后检查引用有效性。版本化快照可编码、解码并恢复引擎，保留 revision 和退役 ID，不导入撤销历史。这些接口用于后续复用准备，尚未实现 Excel 公式、图表或其他办公格式的适配。

[`src/engine/page.ts`](../src/engine/page.ts) 是独立构建之外的未来草案，没有分页器、页面渲染器或 PDF 编辑 SDK。Word / Excel / PPT / PDF 未接入，不能从类型定义推断这些产品已实现。

## 构建与 Windows 安装包

只运行当前源码的生产构建：

```powershell
npm run build
npm start
```

打包前准备固定 Git 运行时；来源、校验和许可证要求见 [GIT-RUNTIME.md](GIT-RUNTIME.md)：

```powershell
npm run prepare:git
npm run pack
```

`pack` 生成解包目录，入口为 `release/win-unpacked/MarkFlow.exe`。生成 NSIS 安装包：

```powershell
npm run dist
```

当前版本产物为 `release/MarkFlow-0.1.0-win-x64-setup.exe`。`pack` / `dist` 都会构建应用并校验 Git 运行时；这些命令面向 Windows x64，不生成 macOS 安装包。安装包未签名，Windows 可能显示未知发布者提示。

`productName` 和安装包名称使用 MarkFlow；`appId` 保留 `app.oopsmd.desktop`，用于延续 Windows 安装升级身份。该标识、旧用户数据目录和持久化键不属于界面名称，不应随文案改名而直接替换。

源码更新不代表已有安装包同步更新。对外发布前还需复核分发内容、第三方许可和对应源码要求；本地打包成功不等于完成这些发布检查。

## 换到 Mac 继续开发

这部分仅是源码接续步骤，尚未经过 Mac 实机验收。GitHub Desktop 已克隆的项目直接从 `npm ci` 开始：

```bash
mkdir -p ~/Developer
cd ~/Developer
git clone https://github.com/goldenccar/MarkFlow.git
cd MarkFlow
npm ci
npm exec --no -- install-electron
npm run dev
```

先确认终端中的 `git --version` 可用。两台电脑分别安装依赖，不复制 `node_modules` 或 Electron 运行时。开始工作前拉取，结束时提交并推送，切换电脑前确认推送成功；未提交源码、应用设置和恢复草稿不会随 Git 同步。

先验证打开、输入、保存和重开；字体检测、部分 Ctrl 快捷键及窗口行为仍需适配。macOS / Linux 安装包尚未验证，`prepare:git`、`pack`、`dist` 目前只针对 Windows x64。

## 技术与设计参考

应用使用 Electron、React、TypeScript；编辑层为 Tiptap / ProseMirror 与 CodeMirror，解析渲染为 remark / KaTeX，版本操作调用原生 Git，安装包由 electron-builder 生成。

技术文档：[Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、[CodeMirror](https://codemirror.net/docs/)、[KaTeX 配置](https://katex.org/docs/options)、[Git](https://git-scm.com/docs)、[electron-builder](https://www.electron.build/)。

视觉规范见 [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)：4/8 px 间距、13 px UI 基础文字、16 px 默认正文、紧凑控件、模式主题及渐进工具收纳。文档记录了 Apple、Material 与官方设计评审维度的参考依据，不代表获得设计奖项认证。早期编辑交互参考 [Notion 编辑模型](https://www.notion.com/help/writing-and-editing-basics)，并未实现完整 Notion 数据库或 AI。
