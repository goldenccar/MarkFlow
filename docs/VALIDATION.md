# MarkFlow 0.1.0 验证记录

更新：2026-10-31（Asia/Shanghai）。各节按验证日期区分，历史记录不代表当前版本重新验收。

## LaTeX 原生窗口按钮配色（2026-10-31）

- 修复进入 LaTeX 页面时没有同步 Windows 原生关闭/最小化/最大化区域配色的问题：窗口外观 effect 现在同时监听完整文档工作区的激活状态。复现前为 LaTeX 蓝灰顶栏搭配 Markdown 灰绿窗口按钮区域。
- `scripts/window-theme-smoke.mjs` 在隔离 Electron 窗口执行实际 `setTitleBarOverlay`，核对其背景、符号颜色与页面主题变量。浅色、深色及模拟系统深浅变化下，Markdown → LaTeX → Markdown 共 **12/12** 检查通过，渲染异常 **0**；修复前同一脚本在首次进入 LaTeX 时失败。
- 主题单元测试 **4/4**、类型检查及构建通过。日志：`.test-data/window-theme-before.log`、`.test-data/window-theme-after.log`、`.test-data/window-theme-unit.log`、`.test-data/window-theme-build.log`。本轮未重验 macOS 或安装包。

## 单一应用栏与系统项目侧栏（2026-10-31，后续更新）

- Markdown、公式片段和完整 LaTeX 只挂载一个 `ApplicationBar` 与一个 `ProjectSidebar`。首栏固定为打开文件、主题、历史、保存，编译、页面设置、环境、导出和生成放在第二栏；Paper 不再持有第二份项目列表或文件树。
- 全量测试 **409/409** 通过；随后新增 PDF 有效性判断的回归，相关模型 **7/7** 通过。类型检查、构建及差异格式检查通过。全量日志：`.test-data/shared-shell-tests.log`；构建：`.test-data/shared-shell-build.log`。
- Windows Electron 最终 **13/13** 组桌面流程通过，前端异常 **0**：系统项目切换、未保存 TeX 恢复、真实拖动与改名后的撤销/重做、主文件路径同步、归档/删除、实际两页 PDF、干净文件外部刷新、脏文件冲突保护、补全和页面设置、生成稿只读及返回原文 Mark。
- 补充边界：Paper A 激活时拖入 B 的真实 Markdown 文件，正文和项目都切到 B，保存不写入 A；先编译后保存相同正文，文件监听刷新不会让 PDF 误标过期或重建 canvas。修复保存后旧恢复稿残留引起的假冲突。
- 三个编辑模式在 **1440／1100／920** 宽度、深浅主题下的 **18** 个组合均无横向溢出。首栏四项同序且高 **44px**；侧栏沿用相同组件和尺寸，第二栏按功能数量换行。最终桌面证据：`D:/MarkFlow-Projects-20261031/project-workspace-DzDq4A/results.json` 及同目录截图。
- 本地试用窗口已加载最终构建，独立项目 `.test-data/shared-shell-preview-projects/统一项目试用` 同时包含 Markdown 与 LaTeX；实际两页 PDF 状态为最新。截图：`.test-data/shared-shell-final-preview.png`。本轮未重验 macOS、安装包或真实在线 GitHub 凭据；不以组件复用宣称整体代码减半或性能提升 50%。

## 共用工作区与按引擎配置补全（2026-10-31）

- 最终类型检查与生产构建通过，115 项定向自动测试通过，覆盖补全配置与热更新、保存校验、文档识别、页面设置、Mark 历史、富文本及 LaTeX 输出。日志：`.test-data/workspace-build.log`、`.test-data/workspace-tests.log`。
- Windows Electron 12 组真实桌面流程通过，渲染异常为 0：自定义规则实际插入、三引擎隔离、关闭触发后 Tab 缩进、旧撤销记录、重启恢复、完整文档自定义、Esc 后富文本缩进不重弹、真实 3 页 PDF、页面配置开合/快速切换/减少动态效果、未应用表单保留及 Esc 返焦点、通用字号继承、共用侧栏开关。
- Markdown、公式片段、完整 LaTeX 编辑态各在 1440／1100／920 宽度、深浅主题下核验（18 组截图）：路径栏、工具栏和侧栏尺寸一致，无横向溢出。最终矩阵使用已重新编译的完整文档；PDF 节点及滚动稳定性由独立的开合流程验证。
- 桌面脚本：`scripts/workspace-settings-smoke.mjs`；结果与截图：`D:/MarkFlow-Workspace-20261031/workspace-settings-vvUSm7/results.json`。另打开独立的两页中文试用项目，实际编译成功，最终截图：`.test-data/workspace-final-preview.png`。保留已有用户窗口和草稿。
- 本轮为 Windows 开发构建验收，不代表安装包、macOS 或物理输入法验收。

