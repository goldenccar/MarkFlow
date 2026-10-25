# OopsMD 0.1.0 验证记录

日期：2026-10-26（Asia/Shanghai）。此记录区分实现、自动测试与需要用户账号/实体输入法的验收。

## 视觉与交互呈现更新（当前开发版）

本轮只调整样式、导航显示、响应式收纳及原生 caption 配色。未修改 Mark 引擎、文档格式、文件/Git、草稿、撤销或编辑事务，也未引入运行依赖。设计规则及官方评审依据见 [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)。

完成旧版基线、第一轮截图和第二轮独立复审：第一轮统一颜色、排版、控件、选择层级和渐进工具收纳；第二轮消除侧栏重复标题、恢复中性夜间底色、隐藏 Geek 原本不可用的 MD 格式组。没有把主观评分或自动检查称作获奖认证。

- **类型检查及最终生产构建：通过。** 日志 `.test-data/design-build-final.log`。
- **最终视觉验收：15/15 通过，41 张截图。** 12 组核心组合：1440×1000、1100×760、920×620 × Markdown/Geek × 浅/深；其余覆盖代码/表格/公式、搜索焦点、字体/格式菜单、Mark/文件右键、设置、减少动态效果。无横向溢出、控件重叠、浮层裁切或页面/控制台错误。新建文件夹与两个树视图按钮的边界和中心命中另有检查。日志 `.test-data/visual-final.log`；画廊 `.test-data/visual-final-94ONBz/index.html`。
- **真实截图人工复审：通过。** 查看 MD 宽屏、窄屏、夜间、Geek 对照及菜单；基线位于 `.test-data/visual-baseline-fP5rAY/`，第一轮位于 `.test-data/visual-round1-2orCBm/`。这些是本机 Electron 渲染截图，窗口原生 caption 的颜色由主进程同步配置，页面截图不包含系统 caption 按钮。
- **主要文字配色：24/24 组对比度不低于 4.5:1，最低 4.58:1。** 覆盖四套主题的正文、辅助文字、细节、强调和主要按钮配对，结果 `.test-data/design-contrast.json`。这是 token 检查，不代表完整 WCAG 审计。
- **富文本 10/10、Mark 排版 7/7、标签工具栏 9/9 通过。** 日志 `.test-data/design-rich-final.log`、`design-mark-style-final.log`、`design-tabs-round1.log`。包括字体字号覆盖、实时/源码/对照、撤销重做、相对图片、草稿恢复、紧凑工具入口；标签测试在第一轮完成，第二轮未更改标签或工具动作。
- **文件与交互 7/7 通过。** 最终构建实际验证文件拖动、右键键盘焦点、归档/恢复、改名、回收站、主题及视图切换后的完整保存快照，日志 `.test-data/design-interactions-final.log`。

性能在其他测试窗口退出后独占执行；生产构建、隔离配置、无 Git 文档，最后一个 Mark 24px，输入 16 个字符；测量前后检查 UUID 列表、大纲、样式和错误状态：

| 场景 | 输入至两帧中位 / 最大 | 50ms 以上长任务 |
| --- | --- | --- |
| 100 个 Mark | 13 / 34ms | 0 |
| 1,000 个 Mark | 17 / 31ms | 0 |

日志 `.test-data/design-performance-final.log`。上一轮 1,000 Mark 为 18 / 30ms；本机样本没有显示明显输入性能下降，不推广为所有设备与任意文档的保证。安装包未重打；真实输入法与 GitHub 账号往返等原有人工验收边界不变。

## 独立 Mark 引擎与全量身份（2026-10-24 开发版）

`src/engine` 已是可单独构建的 `@oops/mark-engine` 私有包，零运行依赖；提供有序树、稳定 ID、原子编辑/移动/复制/拆分/合并/插入/删除、版本校验和共享快照撤销。所有活跃 Markdown Mark 都有 UUID，包括默认样式和空段落。源码视图只显示正文，完整身份 registry 随正常草稿及保存持久化；只读打开旧文件不自动落盘或制造脏状态。Page 无运行时，Word/PPT/PDF 未接入。

