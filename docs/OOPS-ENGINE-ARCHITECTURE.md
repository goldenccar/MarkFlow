# Oops Mark 引擎与适配边界

更新：2026-10-26。Mark 已有独立、可构建的 TypeScript 运行时，OopsMD 是当前实际接入的格式适配器。Excel、Word、PPT、PDF 尚未接入；Page 仅保留草案类型。本轮完善引用协议、版本化快照恢复和批次索引复用，不实现公式计算、图表、筛选器、切片器、页面渲染或 AI。

## 1. 实际代码与职责

| 层 | 已有职责 | 边界 |
| --- | --- | --- |
| src/engine | Mark 树、身份、原子命令、本地引用、版本检查、样式继承、快照历史与快照编解码 | 零运行依赖，不导入 Markdown、React、DOM 或 Node 模块 |
| src/shared/marks.ts | Markdown 原文范围、全量身份 registry、局部字体、源码对应与序列化 | 当前是顶层语义范围的平面适配，不是 Markdown 全 AST 的嵌套数据库 |
| rich/source 适配器 | 编辑器节点到 Mark ID 的映射、复制/拆合、输入和选区 | 复用同一文档历史与保存链路，不自行写磁盘 |
| 文件/Git 服务 | 路径授权、草稿、原子保存、磁盘冲突和版本 | 内容引擎不取得文件或项目权限 |
| src/engine/page.ts | 页面、放置与片段的未来类型 | 不在引擎公共入口及独立构建中，无页面运行时 |

产品内容单元叫 **Mark**；ProseMirror marks 表示加粗、链接等内联格式，两者不同。代码块、CSS block 等技术名称仍按其原义使用。

## 2. 独立包与唯一运行模型

公共入口是 src/engine/index.ts，导出 runtime、history 和 mark。包名 @oops/mark-engine，当前 private，未发布 npm。入口和类型指向 dist，构建只使用 ES2022 标准库类型，不加载应用、DOM 或 Node 类型：

    npm run build --prefix src/engine

使用仓库已有 TypeScript 7.0.2；包内声明该构建依赖，没有运行依赖。编译后的 ESM 可由标准 Node 直接加载，也可被前端打包器使用。默认 ID 工厂要求宿主提供 globalThis.crypto.randomUUID，通用历史默认使用 globalThis.structuredClone；测试或其他宿主可注入 ID 工厂、历史 clone 函数。

    import { MarkEngine } from './src/engine/dist/index.js'

    const engine = new MarkEngine([
      { content: { kind: 'text', text: '第一段' } },
      { content: { kind: 'shape', x: 20, y: 40 } },
    ])
    const first = engine.snapshot.roots[0].id
    engine.transact([{ type: 'copy', id: first, parentId: null, index: 1 }])
    engine.undo()
    engine.redo()

此例证明引擎接受格式自定义内容，不代表已有图形编辑器。唯一运行结构是：

    interface MarkNode<C> {
      id: string
      content: C
      style: { fontFamily?: string; fontSize?: number }
      children: MarkNode<C>[]
    }
    interface MarkSnapshot<C> {
      revision: number
      roots: MarkNode<C>[]
      retiredIds: string[]
    }

children 表达有序所有权树；ID 全树唯一、不能成环。内容必须是有限数字、字符串、布尔、null、数组和普通对象组成的 JSON 数据，不接受函数、类实例或循环引用。格式适配器可提供 validateContent 加上自身语义约束。

mark.ts 的 MarkContent、InlineFormat、MarkSource、Asset 是可选的未来 payload 词汇，不构成第二套文档容器。来源范围约定 UTF-16；字节、码点、字形编号不能混用。素材引用和来源信息不能扩大文件权限。

## 3. 身份、命令与撤销

所有进入运行时的 Mark 都有 ID，包括没有手动样式的节点。ID 不编码文件路径、位置或序号；默认 UUID，测试可注入确定性工厂。