## Fomula 统一交互与页面配置（2026-10-31）

- 最终类型检查、生产构建通过；117 项定向自动测试全部通过，覆盖补全/排序/缩进、文档识别、页面设置、项目会话、Mark 身份/历史与 LaTeX 输出。日志：`.test-data/fomula-build.log`、`.test-data/fomula-tests.log`。
- Windows Electron 的 Fomula 8 组综合流程通过：Markdown 排版与源码补全、公式补全/Tab/撤销、第二份公式独立标签且原文保留、页面配置输入框撤销不修改源码、实际两页 A5 横向 PDF 的页眉页脚与页码、同名创建、连续关闭重开 7 次、完整 `.tex` 与片段分别进入 PDF/KaTeX。证据：`D:/MarkFlow-Fomula-Desktop-20261031/fomula-GnLKQY/results.json`。
- Mark 入口回归 5 组通过：表单、只读源码与来源映射、实际 XeLaTeX PDF/源包、独立副本、未保存 Markdown 快照。证据：`D:/MarkFlow-Fomula-Desktop-20261031/paper-mark-JE0dzU/results.json`。两轮渲染异常均为 0。最终 Fomula 回归另覆盖原生菜单新建、源码/对照切换与设置面板收起；900px 以下源码与文件栏布局在最终预览中另核验。
- 页面配置原生验证生成 3 页中文 A5 横向 PDF，包含长页眉自动换行、PNG、标题/作者/页码占位符、首页隐藏；英文单栏及双栏也成功。独立脚本：`scripts/paper-page-settings-smoke.ts`；证据：`.test-data/paper-page-settings-9PzKVu/`。复杂外来模板冲突会明确拒绝表单覆盖。
- 本轮未重做安装包、macOS 或实体输入法验收；旧交付与待办边界保持原状。

## 保留 Note / PPT 的精简与性能优化（2026-10-31）

- 生产源码统计与同机前后数据见 [本轮审查](PROJECT-AUDIT.md)。基线包含上一轮全部未提交功能，没有通过旧 Git HEAD 或排除新模块放大减少量；源码减半和全软件提速 50% 尚未达成。
- **全量自动化 331/331 通过，无失败、无跳过。** 日志 `.test-data/lean-all-tests.log`。末轮列表编号/CRLF 守卫修改后，**renderer 专项 41/41** 再次通过，日志 `.test-data/lean-renderer-final-tests.log`；不把重叠用例相加。最终类型检查、生产构建、独立 Mark 引擎类型检查及 `git diff --check` 通过，构建日志 `.test-data/lean-build.log`。
- **实际 Windows Electron 42 组通过**：标签/工具栏 9、富文本/Formula 10、DOCX/PPTX 生成 7、论文编译/PDF 8、菜单键盘/焦点 8。所有页面异常为空；富文本控制台异常为空。日志 `.test-data/lean-{tabs-toolbar,rich-final,compiler,paper,menu}.log`。标签检查在末轮列表正则补丁前构建执行，受补丁影响的富文本及后续检查已在最终构建通过。
- **16 个样式对照状态一致**：Markdown/Formula、深浅色、1440/1100/920 宽度，以及设置、生成面板、新建菜单、论文首页；比较计算样式和几何，保留减弱动效及焦点检查。证据 `.test-data/visual-css-equivalence-final-1CWys5/report.json`。菜单补测覆盖方向循环、Home/End、跳过禁用项、Escape 回焦点、外点/窗口变化关闭，且源文件字节不变。
- 原生 DOCX/PPTX 产物的关键 XML、关系、图片及 manifest 与基线一致；37 项输入边界和 6 类特殊 JSON 的快照/历史对照通过。Unicode 计数与旧实现对照 15,000 组通过。具体样本和计时范围见审查报告，不用局部算法计时替代完整生成或桌面响应。
- 全量回归结束后再进行三轮前后桌面对照：1,000 项列表输入响应中位 99 → 49 ms，48 次输入中的大于 50 ms 主线程任务 48 → 7 次；普通段落无同等级提升，部分峰值并未改善。结果 `.test-data/lean-desktop-quiet-comparison.json`，完整口径及波动记录见审查报告。
- 未重新验收新安装包、macOS、实体中文输入法或 Word/WPS 原生视觉排版；完整 TeX 分发、Mark → LaTeX 与 Note 页式编辑器继续保持未完成状态。本轮没有新增依赖或推送 GitHub。

