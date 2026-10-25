# OopsMD 0.1.0

Windows 本地 Markdown / LaTeX 数学片段编辑器。原始 UTF-8 文件是内容来源；阅读、布局和主题切换不改写正文。本版实现范围及待验收项见 [OopsMD-TODO.md](OopsMD-TODO.md)，实际测试结果见 [验证记录](docs/VALIDATION.md)。

当前源码已加入 Mark 富文本编辑、浏览器式标签、排版工具栏、文件夹项目管理、逻辑归档与四组模式配色。本轮通过 `npm run dev` 试用；`release` 中原来的 0.1.0 安装包仍对应此前的首版验收。

## 文档与项目

- 没有历史项目时，直接进入可输入的新文档。内容先保存在本机独立草稿中，首次按 Ctrl+S 才选择文件夹和文件名。
- 有上次标签会恢复标签会话；没有标签但有历史项目时，启动页提供“继续上次项目”和“新建文档”。左侧用于切换文件夹项目。
- “新建文档”始终先创建独立草稿。在某个项目中创建时，首次保存对话框默认定位到该项目；可以改选其他文件夹。
- 取消首次保存会保留编辑内容。切换标签会先保护草稿；关闭未保存标签时可选择保存、保留草稿或取消。草稿以顶部标签显示，Ctrl+Shift+T 可重新打开关闭的标签。
- 第一次保存采用新文件写入，遇到重名会保留已有文件并要求更换文件名。该安全发布方式需要支持硬链接的本地文件系统（本机 NTFS 已验证）；不支持时会提示换保存位置，草稿仍保留。
- 独立草稿不会自动弹出保存对话框、提交 Git 或从之前的项目解析相对图片；保存到项目后沿用原有保存、版本与同步规则。

## 编辑、移动与归档

- Markdown 默认进入**实时预览**：直接编辑排版后的内容，当前 Mark 也不显示 Markdown 标记。源码和对照模式使用 CodeMirror 编辑正文，已识别的 Oops 身份元数据由适配器维护，不放入源码编辑区；Geek 默认对照，仅提供对照与源码。各标签分别保留撤销历史，切换编辑视图不改正文。
- 普通段落按 Enter 新建 Mark，Shift+Enter 插入 Mark 内可见换行。列表回车继续下一项；空列表项回车退出列表。代码、公式和表格内部按语法保留换行，完整结构 Mark 末尾回车新建下一个 Mark。
- 当前文档的 Mark 显示在文件树的文件节点下；草稿或文件夹树模式使用独立的 Mark 大纲，点击可定位。文件树显示文件与目录的完整层级，文件夹树只显示目录，选中目录后在下方显示该层文件。Mark 不会拆成多个磁盘文件。
- 右键 Mark 大纲条目可选择“上移 Mark”“下移 Mark”“复制 Mark”。移动保留身份，复制生成新身份并保留局部样式；操作可撤销。若目标位置会改变 Markdown 结构，操作会被拒绝。
- 新建入口位于顶部标签栏的加号，支持 Ctrl+T / Ctrl+N。文件或文件夹可直接拖到同一项目的文件夹或根目录；目标重名、移入自身会被拒绝。
- 右键文件或文件夹可重命名、归档或移到系统回收站；键盘也可用 Shift+F10 打开菜单。归档只隐藏工作树条目，文件仍在原路径，正文、附件与 Git 内容均保持。
- 左侧“归档”默认收起，展开后可浏览和编辑资料；右键“恢复到工作树”撤销归档。归档文件夹覆盖其子项，恢复其中的文件会恢复整个所在归档。
- 归档记录按项目保存在设备数据的 `archive` 目录，包含相对路径和归档时间；应用内移动、改名、删除会更新记录。外部程序移动文件不能自动跟踪；归档索引尚不跨设备同步。当前没有 AI 功能。
- Markdown 日间为白底，Geek 为淡蓝灰底；夜间分别使用中性炭灰和冷蓝灰。内容色、导航色、焦点色采用独立语义角色。

## 标签与排版