| 操作 | 身份 | 样式与范围 |
| --- | --- | --- |
| edit | 保留 ID | 替换指定节点 payload，保留样式/子节点 |
| move | 保留整个子树 ID | 保留手动覆盖，新位置重新继承父级默认；index 按移除后的目标数组计算 |
| copy | 整个复制子树新 ID | 保留手动覆盖，通过适配器协议重映射内部引用，不共享可变对象 |
| split | 首片保留 ID，其余新 ID | 当前限叶节点；首片保留样式，新片默认空覆盖，可逐片显式指定 |
| merge | 第一片保留 ID，其余退役 | 当前限文档顺序中的相邻兄弟叶节点；保留第一片样式，合并正文由适配器提供 |
| insert / remove | 新插入分配/接受未使用 ID；删除退役整个子树 | 重复、未知、已退役 ID 或非法结构拒绝提交 |
| style | 保留 ID | 只修改白名单覆盖；null 清除覆盖，undefined 不修改 |

applyMarkCommands(before, commands, options) 在独立工作副本上执行整批命令，任一失败不修改输入快照。expectedRevision 不符时拒绝，适配器还需检查自己的来源/磁盘版本。

reconcileSnapshot(before, inputs, options) 接收编辑器的权威节点映射：已有 ID 保留、缺 ID 分配、未知但未使用 ID 接受、消失的 ID 退役。拒绝重复/已退役 ID。复杂度为节点、内容及 tombstone 总量的线性遍历；同 ID 输入编辑不增加 retiredIds，只有身份消失才增加。持久化不能任意截断 tombstone，否则会失去已删除身份的防复用约束。

MarkEngine 提供上述纯函数的有状态封装、snapshot 防御性副本与 undo/redo；撤销恢复原 ID，版本仍递增，废弃 redo 分支的 ID 继续保留为已使用。SnapshotHistory<T> 是通用历史，默认 600 ms 分组、最多 100 个过去检查点、约 32 MiB 过去快照预算；超大文档仍至少保留一次撤销，因此这不是进程总内存硬上限。EditHistory 保留原来的正文/光标 API，renderer 旧入口只是重导出，rich/source 共享它。

OopsMD 目前通过纯函数和已有文本快照历史接入，不要求界面改用第二份 MarkEngine 状态。Markdown payload 是 type/raw，roots 是平面语义 Mark，children 暂为空。字体作用于整个选中 Mark：顶层表格一个范围、顶层列表按列表项，未实现嵌套单元格或文字选区字体。

### 本地引用与复制

children 只表示内容的有序所有权；引用不取得目标的所有权，也不把目标挂到第二个父节点。适配器可在 EngineOptions<C>.references 中提供 get(content): readonly string[] 与 remap(content, idMap: ReadonlyMap<string, string>): C。get 只声明当前文档内的强 Mark 引用；普通 Markdown 不配置此协议，不增加引用 payload 扫描。

copy 先给整棵子树分配新 ID，形成完整旧 ID → 新 ID 映射，再调用 remap 处理各节点的 payload。因此兄弟之间的前向引用也能正确复制。适配器只替换映射中出现的 ID；同文档内指向复制范围之外的引用仍指向原目标。引擎校验复制前后声明引用的对应及出现次数，漏映射或误改外部引用会拒绝提交。引擎不会猜测任意字符串是不是 ID，也不会把公式中的 A1 地址当成 Mark ID 替换。

例如一个父 Mark 拥有 cell-a、cell-b，payload 为 `{"rows":[["cell-a","cell-b"]]}`。复制父 Mark 后，两个新子 Mark 的 ID 与复制后的 rows 必须一起变化；修改复制后的单元格不能回写原单元格。这只是 JSON 引用机制的例子，当前没有单元格编辑器。

强引用在整批事务完成后检查：目标必须仍是 live Mark。单独删除一个仍被其他 Mark 引用的目标会拒绝整批事务；同批删除引用者、清除引用或改指向其他存活目标后，可以删除原目标。引用允许回指或形成环，不能形成环的约束只适用于 children 所有权树；公式循环如何报错属于未来计算层。引擎不自动级联删除，不偷偷改成空值。事务失败不能留下半次复制、已删节点或撤销记录。