- **独立包构建及标准 Node ESM 导入：通过。** 非 Markdown 的向量数据执行复制、撤销、重做后身份正确，不加载应用或页面代码。日志 `.test-data/engine-package-build.log`、`engine-package-import.log`。
- **全量单元与集成测试：133/133 通过。** 日志 `.test-data/engine-unit-full.log`。后续身份映射修订的最终专项 **60/60 通过**，日志 `engine-targeted-final.log`；最后 Preview 全量 ID 与公式样式修复另通过 **14/14 渲染测试**及类型检查。集合有重叠，不相加计数。
- **最终类型检查与生产构建：通过。** 日志 `.test-data/engine-build-final.log`。
- **Mark 身份桌面专项：7/7 通过。** 未编辑旧文件保持干净、相同正文的不同文件身份独立、编辑/移动/复制/拆分/合并与撤销重做、源码/对照、磁盘完整 registry、重启后稳定 ID；日志 `.test-data/engine-identity.log`，fixture `mark-identity-Zz2L6r`。
- **独立样式 7/7、富文本 10/10、项目 14/14、标签工具栏 9/9 通过。** 日志依次为 `.test-data/engine-style.log`、`engine-rich.log`、`engine-project.log`、`engine-tabs.log`。富文本截图已目视复核，页面及控制台错误为空。
- **基础流程 8/8、保存与 Git 安全 10/10、保存后元数据故障 1/1、关闭保存竞态 1/1 通过。** 日志 `.test-data/engine-smoke.log`、`engine-safety.log`、`engine-save-recovery.log`、`engine-close-save-race.log`。保存快照使用完整正文及 registry 比较，保留外部修改、暂存隔离、保存期间继续输入和草稿恢复保护。
- **真实开发/调试启动：5/5 通过。** 日志 `.test-data/engine-dev.log`。检查 dev/debug、preload、CSP、HMR、DevTools、草稿重载、大纲与 9229 inspector；未模拟物理 F12。

性能使用本机生产构建、隔离配置、无 Git 的文档；最后一个 Mark 设置 24px，输入 16 个字符，计时包含两帧。测量前后检查完整 UUID 列表不变、大纲可用、没有错误提示及字体样式仍生效：

| 场景 | 输入至两帧中位 / 最大 | 50ms 以上长任务 |
| --- | --- | --- |
| 100 个 Mark，全量 ID、1 个局部样式 | 11 / 18ms | 0 |
| 1,000 个 Mark，全量 ID、1 个局部样式 | 18 / 30ms | 0 |

证据：`.test-data/engine-performance.log`。上一轮同机 1,000 Mark 样本为 15 / 25ms；本轮样本仍没有长任务，不能据单次测量保证任意文档、所有设备零回退。本轮避免每次输入重复全文解析与逐节点线性查找；身份、样式和正文共享同一可撤销快照，不维护两份编辑状态。

只读旧文件的 ID 首次存在于会话，未经草稿/保存直接关闭后可以重新分配；外部工具删除 registry 会丢失身份和局部样式。安装包未重打，实体中文输入法与真实 GitHub 账号往返仍待人工验收。

## Mark 独立排版与引擎边界（2026-10-23 开发版）

产品内容单元与大纲统一称为 Mark。Markdown 工具栏对当前 Mark 设置字体、字号，支持恢复默认；局部样式与身份保存到文件尾部的版本化注释，进入同一撤销、草稿和保存链路。格式无关的 Mark 与 Page 合同见 `OOPS-ENGINE-ARCHITECTURE.md`，Page 目前仅有类型与设计，没有分页运行时。

- **完整单元与集成测试：109/109 通过。** 日志 `.test-data/mark-unit.log`。随后针对身份映射与性能调整的最终专项 **36/36 通过**，含新增粘贴身份、语义类型变化和 opaque 回退检查，日志 `.test-data/mark-targeted-final.log`。未将两个重叠集合相加。
- **最终类型检查与生产构建：通过。** 日志 `.test-data/mark-build-final.log`。
- **Mark 桌面专项：7/7 通过。** 两段独立排版、大纲/选区同步、源码/对照、精确正文与 Git、样式草稿重启恢复、移动/改名、源码末尾删除、恢复默认、空 Mark 首次保存；日志 `.test-data/mark-style-final.log`，截图 `.test-data/mark-style-aQLJVZ/`。
- **富文本最终回归：10/10 通过。** 含实际视图切换光标、七种格式、跨视图撤销、未编辑原文、相对图片、模拟 IME；页面/控制台错误为空。日志 `.test-data/mark-rich-verified.log`，截图 `.test-data/rich-N02vPW/`。
- **标签与工具栏回归：9/9 通过。** 日志 `.test-data/mark-tabs-toolbar.log`，截图 `.test-data/tabs-toolbar-9XEF0f/`。
- **开发与调试：5/5 通过。** 真实启动 `npm run dev` / `npm run debug`，验证草稿重载、有效 Mark 大纲、preload、nonce CSP、HMR、DevTools、F12 菜单绑定和 9229 调试入口。日志 `.test-data/mark-dev-final.log`。首轮发现新依赖动态预打包导致启动重载，已显式加入预打包列表并通过复测；未模拟 Windows 物理 F12。