## LaTeX 论文工作区（2026-10-30）

- PRD 与 L0–L4 清单统一记录已接入能力及剩余缺口；Note 模板/分页 NP0–NP7 和原有办公场景继续保留。操作见 [论文工作区说明](LATEX-WORKSPACE.md)。
- **类型检查及生产构建通过；全量测试 327/327 通过，无失败、无跳过。** 日志 `.test-data/paper-build.log`、`.test-data/paper-all-tests.log`。后续论文专项复测 **16/16**，与全量用例重叠，不累加。
- **原生 TeX 验证 7/7 通过。** 中文、英文单栏/双栏真实生成 PDF，三类源包重新导入后编译成功，嵌套主文件与 Biber 文献样例通过。检查了中文文本、未保存章节及文献解析；结果 `.test-data/paper-native-TkdW0X/results.json`。另验证真实 SyncTeX 双向定位。仅代表本机样例，不是任意期刊模板兼容声明。
- **Windows Electron 论文检查 8/8 通过，页面异常为空。** 实际新建中文论文、PDF.js 中文跨页显示、未保存内容编译/导出、失败保留旧 PDF、保存及工作区切换、草稿恢复、外部修改保护、小窗口检查。结果 `.test-data/paper-desktop-LDLEeS/results.json`，截图同目录 `paper-two-pages.png`、`paper-narrow.png`。原生文件选择器仅在隔离测试里替换为固定路径。
- **既有桌面回归通过：标签/工具栏 9/9，Formula 3/3。** Formula 验证渲染、首次保存、撤销重做、源码/对照及 Markdown 标签往返。日志 `.test-data/latex-module-tabs-toolbar-retry.log`、`.test-data/latex-module-formula-regression.log`；页面异常为空。标签测试修正了布局切换后的等待时序，未改生产行为。
- 修复中文 PDF 的本地 CMap 资源加载、Windows 长路径下 Biber 缓存启动，以及旧 PDF 在新编译被丢弃后的资源保留问题。编译用全部未保存缓冲的快照，不自动写回原工程；导出源包对应所显示产物的快照。
- 当前以本机源码构建试用，未生成新安装包。应用内环境安装、完整离线宏包冻结、macOS 验收、Overleaf 性能对照、Mark → LaTeX 尚未完成。外来项目需明确信任；禁用 shell escape、固定命令及快照目录不等于操作系统隔离，不宣称可安全编译不可信 TeX。

## 桌面生成入口与全项目代码审查（2026-10-30）

- 文件路径栏“生成”、标签栏加号、原生文件菜单接入 Word/PPT 生成：当前未保存 Markdown、内置样例、本地资料、呈现/素材/字体授权、后台 Worker、诊断定位与打开输出。
- **全量回归 306/306，通过，无跳过。** 日志 `.test-data/audit-unit-tests.log`。全量运行后修改的编译布局和撤销历史分别复测：编译 **71/71**，引擎/历史 **25/25**，日志 `.test-data/audit-compiler-tests.log`、`.test-data/engine-history-unit.log`；这些与全量用例重叠，不累加总数。类型、生产构建、独立引擎构建通过；`git diff --check` 通过。
- **实际 Windows Electron 26 组通过**：新增生成 7、标签/目录导航 9、最终富文本/源码/跨视图撤销 10。页面/控制台错误均为空。日志 `.test-data/compiler-desktop-final.log`、`.test-data/compiler-navigation-ui.log`、`.test-data/compiler-final-rich.log`。使用独立测试配置；打开结果调用以 shell spy 检查，没有打开用户 Office 文档。
- **性能同机前后对比**：1,000 Mark 打开 1,490→1,351 ms，输入到两帧中位 30→31 ms、最大 71→59 ms；输入期间大于 50 ms 的主线程长任务 2→0。100 Mark 中位 14→9 ms、最大 19→16 ms，打开 395→399 ms。各 16 次输入；普通大文档中位基本持平，不宣称全面提速。日志 `.test-data/audit-editor-before.log`、`.test-data/audit-editor-after.log`。
- 未变长列表重复解析、Git 同请求重复读取、引用链重复展开、通用历史大小扫描已优化；恢复副本改为原子写入，隐藏元数据定位边界已修。局部基准、代码精简及剩余长列表内部编辑热点见 [审查报告](PROJECT-AUDIT.md)。
- npm 在线安全数据库报告 **0 个已知漏洞**，证据 `.test-data/audit-dependencies.json`。没有新增第三方依赖。
- 新版 `npm run dev` 预览已实际启动并通过原生窗口检查，现有配置恢复，“生成 Word / PPT”面板及内置示例可见。日志 `.test-data/preview-2026-10-30-dev.log`。不代表新安装包、其他系统、实体输入法或真实在线 GitHub 验收。