跨文档引用和 Asset ID 不放进这一文档本地协议。跨文档复制由调用方核验目标文档权限、来源版本及素材策略：复制素材文件、复用获授权资源，还是保留显式外部链接，需要适配器作决定。子树 ID 映射不授予文件访问权限，不自动搬运二进制资源，也不替页面放置或其他外部索引决定新的引用关系。

### 版本化快照与加载

encodeMarkSnapshot(snapshot, options?) 与 decodeMarkSnapshot<C>(json, options?) 使用一个窄封装：

    { "format": "oops-mark", "schemaVersion": 1, "snapshot": { "revision": 7, "roots": [], "retiredIds": [] } }

编解码验证节点、身份、JSON payload、样式与已配置的引用约束；未知封装版本拒绝加载。MarkEngine.fromSnapshot(snapshot, options?) 恢复活跃身份、退役身份及 revision，后续事务与撤销继续递增版本。不能通过 new MarkEngine(snapshot.roots) 代替恢复，否则会遗失退役身份与版本。

    const json = encodeMarkSnapshot(engine.snapshot, options)
    const saved = decodeMarkSnapshot(json, options)
    const reopened = MarkEngine.fromSnapshot(saved, options)

这里的 options 由宿主代码重新提供，不序列化函数。保存只含当前快照，不含 undo/redo 栈、编辑器光标、计算依赖图或素材文件。加载后 undo 没有历史；执行新事务后可以撤销回加载时的快照。磁盘原子写入、文件大小限制和冲突处理仍由文件服务负责，编解码函数不访问文件系统。

schemaVersion 表示通用快照封装结构；snapshot.revision 表示这份文档的编辑版本。payload 自身的格式版本和迁移由适配器定义并通过 validateContent 验证，不能把二者混为一谈。Markdown 尾注的 registry v:1 也是另一种适配器存储格式，当前 OopsMD 不改用上述通用封装替代 .md 文件或新增 sidecar。

### 批量操作与规模

同一批命令复用位置索引；edit/style 只修改内容或样式，不应逐命令重建全树索引，结构变化时再更新或重建。整个批次仍保持一次原子提交与撤销边界。完整快照仍需要复制、校验和历史存储；此优化不代表已经支持百万单元格，也不要求本轮引入持久化树、计算引擎或新的依赖包。

## 4. 样式与 Markdown 持久化

运行时 resolveTypography 按调用方默认 → 祖先覆盖 → 当前 Mark 覆盖计算，不把最终值写回每个节点。OopsMD **默认字体/字号仍来自设备 Settings**，只有局部覆盖随文件携带；文档默认、命名样式和模板级联尚未实现。

引擎只验证字体标识和正数字号，Markdown 适配器进一步限制为现有字体枚举及 10–96 CSS px。字体缺失时保留请求、显示 fallback，不永久改成替代字体。字体名不代表实际字形覆盖或嵌入许可。

Markdown 不含标准逐段字体语法。当前采用单文件尾注 oops:marks HTML 注释，正文仍是内容依据；尾注携带身份、定位与样式，进入同一次草稿、撤销、保存及 Git 快照。其他阅读器通常不解释 Oops 样式；外部工具剥离尾注会丢失身份与局部覆盖。

registry v:1 保存 documentId、revision、complete、bodyHash、活跃 marks 与 retiredIds。每条活跃记录含 ID、类型、UTF-16 范围、原文/前后文、style、occurrences。当前 occurrences 是相同 raw 的活跃语义范围数量；不同类型同文也计入，因此它仍是“同类型同文唯一性”的保守判据，不是正文中任意子串出现次数。

**删除正文后，新尾注只保存退役 ID，不继续隐藏保存被删正文。** 删除内容由可撤销快照保留；旧版 orphan 记录在下一次正常重写时迁移为退役 ID。外部对应不确定时不把旧样式猜给另一个节点。

