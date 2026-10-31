# macOS 论文工作区验收

## 当前状态

2026-10-31：**未完成真实 macOS 验收。** 当前执行环境是 Windows，未发现可调用的 Mac。名为 MarkFlow-Mac 的 ChatGPT 项目不是远程执行机器；旧版开发界面检查也不能替代当前编译环境和分发包验收。

已经补齐 Mac 环境准备分支、实际 `.app` 验收入口，以及复用现有原生/桌面测试的证据输出。Windows 可以验证脚本语法、参数和非 Mac 拒绝行为，不能验证 Darwin 执行文件、应用启动、中文字体或文献链。

| 项目 | 当前证据 |
| --- | --- |
| 官方 Darwin 基础包及 SHA-256 | 已核对公开发布资料；尚未在 Mac 下载执行 |
| Mac 环境准备、冻结、安装 | 实现入口；真实 Mac 待运行 |
| macOS Apple Silicon / Intel | 均待验收；在一个架构通过不代表另一个通过 |
| 打包 `.app`、中文、BibTeX、Biber、源包回编、PDF 界面 | 验收脚本已串联；尚无 Mac 成功记录 |
| 干净系统、签名、公证、下载后的 Gatekeeper、断网复现 | 待实机验收 |

## 系统要求与环境来源

项目使用 Electron 45，整套应用最低要求 macOS 13。TeX Live 的 universal-darwin 包本身包含 Intel/ARM 代码，但它的最低系统版本与应用要求不同，不能据此降低应用要求。参考 [Electron 44 起移除 macOS 12 支持](https://www.electronjs.org/blog/electron-44-0)和 [TeX Live 2026 Darwin 说明](https://www.tug.org/mactex/mactex-unix-download.html)。

构建者使用官方固定版本 `TinyTeX-darwin-v2026.10.tar.xz`，SHA-256 为 `9962e445b56f06feb2c28f73561e523e89d550e98abf910ba60b0ffb3856921f`，来源为 [TinyTeX v2026.10 官方发布](https://github.com/rstudio/tinytex-releases/releases/tag/v2026.10)。准备脚本仅解压到仓库 `vendor/tex`，不改全局 PATH、不安装 R，也不运行官方脚本中的系统路径修改步骤。[官方 Unix 安装脚本](https://github.com/rstudio/tinytex/blob/master/tools/install-bin-unix.sh)用于核对归档结构和 XeTeX 安装后动作。

`prepare:tex` 是构建者联网准备步骤，补充宏包仍来自 CTAN 当前镜像；**只有经过 `package-tex.ts` 冻结的文件集合才是可重放的分发环境**。冻结包记录文件摘要、包修订、字体/许可文件和来源，面向用户的安装过程不再调用 tlmgr 联网补包。发布一个新的冻结包应使用新版本标识。

## 在 Mac 上运行

先在目标 Mac 安装仓库要求的 Node.js，取得本次完整源码；使用与该架构一致的 Node。需要图形桌面会话，不能只依靠没有桌面的 SSH 终端运行界面测试。

```sh
npm ci
npm run prepare:tex
npm run package:tex
npm run pack:mac
```

`pack:mac` 使用 `scripts/electron-builder-mac.cjs`，生成当前架构的 `.app`，只携带 Darwin 环境包。不能把 Windows 的 `vendor/tex` 复制过来冒充 Darwin 环境；冻结脚本会按实际运行平台和架构记录环境。

对生成的应用运行（把路径替换成实际生成路径）：

```sh
npm run test:paper:mac -- --app "/absolute/path/MarkFlow.app"
```

脚本会创建隔离的应用配置目录，从应用界面的“安装论文环境”入口安装随包环境，然后执行已有的桌面论文流程。接着读取该目录的 `active.json`，使用**同一份实际安装环境**运行原生编译验收，不回退到开发目录里的 TeX。

原生检查包括中文、英文单栏/双栏、多文件未保存快照、实际 BibTeX 内容、三个源包重导入/回编、嵌套主文件的实际 Biber 文献。桌面检查包括最终 PDF 页面、独立滚动、编辑保存、失败后保留旧 PDF、源包、草稿恢复和外部修改冲突。测试使用程序填入文件选择器，不等于系统文件选择器或物理输入法已经验收。

证据保存在 `.test-data/paper-macos-*`：总记录 `acceptance.json`、各组日志、原生 PDF/源包和界面截图。记录包含 OS、Node/应用架构、Rosetta 状态、应用代码摘要、环境 ID/实际路径和执行文件类型。只有两个测试组都通过，才输出 `native-and-packaged-desktop-passed`。签名/Gatekeeper 命令结果独立记录；该状态不等于发布验收完成。目录不会自动删除，便于复查。

## 完成发布验收还需补充

在没有预装 TeX 的干净 Mac 或独立测试系统上，从真实分发文件完成下载、打开、安装环境和上述测试，记录分发文件 SHA-256、系统版本、架构及首次耗时。`which` 没找到 TeX 只能说明 PATH 没命中，不能证明整机从未安装过。

准备完毕后由测试者断开网络，再运行同一测试；它会重新创建空配置并从随包离线资源安装。单独记录断网状态及该次证据目录，不能只因测试代码未主动下载而宣称断网通过。

签名、公证和下载后 Gatekeeper 必须检查真实分发件，不能靠本地构建目录启动成功推断。再完成真实中文输入法、快捷键、Finder 文件操作与辅助功能检查。Apple Silicon 原生、Intel 原生、Rosetta 分别记录；未运行的组合继续保持待验收。