## 首个离线文档编译闭环（2026-10-30）

- 复用 Mark 身份、修订与事务，新增严格 JSON / Markdown 子集、独立内容与呈现、资源/字体校验、DOCX/PPTX 原生输出和薄 SDK/CLI。未接入现有桌面按键路径，也未开放未实现的 Office 编辑器入口。
- 同一资料生成 **2 页 DOCX / 4 页 PPTX**；Windows WPS 12.1.0.29161 实际打开，文字/表格/图片编辑后另存、关闭、重开通过；修改一个共享事实，两类输出均由 12 更新为 18 城市。
- 实际检查了 61 行中文表格的 4 页分页及重复表头、10000×1000 JPEG 的原生嵌入和页内比例；渲染基础全部页面、长表全部页面及更新/大图相关页面，无可见裁断或遮挡。Stage 超量报出 Mark，编译失败保留旧产物。
- **完整单元回归 285/285 通过，无跳过**，日志 `.test-data/compiler-all-tests.log`；末轮修复非法 UTF-8 与原型同名 ID 来源问题后，**编译专项 56/56 通过**，日志 `.test-data/compiler-final-tests.log`。最终类型检查及生产构建通过，差异格式检查通过。未重复本轮范围外的实体输入法、长文档帧率或安装包验收。
- 独立 Windows 洁净源码副本重新安装依赖后，两类 CLI 无密钥运行；无 Electron 二进制，manifest 的输入/呈现/计划/字体/资源一致。该验证不是已发布 commit 的 Git clone，也不是 macOS 验证，因此 TODO M3.4 保留部分完成。
- 新样例见 [实际产物](../examples/compiler/generated/README.md)，详细证据、限制和命令见 [编译器验收](compiler/ACCEPTANCE.md)。AI 接入及 token 成本实验未完成；未测试的微软 Office、macOS 不能由 WPS Windows 结果推定。

## 项目生命周期与独立同步操作（2026-10-30）

- 项目入口统一为新建、打开本地、从 GitHub 链接获取。新建不初始化 Git，已有同源副本核对实际 origin 后可复用；另建副本要求不存在的目标目录。移除只取消登记；重新定位复制设备草稿/归档并保留旧恢复数据，目标冲突拒绝覆盖。原目录已丢失时仍能继续保护最新草稿。
- Git 检查、更新、上传和显式发布分支分开。绑定不切换本地分支；更新前后检查工作区，检查所有未保存标签；更新冻结编辑并刷新缓存。上传验证快进关系和远端版本条件，缺失分支不会自动重建。检查按来源/分支记录，五分钟过期；后台网络等待不阻塞本地提交。
- **类型检查与生产构建通过。230 项测试分批通过：35 项 Git 用例，以及最终全量非 Git 文件中的 195 项用例（包含 3 项 GitHub 地址规范化用例），无失败、无跳过。** 覆盖目录独占创建、元数据迁移及回滚边界、失联目录草稿、别名与路径保护、暂存区隔离、克隆、异名跟踪分支、不同历史、删除分支竞态、缓存过期和后台检查期间提交。
- **实际 Windows Electron 项目生命周期检查 6 组通过**，使用独立测试配置和本地裸仓库：三入口、GitHub 地址身份匹配与复用、云盘链接提示、移动后草稿和归档恢复、移除后的独立草稿、全部标签保护、等待更新期间只读、合并不上传，以及单独上传。渲染器错误为 0。脚本 `scripts/project-lifecycle-smoke.mjs`，日志 `.test-data/project-lifecycle-smoke.log`，成功目录 `.test-data/project-lifecycle-4CbWa8`。
- **原项目回归 14 组通过**：首次保存与取消、拒绝覆盖、强退恢复、保存期间继续输入、版本失败后重试、切项目草稿隔离、目录改名后恢复关闭标签、同名重建的独立撤销、启动选择及多份 Markdown/Formula 草稿恢复。日志 `.test-data/project-regression-smoke.log`，成功目录 `.test-data/projects-gWnAAS`。
- 独立窗口复查 1440×940、920×620 的浅色/深色添加项目对话框，未发现横向溢出，Esc 关闭正常。截图目录 `.test-data/project-visual-opkIHi`；截取时结束入场动画以检查稳定布局。22 个桌面脚本通过语法检查，差异格式检查通过。
- 本轮没有操作真实 GitHub 账号、公网仓库或用户文档，也未重新验收安装包、物理中文输入法、macOS/Linux。GitHub 身份匹配使用真实本地仓库配置，远端授权失败提示在该界面用例中模拟；克隆、拉取、合并和上传测试使用本机裸仓库。坚果云仅接入客户端已同步的本地目录，WebDAV 和分享链接导入未实现。

