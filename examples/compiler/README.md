# 编译器离线样例

“青屿记录”是虚构项目。城市数量、检查次数和状态均为测试数据，不代表真实客户、机构或业务成果。

| 文件 | 用途 |
| --- | --- |
| `content.json` | 一份共享内容，显式文档身份、修订和 Mark ID |
| `note.json` | DOCX 两节，第二节 `breakBefore: true`，目标为 2 页报告 |
| `stage.json` | PPTX 四页：cover、body、image、table；`title` 是 Mark ID |
| `assets/test-blocks.png` | 本次程序生成的 640 × 240 RGB PNG 测试色块，无网络素材或第三方图片 |
| `invalid/*.json` | 三个独立错误输入、共用呈现 `note.json` 与预期错误 `expected.json` |

`fact-coverage` 是唯一共享事实 Mark：包含“12 个城市、24 次检查”。Note 第一节和 Stage 封面 / 正文都选择它，没有复制出三份文字。修改时只改该 Mark 并推进 `revision`，再生成两类产物，检查所有选择位置是否更新。

`report-context` 的 168 字中文长段落只由 Note 选择；Stage 选择的正文与图片说明各少于 90 字。表格 `status-table` 为 4 行 × 3 列，含一行表头。图片与说明是分别可定位的对象。显式分页只是目标约束，实际 DOCX 页数还需在声明的 Word/WPS 版本核验，不能仅从 JSON 宣称验收完成。

所有文字默认或显式使用 Microsoft YaHei。编译时由调用者提供本机字体，例如 `C:\Windows\Fonts\msyh.ttc`；仓库不复制该系统字体。`standard-v1` 的 Stage 页面为 960 × 540 pt、正文 21 pt、可读下限 18 pt，不通过自动缩字掩盖溢出。资产授权根应指向此样例目录，使 `assets/test-blocks.png` 在根内解析。

测试图是非艺术资产：浅色背景上三个等大、不同颜色的矩形，用于核对比例、位置与原生图片对象。矩形不代表数值、走势或真实产品效果，不应描述为统计图。生成过程只用本地像素、PNG 分块和 zlib 压缩，没有外部图片来源。

## 最短命令

在仓库根目录、已按锁文件安装依赖后执行。以下 PowerShell 命令先创建输出目录，再生成文件；字体路径示例适用于已安装微软雅黑的 Windows。

```powershell
New-Item -ItemType Directory -Force examples/compiler/generated | Out-Null
npm run compile -- --input examples/compiler/content.json --presentation examples/compiler/note.json --output examples/compiler/generated/report.docx --assets examples/compiler --font "Microsoft YaHei=C:/Windows/Fonts/msyh.ttc"
npm run compile -- --input examples/compiler/content.json --presentation examples/compiler/stage.json --output examples/compiler/generated/deck.pptx --assets examples/compiler --font "Microsoft YaHei=C:/Windows/Fonts/msyh.ttc"
```

成功时 stdout 包含 manifest，产物内部也有 `markflow/manifest.json`。命令行生成成功不等于已通过 Word/WPS 的显示、页数与可编辑验收。换机器需提供同名字体族的实际本地字体文件，不能把其他字体改名映射为 Microsoft YaHei。

## 故意无效的输入

| 输入 | 共用呈现 | 预期 |
| --- | --- | --- |
| `invalid/unknown-version.json` | `invalid/note.json` | `UNSUPPORTED_VERSION`：拒绝 version 99 |
| `invalid/broken-reference.json` | `invalid/note.json` | `INVALID_REFERENCE`：不存在的 Mark 引用 |
| `invalid/missing-resource.json` | `invalid/note.json` | `ASSET_MISSING`：模型合法，但授权根内没有所声明的图片 |

三者都不能产生一个被当作成功的部分产物，也不能覆盖已有的有效输出。缺失资源案例仍以本样例目录为 `assetRoot`，不能通过修改工作目录或下载替代图让其意外通过。

输入字段与支持范围见 [语言规范](../../docs/compiler/LANGUAGE.md)。本样例不是四组成本对照结果；完整实验要求见 [成本协议](../../docs/compiler/COST-PROTOCOL.md)。
