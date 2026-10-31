# Office 写出器选择与验收环境

核查日期：2026-10-30。范围对应 PRD / TODO 的 M0.5、M2-N、M2-S：先生成原生可编辑 DOCX/PPTX，不代表 Office 导入、完整编辑器或保真往返已经实现。

## 依赖选择

建议固定三个生产依赖：`docx@9.15.0`、`pptxgenjs@4.0.1`、`fontkit@2.0.4`。前两者写出文件，fontkit 读取调用者显式提供的字体并度量文字；不增加 Office 自动化、服务端转换或云端生成作为产品运行依赖。`@types/fontkit@2.0.9` 可作为开发依赖，其余两套写出器已带 TypeScript 类型。

| 包 | 官方稳定发布 | 许可与维护证据 | 首版用途 |
| --- | --- | --- | --- |
| docx 9.15.0 | npm 2026-10-27；GitHub 同日发布，非预发布 | MIT；2026-10-29 默认分支仍有修复提交 | 标题、段落、行内样式、链接、列表、图片、简单表格 → DOCX 原生结构 |
| PptxGenJS 4.0.1 | npm / GitHub 2025-06-26；当前仍是 latest | MIT；未归档，但默认分支最近提交为 2025-06-26，发布节奏明显较慢 | 文本框、图片、基础形状与表格 → PPTX 原生对象 |
| fontkit 2.0.4 | npm 2024-08-09；当前仍是 latest | MIT；默认分支 2026-10-28 仍有字形布局修复，但不等于这些修复已进入 2.0.4 | TTC/TTF 字体族、字形覆盖、度量与字符串整形 |

官方依据：