性能使用本机生产构建、隔离配置、无 Git 的文档；最后一个 Mark 设置 24px，再输入 16 个字符，计时包含两帧。测量前后均确认大纲可用、无错误提示、局部样式仍生效：

| 场景 | 输入至两帧中位 / 最大 | 50ms 以上长任务 |
| --- | --- | --- |
| 100 个 Mark，1 个局部样式 | 15 / 19ms | 0 |
| 1,000 个 Mark，1 个局部样式 | 15 / 25ms | 0 |

证据：`.test-data/mark-performance-final.log`。优化前同样 1,000 个 Mark 的样本为中位 52ms、最大 87ms；已移除样式维护中重复的正文 AST 解析，复用编辑事务的可信范围与语义类型。不确定内容仍走解析回退。结果不能推广到任意机器、所有 Mark 都独立设置样式或任意复杂文档。

局部默认仍为设备设置；手动覆盖随文件携带。只有手动设置过样式的 Mark 有持久 UUID，其余使用快照定位；外部修改后身份有歧义时停用对应样式，不猜测继承。完整跨产品 Mark 图、图片/页面引擎、PDF 编辑和 AI 均未宣称完成。安装包未重打；实体输入法和真实 GitHub 网络往返仍需人工验收。

## 真正富文本、标签与性能更新（上一轮开发版）

本轮将 Markdown 活动块改为 ProseMirror 富文本，源码与对照仍使用 CodeMirror；Geek 默认对照且没有独立预览入口。增加独立文档标签、七项文本格式、字体选择、页内搜索和融合 Windows 窗口栏。源码中的安全/保真边界与操作方法见 README。安装包未重打。

- **单元与集成测试：98/98 通过，0 失败。** 包含既有文件/Git保护与新的富文本 schema、原文块/CRLF保真、未知HTML保存、七种marks、撤销历史、字体识别、标签元数据。日志：`.test-data/upgrade-unit-final.log`。
- **最终类型检查与生产构建：通过。** 日志：`.test-data/upgrade-build-final.log`。
- **原有桌面回归：27/27 通过。** 归档6、基础8、安全10、代码复制2、保存后元数据失败1；日志：`.test-data/tabs-archive-smoke.log`、`tabs-smoke.log`、`tabs-safety-smoke.log`、`tabs-clipboard-smoke.log`、`tabs-save-recovery-smoke.log`（均位于 .test-data）。
- **项目与关闭竞态：15/15 通过。** 项目14项，含保留草稿后移动文件夹再重开、A改名B后新建A的独立正文/Undo；关闭保存专项1项，在最后Git状态等待阶段尝试输入，确认关闭期间编辑只读、恢复后正文与磁盘/HEAD一致。日志：`.test-data/final-project-smoke.log`、`.test-data/final-close-save-race-smoke.log`。
- **设计与文件操作：7/7 通过。** 四组主题、920小窗口、右键焦点、拖动/归档/回收站。日志：`.test-data/tabs-design.log`，截图：`.test-data/design-TyagsN`。
- **标签与工具栏：9/9 通过。** 独立Undo和保存、取消关闭/保留草稿重开、多个固定标签、关闭其他/右侧、拖动、窄窗resize完整显示活动标签、真实CtrlT/W/Tab/ShiftTab/ShiftT/F、各标签布局、重启会话、字体/格式/搜索，以及真实大纲节点enabled且无错误提示。最终日志：`.test-data/tabs-toolbar-final.log`；截图：`.test-data/tabs-toolbar-TnTUe8`。
- **富文本桌面验收：9/9 通过。** 常见语法排版与原文保留、七种格式、跨视图撤销重做、列表换行、搜索焦点、公式 Ctrl+S、模拟 IME，以及首次保存后相对图片刷新并保留撤销历史。页面与控制台错误均为空。日志：`.test-data/rich-editor-final.log`；截图：`.test-data/rich-jADpoN/rich-editor.png`。
- **开发调试：5/5 通过。** 真实启动 `npm run dev` / `npm run debug`，验证富文本输入和草稿重载、可用大纲、preload、nonce CSP、HMR WebSocket、DevTools、F12 菜单绑定及 9229 主进程调试入口。日志：`.test-data/upgrade-dev.log`。未模拟 Windows 物理 F12 按键。
- **字体实测：** 实际桌面用户已有仿宋、楷体、微软雅黑、阿里巴巴普惠体3.0；两款GB2312未安装。CDP核验正文实际使用 Alibaba PuHuiTi 3.0 / AlibabaPuHuiTi_3_55_Regular（25 glyphs），不只是CSS声明。没有额外系统安装或重新分发字体文件；沙箱账户HKCU与桌面账户不同，不采用沙箱查询作为最终可用性结论。