## 浅色一致性与提交前复查（2026-10-28）

- 浅色标签与布局按钮共用选中底色和边框，设置字段使用同一控件底色；统一文档栏图标按钮尺寸、主题浮层底色及目录搜索框边界。正文块操作入口固定在页边留白内，避开列表序号与引用边线；富文本编辑区最少保留 36 px 横向操作空间。
- 真实 macOS Electron 检查 1440×940 下 Markdown / Formula 浅深主题、首项与中间标签、目录选中态和列表操作入口；通过 DevTools 复查 1101×760 的停靠设置、1100×760 的设置浮层、920×620 的紧凑工具栏、原生下拉选项及面板滚动。920 下可滚动至阈值输入和保存按钮，已有值保持不变。
- 920×620 下末尾活动标签完整显示：标签条可见范围 x=220–848，活动标签 x=668–848；根节点与标题栏横向滚动为 0，内容宽度均为 920。固定标签数量过多时整条可滚动，容量判断新增混合标签、全部固定、小数边界及非法测量值回归，标签测试共 7 项通过。
- **最终类型检查与生产构建通过。完整单元测试 201 项：198 通过、0 失败、3 项 Windows 专用跳过。** 日志 `.test-data/pre-push-final-build-20261028.log`、`.test-data/pre-push-final-unit-tests-20261028.log`。差异格式检查通过。
- 全量回归发现并修复既有 macOS 大小写改名问题：按实际解析路径识别大小写别名，保留目标占用保护与失败回滚；同时修正临时目录 `/var` 与 `/private/var` 别名导致的测试故障注入遗漏，增加草稿/归档/临时文件回滚检查。
- 桌面 smoke 脚本更新为独立文档、新建菜单、主题菜单与右侧内容块入口，21 个 `.mjs` 语法检查通过；本轮没有运行这些自动化桌面脚本。界面验证来自上述真实窗口操作，没有重新验收 Windows 安装包或重复长文档帧率采样。最终保留本地预览及跟随本机主题。

## 标签栏与侧栏边界（2026-10-28）

- 统一 40 px 标题栏内居中的 30 px 完整圆角标签；标签条两侧各留 8 px，移除标签间竖线，侧栏开关与新建按钮共用中心线。保留贯通顶部的侧栏边界。
- 真实 macOS Electron 检查 1440×940 下首个选中、中间选中、Markdown / Formula 深色主题、固定与取消固定标签；通过 DevTools 检查 920×620 CSS 内容视口的标签溢出及侧栏开合。
- 复现并修复侧栏展开后当前标签被裁切：920 宽时修复前标签右边界 932、可见区右边界 848；修复后均为 848。最终版本在 DevTools 停靠形成的 885×940 内容视口复验，标签与可见区右边界均为 813。滚动在侧栏动画结束后执行，右侧目录布局事件不会无条件重置标签滚动。
- 标签定位只更新标签条自身的横向滚动，避免牵动隐藏溢出的祖先；固定、取消固定和重排也会重新定位，标题文字与编辑状态更新不会触发多余滚动。最终 885 宽复验中外层滚动偏移为 0。
- 标签单元测试 3 项通过；最终类型检查与生产构建通过，日志 `.test-data/tab-layout-build.log`。本轮未重新验证 Windows 或浅色主题。文档内容与用户设置未修改。

## MarkFlow 与 Formula 名称统一（2026-10-28）

- **类型检查与生产构建通过。** 日志 `.test-data/markflow-brand-build.log`。
- **相关测试 52 项通过、0 失败、3 项跳过。** 覆盖文档模块、会话、渲染、标签、主题与 Git；跳过项为 Windows 专用文件名大小写测试。日志 `.test-data/markflow-brand-tests.log`。
- **真实 macOS Electron 运行检查通过。** 在独立测试目录完成 5 次启动，应用名称、原生窗口标题和 HTML 标题均为 MarkFlow；新建菜单显示 Formula，没有 Geek；渲染器错误为 0。
- **旧数据兼容检查通过。** 默认 `appData/oopsmd` 恢复旧设置及 `latex-math` 草稿；旧标签存储键、固定标签及目录固定偏好在重启后保留。恢复的公式可继续编辑、渲染、保存为 `.tex`，并在重启后重新打开。
- **环境变量检查通过。** `OOPSMD_USER_DATA` 继续有效；两者同时设置时，优先使用 `MARKFLOW_USER_DATA`，旧测试目录的设置未被修改。隔离脚本 `.test-data/branding-recovery.mjs`，成功资料目录 `.test-data/branding-recovery-uDC1BO`；真实用户资料与已有应用实例未参与测试。
- **安装名称配置检查通过。** 使用本地 electron-builder 的名称与宏解析逻辑，确认程序为 `MarkFlow.exe`、安装包为 `MarkFlow-0.1.0-win-x64-setup.exe`、卸载列表名称为 `MarkFlow 0.1.0`。结果 `.test-data/markflow-packaging-names.json`。保留原 `appId` 维持 Windows 升级身份；此次没有生成或实机验收 Windows 安装包。
- PRD、使用说明及开发文档同步当前名称；历史验证记录保留当时名称。完整中英文界面切换及 Note、Array、Stage、PDF 编辑器不属于本次实现。


