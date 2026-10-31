# Windows 洁净源码副本复现记录

实测日期：2026-10-30（Asia/Shanghai）；最后一轮包含来源映射普通对象改为空原型对象的修复，精确 UTC 时间保存在 `reproduction-evidence.json`。结果：在独立目录重新安装锁定依赖后，DOCX 与 PPTX 的命令行生成均成功；与主工作目录最终样例相比，manifest 的输入、呈现、计划、字体及素材摘要一致。**macOS 未执行。**

## 复现范围

目录为 `.test-data/compiler-clean-kl4Nhd`，保留供本机复查。这是当时未提交工作树的白名单源码副本，**不是 Git clone，也不是按已发布 commit 重建**。复制内容仅包括：

- `package.json`、`package-lock.json`；
- `src/compiler`、`src/engine`、`src/shared`；
- `examples/compiler`。

没有复制 renderer、main、preload、Electron 构建产物、DeepSeekHarness 或用户文档。清单中的 46 个源码 / 样例 / 包文件都保存了 SHA-256，最终运行逐个与主工作目录核对，一致后才写成功证据。独立目录另有安装日志、证据脚本、一个最小本地 `tsconfig.json` 和输出目录；显式指定该配置，避免 tsx 向上读取主工作目录的配置。

本次主机为 Windows `10.0.26100`、x64，Node `v24.15.0`、npm `11.12.1`。字体明确读取 `C:\Windows\Fonts\msyh.ttc`，没有把系统字体复制进测试目录或产物。

## 安装与运行

在独立目录执行：

```powershell
npm.cmd ci --ignore-scripts --no-audit --fund=false --userconfig=.npmrc --cache=.npm-cache
```

私有 `.npmrc` 只指定公开 npm registry；缓存位于测试目录。实测安装 599 个包，约 30 秒。使用项目完整锁文件，所以安装树仍包含 Electron 的 npm 包；`--ignore-scripts` 禁止其二进制安装脚本，最终确认 `node_modules/electron/dist/electron.exe` 不存在。这里证明编译运行不需要 Electron 二进制，不声称依赖树完全没有 Electron 包。

独立运行脚本直接调用该目录的 `node_modules/tsx/dist/cli.mjs` 和 `src/compiler/cli.ts`，生成 `output/report.docx`、`output/deck.pptx`。10 个主要编译依赖的解析路径均位于该目录的 `node_modules`，没有把主工作目录安装的包当作复现依赖。

CLI 子进程只继承 Windows 执行所需的 PATH、系统目录、临时目录、处理器信息等环境项，以及本地 `TSX_TSCONFIG_PATH`；不继承 API key、token、用户配置目录或桌面会话变量。生成使用本地样例、图片与明确提供的字体，没有启动 Electron 或 Office。安装允许访问公开 npm；本次不是断网虚拟机或新操作系统账户测试。

## 结果

| 项目 | DOCX | PPTX |
| --- | --- | --- |
| CLI 退出码 | 0 | 0 |
| 输出文件 | `output/report.docx` | `output/deck.pptx` |
| 大小 | 13,355 字节 | 25,239 字节 |
| input / presentation / plan 摘要 | 全部一致 | 全部一致 |
| 字体 / 素材摘要 | 全部一致 | 全部一致 |
| 其他 manifest 字段 | compiler、target、documentId、revision、template、writer、diagnostics 均一致 | 同左 |

比较基准是主工作目录 `.test-data/compiler-acceptance/final/report.docx` 和 `deck.pptx` 内的 `markflow/manifest.json`，不是另存且可能过期的 sidecar。

关键摘要：

| 内容 | SHA-256 |
| --- | --- |
| 两类共同 input | `02286c5f8c452970416a88fa40bf3b60e524b629f69db26dee806050fc1603f6` |
| DOCX presentation | `4d53750a185e8508f8030b7c32616f1212f9e8c4202177b40221bf88cefd036d` |
| DOCX plan | `3b13b21890ea84cb7fb41072cc245f0f9499a73c0d9fdf90f614283522590461` |
| PPTX presentation | `7f3b5bef34afba00c038027176be6ee9e259a0e85a6a877efd20957892e537f7` |
| PPTX plan | `6cb16103ab707ec3fd7d0c3e2cf108a4f66fb6300dce78e667e88b06fd2cc4c2` |
| Microsoft YaHei 字体文件 | `3084f1f88369af6bf9989c909024164d953d1e38d08734f05f28ef24b2f9d577` |
| 测试 PNG | `3f4a1d5513ecac18a3a6f7b1e21380748341a94ca646ca6e752d7add24424504` |

最终 Office ZIP 文件的字节摘要与主目录产物不同。本项证明相同语义计划、主题及声明资源的复现，不是逐字节一致构建；没有用 plan hash 相同替代产物二进制相同的结论。

## 失败尝试与保留证据

第一次在受限执行环境中安装时，npm 无法写系统缓存的 `_logs`，并报 `Exit handler never called!`。保留在 `install-sandbox-failure.log`；随后改为授权联网安装及目录内私有缓存，成功完成。没有修改目录 ACL，也没有为安装关闭校验。

第一次生成已完成两类 manifest 比较，但最后发现主工作目录 `src/compiler/cli.ts` 增加了严格 UTF-8 解码，源码清单与副本不再一致。脚本因此返回失败，日志保留为 `reproduction-before-final-cli.log`。同步最终 CLI 后重新核对 46 个文件并完成最终复现；没有把该失败尝试计为最终成功。

最终复查又修复了 `model.ts` 的来源映射：复制来源字典时保留空原型，防止 `constructor` 等合法 Mark ID 误取原型属性。同步该文件并更新清单后再次复跑，没有重新安装依赖；46 个文件一致、两类 CLI 退出码为 0、全部 manifest 比较仍通过。前一轮日志另存为 `reproduction-before-final-model.log`，当前 `reproduction.log` 和证据 JSON 对应包含该修复的最终轮次。

本机证据位于同一个保留目录：

- `source-inventory.json`：复制文件与摘要；
- `install.log`：最终安装日志；
- `reproduce.mjs`：依赖路径、隔离环境、CLI 与 manifest 比较过程；
- `reproduction.log`、`reproduction-evidence.json`：最终结果和逐字段比较；
- `output/*-stdout.json`、`output/*-stderr.txt`：各 CLI 原始输出；
- `output/report.docx`、`output/deck.pptx`：实际生成文件。

这次没有在独立目录重复运行 Office 显示 / 编辑 / 重开、全部故障注入、成本四组实验或 macOS 测试。实际页数与原生编辑验收需查看主任务的独立记录；生成成功不自动证明这些项目。常规使用命令见 [样例 README](../../examples/compiler/README.md)。