性能基于本机隔离文档，不能推广为任意机器的速度保证：

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 40目录/1000文件的Git status，3样本中位 | 1020.4ms → 394.5ms；14个Git进程 → 热态9个 | .test-data/main-perf-before.json、main-perf-after.json |
| 100段落，16次输入，输入至两帧 | 中位13ms，最大18ms，50ms以上longtask为0 | .test-data/editor-performance-verified.log |
| 1000段落，16次输入，输入至两帧 | 中位15ms，最大30ms，50ms以上longtask为0 | 同上；已等1000个大纲节点可用且无alert |

已去除旧编辑器的光标移动全篇解析、主线程大纲解析与重复Git查询，复用已完成的字符计数Worker。大纲在后台更新，旧版本偏移对应的导航按钮在更新完成前不可点击，避免跳到错误位置。初期Worker因实体解码依赖选中DOM导出而失败，已配置官方纯JS导出；`editor-performance-final.log` 是修复前无有效大纲的样本，作废，性能结论只取上表 verified 日志。

## Block 编辑、逻辑归档与界面更新（上一轮开发版）

此轮覆盖默认可编辑实时预览、文件节点下的 block 导航、拖动移动、右键菜单、隐藏归档树，以及 Markdown/Geek 的日夜配色。没有重新生成安装包。

- **自动化测试：81/81 通过，0 失败、0 跳过。** 日志：`.test-data/blocks-tests.log`。包括原有文件/Git/渲染保护、8 项 block 原文边界与换行测试、8 项归档测试和 2 项树筛选/拖动目标测试。
- **最终类型检查与生产构建：通过。** 日志：`.test-data/blocks-build-final.log`。
- **归档 IPC：6/6 通过。** 验证原文和 Git 字节不变、重启与项目隔离、移动继承、恢复、删除与草稿保护、归档元数据写入失败后的恢复、路径与旧项目调用边界。日志：`.test-data/blocks-archive.log`。
- **原有桌面流程：32/32 通过。** 项目流程 12、基础 8、安全 10、复制调用链 2，保留原撤销/重做、保存中继续输入、模拟 IME、阈值、外部冲突及真实回收站检查。日志：`.test-data/blocks-project.log`、`.test-data/blocks-regression.log`、`.test-data/blocks-safety.log`、`.test-data/blocks-clipboard.log`。
- **保存后故障：1/1 通过。** 首次保存正文成功后，单次注入归档查询失败；磁盘正文完整、界面已绑定新文件、状态明确正文已保存，独立草稿保留且可继续编辑。日志：`.test-data/blocks-save-recovery.log`。
- **设计与实际操作：7/7 通过。** 验证 Markdown/Geek × 浅色/深色在 1440 宽屏及 920×620 小窗口中的布局；检查键盘右键菜单与焦点返回、文件真实拖动、归档与重启恢复、改名、系统回收站，以及视图切换前后保存字节一致。日志：`.test-data/design-final.log`；最终截图目录：`.test-data/design-oG8TE4/`。已目视复核列表间距、Markdown 正文和 Geek 模式。
- **Block 编辑：7/7 通过。** 验证默认直接输入、Enter 立即生成空块、Shift+Enter 保留同块换行、首次保存与全部模式/视图的统一撤销历史、树定位与段落中部点击、列表逐项成块、引用式链接/唯一标题 ID/代码复制、原文精确往返、多行粘贴、模拟 composition 和空文件编辑。最终日志：`.test-data/blocks-editor-final.log`；截图与原始文件：`.test-data/blocks-02NoMO/`。列表单项高度已检查小于 40px；真实中文输入法仍未由自动化替代。

