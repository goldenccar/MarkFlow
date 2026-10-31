# 实际生成样例

这四份文件来自同一 `content.json` 和两份呈现描述；内容为虚构测试资料。

- [2 页报告](report.docx) / [4 页演示](deck.pptx)：原始“12 个城市”。
- [更新后的报告](updated-report.docx) / [更新后的演示](updated-deck.pptx)：只修改 `fact-coverage` 为“18 个城市”，通过现有 Mark 事务推进 revision 后重编译。

2026-10-30 在 Windows WPS 12.1.0.29161 中实际打开，并对基础文件另存副本后验证文字、表格、图片编辑与重开。这里保留的是编译原件，没有写入测试编辑文字。字体为显式提供的 Microsoft YaHei，文件未嵌入系统字体。

每个文件 ZIP 内的 `markflow/manifest.json` 包含源内容、呈现、主题、字体、资源摘要及写出器版本。重新编译的 ZIP 时间戳可能不同，不要求逐字节一致。运行 `npm run compiler:demo -- --font C:/Windows/Fonts/msyh.ttc` 可复现完整演示链；详细证据与限制见 [验收记录](../../../docs/compiler/ACCEPTANCE.md)。
