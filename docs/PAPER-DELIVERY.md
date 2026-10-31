# 论文环境与 Mark → LaTeX 交付记录

日期：2026-10-31。以下结果属于本次工作区，不代表发布提交、公开下载或 macOS 已验收。

## 可用入口

新建标签 → **LaTeX 论文**。

- **安装论文环境**：完整 Windows 分发件带离线资源；安装一次后编译不需要下载。轻量应用使用 **导入离线环境包**。可取消、重试、回退上一版本，不修改系统 PATH。
- **资料来源 → 当前 Markdown / 本地 Mark / Markdown**：选择模板，填写标题、作者、摘要与参考文献，生成独立论文项目。使用当前未保存快照，不自动保存原文。
- **编译**：生成实际 PDF，源码和 PDF 独立滚动。生成稿只读，保留输入、身份、修订、来源映射及资源摘要。
- **定位原文 Mark**：源码位置或编译诊断返回未变化的当前 Markdown；PDF 双击先通过 SyncTeX 返回源码。
- **另存为独立 LaTeX**：生成可单独编辑的项目，不回写原 Mark。原有 Markdown、Formula、Word 与 PPT 生成入口保留。

## 实际证据

| 检查 | 结果 / 位置 |
| --- | --- |
| 类型检查与生产构建 | 通过；`.test-data/paper-completion-build.log` |
| 最终打包版桌面 | Mark 流程 6/6、原论文流程 9/9，渲染错误 0；`D:/MarkFlow-Paper-Desktop-20261031/paper-mark-3WTTEW/results.json` 和 `paper-desktop-hJYYCR/results.json` |
| 论文、编译器、Mark 与文件回归 | 153/153；`.test-data/paper-completion-regression.log` |
| 冻结环境 | 357,080,995 字节；364 个 TeX 包，34,829 个文件；固定清单与摘要在 `src/main/paperEnvironmentCatalog.json` |
| 全新目录安装、取消保旧、已安装环境真实编译 | 通过；`D:/MarkFlow-TeX-Verification-20261031-7c8a/clean-import/installation.json` |
| 中文、英文单栏/双栏、各源包往返、嵌套主文件 Biber | 7/7；同目录 `paper-native-C8A76r/results.json`，使用新安装环境，不使用开发目录回退 |
| 共享事实/图片的 DOCX、PPTX、PDF | 12 改为 18 后三类输出都更新；图片字节一致；`.test-data/paper-mark-Qqds6b/results.json` |
| 原始输入与派生稿保护 | 自动化覆盖拒绝改写生成稿、独立副本编辑、越界资源、源包保留配置/映射、外部变更/缺失停止编译 |
| 未保存 Markdown 尾部空 Mark | 实际故障草稿回归通过，3 个 ID 保持不变；`.test-data/mark-identity-regression-FldHh8/result.json` |
| Mark 与实际 PDF 双向定位 | 3 个 Mark 经 TeX 行 → SyncTeX PDF 坐标 → TeX 行后均回到同一 ID；`.test-data/paper-mark-Qqds6b/shared-12/mark-synctex-proof.json` |
| Windows 瞬时文件占用 | 仅针对瞬时错误短重试，每次重新检查版本；永久错误/外部修改保留原文件；`.test-data/atomic-write-retry-unit.log` |

环境安装验证的编译器从随包文件运行，采用受控 PATH；不能将这称为“整机从未安装 TeX”。同样，测试未主动联网不等于实际断开网卡。完整冻结包是当前支持功能所需环境，不是 CTAN 全部包。

## 来源与保真边界

版本化 `markflow-paper` 扩展复用现有共享文档、Mark 身份和资源，单独解释论文公式、文献与交叉引用。共享 Office 输入格式不变。原生 LaTeX 工程保持原始工程为来源，不执行任意 TeX → Mark 逆转换。

已支持受限标题、段落、列表、表格、PNG/JPEG、数学、文献与标签引用。没有持久身份登记的普通 Markdown 使用明确标识的临时身份。字体族采用模板并发出提示；字号转换保留。双栏长表、五六级标题的精确层级、自定义数学宏、完整出版社模板和跨格式文献组织不在本轮保真保证内。

## 未完成项

- **实际 macOS 验收**：当前只有 Windows 执行环境。Darwin 准备分支、打包配置和真实 `.app` 验收入口已实现，尚未在 Mac 执行。详见 [Mac 实机验收](MACOS-ACCEPTANCE.md)。
- 干净操作系统、整机断网、真实下载安装、签名/公证、物理中文输入法和另一处理器架构验收。
- 操作系统级隔离、任意宏包自动修复、Overleaf 同条件比较。
- Note 分页编辑器、Stage 编辑器继续保留在原路线；本次论文 PDF 预览不替代这些功能。

本次没有发布 GitHub Release，没有构造不存在的在线下载地址，也未推送工作区变更。

## 本地分发文件

- 完整安装文件：`D:/MarkFlow-Paper-Release-20261031/MarkFlow-0.1.0-paper-win-x64-setup.exe`，518,580,265 字节。
- SHA-256：`8506dfb28e2c4e29927762bce39a54cf182dae936ec06c29ec2233b5cf26bce3`。
- 未安装版：同目录 `win-unpacked/MarkFlow.exe`。上述 15 组桌面检查使用此真实打包程序，确认 `app.isPackaged=true`，从随包资源安装到空用户配置。
- 当前为未签名调试分发件；已经生成 NSIS 安装文件，未在干净系统中执行安装向导或验证下载后的系统信誉提示。