归档记录目前仅保存在设备数据中，跟随应用内移动/改名；外部程序移动文件不能自动跟踪。块节点由原 Markdown 解析，活动块显示可编辑源码，其余块排版；本次不是完整 Notion 数据库或完整所见即所得实现，未接 AI。实体输入法与真实 GitHub 网络往返边界仍见下文。

## 项目启动流程与界面更新（上一轮开发版）

本节对应后续的“先写文档、首次保存归入项目”及界面调整。下方原始 0.1.0 安装包记录保留为历史证据；本次更新没有重新生成安装包，使用 `npm run dev` 试用。

- **自动化测试：63/63 通过，0 失败、0 跳过。** 日志：`.test-data/project-redesign-tests.log`。新增项目授权、旧配置迁移、独立草稿、首次保存不覆盖、保存快照及未归档文档的本地图片隔离检查。
- **类型检查与构建：通过。** 最新构建日志：`.test-data/project-redesign-build.log`。
- **实际 Electron 项目流程：12/12 通过。** 覆盖无项目直接编辑、取消首次保存、拒绝覆盖、强制退出恢复、保存期间继续输入与撤销重做、草稿迁移、Git 暂存保护、项目切换、上次项目启动选择及多份未归档草稿。日志：`.test-data/project-redesign-flow.log`；截图：`.test-data/projects-K1nCPq/project-flow.png`。
- **开发调试：5/5 通过。** 真实执行 `npm run dev` 与 `npm run debug`，验证 preload、CSP、HMR 连接、DevTools、原生菜单 F12 绑定及主进程 9229 调试端口。日志：`.test-data/project-redesign-dev.log`。没有模拟物理 F12 按键。
- **原桌面流程回归：20/20 通过。** 基础 smoke 8 项、安全 smoke 10 项、复制调用链 2 项。使用当前开发构建，不属于更新后安装包验收。
- **界面检查：5 个布局场景通过。** 1440 宽屏与 920×620 小窗口、浅色/深色、设置面板均未检测到横向溢出或控件越界；源码及预览正文均为 16px，小窗口编辑区高度 436px。另检查了有上次项目时的启动选择界面。截图目录：`.test-data/ui-t8yZQX/`；复跑脚本：`scripts/ui-smoke.mjs`。

首次保存的完整文件发布依赖目标文件系统支持硬链接；本地 NTFS 已验证。不支持时保留独立草稿并报告失败。原有真实 GitHub 账号、实体输入法及签名边界仍见下文。

## 环境

- Windows x64，系统构建 10.0.26100。
- Node.js 24.15.0；npm 11.12.1。
- Electron 45.0.0；React 19.3.1；Vite 8.3.5；TypeScript 7.0.2。
- 开发机 Git 2.54.0.windows.1；随包 Git 2.56.0.windows.3、GCM 2.9.1、OpenSSH 10.6p1。
- 所有测试文档、账号身份和远端仓库均为隔离测试数据；没有操作用户 GitHub 仓库或凭据。

## 验证范围