## 阈值显式保存（2026-10-28）

- 改为输入框与保存按钮同排，失焦不提交；按钮和 Enter 共用校验与提交入口，保存期间禁止重复提交。
- 真实 macOS Electron 验证：500 改为 700 后按 Tab，仍显示当前生效500；点击保存后为700并出现勾选反馈；输入0按Enter保持700并就地报错；Esc恢复700；输入500按Enter保存成功。最终阈值恢复500，原有文档未修改。
- 检查未修改、未保存、保存成功和错误状态的实际深色外观。类型检查与生产构建通过，日志 `.test-data/threshold-save-build.log`。本节不重复宣称上轮尺寸与主题检查。

## 控件细节与尺寸复查（2026-10-28，后续修订）

- **97 项相关测试通过，0 失败、0 跳过。** 增补导航窄宽度和对照布局规则，回归主题、模块、渲染、块转换、身份、历史与标签。日志 `.test-data/ui-detail-validation.log`。最终类型检查和生产构建通过，日志 `.test-data/ui-detail-build.log`。
- **分隔线与选择控件：** 侧栏边界延伸至窗口顶端，收起后无残留线；Markdown 深色与 Geek 浅/深色实际检查通过。设置和工具栏统一箭头尺寸、内边距与文字避让；920×620 下直接点击主题下拉箭头可打开原生选项。
- **尺寸检查：** macOS Electron 原生窗口 1440×940；通过同一窗口的 DevTools 检查 920×620、1100×760、1440×940 CSS 内容视口。目视复查工具收纳、查找行、设置滚动、目录浮层和对照布局；920 与1440 的根节点宽度检查未发现横向溢出。模拟内容视口不等于调整系统分辨率或验证其他操作系统。
- **窄窗口交互：** 查找“章节”得到2个匹配，Enter定位到下一项；设置在620高视口可滚动到最后说明。对照模式不足宽度时目录转浮层，放宽至1440后恢复固定。发现并修复排版菜单Esc连带关闭目录，重启后复验通过。
- **键盘与数值：** 标签菜单Shift+F10、End/方向键和Esc返回入口；排版菜单初始聚焦、End及Esc恢复焦点通过。阈值1.5、0、空值均显示就地错误并保留500；Esc恢复，700正常保存后恢复为500。关闭草稿确认框的Shift+Tab/Tab循环、背景Cmd+T/Cmd+S受阻及取消返回原标签通过。
- **独立复查发现并修复搜索状态残留：** 切到Geek或切换实时/源码/对照布局时，关闭查找行并清空旧匹配计数；实际从Markdown查到2项后切Geek、以及对照切实时均复验通过。
- **运行与边界：** 组件热更新期间出现过依赖数组变更提示，正常保留草稿并完整重启后未再出现；随后尺寸和交互检查未出现新的运行错误。本轮未重复长文档帧率采样，没有打包安装程序或重新验收Windows。原始用户草稿保留，最终主题恢复为跟随本机，本地预览保持打开。

## 跟随本机主题与界面细节（2026-10-28）

