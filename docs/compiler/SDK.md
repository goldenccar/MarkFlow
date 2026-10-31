# 编译器 SDK 与 CLI

要求 Node.js >=22.12，依赖见仓库锁文件。开发使用 `npm ci --ignore-scripts` 即可运行编译器；此方式跳过 Electron 下载，不适用于直接启动桌面应用。安装依赖需要网络或已有 npm 缓存，编译本身不访问网络或模型服务。

## 最短体验

在仓库根目录运行：

```powershell
npm ci --ignore-scripts
npm run compiler:demo -- --font C:/Windows/Fonts/msyh.ttc
```

默认输出在 `examples/compiler/generated`：基础报告/演示、将同一个事实从 12 改为 18 城市后的两个产物、修复后的演示，以及长表格检查件。`demonstration.json` 记录溢出诊断和旧文件保护结果。字体文件需由调用者合法取得；其他系统须提供覆盖中文且族名为 Microsoft YaHei 的字体，或使用 SDK 显式修改主题/字体实现后单独验证，不能自动拿本机默认字体替代。当前固定模板不支持 CLI 切换字体族默认值。

单个产物：

```powershell
New-Item -ItemType Directory -Force .test-data/my-output | Out-Null
npm run compile -- --input examples/compiler/content.json --presentation examples/compiler/stage.json --output .test-data/my-output/deck.pptx --assets examples/compiler --font "Microsoft YaHei=C:/Windows/Fonts/msyh.ttc"
```

命令成功返回 0 并输出 manifest JSON；错误返回 1 并在标准错误输出诊断 JSON。直接用 `node --import tsx src/compiler/cli.ts ...` 可避免 npm 自身的启动提示混入标准输出。源 JSON、呈现均最多 8 MiB，输出目录须已存在；源文件不会被改写。`--input` 也支持受限 `.md`，对应呈现仍按返回的 Mark ID 选择内容。

## SDK

```ts
import { compile, writeCompilation, applySemanticCommands } from './src/compiler/index.js'

const next = applySemanticCommands(document, [
  { type: 'edit', id: 'fact-coverage', content: {
    kind: 'paragraph', runs: [{ text: '本次虚构试点覆盖 18 个城市。' }],
  } },
], document.revision)

const result = await compile(next, presentation, {
  assetRoot: '/absolute/project/resources',
  fontFiles: { 'Microsoft YaHei': '/absolute/fonts/msyh.ttc' },
})
await writeCompilation(result, '/absolute/output/report.docx', [sourcePath, presentationPath])
```

`compile()` 返回字节和 manifest；`prepareCompilation()` 返回规范化、资源及度量后的计划，可单独验证。输入不含 Electron 状态或 API 凭据。库调用者负责声明输入读取范围及 `writeCompilation` 的受保护文件，包括源、呈现、字体、素材。CLI 已完整传入这些路径。

`markdownToDocument(source, sourcePath)` 返回 `document` 与 `diagnostics`。调用编译器时传入第四个参数 `diagnostics`，让临时身份等警告进入 manifest；任何 error 都阻断编译。JSON 文档通过已有 Mark 引擎执行事务和版本检查，没有第二套撤销实现。需要交互式撤销的调用者可使用 `MarkEngine` / `semanticEngineOptions` 的既有历史能力；本 SDK 的批次操作是纯数据变换。

这仍是单仓库源模块和 CLI，不是已经发布到 npm 的独立包。没有新增服务端、插件系统或桌面创建入口。完整字段及导入/往返边界见 [语言规范](LANGUAGE.md)，验证平台见 [复现记录](REPRODUCIBILITY.md)。