- 标签位于文件路径上方：点击切换，拖动排序，中键或 × 关闭，右键可固定、关闭其他、关闭右侧、重新打开关闭的标签。Ctrl+Tab / Ctrl+Shift+Tab 切换，Ctrl+1…8 选择对应位置，Ctrl+9 选择最后一项，Ctrl+W 关闭当前，Ctrl+Shift+T 恢复最近关闭。
- 工具栏顺序为 MD/Geek 胶囊 → 字体、字号 → 加粗、下划线、删除线、斜体、上标、下标、荧光笔 → 页内搜索 → 显示布局。文本格式按钮用于 Markdown，Geek 使用 LaTeX 命令。较窄窗口将格式按钮收进“更多排版”。Ctrl+F 聚焦搜索，Enter / Shift+Enter 跳转下一个/上一个，Escape 退出。
- Markdown 工具栏的字体、字号作用于光标所在的整个 **Mark**；也可先从 Mark 大纲定位，再调整。不同 Mark 可以独立排版，“恢复 Mark 默认样式”清除手动覆盖。未手动设置的 Mark 继承设置面板中的默认字体、默认字号；Geek 仍使用阅读默认。Enter 新 Mark 使用默认样式，Shift+Enter 留在当前 Mark。
- 默认字体和字号仍是设备上的阅读偏好，局部覆盖与 Mark 身份保存在 `.md` 尾部的 Oops 注释元数据中，随草稿、撤销、Git、文件移动及复制保留。修改字体不会重写 Markdown 正文；其他 Markdown 软件通常只显示正文，不会解释 Oops 的字体覆盖。外部工具删除专用注释会同时丢失已有 Mark 身份及局部样式，再打开时为正文重新分配身份。
- 六款字体均有选项，缺失字体标为“未安装”。默认字重，不提供字重列表；加粗/斜体是独立文字格式，代码默认等宽显示。字号沿用 CSS px，未来页面适配器明确换算为 pt。
- Windows 标题栏融合标签区，保留系统的最小化、最大化、关闭及窗口拖动。Alt+F4 关闭窗口；Alt+1/2/3 切换实时预览/源码/对照（Geek 将实时预览映射为对照）。

## Oops 套件引擎边界

产品内容单元统一称为 **Mark**。`src/engine` 已实现独立、零运行依赖的 TypeScript 引擎：有序树、稳定 ID、编辑/移动/复制/拆分/合并/插入/删除原子事务，以及共享快照撤销。公共入口是 `src/engine/index.ts`，运行 `npm run build --prefix src/engine` 可单独生成 `@oops/mark-engine` 的 ESM 与类型声明，不需要 Electron、Markdown 或 DOM。

`src/shared/marks.ts` 是实际接入的 Markdown 适配器，为所有活跃语义 Mark 分配身份，包括未设置样式的内容；当前范围是顶层节点与顶层列表项，尚非完整嵌套 AST。ID 随尾部 registry、草稿和正常保存持久化。首次打开纯 Markdown 会先在内存补齐，不自动改磁盘；从未保存或产生草稿就关闭时，下次可重新分配。外部修改对应不确定时不猜身份/样式；删除后 registry 只保留退役 ID，被删正文保留在撤销历史中。

`src/engine/page.ts` 仍是独立构建之外的未来草案，没有分页器、页面渲染器或 PDF 编辑 SDK。Word/PPT/PDF 尚未接入，也没有 AI。实际 API、样式继承、源码对应与后续页面边界见 [Mark 引擎架构](docs/OOPS-ENGINE-ARCHITECTURE.md)。

## Markdown 支持范围

