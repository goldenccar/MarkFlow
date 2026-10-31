# MarkFlow 编译输入语言 v1

本文件定义当前 Node 编译入口使用的严格子集。内容输入、呈现输入、编译结果分别存储；桌面编辑器的设置和撤销历史不进入编译输入。对应代码为 `src/compiler/types.ts`、`model.ts`、`markdown.ts`、`layout.ts`。示例见 [examples/compiler](../../examples/compiler/README.md)。

## 内容输入

```json
{
  "format": "markflow",
  "version": 1,
  "documentId": "example-document",
  "revision": 1,
  "marks": [
    {
      "id": "fact-coverage",
      "content": {
        "kind": "paragraph",
        "runs": [{ "text": "虚构试点覆盖 12 个城市。" }]
      },
      "style": { "fontFamily": "Microsoft YaHei" }
    }
  ],
  "assets": [],
  "retiredIds": []
}
```

| 字段 | 规则 |
| --- | --- |
| `format` / `version` | 固定为 `markflow` / `1`；未知版本拒绝 |
| `documentId` | 显式文档身份，不能用文档当前顺序代替 |
| `revision` | 非负安全整数，保留到编译结果；命令按预期修订执行 |
| `marks` | 有序的平面语义 Mark 数组；每项有 `id`、`content`，可有 `style`、`source` |
| `assets` | `{id, path}` 数组；图片内容通过资产 ID 引用，不把二进制编码放入文字字段 |
| `retiredIds` | 可省略的已删除身份列表，不能与活跃或已消解身份重复 |
| `consumedSources` | 可省略的 `{id, source}` 数组；记录 Markdown 引用定义消解前的身份及位置，不生成可见段落 |

ID 为 1–128 个字母、数字、下划线或连字符，首字符必须是字母或数字。活跃 Mark、已删除 Mark、已消解定义不能重复占用一个 ID。无效 JSON 数据、未知字段、重复 ID、失效引用及引用循环均拒绝，不悄悄删字段。通用 Mark engine 支持树结构；此编译输入首版刻意限制为平面语义 Mark。

### 内容类型

| `kind` | 必填字段 | 可选字段与限制 |
| --- | --- | --- |
| `heading` | `level`、`runs` | `level` 为 1–6 |
| `paragraph` | `runs` | 可用空数组表示一个空段落 |
| `list-item` | `ordered`、`runs` | 有序列表必须有正整数 `ordinal`；无序列表不能有 `ordinal`；单项不含子列表 |
| `image` | `assetId`、`alt` | 可有文字 `caption`；图片是独立内容对象 |
| `table` | `header`、`rows` | `rows` 是“行 → 单元格 → TextRun”的三层数组；矩形且至少一行一列，无合并单元格 |
| `reference` | `targetId` | 引用另一个可渲染 Mark；不得指向自己形成循环、缺失目标或已消解定义 |

`TextRun` 为 `{text, format?}`。`format` 支持布尔值 `bold`、`italic`、`underline`、`strike`，`script: "superscript" | "subscript"`，`highlight: "#RRGGBB"`，以及安全链接 `link`。JSON 模型支持 HTTP、HTTPS、mailto；Markdown 适配器当前只接收 HTTP、HTTPS。链接不得含凭据或控制字符。换行可在 `text` 中用 `\n` 表达；制表符不在首版排版子集中。

`style.fontFamily` 为一个明确字体族名称，不接受 CSS 回退串或 `system-ui`、`serif` 等设备相关泛型。`style.fontSize` 使用 CSS px；编译时明确换算为 pt：`px × 72 / 96`。省略字段继承编译主题，不读取桌面阅读器字号。调用者必须通过 `fontFiles` 提供实际字体文件；缺字、字体族不匹配或文件缺失均报错，不自动找另一种字体。

### 资产与来源

资产路径相对于调用者明确授权的 `assetRoot`，使用 `/` 分隔。当前只接受实际本地 PNG/JPEG；不下载远程图、不读取 data URL、不允许绝对路径、目录逃逸或指向授权根外的符号链接。单文件上限 20 MiB、总计上限 64 MiB，尺寸不超过 32768 像素且总像素不超过 4000 万。带旋转 EXIF 的 JPEG 需先明确归一化方向。