- **93 项相关测试通过，无跳过。** 新增覆盖系统主题解析、原生配色、默认值/旧设置持久化及目录键盘导航；并回归文档模块、渲染、块转换、身份、历史、标签和阅读定位。日志 `.test-data/theme-ui-validation.log`。
- **类型检查与生产构建通过。** 日志 `.test-data/theme-ui-build.log`。本次没有打包安装程序。
- **三轮审查与修正：** 第一轮检查静态布局/对比度/交互，修复工具栏与标签焦点、目录层级和面板拥挤；第二轮真实 Electron 窗口发现并修复主题菜单行对齐和原生滑杆风格；第三轮独立代码审查发现并修复 Shift+Tab 菜单退出与面板焦点恢复问题，随后真实键盘复验。
- **实际视觉范围：** macOS Electron、1440×940 CSS px，Markdown 和 Geek 各自的浅/深配色；固定目录、菜单和设置。另在 DevTools 停靠后的 885×940 内容视口检查紧凑工具栏、目录及设置浮层；未见控件重叠、菜单裁切或横向页面溢出。885 px 为内容视口，不是改变系统分辨率或原生窗口的最小宽度。
- **主题行为：** 顶部菜单与设置入口同步；菜单方向键/Enter、Tab、Shift+Tab 均实测。系统实际为深色时，明确选择浅色仍显示浅色；切到跟随本机立即变深。通过 DevTools 模拟浅色媒体查询，renderer 自动变浅；移除模拟后自动恢复真实深色。持久化值仍为 `system`。原生窗口响应实际 OS 切换的逻辑有单元测试，本次未修改系统外观来触发原生事件。
- **目录与焦点：** 无结果搜索及清除恢复、固定状态恢复、设置 Esc 返回入口通过；设置打开时切换 Geek 后焦点保留在目标编辑器。最后确认目录层级、菜单对齐和新滑杆显示正常。
- **性能边界：** 本轮未增加逐帧宽度动画或 JS 滑杆更新；沿用下节已经测量的 FLIP 布局过渡。本轮未重复整套长文档帧率采样。浅色代码注释配对从 3.78:1 提升至 4.64:1，这是颜色值检查，不是完整无障碍认证。
- 原始用户草稿未修改；预览以跟随本机保留。Windows 实机外观不在本轮验收范围。

## 独立文档模块、右侧导航与动画（2026-10-28）

- **87 项相关测试全部通过，无跳过。** 覆盖模块注册/布局、Geek 源码隔离及历史、文档会话、Markdown/数学渲染、标题层级与搜索、短文档固定策略、阅读位置二分查找、块转换、Mark 身份/原文往返和标签。日志：`.test-data/document-modules-validation.log`。
- **类型检查与生产构建通过。** 日志：`.test-data/document-modules-build.log`。没有重打安装包。
- **真实 macOS Electron 预览检查通过：** 加号分别新建 Markdown/Geek；Geek 公式输入、撤销/重做及跨模块标签切换；右侧目录固定/取消固定、折叠、搜索折叠分支中的标题、定位正文；空草稿不继承空白固定面板；拆分后块格式菜单仍可打开。Geek 顶栏、侧栏及正文配色一致。原始用户草稿未改动。
- **阅读定位：** 使用含 60 节的独立测试文档，共 61 个标题。滚动后目录高亮第 4 节；现场几何检查下一节标题在视口 y=207px、尚未越过阅读锚点，与高亮一致。源码仍由光标定位，不实现双栏同步滚动。
- **动画采样：** 本机 1440×940 CSS 像素、开发模式、DevTools 关闭时操作，短文档与 60 节长文档各进行 4 次左侧栏切换和 4 次目录固定切换。短文档 88 个帧间隔：中位 16.7ms、P95 16.8ms、最大 17.6ms；长文档 88 个帧间隔：中位 16.7ms、P95 16.8ms、最大 16.8ms；两组均无超过 25ms 的间隔。单次状态提交最大 5.5/7.5ms，总准备最大 8.3/12.9ms。16 次动画均正常结束，未残留动画状态。数值来自开发态 `__workspaceMotionDebug`，是本次 rAF 采样，不是浏览器 Layout 事件计数或任意设备的性能保证。
- **扩展边界：** Word、Excel、PDF 仅提供 codec/runtime/render/layout 类型契约，未注册为可用文档模块。Geek 仍只处理 LaTeX 数学片段。

## macOS 导航、窗口配色与块转换（2026-10-28）

- 类型检查与生产构建通过。
- 49 项相关测试全部通过：内容块转换、嵌套标题定位、Mark 身份与样式、富文本往返、共享撤销。新增测试覆盖 9 种转换格式、复杂嵌套保护、无关原文/CRLF 保留，以及引用和列表内部标题选择。
- macOS Electron 本地预览实际验证：正文转 H2 后进入目录，单步撤销/重做；嵌套无序列表转有序列表保留子项；源码右键转代码块并撤销；目录准确定位并高亮引用中的第二个标题；Geek 浅/深主题顶栏同步；侧栏收起后原生红黄绿按钮与侧栏入口不重叠。
- 在独立验收草稿中操作，原有用户草稿保留。Windows 原生窗口配色已实现，但本轮未在 Windows 实机验证。减少动态效果规则经过代码检查，本轮未切换系统偏好做实机验收。
- 此前本机全量测试有 5 项失败、3 项跳过；5 项文件系统/归档相关失败也在原始 `3895c23` 代码复现，记录于 `.test-data/local-preview-unit-tests.log` 与 `.test-data/original-mac-tests.log`。本轮执行上述相关测试，未重复全量文件/Git 测试。
- Word、Excel、PDF 仍为入口规划，未接入编辑器。

