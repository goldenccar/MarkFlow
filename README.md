# MarkFlow

**中文** · [English](README.en.md)

![MarkFlow：一份内容，多种交付](docs/assets/markflow-hero-zh.svg)

**用一份资料，写出报告，也做出演示。**

MarkFlow 是一个本地优先的写作工作区与文档编译器。用 Markdown 写作，用可复用的 Mark 组织内容，再生成可继续编辑的 Word 报告和 PowerPoint 演示。资料发生变化时，更新共享内容，重新生成两份交付物。

[开始使用](#开始使用) · [查看示例](#一次修改两份交付) · [产品设计](docs/PRD.md) · [开发文档](docs/DEVELOPMENT.md) · [路线图](OopsMD-TODO.md)

## 内容写一份，交付有多种

- **资料共用，表达各有侧重。** 报告展开细节，演示突出重点。正文与呈现分开维护，让两种表达使用同一组事实。
- **改动沿着内容传递。** 将共享资料中的“12 个城市”改为“18 个城市”，重新生成，报告与演示中的对应内容一起更新。
- **文件交出去，还能接着改。** DOCX / PPTX 保留原生文字、表格和图片对象，接收方可以在熟悉的办公软件里继续工作。
- **从写作到生成，都在本地。** 编辑、保存和编译无需注册账号或配置 AI 密钥；也可以通过 SDK / CLI 将生成能力接入自己的工具。

![从编写资料、选择呈现到生成可编辑文件的工作流](docs/assets/markflow-workflow-zh.svg)

## 一次修改，两份交付

仓库自带一组完整示例：一份项目资料、两份呈现描述，生成 **2 页报告与 4 页演示**。修改一项共同事实，再次生成即可看到两种产物的变化。

| 交付物 | 原始资料：12 个城市 | 更新资料：18 个城市 |
| --- | --- | --- |
| Word 报告 | [打开报告](examples/compiler/generated/report.docx) | [打开更新后的报告](examples/compiler/generated/updated-report.docx) |
| PowerPoint 演示 | [打开演示](examples/compiler/generated/deck.pptx) | [打开更新后的演示](examples/compiler/generated/updated-deck.pptx) |

这些文件来自同一份虚构项目资料。示例已在 Windows WPS 中完成文字、表格、图片的修改、保存与重新打开。[查看源文件与运行方法](examples/compiler/README.md) · [查看验收记录](docs/compiler/ACCEPTANCE.md)

## 一个适合日常写作的工作区

先写内容，保存时再选择位置。文件留在自己的文件夹里；多个标签各自保留草稿、编辑状态和撤销历史。

![MarkFlow 当前桌面工作区：Markdown 编辑、项目文件与正文导航](docs/assets/workspace-light.png)

Markdown 提供排版编辑、源码与对照三种视图。标题、段落和列表项都可以作为 Mark 调整字体、字号、顺序；正文目录帮助你在长文中找到需要修改的部分。Fomula 提供公式片段的即时渲染和完整 LaTeX 文档的实际 PDF 预览。

**公式与文档：顶部 ＋ → Fomula。** 在“公式片段 / LaTeX 文档”之间切换；从中文/英文模板开始，或打开已有项目。页面设置表单配置纸张、正文与页眉页脚，右侧 PDF 独立跨页阅读。支持斜线提示与 Tab 补全、文献、错误定位和 PDF/源包导出。[使用与环境准备](docs/LATEX-WORKSPACE.md)

论文首页也可选择当前 Markdown 或本地 Mark 资料，配置标题、作者、摘要和文献后生成论文。生成稿保留来源，另存为独立 LaTeX 后可直接编辑。Windows 完整分发件支持在应用内安装离线环境；macOS 实机仍待验收。[本轮验证与边界](docs/PAPER-DELIVERY.md)

需要版本记录时再启用 Git。保存、本地版本和远端同步分别管理；默认在正文净修改达到 **500** 时记录版本，阈值可调整或关闭。

<details>
<summary>查看深色工作区</summary>

![MarkFlow 深色工作区](docs/assets/workspace-dark.png)

</details>

## 在工作区里生成 Word 和 PPT

点击文件路径栏右侧的 **生成**，选择当前 Markdown、内置示例或本地资料，再选择 Word 报告或 PPT 演示。

![MarkFlow 的 Word / PPT 生成面板](docs/assets/generate-panel.png)

当前文档可以直接使用尚未保存的编辑内容。生成完成后打开文件继续处理；遇到缺失资源、超出页面容量等问题，诊断会指出原因，并为当前文档提供可用的内容定位。

当前生成器支持标题、段落、扁平列表、简单表格、PNG/JPEG 图片与常用文字格式，采用固定报告主题和四类演示版式。[完整输入说明](docs/compiler/LANGUAGE.md)

## 开始使用

### 运行桌面工作区

准备 **Node.js 22.12+** 和 Git；仓库使用的 Node.js 版本见 [`.nvmrc`](.nvmrc)。

```bash
git clone https://github.com/goldenccar/MarkFlow.git
cd MarkFlow
npm ci
npm exec --no -- install-electron
npm run dev
```

启动后即可写作。想先体验生成流程，打开 **生成 → 内置示例**。

### 只使用编译器

在项目目录安装依赖并运行示例，无需启动桌面窗口：

```powershell
npm ci --ignore-scripts
npm run compiler:demo -- --font C:/Windows/Fonts/msyh.ttc
```

文件输出到 `examples/compiler/generated`。以上命令使用 Windows 本机的微软雅黑字体；字体随本机环境提供。[SDK / CLI 与字体配置](docs/compiler/SDK.md)

当前为开发版，桌面生成与文件编辑验收覆盖 Windows / WPS，macOS 已有桌面开发版交互检查。构建自己的 Windows 安装包、跨平台开发及各版本验证范围，见 [开发指南](docs/DEVELOPMENT.md) 和 [验证记录](docs/VALIDATION.md)。

## 正在走向哪里

MarkFlow 的长期方向，是让人和 AI 围绕同一份结构化内容协作。

| 阶段 | 能力 |
| --- | --- |
| 现在 | 本地 Markdown / Fomula 工作区、共享内容生成 DOCX / PPTX、桌面生成入口、独立 SDK / CLI |
| 接下来 | 自定义 AI API、选段修改、差异预览与撤销，以及完整成本对照 |
| 持续扩展 | 带来源定位的知识助手，Note / Stage 可视化编辑，Array 表格与已有 PDF 的阅读和处理 |

AI 将通过明确的内容操作接入现有编辑与保存流程。完整计划与进度见 [产品设计](docs/PRD.md) 和 [开发清单](OopsMD-TODO.md)。

## 一起把交付做得更好

欢迎贡献可复用的样例、版式、格式适配和问题修复。一个可公开的最小输入、期望结果与实际表现，就是很有价值的反馈。

[提交问题](https://github.com/goldenccar/MarkFlow/issues) · [开发与测试](docs/DEVELOPMENT.md) · [编译器结构](docs/compiler/WRITERS.md) · [产品需求](docs/PRD.md)

## 许可证

MarkFlow 使用 [MIT License](LICENSE)。
