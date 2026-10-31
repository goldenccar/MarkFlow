import type { Diagnostic } from '../compiler/types'
import type { CompilerSession } from '../shared/compilerUi'

const reasons: Record<string, string> = {
  JSON_SYNTAX: 'JSON 文件语法不正确，请检查括号、引号和逗号。',
  INPUT_ENCODING: '资料文件不是有效的 UTF-8 文本，请转换编码后重试。',
  INPUT_LIMIT: '资料或呈现文件过大，请使用不超过 8 MiB 的文件。',
  INPUT_FORMAT: '请选择 Markdown（.md）或 MarkFlow 资料（.json）文件。',
  UNSUPPORTED_VERSION: '资料版本不受支持，请使用当前版本的 MarkFlow 资料。',
  PRESENTATION_VERSION: '呈现文件版本不受支持，请选择版本 1 的呈现 JSON。',
  PRESENTATION_REFERENCE: '呈现文件引用了资料中不存在的 Mark，请检查所选资料与呈现是否配套。',
  INVALID_REFERENCE: '资料中存在无效的 Mark 引用，请修正引用后重试。',
  REFERENCE_CYCLE: 'Mark 引用形成循环，无法生成，请移除循环引用。',
  LAYOUT_OVERFLOW: '内容超出页面可用空间，请缩短对应 Mark，或用呈现 JSON 将内容分到其他页。字号不会自动缩小。',
  LAYOUT_CONTENT: '内容类型与所选版式不匹配，请调整呈现文件或恢复自动排版。',
  TABLE_COLUMN_WIDTH: '表格列过窄，请减少列数、缩短内容或调整呈现。',
  TABLE_ROW_HEIGHT: '表格单行无法放入一页，请拆分该行的内容。',
  NOTE_FONT_SIZE: 'Word 报告的字号须在 8–72 磅之间，请调整对应 Mark 的字号。',
  STAGE_FONT_SIZE: 'PPT 字号超出版式允许范围，请调整对应 Mark 的字号。',
  SLIDE_TITLE: 'PPT 标题必须引用标题或段落 Mark。',
  FONT_MISSING: '找不到所需字体，请在高级设置中填写字体名称并选择对应字体文件。',
  FONT_FAMILY: '字体文件不包含指定字体，请核对字体名称并重新选择文件。',
  FONT_FORMAT: '无法读取字体文件，请选择有效的 TTF、OTF 或 TTC 字体。',
  FONT_LIMIT: '字体文件过大，请选择不超过 64 MiB 的字体。',
  FONT_GLYPH: '所选字体缺少正文中的字符，请指定包含这些字符的字体。',
  ASSET_ROOT: '素材文件夹不存在或无法读取，请在高级设置中重新选择。',
  ASSET_ROOT_REQUIRED: '资料包含图片，请先在高级设置中选择包含这些图片的素材文件夹。',
  ASSET_MISSING: '找不到图片，请检查相对路径和高级设置中的素材文件夹。',
  ASSET_SCOPE: '图片路径超出已选择的素材文件夹，请调整路径或重新选择素材根目录。',
  ASSET_FORMAT: '图片损坏或格式不受支持，请使用完整的 PNG 或 JPEG 图片。',
  ASSET_LIMIT: '图片超过大小限制：单张最多 20 MiB，合计最多 64 MiB。',
  ASSET_DIMENSIONS: '图片尺寸过大，请先缩小图片。',
  IMAGE_ORIENTATION: '图片含有旋转方向信息，请先将图片转正并另存后重试。',
  TEXT_TAB: '正文含制表符，请改用空格。',
  TEXT_WIDTH: '字符宽度超出文本区域，请调整字号或内容。',
  OUTPUT_DIRECTORY: '输出文件夹不可用，请选择一个已存在且可写入的文件夹。',
  OUTPUT_EXTENSION: '输出扩展名与生成目标不匹配，请重新选择输出位置。',
  OUTPUT_LINK: '输出位置必须是普通文件，不能是目录或链接。',
  OUTPUT_INPUT: '输出不能覆盖资料、呈现、字体或素材文件，请使用不同文件名。',
  OUTPUT_WRITE: '无法写入输出文件，请关闭占用该文件的程序并检查目录权限；已有文件会保留。',
  DOCX_PAGINATION: 'Word/WPS 会完成最终换行与分页，请在生成文件中检查实际排版。',
}

export function compilerDiagnosticReason(diagnostic: Diagnostic): string {
  if (/[\u3400-\u9fff]/u.test(diagnostic.message)) return diagnostic.message
  if (reasons[diagnostic.code]) return reasons[diagnostic.code]
  if (diagnostic.code.startsWith('MARKDOWN_')) return 'Markdown 中有当前生成器无法处理的内容，请检查对应位置；原文不会被改写。'
  if (/^(INVALID_|DUPLICATE_|UNKNOWN_|UNSUPPORTED_|IMPLICIT_|UNSAFE_|MISSING_|PRESENTATION_SCHEMA|THEME_UNKNOWN|TARGET_UNKNOWN)/.test(diagnostic.code)) return '资料或呈现中的字段不符合当前格式，请检查对应字段和详细原因。'
  return diagnostic.severity === 'warning' ? '生成器返回了一项提示，请查看详细信息。' : '操作未完成，请检查所选文件和访问权限后重试。'
}

export function compilerDiagnosticLocation(diagnostic: Diagnostic): string {
  const parts: string[] = []
  if (diagnostic.markId) parts.push(`Mark ${diagnostic.markId}`)
  const source = diagnostic.source
  if (source) {
    let location = source.file
    if (source.line !== undefined) location += ` · 第 ${source.line} 行${source.column !== undefined ? `，第 ${source.column} 列` : ''}`
    else if (source.from !== undefined) location += ` · 字符位置 ${source.from + 1}`
    if (source.pointer) location += ` · ${source.pointer}`
    parts.push(location)
  }
  if (diagnostic.field) parts.push(`字段 ${diagnostic.field}`)
  return parts.join(' · ')
}

/** Source offsets from an advanced presentation/resource must never navigate the open document. */
export function canLocateCompilerDiagnostic(diagnostic: Diagnostic, session: CompilerSession | null): boolean {
  return session?.sourceKind === 'current' && (!!diagnostic.markId || (
    diagnostic.source?.file === session.sourceLabel && Number.isSafeInteger(diagnostic.source.from) && diagnostic.source.from! >= 0
  ))
}
