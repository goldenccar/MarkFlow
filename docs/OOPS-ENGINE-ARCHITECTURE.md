# Oops Mark 引擎与适配边界

更新：2026-10-24。Mark 已有独立、可构建的 TypeScript 运行时，OopsMD 是当前实际接入的格式适配器。Word、PPT、PDF 尚未接入；Page 仅保留草案类型，本轮不实现页面渲染、分页或 AI。

## 1. 实际代码与职责

| 层 | 已有职责 | 边界 |
| --- | --- | --- |
| src/engine | Mark 树、身份、原子命令、版本检查、样式继承、快照历史 | 零运行依赖，不导入 Markdown、React、DOM 或 Node 模块 |
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
| copy | 整个复制子树新 ID | 保留 payload 与手动覆盖，不共享可变对象 |
| split | 首片保留 ID，其余新 ID | 当前限叶节点；首片保留样式，新片默认空覆盖，可逐片显式指定 |
| merge | 第一片保留 ID，其余退役 | 当前限文档顺序中的相邻兄弟叶节点；保留第一片样式，合并正文由适配器提供 |
| insert / remove | 新插入分配/接受未使用 ID；删除退役整个子树 | 重复、未知、已退役 ID 或非法结构拒绝提交 |
| style | 保留 ID | 只修改白名单覆盖；null 清除覆盖，undefined 不修改 |

applyMarkCommands(before, commands, options) 在独立工作副本上执行整批命令，任一失败不修改输入快照。expectedRevision 不符时拒绝，适配器还需检查自己的来源/磁盘版本。

reconcileSnapshot(before, inputs, options) 接收编辑器的权威节点映射：已有 ID 保留、缺 ID 分配、未知但未使用 ID 接受、消失的 ID 退役。拒绝重复/已退役 ID。复杂度为节点、内容及 tombstone 总量的线性遍历；同 ID 输入编辑不增加 retiredIds，只有身份消失才增加。持久化不能任意截断 tombstone，否则会失去已删除身份的防复用约束。

MarkEngine 提供上述纯函数的有状态封装、snapshot 防御性副本与 undo/redo；撤销恢复原 ID，版本仍递增，废弃 redo 分支的 ID 继续保留为已使用。SnapshotHistory<T> 是通用历史，默认 600 ms 分组、最多 100 个过去检查点、约 32 MiB 过去快照预算；超大文档仍至少保留一次撤销，因此这不是进程总内存硬上限。EditHistory 保留原来的正文/光标 API，renderer 旧入口只是重导出，rich/source 共享它。

OopsMD 目前通过纯函数和已有文本快照历史接入，不要求界面改用第二份 MarkEngine 状态。Markdown payload 是 type/raw，roots 是平面语义 Mark，children 暂为空。字体作用于整个选中 Mark：顶层表格一个范围、顶层列表按列表项，未实现嵌套单元格或文字选区字体。

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

## 5. Page 与二进制格式：保留边界，不实现

page.ts 的草案让 Placement 引用 Mark ID，保存盒、仿射矩阵、zIndex 与裁切；内容不因多处放置而复制。PageSource 区分 flow、fixed、imported-pdf：流式分页由有序内容生成片段，固定页面保存用户放置，导入 PDF 保留原文件与实际可编辑范围。一段跨页仍是一个 Mark，Fragment 是派生结果。

Mark 保存页码/总页数字段的语义，未来 Page 计算显示值与分页结果。页眉、页脚和模板引用普通 Mark，不将动态页码写死成正文。页面规格、边距和计数器可参考 [W3C CSS Paged Media](https://www.w3.org/TR/css-page-3/)；不可分内容、孤行与强制分页边界参考 [CSS Fragmentation](https://www.w3.org/TR/css-break-3/)。这些标准不是已有浏览器或应用功能的证明。

页面坐标草案为 pt、左上原点、x 向右、y 向下；[a,b,c,d,e,f] 表示 x'=a*x+c*y+e、y'=b*x+d*y+f。盒位置不应和矩阵平移重复计算。SVG 的坐标与变换可作参照，原 SVG 脚本/外链仍需独立安全处理。[W3C SVG 2](https://www.w3.org/TR/SVG2/coords.html)

字号保留 CSS px，Page 显式换算 pt = px × 72 / 96，窗口缩放和物理屏幕像素另算；不能静默把 16 px 当 16 pt。[W3C CSS Units](https://www.w3.org/TR/css-values-4/#absolute-lengths)

文字 shaping、断行、分页与 PDF 写入分别负责字形、可断位置、页面约束和文件输出。字符数乘字号不能得到可靠宽度，也不能假定一字符一字形。[HarfBuzz Manual](https://harfbuzz.github.io/shaping-concepts.html) [Unicode UAX #14](https://www.unicode.org/reports/tr14/) 后续应使用成熟排版器，不在 Mark 核心自写 Unicode 排版。

PDF 提取文字不等于恢复可靠段落或原编辑结构；内容流顺序不保证阅读顺序。[PDFBox FAQ](https://pdfbox.apache.org/3.0/faq.html#text-extraction) 添加覆盖文字、重排页面也不等于能编辑任意原正文，例如 pdf-lib 不提供表单以外原页面文字的编辑/删除 API。[pdf-lib 限制](https://github.com/Hopding/pdf-lib#limitations) 白色矩形遮盖不是内容删除或脱敏。

Word/PPT/PDF 可消费同一 Mark 运行时，但各自必须实现内容映射、字体/素材、导入保真、真实编辑能力和安全写回；目前均未完成。二进制内容与正文资产不直接塞进 JSON，资源 ID 由适配器解析，跨文档复制须明确素材复制或引用策略。

## 6. 未来自动操作与验证边界

当前没有 AI 执行。将来命令需绑定目标文档/项目授权、缓冲及磁盘版本、Mark ID；区间修改还需编码、范围和预期原文。通过校验后作为一次可撤销事务，再经过现有草稿/保存。换 tab 不改变命令目标，文档内的指令不构成程序授权。

本轮独立包构建、标准 Node ESM 导入及通用 shape payload/copy/undo/redo 已验证；引擎与原编辑历史共 12 项单元测试覆盖身份、非法整批拒绝、子树复制、拆合、继承和撤销。UI 与 Markdown 集成验收另见项目验证记录。独立包不需要 Electron、Markdown 或 Page 依赖，未发布或额外安装软件包。