Markdown 没有统一滚动版本号。此版以最新正式 [CommonMark 0.31.2（2024-01-28）](https://spec.commonmark.org/) 和 [GFM 0.29-gfm（2019-04-06）](https://github.github.com/gfm/) 为解析基准，使用 remark-parse 11 / remark-gfm 4；不能把解析器版本号当成 Markdown 标准版本。

支持标题、段落、引用、列表、围栏/缩进代码、分隔线、链接、相对图片、表格、任务列表、删除线与自动链接。数学公式由 remark-math / KaTeX 提供。下划线、上标、下标、荧光笔用安全的 u / sup / sub / mark 标签保存，它们不是 CommonMark 独立语法。任意 HTML 和脚本不执行。

富文本使用 Tiptap / ProseMirror。未编辑 Mark 的原文、引用定义及间隔按原文保留，仅对发生修改的 Mark 生成 Markdown；未支持的特殊结构保留为受保护 Mark，可到源码模式修改。不是完整 Notion 数据库，也没有 AI 功能。标准解析覆盖与富文本可编辑范围是两个不同边界，不声称所有 Markdown 方言都能所见即所得编辑。

## 本地启动

已安装依赖的开发机，在项目根目录运行：

```powershell
npm run dev
```

命令会打开 Electron 窗口。前端修改热更新；主进程和 preload 修改会重新构建、重启窗口。无需 GitHub 登录即可编辑、预览、保存和记录本地版本。请先用单独的测试文件夹调试。

在另一台开发机首次准备：安装 Node.js 22.12+（建议与 `.nvmrc` 一致，使用 24.15.0）。Windows 安装 Git for Windows，macOS 确认终端中 `git --version` 可运行，然后在项目根目录运行：

```powershell
npm ci
npm exec install-electron -- --no
npm run dev
```

Electron 45 首次使用需下载运行时；若网络受限，先完成上述下载。所有运行依赖锁定在 `package-lock.json`，不要自行混用旧依赖版本。

### 从 Windows 换到 Mac 继续开发

首次在 Mac 获取项目（已通过 GitHub Desktop 克隆的，直接进入该项目目录并从 `npm ci` 开始）：

```bash
mkdir -p ~/Developer
cd ~/Developer
git clone https://github.com/goldenccar/MarkFlow.git
cd MarkFlow
npm ci
npm exec install-electron -- --no
npm run dev
```

两台机器分别安装依赖，不复制 `node_modules` 或 Electron 运行时。开始工作前先拉取；结束时提交并推送，切换电脑前确认推送成功。未提交的源码、应用设置和恢复草稿不会随 Git 同步。

当前提供的是开发接续流程，尚未在 Mac 实机验收。先验证打开、输入、保存和重开；字体检测、部分 Ctrl 快捷键及窗口行为仍需适配。`prepare:git`、`pack`、`dist` 当前针对 Windows x64，不能用来生成 Mac 安装包。

## 怎么调试

- **界面与编辑器**：在应用按 **F12**，使用 Console 查看错误，Sources 给 TypeScript/React 源码下断点。`src/renderer/App.tsx` 管理当前文档与保存状态，`BlockEditor.tsx` / `Preview.tsx` 管理编辑和预览，`src/shared/blocks.ts` 负责原文块边界，`src/shared/richMarkdown.ts` 负责富文本与原文的保真桥接。
- **文件与 Git**：运行 `npm run debug`，再用 VS Code 的“OopsMD: attach main process”连接 **9229**。在 `src/main/index.ts` 的 `files:save` 处下断点，可依次检查快照、磁盘 revision、落盘结果、Git 结果。文件安全逻辑在 `files.ts`，版本与同步在 `git.ts`。
- **IPC**：`src/preload/index.ts` 是最小桥接层，接口类型在 `src/shared/types.ts`。文件和 Git 调用绑定文档库，切换前排队的旧调用会被拒绝。
- **独立测试配置**：可在启动前设置 `$env:OOPSMD_USER_DATA = "$PWD\.test-data\manual-profile"`，将测试设置、最近文档和恢复草稿与日常配置隔离。测试完用 `Remove-Item Env:OOPSMD_USER_DATA` 恢复默认。默认设备数据目录由 Electron 的 `app.getPath('userData')` 决定，Windows 通常在 `%APPDATA%\oopsmd`；不进入文档 Git 仓库。

不要只在普通浏览器打开 Vite 地址来测试文件/Git：这些能力需要 Electron 主进程。应用未暴露任意命令执行或通用 IPC 接口。

## 最短验证路径

1. 直接在新文档输入 Markdown 和 `$E=mc^2$`；Ctrl+S 选择测试文件夹，命名为 `说明.md`。也可以从左侧“项目”旁的加号打开已有文件夹。
2. 切换“实时预览 / 源码 / 对照”和“Markdown / Geek”，确认源码、撤销历史保持不变。Geek 接收 `\frac{a}{b}` 等数学片段，不编译完整 TeX。
3. 按 Ctrl+S 检查磁盘。关闭再打开应用，验证继续上次项目、新建文档以及草稿入口。
4. 打开“Git 与同步”，填写作者姓名、邮箱，明确点击“启用 Git 并建立基线”。只读打开不会初始化仓库。
5. 设置自动版本阈值（默认 500）；可临时改成 10 便于观察。粘贴超过阈值只记录一个快照；Ctrl+S 不创建空提交。
6. 输入不足阈值的内容，在另一编辑器修改同一文件，验证冲突提示。切换文档或关闭时选择保存或保留草稿；再次打开可恢复。

独立引擎与 Mark 身份专项可在项目根目录运行。专项会启动独立测试配置的 Electron，检查移动、复制、拆分/合并、撤销及重开后的身份；应用需先构建：

```powershell
npm run build --prefix src/engine
npm run build
node scripts/mark-identity-smoke.mjs
```

## GitHub 连接与认证

在“Git 与同步”填 GitHub HTTPS/SSH URL 与分支，点击“保存仓库配置”，然后手动同步。开发版调用 PATH 上的 Git；安装版带有固定版本 MinGit、Git Credential Manager 和 OpenSSH，来源与许可证见 [docs/GIT-RUNTIME.md](docs/GIT-RUNTIME.md)。

已有远端内容时，最直接的首次接入是先克隆，再用 OopsMD 打开仓库根目录：

```powershell
git clone https://github.com/你的账号/你的仓库.git "D:\OopsMD-notes"
```

私有仓库需先用 Git Credential Manager 完成授权，或配置可用的 SSH 密钥。推荐先在终端对该仓库执行一次 `git fetch origin`；首次浏览器授权由 Git/GCM 处理。应用不保存账号口令或 token，不把凭据放进仓库 URL。

同步前工作区、暂存区和编辑器须处理完变更。记录变更时只选择本次文件，附件可随当前文档提交；改名需选旧、新两条路径。对其他工具已暂存的当前文件暂停版本记录，其他已暂存文件保留。自动记录失败后暂停重试，处理原因后手动保存重新启用。

同步会 fetch、合并、push，不强推。文本、二进制、删除/修改冲突可逐文件选择本地或远端，再完成合并；也可中止合并后用外部 Git 工具细化处理。本地与远端是两套无共同历史的仓库时会拒绝自动合并，先克隆到新目录并有选择地复制文档。

## 检查、构建和安装包

```powershell
npm run typecheck
npm test
npm run build --prefix src/engine
npm run build
npm run test:smoke
npm run test:safety
node scripts/clipboard-smoke.mjs
node scripts/project-smoke.mjs
node scripts/rich-smoke.mjs
node scripts/mark-style-smoke.mjs
node scripts/mark-identity-smoke.mjs
node scripts/archive-smoke.mjs
node scripts/save-recovery-smoke.mjs
node scripts/design-smoke.mjs
node scripts/tabs-toolbar-smoke.mjs
node scripts/close-save-race-smoke.mjs
node scripts/editor-performance.mjs
npm start

npm run prepare:git
npm run dist
```

- `npm test`：字符计数、渲染安全、文件与草稿保护、原生 Git 暂存隔离及双工作副本同步测试。
- Electron 冒烟测试使用 `.test-data` 下独立文档库与配置，不操作日常文档。复制专项测试仅在内存中捕获原生接口调用，不读写系统剪贴板。
- `npm run pack` 只生成解包目录；`npm run dist` 生成 `release/OopsMD-0.1.0-win-x64-setup.exe`。
- 解包应用入口：`release/win-unpacked/OopsMD.exe`。
- 本版安装包未签名，Windows 可能显示未知发布者提示；没有声称通过签名验证。

## 已知边界

- 真实 GitHub 公有/私有账号授权与跨设备联网往返尚需使用自己的仓库验收；已执行的同步测试使用本机两个工作副本及裸仓库。
- 输入法组合事件已保护；真实中文输入法候选窗仍需人工验收。macOS/Linux 安装包没有测试。
- 文本编码只支持 UTF-8；首次保存保留 BOM 和原换行风格。混合换行文件发生编辑后以首个换行风格统一；纯阅读和无变化保存不改字节。
- 删除通过系统回收站；仍有未保存草稿的目录会阻止删除，需先恢复保存或导出。重命名报告常见内部链接的影响并迁移草稿，不自动修复链接。
- 复杂字符差异在 Worker 计算，超时会提示手动保存，不采用近似计数。草稿在输入停止约 250 ms 后写入，突然断电可能损失最后这段尚未持久化的输入。
- 精确快照提交使用 Git plumbing，不运行 commit hooks 或自动签名。已有仓库的特殊合并状态、当前文件暂存和锁不会被自动清除。
- 预览只识别下划线、上标、下标、荧光笔的安全样式标签，不运行任意原始 HTML/脚本，仅自动加载文档库内的相对图片；外部链接经明确点击交给系统。完整 TeX/PDF 编译、跨文件全文搜索、PDF 导出及其他未勾选 T1/T2 功能尚未实现。

技术依据：[Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、[CodeMirror](https://codemirror.net/docs/)、[KaTeX 配置](https://katex.org/docs/options)、[Git](https://git-scm.com/docs)、[electron-builder](https://www.electron.build/)。

设计规则见 [DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md)：4/8 px 间距基准、13 px UI 基础文字、16 px 默认正文、28–32 px 紧凑控件和 7 px 基础圆角。Markdown 使用白色正文与温灰导航，Geek 使用冷蓝灰；rich/preview 共用排版，文件与 Mark 使用不同选择层级，工具栏按可用宽度渐进收纳。2026-10-26 完成两轮真实截图复审与功能/性能回归，记录见 [VALIDATION.md](docs/VALIDATION.md)。参考 [Apple 布局与层级](https://developer.apple.com/design/human-interface-guidelines/layout)、[上下文菜单](https://developer.apple.com/design/human-interface-guidelines/context-menus)、[Material 色彩角色](https://m3.material.io/m3/pages/color-roles?s=m3)，以及设计规则中列出的 Awwwards/Webby/FWA 官方评审维度；不代表获奖认证。早期编辑交互参考 [Notion 编辑模型](https://www.notion.com/help/writing-and-editing-basics)，当前未实现完整 Notion 数据库、斜杠菜单、跨页 Mark 引用或 AI。