完整 registry 在文档进入编辑会话时创建；App 将这一步纳入 clean baseline，不只因补 ID 就改写磁盘。已有 registry 的身份跨重开保留；首次打开纯 Markdown 时的新身份先存在于会话，随后续实际草稿/保存持久化。**纯文件只打开后直接关闭、从未保存或产生草稿时，下次可以重新分配 ID。** 引擎不为此偷偷写原文件。

当前 JSON 长度保护为 32 × 1024 × 1024 个 JavaScript 字符，不是精确 UTF-8 字节或内存上限；原文定位片段会增大文件。超限拒绝本次序列化。尾注转义注释特殊字符；有效注册区独立于正文解析，未闭合代码围栏不会吞掉它。短 schema 代码示例和普通注释仍按正文处理。未知版本/损坏数据保留原文并阻止相关格式修改，不直接丢弃。

### 源码对应

优先使用当前事务的 ID/范围映射；无权威映射时才校验原快照、原文、结构和上下文。唯一文字不自动等于同一身份：两段相同文字删掉一段后，剩余段不能因为变得唯一就继承被删段的 ID/样式。范围排序以正文位置为准，不信任 JSON 数组顺序。

应用内源码和对照视图只编辑正文，已识别的 registry 不放入 CodeMirror 编辑区；源码与 rich 适配器都提交正文及身份映射，由 Markdown 适配器维护完整 registry。外部工具仍可能修改或移除尾注；对应不确定时按上述保守规则处理，不猜身份或样式。Markdown AST 省略中间空段落，已登记的空 Mark 由适配器验证并保留。调整一个 Mark 不重排无关原文、代码、公式和空白；移动/复制后的 Markdown 结构若会改变语义，操作拒绝。

完整文件 revision 用于磁盘冲突，bodyHash 仅用于快照判别、不是安全摘要。metadata 不计入用户新增正文字符阈值，样式与结构修改仍进入脏状态/草稿/手动保存。保存保持已有 BOM/EOL 与冲突保护，磁盘正文写好后的附加失败不能被报告成正文未保存。

## 5. 表格、计算与图表：未来适配边界

Mark 树保存内容归属、稳定身份与可撤销修改。未来表格适配器可让表格或单元格成为 Mark，并负责行列结构、值类型及公式原文；具体粒度由实际适配器决定，本轮不新增空表格 schema 或通用单元格模型。

行列地址和身份分开：A1 是某一工作表当前行列位置上的地址，Mark ID 是内容对象的身份。插入行、移动区域和复制公式时如何改变相对/绝对地址，属于表格适配和计算语义。Mark 的通用 move/copy 只处理所有权与声明的 ID 引用，不能被称为 Excel 公式复制或重算支持。

