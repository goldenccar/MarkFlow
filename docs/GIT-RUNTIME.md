# Windows Git 运行时

MarkFlow 的 Windows x64 安装包携带官方标准版 MinGit。开发模式使用本机 Git；打包版使用 `resources/git/cmd/git.exe`。运行时完整保留上游文件，包括 Git Credential Manager、OpenSSH、证书和各组件许可证，没有依赖用户另装 Git。

## 固定来源与校验

- 核对日期：2026-10-23。
- 上游版本：Git for Windows `v2.56.0.windows.3`。
- [官方发布页](https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.3)；[对应 GitHub API](https://api.github.com/repos/git-for-windows/git/releases/tags/v2.56.0.windows.3)。
- ZIP：`MinGit-2.56.0.3-64-bit.zip`，39,854,943 字节。
- SHA-256：`2e5619966e588fde5f8122c5557cad50c0fbafcaed736689f40ec1dfb1d78ea7`，已与 API 的 `digest`、发布页及实际下载文件三方核对。
- 解压后原始运行时：375 个文件，96,255,624 字节。文件名排序后，将每个路径、NUL 分隔符、文件 SHA-256 和换行串接，再计算整体 SHA-256：`84d1058a2409e535b5d531d65cc597e7ad09506421c65e0b1cec49fa8d25614b`。
- 固定配置见 `vendor/git-manifest.json`。构建不会追随 `latest` 自动升级。

```powershell
npm run prepare:git
node scripts/check-git.mjs
# 打包后可再次校验完整复制结果：
node scripts/check-git.mjs release/win-unpacked/resources/git
```

准备脚本仅从固定官方 HTTPS URL 下载 ZIP，先验 SHA-256，再用隐藏的非交互 PowerShell `Expand-Archive` 解压到临时目录。完整性、版本和许可证检查全部通过后才放到 `vendor/git`。已有运行时会核验后复用；不覆盖内容不同的现有目录。ZIP 缓存和运行时已由 `.gitignore` 排除，固定清单应提交。

`check-git.mjs` 会复核全部原始文件的内容和路径、关键许可证、来源说明，以及 Git/GCM/SSH 的实际运行版本。测试时从 `PATH` 去掉本机 Git，并禁用外部 Git 配置，避免误用开发电脑的工具。

## 已验证的程序与认证边界

| 组件 | 已运行的结果 |
| --- | --- |
| `cmd/git.exe --version` | `git version 2.56.0.windows.3` |
| `cmd/git.exe credential-manager --version` | `2.9.1+6760f0ef069c994aa2bb1d703fb374986ee82a3e` |
| `usr/bin/ssh.exe -V` | `OpenSSH_10.6p1, OpenSSL 3.5.9 29 Sep 2026` |

标准 MinGit 自带 `credential.helper=manager`。HTTPS 认证交由 GCM 和系统凭据存储；SSH 使用已有密钥、agent 和 `known_hosts`。首次使用应在终端完成认证及 SSH 主机指纹确认，然后在 MarkFlow 中同步。应用不保存 token、私钥或密码，不把凭据写入文档库。首版没有内嵌登录界面，也不自动创建密钥或修改全局 Git 配置。

上表确认随包程序能独立运行；隔离 `PATH` 后，Git 能找到随包 GCM，并能通过内置 shell 调用随包 `ssh -V`。未访问用户账号，未把私有仓库 HTTPS 登录、SSH 密钥访问或真实 GitHub 推送标为验收通过。MinGit 的默认系统配置会继承已有 Git for Windows 配置，实际运行时用户配置仍可能改变 helper、代理和 SSH 选择。

## 许可证与对应源代码

完整保留原始 `LICENSE.txt`、`ucrt64/doc/git-credential-manager/LICENSE`、`ucrt64/share/licenses/`、`usr/share/licenses/`。根目录许可为 Git 的 GPL v2 文本；GCM 为 MIT；OpenSSH、OpenSSL 等适用各自许可证。准备脚本额外生成 `MARKFLOW-GIT-SOURCE.txt` 和 `.markflow-runtime.json`，随安装包保留来源与校验记录。已准备过旧版运行时的环境需重新运行 `npm run prepare:git`，校验原始文件后会更新这两份元数据并移除旧名称文件。

- [同版本 Git 源代码和构建配方归档](https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.3/mingw-w64-git-2.56.0.3-1.src.tar.gz)。
- [同版本 Git 源码树](https://github.com/git-for-windows/git/tree/v2.56.0.windows.3)。
- [Git for Windows SDK 与组件包元数据](https://github.com/git-for-windows/git-sdk-64)。
- [GPL v2 正文](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html)。

这些是上游源码获取入口，不是 MarkFlow 发布方作出的书面源码提供承诺。对外发布二进制前，发布方还需按各组件许可证提供所需的对应源代码、构建材料或有效书面要约；本地打包检查不宣称完成公开分发的全部合规审查。
