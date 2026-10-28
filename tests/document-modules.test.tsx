import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { renderToStaticMarkup } from 'react-dom/server'
import { getDocumentModule, getDocumentModuleForPath, modeForPath, normalizeDocumentLayout, registeredDocumentModules } from '../src/renderer/documents'
import { FormulaPreview } from '../src/renderer/documents/FormulaPreview'
import { toFormulaSource } from '../src/renderer/documents/formulaSource'
import { ensureMarkDocument, readMarkDocument } from '../src/shared/marks'
import { isDocDirty } from '../src/renderer/documentSession'

test('registered document modules retain persisted IDs and independent layouts and capabilities', () => {
  assert.deepEqual(registeredDocumentModules.map(module => module.id), ['markdown', 'latex-math'])
  const markdown = getDocumentModule('markdown'), formula = getDocumentModule('latex-math')
  assert.notEqual(markdown.editor, formula.editor)
  assert.notEqual(markdown.preview, formula.preview)
  assert.equal(markdown.defaultExtension, '.md')
  assert.equal(formula.defaultExtension, '.tex')
  assert.deepEqual(markdown.layouts, ['preview', 'source', 'split'])
  assert.deepEqual(formula.layouts, ['split', 'source'])
  assert.equal(markdown.capabilities.blockFormatting, true)
  assert.equal(formula.capabilities.blockFormatting, false)
  assert.equal(normalizeDocumentLayout('latex-math', 'preview'), 'split')
  assert.equal(normalizeDocumentLayout('latex-math', 'source'), 'source')
  assert.equal(normalizeDocumentLayout('markdown'), 'preview')
  assert.equal(normalizeDocumentLayout('markdown', 'unknown'), 'preview')
})

test('path detection never presents unimplemented formats as editable Markdown', () => {
  for (const path of ['notes/a.md', 'A.MARKDOWN', 'a.mdown', 'a.txt']) assert.equal(modeForPath(path), 'markdown')
  assert.equal(getDocumentModuleForPath('formulas.TEX')?.id, 'latex-math')
  for (const path of ['report.docx', 'sheet.xlsx', 'document.pdf', 'unknown.bin', 'noextension']) assert.equal(getDocumentModuleForPath(path), undefined)
  for (const mode of ['docx', 'spreadsheet', 'pdf', 'toString', '__proto__', '']) assert.throws(() => getDocumentModule(mode), /不支持/)
})

test('Formula initialization is raw text only, preserves clean/draft semantics and exposes no Markdown outline', () => {
  const formula = getDocumentModule('latex-math'), source = '\\begin{aligned}\r\nx &= y + 1\\\\\r\nz &= x^2\r\n\\end{aligned}'
  const opened = formula.initialize(source, source)
  assert.equal(opened.content, source.replaceAll('\r\n', '\n'))
  assert.equal(readMarkDocument(opened.content).metadata, null)
  assert.equal(isDocDirty(opened), false)
  const draft = formula.initialize(opened.content + '\n+1', source)
  assert.equal(isDocDirty(draft), true)
  assert.equal(draft.cleanContent, opened.content)
  assert.deepEqual(formula.getOutline('# not a Markdown heading'), [])
  assert.equal(getDocumentModule('markdown').getOutline('# Actual heading')[0].text, 'Actual heading')
})

test('Formula legacy footer compatibility is explicit and unknown or malformed text stays unchanged', () => {
  const raw = 'x^2 + y^2', registered = ensureMarkDocument(raw)
  assert.equal(toFormulaSource(registered), raw)
  assert.equal(toFormulaSource(registered.replace('x^2', 'changed x^2')), registered.replace('x^2', 'changed x^2'))
  assert.equal(getDocumentModule('latex-math').initialize(registered, registered).content, registered)
  for (const value of [raw + '\n\n<!-- oops:marks {"v":2,"marks":[]} -->', raw + '\n\n<!-- oops:marks not json -->', raw + '\n\n<!-- an ordinary comment -->']) assert.equal(toFormulaSource(value), value)
})

test('Formula renders LaTeX directly and keeps invalid source readable', () => {
  const props = { path: 'formula.tex', onNavigate() {}, onExternal() {} }
  const math = renderToStaticMarkup(<FormulaPreview content="x^2" {...props} />)
  assert.ok(math.includes('katex'))
  assert.ok(!math.includes('markdown-preview'))
  const invalid = renderToStaticMarkup(<FormulaPreview content={'\\frac{x}'} {...props} />)
  assert.ok(invalid.includes('公式尚不能渲染'))
  assert.ok(invalid.includes('\\frac{x}'))
})

test('loading Formula editor and preview has no Tiptap, Markdown parser or Mark registry runtime dependency', () => {
  const editor = new URL('../src/renderer/documents/FormulaEditor.tsx', import.meta.url).href
  const preview = new URL('../src/renderer/documents/FormulaPreview.tsx', import.meta.url).href
  const script = `
    import { registerHooks } from 'node:module';
    const dependencies = new Set();
    registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); dependencies.add(result.url); return result; } });
    await import(${JSON.stringify(editor)});
    await import(${JSON.stringify(preview)});
    process.stdout.write(JSON.stringify([...dependencies]));
  `
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const loaded = JSON.parse(result.stdout) as string[]
  assert.ok(loaded.some(url => url.includes('codemirror')), 'the isolated process must actually load CodeMirror')
  assert.ok(loaded.some(url => url.includes('katex')), 'the isolated process must actually load KaTeX')
  assert.deepEqual(loaded.filter(url => /(?:@tiptap|remark-|react-markdown|shared\/marks|richMarkdown|richExtensions|BlockEditor)/.test(url)), [])
})