## 柔和浅色与 Mark 复用基础（2026-10-26 后续开发版）

日间正文改为灰白 / 淡蓝灰，同步导航、浮层、代码底色和原生 caption。Mark 核心补可选本地引用协议、复制引用重映射、版本化快照编解码 / 恢复，并在编辑批次中复用位置索引；校验器与引用适配回调不能保留可修改已提交状态的对象。README 改为产品首页，操作与开发细节拆入 USAGE、DEVELOPMENT。没有新增运行依赖，也没有实现 Excel 公式、图表、Page 或其他办公格式适配。

- **最终类型检查 / 生产构建及独立引擎构建：通过。** 日志 `.test-data/mark-extensions-build.log`、`mark-extensions-package.log`；标准 Node ESM 导入验证复制引用、JSON 往返、加载后退役 ID 防复用及撤销重做，见 `mark-extensions-esm.log`。
- **引擎与身份专项：33/33 通过。** 覆盖复制子树内部 / 外部 / 前向引用、普通字符串与素材 ID 不误替换、漏映射拒绝、错误回滚、快照版本及字段验证、重载后的 ID / revision / undo、回调别名隔离与混合结构命令索引。日志 `mark-extensions-unit.log`。独立代码复审未发现剩余阻断项。
- **现有 Markdown 针对性回归：64/64 通过。** 覆盖身份、共享历史、rich/source 对应、文档 clean baseline 与渲染，日志 `mark-extensions-md-regression.log`。与上述专项存在重叠，不相加统计；此次未重复执行不受改动影响的完整 Git / 文件系统测试集。
- **真实 Electron Mark 身份检查：7/7 通过。** 编辑、移动、复制、拆分合并、撤销重做、源码 / 对照、保存后重开身份与样式保持，日志 `mark-extensions-identity.log`。
- **配色与界面检查：15/15 通过，12 张实际截图。** 覆盖 1440×1000、1100×760、920×620 × MD / Geek × 浅 / 深；大纲、边界、控件命中、减少动态效果与键盘焦点无异常，原始文件没有被修改。日志 `soft-light-visual.log`，画廊 `.test-data/visual-soft-light-62XiRq/index.html`。已目视复核两种日间宽屏，README 三张图来自这次真实窗口；页面截图不含系统 caption 按钮。
- **主要文字 token 对比度：24/24 不低于 4.5:1，最低 4.59:1。** 见 `.test-data/soft-light-contrast.json`；这是配色配对检查，不是完整 WCAG 审计。
- **README 及新指南：56 个相对文件 / 图片链接和锚点通过检查。** 启动命令对照实际 scripts、Electron bin 与 `.nvmrc`，未添加未经验证的下载入口或跨平台发布声明。

生产 Electron、隔离 profile、无 Git 的本机输入测量；每个场景最后一个 Mark 设为 24px，输入 16 字符，测量含两帧并复核完整 ID 列表与样式。首轮出现一次 55ms 长任务，因此再执行两次相同检查，保留全部结果：

| 场景 | 首轮中位 / 最大 | 复测 1 中位 / 最大 | 复测 2 中位 / 最大 | 50ms 以上长任务 |
| --- | --- | --- | --- | --- |
| 100 个 Mark | 11 / 18ms | 10 / 15ms | 14 / 18ms | 三轮均 0 |
| 1,000 个 Mark | 18 / 31ms | 17 / 30ms | 17 / 29ms | 首轮 1 次 55ms，复测均 0 |

日志 `.test-data/mark-extensions-performance.log`、`mark-extensions-performance-repeat1.log`、`mark-extensions-performance-repeat2.log`。未观察到持续输入回退，偶发长任务的根因未作归因，不能承诺任意文档或设备没有卡顿。

核心批量探针另以 10,000 个平面节点执行 1 / 100 / 1,000 条 edit，9 个有效样本的中位数为 20.15 / 19.94 / 18.59ms。见 `.test-data/mark-extensions-batch.json`；它测量纯事务，不含引用协议、UI 或完整工作簿，不能当成 Excel 性能指标。

本轮没有重打安装包；实体输入法与真实 GitHub 账号往返仍沿用原有人工验收边界。

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