PNG 额外检查分块边界、CRC、IDAT 压缩流与末尾 IEND，解压上限 160 MiB；JPEG 检查扫描标记与末尾 EOI。这是有界的结构校验，不声称完整像素解码或任意图像格式兼容。CLI 只接受有效 UTF-8，不用替换字符掩盖错误编码。

`source` 可包含 `file`、`pointer`、`from`、`to`、`line`、`column`。`pointer` 是 JSON Pointer。`from/to` 是原始文本中以 UTF-16 代码单元计数的半开区间，必须成对提供；`line/column` 从 1 开始，指向起点。这些字段是定位证据，不授予文件读取权限。内容经命令修改、拆分或合并后，旧精确位置会失效，不能把旧范围包装为新内容的来源。

## Markdown 输入适配

API：

```ts
markdownToDocument(source, sourcePath)
// => { document: MarkDocumentInput, diagnostics: Diagnostic[] }
```

适配器使用项目现有 remark 语法链，不自行解析 Markdown，也不调用编辑器、写回源文件或读取素材文件。`sourcePath` 用于来源定位和普通 Markdown 的临时身份输入。

| Markdown 结构 | 当前处理 |
| --- | --- |
| ATX / Setext 标题、普通段落 | 转为标题 / 段落 Mark |
| 粗体、斜体、删除线 | 转为对应行内格式 |
| `<u>`、`<sup>`、`<sub>`、`<mark>` | 仅接受正确配对、无属性的标签；高亮固定为 `#fff2a8` |
| HTTP/HTTPS 链接、引用式链接 | 消解为行内链接；提示标题暂不支持，会报错 |
| 软换行 / Markdown 硬换行 | 分别转为空格 / `\n` |
| 简单有序、无序列表 | 每个顶层列表项一个 Mark，保留序号；序号从 1 或更大开始 |
| 独立图片、引用式图片 | 转为 image Mark；图片标题转为 `caption`；相对路径解码并归一化，边界由模型及资产解析器检查 |
| 引用定义 | 原 Mark ID 和位置进入 `consumedSources`；不作为正文显示 |
| 无列对齐标记的矩形 GFM 表格 | 保留表头和单元格行内格式 |
| 已登记空段落 | 保留身份并转为空 paragraph |
| 代码块 / 行内代码、数学块 / 行内数学、引用块、分隔线 | 当前报错 |
| 嵌套列表、任务列表、多段列表项、文字中混排图片 | 当前报错 |
| 列对齐、缺列 / 多列、合并单元格、脚注、未知 HTML | 当前报错 |
| 远程图片、非法路径编码、非 HTTP/HTTPS Markdown 链接 | 当前报错 |

已有有效 Mark 尾部登记时，保留 `documentId`、`revision`、全部活跃 Mark ID、已消解定义 ID、已删除 ID 和手动字体字号。登记与正文不能完整对应、元数据损坏或版本不支持时停止编译，不生成替代 UUID。字体 ID 映射为目录中的首个明确字体族，例如 `fangsong` → `FangSong`；`system` 固定映射为 `Microsoft YaHei` 并发出警告。

没有登记的普通 Markdown，以原路径和原内容的 SHA-256 派生临时身份，返回 `MARKDOWN_TEMPORARY_IDENTITIES` 警告。它只保证完全相同输入的可重复性，不保证文本变化后身份稳定，也不表示编辑器保存过该文档。身份解析可使用 LF 副本兼容磁盘 CRLF；输出位置仍映射回原始正文，包括 UTF-16 字符和文件开头 BOM 所占的偏移。

无法表示的结构抛出 `CompilationError`，其中 `diagnostics` 包含错误码、文档 / Mark ID（可确定时）、字段及来源位置。不会拿不完整的结果继续写文件。

## 呈现输入