- docx：[发布记录](https://github.com/dolanmiu/docx/releases/tag/9.15.0)、[版本 package.json](https://github.com/dolanmiu/docx/blob/9.15.0/package.json)、[MIT 许可](https://github.com/dolanmiu/docx/blob/9.15.0/LICENSE)、[维护提交](https://github.com/dolanmiu/docx/commit/b3c1eedfd1ec5327dde6cc3bc6128e9089cc32cb)。
- PptxGenJS：[发布记录](https://github.com/gitbrent/PptxGenJS/releases/tag/v4.0.1)、[版本 package.json](https://github.com/gitbrent/PptxGenJS/blob/v4.0.1/package.json)、[MIT 许可](https://github.com/gitbrent/PptxGenJS/blob/v4.0.1/LICENSE)、[最近默认分支提交](https://github.com/gitbrent/PptxGenJS/commit/3c9ec1b687c174952166f6a34b5e87ebf69fa469)。
- fontkit：[官方 npm 元数据](https://registry.npmjs.org/fontkit/2.0.4)、[已发布版本对应 README](https://github.com/foliojs/fontkit/blob/fbf3b9ef21eebd219eb73e666faed573af0fba09/README.md)、[MIT 许可](https://github.com/foliojs/fontkit/blob/fbf3b9ef21eebd219eb73e666faed573af0fba09/LICENSE)、[维护提交](https://github.com/foliojs/fontkit/commit/f4c2243e1ba0f873b956d0784a443780cfcd8dcd)。

核查时项目 package.json、package-lock.json 与 node_modules 均未包含这三个包。本机 Node 为 24.15.0；docx 声明 Node >=16，另两包支持 Node 且提供 ESM/CJS 入口。安装与运行结果需另记，元数据核查不能代替实际执行。

依赖数量以各版本 package.json 为准。docx 9.15.0 声明 fflate、nanoid、@types/node；PptxGenJS 4.0.1 声明 jszip、image-size、https、@types/node，不能照抄其 README 中“zero runtime dependencies”的描述。fontkit 2.0.4 有自身解析、解压和 Unicode 依赖，尚无内置类型声明。保留许可文本与锁文件，不因均为 MIT 就省略分发时的第三方许可处理。

实现阶段补充：PptxGenJS 上游声明的 image-size 1.2.1 在依赖审计中存在高危项，项目将该依赖覆盖并固定为 `image-size@2.0.4`，同时直接用于受限的本地 PNG/JPEG 尺寸解析。主任务记录安装后的 `npm audit` 为 0；该数字只是当次已知依赖公告检查结果，不替代图片输入边界测试。跨主版本覆盖须由实际 PNG/JPEG 的 DOCX/PPTX 输出测试复核兼容性，升级写出器时重新检查。

## 官方样例与实现入口

已阅读的候选：

- [docx basic-document.ts](https://github.com/dolanmiu/docx/blob/9.15.0/demo/getting-started/basic-document.ts)：`Document` → `Paragraph` / `TextRun` → `Packer.toBuffer`，可作为纯 Node TypeScript 写出入口。
- [docx basic-table.ts](https://github.com/dolanmiu/docx/blob/9.15.0/demo/tables/basic-table.ts)：原生 `Table` / `TableRow` / `TableCell`，明确列宽与单元格段落。首版采用无合并单元格子集。
- [PptxGenJS Quick Start](https://gitbrent.github.io/PptxGenJS/docs/quick-start/)：`new pptxgen()` → `addSlide()` → `addText()`；产品适配返回 Buffer，由调用层负责安全写盘。
- [PptxGenJS Node demo](https://github.com/gitbrent/PptxGenJS/blob/v4.0.1/demos/node/demo.js)：包含文字、形状、图片；原例包含远程图片 URL，不能直接作为离线验收样例。替换为已验证的本地图片字节，不引入流式 demo 使用的 Express。
- fontkit 2.0.4 使用 `create(buffer, postscriptName)`、字体集合 `fonts` / `getFont`、`familyName`、`hasGlyphForCodePoint` 与 `layout` / `xAdvance`。不要使用当前主分支 README 新增、但 2.0.4 未导出的 `fontkit/core` 等入口。

默认主题固定为 Microsoft YaHei，调用者通过 `fontFiles` 指定本机字体。字体仅用于检查与度量，manifest 记录字体文件摘要与字体名称；不将系统字体复制进仓库或默认嵌入产物。fontkit 的字形度量不是 Word/WPS 段落分页或 PowerPoint 排版引擎，最终可读性与分页仍须在指定应用核对。

## 本机验收环境

已只读核实安装信息、可执行文件和版本，未因此打开或修改任何用户文档：

| 应用 | 本机结果 | 后续用途 |
| --- | --- | --- |
| WPS Writer | `E:\Ins_add\WPS Office\12.1.0.29161\office6\wps.exe`，12.1.0.29161；`kwps.Application` 已注册 | DOCX 打开、修改文字/表格、调整图片、保存后重开 |
| WPS Presentation | `E:\Ins_add\WPS Office\12.1.0.29161\office6\wpp.exe`，12.1.0.29161；`kwpp.Application` 已注册 | PPTX 文本、表格、图片/形状对象编辑与重开 |
| Microsoft Word / PowerPoint | 未找到已注册的可执行程序或对应 COM 类；旧 Office 辅助目录不算完整安装 | 不声称已完成 Microsoft Office 兼容验收 |
| LibreOffice | 标准安装位置与应用登记未找到 | 本轮不能承诺可用的无界面渲染验收 |

WPS 的系统 `wpp.exe` App Paths 登记指向统一 `wps.exe`；实际独立 `wpp.exe` 文件也存在。注册与文件存在仅证明验收入口可用，不证明 COM 调用或生成文件兼容已经成功。

已确认 `C:\Windows\Fonts\msyh.ttc`、`msyhbd.ttc` 存在。固定应用版本与字体文件摘要后再记录 2 页报告 / 4 页演示的实际页数；其他平台结果单列，不能外推。

## 本轮 WPS 自动验收记录

2026-10-30 已在上述 WPS 12.1.0.29161 执行 [验收脚本](../../scripts/compiler-office-check.ps1)。脚本仅接受仓库 `.test-data/compiler-acceptance` 下的调用者指定文件，原件只读打开，编辑另存副本；逐个关闭自己打开的对象，不退出共享 WPS，不覆盖既有输出。

- 最终报告：原版和编辑后重开均为 2 页，1 个原生表格、1 张行内图片；文字、表格单元格及图片宽度修改均保存成功。
- 最终演示：原版和编辑后重开均为 4 页、17 个对象，其中 12 个文字对象、1 个表格、1 张图片；三类对象修改均保存成功。
- 共享事实从 `12 个城市` 改为 `18 个城市` 后，两个更新产物在 WPS 中均读到完整新事实，仍为 2 页 / 4 页。
- 中文长表格：60 行数据加 1 行表头，在 WPS 中实际为 4 页；末行 `检查行 60` 完整，原生表格首行的重复表头标志有效。逐页是否实际显示表头仍须结合导出的 PDF 视觉检查。
- 上述原件的 SHA-256 在验收前后相同，既有文档数量在脚本结束后不变。原版与编辑版 PDF 分开保存。

记录在本机 `.test-data/compiler-acceptance/final-office-3/office-check.json`、`updated-office-exact/office-check.json`、`long-table-office/office-check.json`。这些生成文件不作为源码提交。DOCX 使用 `ExportAsFixedFormat` 导出；WPS Presentation 在 PowerShell 7 下该接口存在 COM 参数兼容错误，脚本记录错误并使用 WPS 原生 `SaveCopyAs` 的 PDF 格式导出，确认演示的源文件绑定不变。自动编辑与重开通过不代替逐页视觉检查，也不代表 Microsoft Office 或非 Windows 验收。

例如，在仓库根目录运行（输出目录必须尚无同名结果）：

```powershell
./scripts/compiler-office-check.ps1 `
  -InputDirectory "$PWD/.test-data/compiler-acceptance/final" `
  -OutputDirectory "$PWD/.test-data/compiler-acceptance/office-check-new"
```

`-ReadOnlyCheck` 只检查并导出原版 PDF；`-DocxName ''` 或 `-PptxName ''` 可跳过一种格式。长表格可指定 `-ExpectedPages 0 -ExpectedLastTableText '检查行 60' -RequireRepeatedTableHeader`，其中页数 0 表示记录实际值而不预设页数。

## M0.5 对照与合格条件

四种输入路线使用相同事实、图片、模板能力、字体和最终写出器：Mark、Markdown＋模板、简洁 JSON＋布局规则、高层 DOCX/PPTX API。原始 OOXML 可作为附加对照，不作为刻意低效的唯一基线。

1. 同一资料生成 2 页 DOCX 报告与封面/正文/图文/表格四页 PPTX，覆盖中文长文本、行内强调、列表、链接、本地图片与简单表格。
2. 修改一个共享事实后重新生成，两类输出正确更新；文件内容检查与目标应用显示均通过。
3. 原生文字、表格可编辑；图片可替换或移动；保存关闭后重开，编辑结果仍在，不以整页截图充当可编辑产物。
4. 故意输入失效引用、未知结构、缺失图片与超量文本，获得定位到 Mark/字段的诊断；不静默丢失内容、截断、覆盖旧有效输出或缩小到可读下限以下。
5. 对照统计完整提示/输入/输出/工具往返/重试、首次通过率、合格产物耗时与人工修正量。此轮选择写出器，不提前宣称 token 节省比例。

PptxGenJS 暴露 `fit`/`autoFit` 等文字选项，但它们不能代替编译器的容量检查和真实应用验收。[官方文字 API](https://gitbrent.github.io/PptxGenJS/docs/api-text/)

当前选择是有限范围生成的实现基础。PptxGenJS 发布较旧、fontkit 主分支与已发布版本存在差异，均需锁定版本并通过固定样例决定是否可用；安装成功或 ZIP 包结构正确不等于分页、中文排版与原生编辑验收通过。
