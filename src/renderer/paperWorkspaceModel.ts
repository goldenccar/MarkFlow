import type { PaperBuffer, PaperFile, PaperProject } from '../shared/paper'

export interface PaperEditorBuffer extends PaperBuffer {
  baseline: string
  position: { cursor: number; scroll: number }
  recovered: boolean
  diskRevision: string
  conflict: boolean
}

export function openPaperBuffer(file: PaperFile): PaperEditorBuffer {
  const recovered = !!file.draft && file.draft.content !== file.content
  return { path: file.path, content: recovered ? file.draft!.content : file.content, baseline: file.content, revision: recovered ? file.draft!.revision : file.revision, diskRevision: file.revision, conflict: recovered && file.draft!.revision !== file.revision, position: { cursor: 0, scroll: 0 }, recovered }
}

export function paperDraftNeeded(buffer: PaperEditorBuffer, drafted: string | undefined) {
  return (buffer.content !== buffer.baseline || drafted !== undefined) && drafted !== buffer.content
}

export function savedPaperBuffer(current: PaperEditorBuffer, written: PaperBuffer, result: PaperFile): PaperEditorBuffer {
  // Saving one snapshot must not consume edits made while the write was pending.
  return { ...current, baseline: written.content, revision: result.revision, diskRevision: result.revision, conflict: false, recovered: false }
}

export function paperRenderInputsChanged(before: PaperProject, after: PaperProject, oldBuffers: Readonly<Record<string, Pick<PaperBuffer, 'content'>>>, buffers: Readonly<Record<string, Pick<PaperBuffer, 'content'>>>) {
  if (Object.entries(oldBuffers).some(([path, buffer]) => buffers[path]?.content !== buffer.content)) return true
  if (before.mainFile !== after.mainFile || before.engine !== after.engine || before.files.length !== after.files.length) return true
  const previousFiles = new Map(before.files.map(file => [file.path, file]))
  return after.files.some(file => {
    const previous = previousFiles.get(file.path)
    // Loaded source is rendered from its buffer; saving it only updates disk metadata.
    return !previous || previous.directory !== file.directory || previous.editable !== file.editable || (!buffers[file.path] && previous.size !== file.size)
  })
}

export function paperOutline(content: string) {
  return [...content.matchAll(/^\s*\\(part|chapter|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\{([^}\n]+)\}/gm)].map(match => ({
    label: match[2], line: content.slice(0, match.index).split('\n').length,
    depth: ['part', 'chapter', 'section', 'subsection', 'subsubsection'].indexOf(match[1]),
  }))
}

export function paperCitations(buffers: readonly { path: string; content: string }[]) {
  const entries: { key: string; file: string }[] = [], seen = new Set<string>()
  for (const buffer of buffers.filter(item => /\.bib$/i.test(item.path))) {
    for (const match of buffer.content.matchAll(/@([\w-]+)\s*\{\s*([^,\s{}]+)\s*,/g)) {
      if (/^(?:comment|string|preamble)$/i.test(match[1]) || seen.has(match[2])) continue
      seen.add(match[2]); entries.push({ key: match[2], file: buffer.path })
    }
  }
  return entries
}

export function insertPaperSnippet(content: string, cursor: number, snippet: string) {
  const at = Math.max(0, Math.min(cursor, content.length))
  return content.slice(0, at) + snippet + content.slice(at)
}

export const paperSnippets = {
  section: '\n\\section{Section title}\n\n',
  equation: '\n\\begin{equation}\n  E = mc^2\n  \\label{eq:example}\n\\end{equation}\n',
  table: '\n\\begin{table}[htbp]\n  \\centering\n  \\caption{Table caption}\n  \\label{tab:example}\n  \\begin{tabular}{ll}\n    \\hline\n    Item & Value \\\\\n    \\hline\n    Example & 1 \\\\\n    \\hline\n  \\end{tabular}\n\\end{table}\n',
}