公式依赖通常形成图，适合由独立计算层维护解析、引用关系、增量重算、循环与错误值；该图是派生运行状态，不能用 children 所有权树兼任。HyperFormula 使用单元格和范围依赖图决定求值次序，并专门优化大范围依赖，可作为以后计算层的参考；当前没有接入或选定该依赖。[HyperFormula 依赖图](https://handsontable.com/docs/hyperformula/guide/dependency-graph.html)

图表应保存数据绑定与声明式规格，渲染层消费已解析的数据及配置，生成屏幕或导出结果。相同绑定与规格未来可由 Word、PPT、PDF 适配器放置或渲染，无需为每一种输出格式复制一套业务数据。ECharts 的 dataset 将数据与展示配置分开，并允许多系列复用数据，这支持上述职责划分；不表示当前已支持图表或保存任意 ECharts 可执行回调。[ECharts Dataset](https://echarts.apache.org/handbook/en/concepts/dataset/)

文件格式适配仍需单独实现。SpreadsheetML 将工作表、图表工作表、表格、计算链和公式定义为不同部分；通用 Mark 树不能直接替代这些格式语义，也不保证导入后无损写回。[Microsoft SpreadsheetML 结构](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document)

当前只把这些职责边界写清，不创建一组尚无消费者的计算、图表、Excel 或导出 engine 包。当前规划不含筛选器和切片器；页面布局继续独立。

## 6. Page 与二进制格式：保留边界，不实现

page.ts 的草案让 Placement 引用 Mark ID，保存盒、仿射矩阵、zIndex 与裁切；内容不因多处放置而复制。PageSource 区分 flow、fixed、imported-pdf：流式分页由有序内容生成片段，固定页面保存用户放置，导入 PDF 保留原文件与实际可编辑范围。一段跨页仍是一个 Mark，Fragment 是派生结果。

Mark 保存页码/总页数字段的语义，未来 Page 计算显示值与分页结果。页眉、页脚和模板引用普通 Mark，不将动态页码写死成正文。页面规格、边距和计数器可参考 [W3C CSS Paged Media](https://www.w3.org/TR/css-page-3/)；不可分内容、孤行与强制分页边界参考 [CSS Fragmentation](https://www.w3.org/TR/css-break-3/)。这些标准不是已有浏览器或应用功能的证明。

页面坐标草案为 pt、左上原点、x 向右、y 向下；[a,b,c,d,e,f] 表示 x'=a*x+c*y+e、y'=b*x+d*y+f。盒位置不应和矩阵平移重复计算。SVG 的坐标与变换可作参照，原 SVG 脚本/外链仍需独立安全处理。[W3C SVG 2](https://www.w3.org/TR/SVG2/coords.html)

字号保留 CSS px，Page 显式换算 pt = px × 72 / 96，窗口缩放和物理屏幕像素另算；不能静默把 16 px 当 16 pt。[W3C CSS Units](https://www.w3.org/TR/css-values-4/#absolute-lengths)

文字 shaping、断行、分页与 PDF 写入分别负责字形、可断位置、页面约束和文件输出。字符数乘字号不能得到可靠宽度，也不能假定一字符一字形。[HarfBuzz Manual](https://harfbuzz.github.io/shaping-concepts.html) [Unicode UAX #14](https://www.unicode.org/reports/tr14/) 后续应使用成熟排版器，不在 Mark 核心自写 Unicode 排版。

PDF 提取文字不等于恢复可靠段落或原编辑结构；内容流顺序不保证阅读顺序。[PDFBox FAQ](https://pdfbox.apache.org/3.0/faq.html#text-extraction) 添加覆盖文字、重排页面也不等于能编辑任意原正文，例如 pdf-lib 不提供表单以外原页面文字的编辑/删除 API。[pdf-lib 限制](https://github.com/Hopding/pdf-lib#limitations) 白色矩形遮盖不是内容删除或脱敏。

Word/PPT/PDF 可消费同一 Mark 运行时，但各自必须实现内容映射、字体/素材、导入保真、真实编辑能力和安全写回；目前均未完成。二进制内容与正文资产不直接塞进 JSON，资源 ID 由适配器解析，跨文档复制遵守上述素材与权限边界。

## 7. 未来自动操作与验证边界

当前没有 AI 执行。将来命令需绑定目标文档/项目授权、缓冲及磁盘版本、Mark ID；区间修改还需编码、范围和预期原文。通过校验后作为一次可撤销事务，再经过现有草稿/保存。换 tab 不改变命令目标，文档内的指令不构成程序授权。

本轮 33 项针对性测试通过，覆盖核心事务、引用复制与删除、快照恢复、原编辑历史及 Markdown 身份适配。独立包构建、标准 Node ESM 中复制引用、JSON 编解码与恢复通过。独立审查另验证回调不能保留可变快照引用、只读 ID 映射不能泄漏底层 Map、错误引用映射原子拒绝，以及加载后的撤销版本递增。生产构建、Markdown 回归、实机身份操作及输入性能的结果见 [验证记录](VALIDATION.md)。这些结果不表示已实现 Excel 或其他 Office 格式。独立包不需要 Electron、Markdown 或 Page 依赖，未发布或额外安装软件包。
