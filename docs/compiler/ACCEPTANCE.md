# 首个离线编译闭环验收

日期：2026-10-30（Asia/Shanghai）。本轮完成 M0、M1、M2-N、M2-S、M3.1–M3.3，共 19 项。M3.4 保留部分完成状态：已做独立安装依赖的 Windows 洁净源码副本，尚未按发布提交做真实 Git 检出；macOS 未执行。M4 / M5 未实现或实测。

## 可复查产物

共享源为 `examples/compiler/content.json`；两份呈现为 `note.json`、`stage.json`；自有测试图为 `assets/test-blocks.png`。城市、次数和项目名称均为虚构样例，不代表真实业务。

| 文件 | WPS 实际结果 |
| --- | --- |
| [report.docx](../../examples/compiler/generated/report.docx) | 2 页，原生文字、1 张图片、1 个 4×3 表格 |
| [deck.pptx](../../examples/compiler/generated/deck.pptx) | 4 页，17 个形状，其中 12 个文本对象、1 个图片、1 个表格 |
| [updated-report.docx](../../examples/compiler/generated/updated-report.docx) | 2 页，共享事实更新为“18 个城市” |
| [updated-deck.pptx](../../examples/compiler/generated/updated-deck.pptx) | 4 页，封面和正文中的共同事实均更新 |

重建命令：

```powershell
npm run compiler:demo -- --font C:/Windows/Fonts/msyh.ttc
```

默认生成上述文件、更新后的结构化源、长表格与修复演示；`demonstration.json` 保存故意溢出的诊断和旧产物保护检查。此命令不调用模型，也不启动 Office。示例 SDK/CLI 及限制见 [SDK](SDK.md)。

## 固定环境与版本

- Windows 10.0.26100 x64，Node 24.15.0，npm 11.12.1。
- WPS 12.1.0.29161；COM 的 Application.Version 返回 `12.0`，使用可执行文件版本识别准确构建。
- Microsoft YaHei：显式读取 `C:/Windows/Fonts/msyh.ttc`，SHA-256 为 `3084f1f88369af6bf9989c909024164d953d1e38d08734f05f28ef24b2f9d577`，不嵌入或再分发系统字体。
- `docx@9.15.0`、`pptxgenjs@4.0.1`、`fontkit@2.0.4`；`image-size@2.0.4` 固定覆盖上游旧版本，安装后的依赖审计为 0 个已知公告项。
- 编译器 manifest 版本 `0.1.0-compiler.1`。基准仓库 HEAD 为 `14a64e37f4980b497015d21d367e5b69ff13743d`；编译器为其上未提交实现，不能说该提交已经包含本轮功能。精确源码清单与哈希保存在洁净副本 `source-inventory.json`，见 [复现记录](REPRODUCIBILITY.md)。

## 实际 Office 检查

验收脚本 `scripts/compiler-office-check.ps1` 只允许读取/写入仓库 `.test-data/compiler-acceptance` 下的测试文件。原件只读，修改另存 edited 副本，不覆盖原文件；只关闭脚本自行打开的对象，不 Quit 共享 WPS。

1. 基础 DOCX / PPTX 均实际打开，修改普通文本、原生表格单元格，调整原生图片宽度，另存、关闭并重开。三项修改保留，页数仍为 2 / 4；原文件 SHA-256 不变。
2. `fact-coverage` 经现有 Mark 命令从 12 改为 18，revision 递增后重新输出；WPS 对完整短语“18 个城市”的检查在两种格式中均通过。修复后的演示再次实际打开为 4 页，原始“12 个城市”恢复。
3. 故意将同一个 Mark 扩大至无法放入 Stage 的容量，得到 `LAYOUT_OVERFLOW` 与 `markId: fact-coverage`。SDK/CLI 自动测试确认失败不覆盖上一次有效文件，修复后可再次输出。
4. 中文长表格：61 行（含表头），WPS 实际 4 页，最后一行“检查行 60”完整。逐页渲染确认 2–4 页重复表头且未裁断表格。
5. 大图片：10000×1000 JPEG，10MP；DOCX / PPTX 均嵌入原生 JPEG（158129 字节）。DOCX 写入尺寸 487.28×48.728 pt；WPS COM 读出 487×48.5 pt，约 0.41% 比例差，记录为应用测量差而非逐像素一致。PPTX 图片为 492.480×49.248 pt，完整在 960×540 pt 页面内。对应报告 / 演示仍为 2 / 4 页。
6. 从 WPS 导出 PDF 供视觉检查：基础报告全部 2 页、演示全部 4 页、长表全部 4 页、修改事实所在页及大图页已渲染检查，中文清楚、图片比例正常、无可见遮挡或截断。PDF 是测试中间件，不是本编译器新增的 PDF 输出功能。

PPTX 的 `ExportAsFixedFormat` 在 WPS COM 调用中失败，脚本记录原因后使用 WPS 原生 `SaveCopyAs(..., PDF)` 成功导出；不将失败接口写成已经支持。Word / PowerPoint 的微软版本没有安装，本轮未声称验证。

证据目录均位于 `.test-data/compiler-acceptance/`：

| 目录 | 内容 |
| --- | --- |
| `final` | 源编译产物、更新与修复产物、长表格、demonstration.json |
| `final-office-3` | 原件和编辑版 PDF、edited Office 文件、编辑重开报告 |
| `updated-office-exact` | 更新后短语和页数报告、PDF |
| `long-table-office` | 61 行表格、末行与页数、表头报告和 PDF |
| `repaired-office` | 修复后的真实打开和原始事实检查 |
| `large-image-office` | 大 JPEG 实际打开、比例/页界、图片字节检查及 PDF |

首次脚本调试中的失败记录保留：WPS Cell.Range 结束符与 PowerShell COM 调用差异在脚本中修复后重跑，只有最后成功轮次计入上表。

## 自动验证与边界

最终编译专项 56/56 通过，无跳过；类型检查通过。覆盖现有 Mark 身份/事务、Markdown 原文与来源、未知版本/字段/类型、失效或循环引用、字体缺字和错族、PNG/JPEG 范围、junction 逃逸、截断 PNG、粗体测量、过密表格、原生 OOXML、UTF-8 错误、CLI 失败保护及共同事实更新。日志 `.test-data/compiler-final-tests.log`、`.test-data/compiler-final-typecheck.log`。

生产构建通过，日志 `.test-data/compiler-build.log`。完整单元回归 285/285 通过、无跳过（含当时 55 项编译测试及既有 230 项），日志 `.test-data/compiler-all-tests.log`；末轮增加来源映射同名 ID 回归并修复后，重新运行上述最终 56 项编译专项。编译模块没有被引入桌面 renderer/main 或按键路径；本轮不把这一隔离事实当作新的实体输入法或长文档帧率测量。

本轮还没有完成：发布提交的真实 Git clone 重建、macOS 编译、微软 Office、完整 Note/Stage 编辑器、Office 导入与保真往返、AI 接入、四组 token/成本测量。写出成功和 ZIP 结构正确均不能替代这些项目。