| 检查 | 方法与证据 |
| --- | --- |
| 类型与构建 | `npm run typecheck`；`npm run dist`，日志 `.test-data/final-dist.log` |
| 字符计数与解析 | `tests/changes.test.ts`、`tests/render.test.tsx`：字素、净增删替换、撤销、换行、GFM/数学、宏隔离、路径与脚本边界 |
| 文件与恢复 | `tests/files.test.ts`：UTF-8/BOM/换行、并发 revision、外部修改、草稿迁移、目录/大小写改名、重名、回收站失败、设置校验 |
| Git | `tests/git.test.ts`：暂存隔离、精确快照、提交期间继续修改、锁/身份失败、历史、改名、附件、双工作副本同步、文本/二进制/删除冲突、失败重试、Git 配置干扰 |
| Windows 大小写改名 | 文件/目录仅改变大小写，HEAD/index 只保留实际新路径；旧路径已暂存时拒绝记录；其他暂存保留 |
| 桌面正常流程 | `scripts/smoke.mjs`：真实 Electron 窗口、相对图片与公式、源码/预览切换、撤销重做、Ctrl+S、无空提交、阈值、两种目录视图、.tex 错误、创建/改名/真实回收站、外部冲突、崩溃恢复 |
| 桌面状态边界 | `scripts/safety-smoke.mjs`：普通文件、模式切换、继续输入的快照、499/500/1200、模拟输入法、生产 Worker、保存失败停止提交、暂存失败后暂停自动重试、文档库切换的旧 IPC 请求拒绝 |
| 代码复制 | `scripts/clipboard-smoke.mjs`：真实按钮经 preload 到主进程，核对中文及换行文本，验证异步失败反馈；原生写入替换为内存捕获，测试不读写系统剪贴板 |
| 开发调试 | `scripts/dev-smoke.mjs`：真实 `npm run dev`/`npm run debug`、CSP nonce、preload、HMR WebSocket、DevTools 能力和 9229 inspector；未声称模拟了 Windows 物理 F12 按键 |
| 离线 Git 资源 | `scripts/check-git.mjs`：固定官方 ZIP 校验、375 个原始文件、许可证/来源完整、排除系统 Git 后独立运行 |
| 安装后的程序 | `scripts/install-smoke.ps1`：隔离目录中实际 NSIS 安装、app.asar 与最终构建一致、内置 Git 校验、三组 installed-exe smoke、仅卸载测试安装并保留设备数据 |

实际执行结果见本文末尾；上表用于说明覆盖范围。

## 明确未验证 / 未实现

- **真实 GitHub 授权与网络往返**：未使用用户账号，公有/私有仓库尚需人工验收。双副本测试使用本地裸仓库，包含新增、附件、修改、删除、并发更新和冲突。
- **实体中文输入法**：已验证 composition 期间不自动提交；仍需使用微软拼音等真实候选窗确认体验。
- **签名**：安装包为未签名构建，不等于签名验证通过。
- **平台**：没有验收 macOS/Linux 安装包。
- **未实现扩展**：跨文件全文搜索、滚动联动、自动链接修复、PDF/完整 TeX 编译尚未实现；标签与常见 Markdown 富文本编辑已经提前实现，未知结构以受保护节点保留。
- **安全范围**：路径、进程边界、离线资源与已知依赖漏洞检查不构成独立安全审计。

已修复的关键竞态包括：切库前排队请求误写新库、读文件/历史时覆盖后续输入、部分暂存被带入提交、保存完成后重读到外部内容、大小写改名产生重复 Git 路径、草稿随目录改名丢失、外部更新被旧缓冲覆盖。代码复制改用带调用方校验的专用 IPC，解决浏览器权限拒绝导致的复制失败。

## 原始 0.1.0 安装包执行结果（本次界面更新之前）

- **自动化测试：54/54 通过，0 失败、0 跳过。** 日志：`.test-data/final-tests.log`。
- **类型检查、生产构建与 NSIS 打包：通过。** 日志：`.test-data/final-dist.log`。
- **开发调试：通过。** 实际启动 `npm run dev`、`npm run debug`，验证 HMR、preload、DevTools 能力及 9229 主进程调试端口。
- **最终安装包验收：通过。** 2026-10-23 09:41–09:42 CST 实际安装到隔离目录，核对安装内容与最终构建一致；内置 Git、GCM、SSH 及 375 个资源文件完整。
- **安装版桌面检查：20/20 通过。** 基础 smoke 8 项、安全 smoke 10 项、代码复制调用链 2 项；页面错误列表为空。复制检查将原生写入替换为内存捕获，未读写用户剪贴板。随后执行专属卸载器，独立复查安装目录、注册项、快捷方式和进程均已清理。没有删除原有设备数据。日志：`.test-data/install-validation.log`，截图：`.test-data/oopsmd-smoke.png`。
- **依赖检查：** 本次 `npm audit` 未报告已知漏洞；这不代替安全审计。

最终交付：`release/OopsMD-0.1.0-win-x64-setup.exe`，148,758,762 字节，Authenticode 状态 **NotSigned**。

```text
SHA-256 691EB427F1DD168450DB6DACE4FDB9B690E8FCA3CD739B50FDB2D5D4733A5798
```

安装日志保留了首次检查中导航时序失败及修正后的完整重跑记录。最终通过的是上述 SHA-256 对应安装包。