呈现输入固定 `format: "markflow-presentation"`、`version: 1`、`theme: "standard-v1"`。它选择已有 Mark，不复制事实文本。

- Note / DOCX：`target: "docx"`，`sections: [{marks: [id...], breakBefore?: boolean}]`。`breakBefore: true` 明确在该节前分页；最终自然换行和页数仍由 Word/WPS 决定。
- Stage / PPTX：`target: "pptx"`，`slides: [{layout, title, marks: [id...]}]`。`title` 是标题或段落的 **Mark ID**，不是标题文字。`layout` 限定为 `cover`、`body`、`image`、`table`；图文布局恰有一张独立图片，表格布局恰有一个表格。

同一 ID 可被多页 / 两种呈现重复选择；这不产生第二份内容身份。演示稿不会自动抽取长文摘要；需明确选择适合演示的短 Mark。

`standard-v1` 固定字体为 Microsoft YaHei。Note 使用 A4、54 pt 页边距、11 pt 正文；Stage 使用 960 × 540 pt 页面、48 pt 页边距、30 pt 标题、42 pt 封面标题、21 pt 正文和 18 pt 可读下限。Stage 不自动缩字塞入溢出内容；超量时定位报错。当前模板只有这一版，不能凭输入任意注入样式或执行代码。

## 输出与首版边界

输出为 DOCX / PPTX 字节与编译 manifest。manifest 记录输入、呈现、计划、主题、字体、素材摘要、写出器版本及诊断；它不是源文件、撤销历史或 Office 原文保真证明。字体只用于检查与度量，不默认嵌入、复制或再分发。

manifest 存放在输出 ZIP 的 `markflow/manifest.json`，因此它与文档一起原子替换。CLI 也将它输出到标准输出。SDK 的 `compile()` 不写文件，`writeCompilation()` 在生成完成后使用同目录临时文件替换目标；调用者传入 `protectedInputs`，CLI 自动包含源文件、呈现、字体和素材。输出不能是符号链接、硬链接或目录。源输入、呈现或布局错误不会覆盖已有有效文件；这不承诺多个产物同时提交，也不提供目标文件在 Office 中被修改时的合并。

### 各方向能力矩阵

| 方向 / 内容 | DOCX | PPTX |
| --- | --- | --- |
| 首版语义 → 文件 | 原生可编辑标题、段落、列表、链接、样式、图片对象和简单表格 | 四类版式；原生可编辑文本、列表、形状、图片对象和简单表格 |
| 图片内部像素 → 文字 / 矢量 | 作为原生图片保留；内部像素不可逐字编辑 | 同左；图片对象可移动、缩放或替换 |
| 明确排版转换 | CSS px 转 pt；图片按比例缩放至可用区域；最终分页由 Word/WPS 决定 | 测量后显式换行；长列表续行是独立文本对象；图片按比例缩放 |
| 未支持结构 | 拒绝编译，不忽略或生成不完整产物 | 拒绝编译；超容量报错，不自动缩到下限以下 |
| 文件 → 内容提取 | 未实现，无导入入口 | 未实现，无导入入口 |
| 已有文件 → 重排输出 | 未实现；不能拿生成证明重排保真 | 未实现；不能拿生成证明重排保真 |
| 任意原文件 → 保存往返 | 未实现，未承诺保真 | 未实现，未承诺保真 |
| 未知 Office 对象的 opaque 保留 | 未实现；不声称未知对象能无损保存 | 未实现；不声称动画等对象能无损保存 |

支持“原生可编辑”指对象在受测 Office 应用内可编辑，不表示仓库已具备 Note/Stage 编辑器。输出格式、字体和软件版本共同决定最后显示；ZIP 时间戳不作为语义/布局一致性的判据。

首版不提供 Office 导入、任意模板语言、公式计算、图表、复杂页眉页脚、嵌套表格、完整分页引擎或 PDF 输出。原生结构写出、实际应用显示、人工修改后保存重开是分开的验收项，见 [写出器与验收环境](WRITERS.md)。成本是否更低也必须独立测量，见 [成本实验协议](COST-PROTOCOL.md)。
