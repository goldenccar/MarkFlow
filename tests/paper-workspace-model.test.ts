import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { insertPaperSnippet, openPaperBuffer, paperCitations, paperDraftNeeded, paperOutline, paperRenderInputsChanged, savedPaperBuffer } from '../src/renderer/paperWorkspaceModel'
import type { PaperProject } from '../src/shared/paper'

describe('paper workspace buffer ownership', () => {
  it('restores a draft without replacing the disk baseline', () => {
    const buffer = openPaperBuffer({ path: 'part.tex', content: 'disk', revision: 'new-disk', draft: { content: 'draft', revision: 'old-disk', updatedAt: '' } })
    assert.equal(buffer.content, 'draft'); assert.equal(buffer.baseline, 'disk'); assert.equal(buffer.recovered, true)
    assert.equal(buffer.revision, 'old-disk'); assert.equal(buffer.diskRevision, 'new-disk'); assert.equal(buffer.conflict, true)
  })
  it('retains newer text after a pending save completes', () => {
    const written = { path: 'part.tex', content: 'saved snapshot', revision: '1' }
    const current = { ...openPaperBuffer({ ...written }), content: 'typed later' }
    const accepted = savedPaperBuffer(current, written, { ...written, revision: '2' })
    assert.equal(accepted.content, 'typed later'); assert.equal(accepted.baseline, 'saved snapshot'); assert.equal(accepted.revision, '2')
  })
  it('replaces a persisted draft when undo returns to the disk baseline', () => {
    const buffer = openPaperBuffer({ path: 'part.tex', content: 'disk', revision: '2' })
    assert.equal(paperDraftNeeded(buffer, 'old draft'), true)
    assert.equal(paperDraftNeeded(buffer, 'disk'), false)
    assert.equal(paperDraftNeeded(buffer, undefined), false)
    assert.equal(openPaperBuffer({ ...buffer, draft: { content: 'disk', revision: '1', updatedAt: '' } }).revision, '2')
  })
  it('extracts only section commands and bibliography entries', () => {
    assert.deepEqual(paperOutline('% \\section{hidden}\n\\section{Intro}\n\\subsection*{Detail}').map(item => [item.label, item.line]), [['Intro', 2], ['Detail', 3]])
    assert.deepEqual(paperCitations([{ path: 'refs.bib', content: '@article{first,\n title={A}}\n@string{ignored, value}\n@book{first,title={B}}' }]), [{ key: 'first', file: 'refs.bib' }])
  })
  it('inserts source controls at a bounded cursor without replacing nearby macros', () => {
    assert.equal(insertPaperSnippet('\\custom{}', 7, 'x'), '\\customx{}')
    assert.equal(insertPaperSnippet('abc', 200, '\n'), 'abc\n')
  })
  it('keeps a compiled preview current when saving the same rendered source', () => {
    const before: PaperProject = { id: 'p', rootLabel: '/paper', name: 'Paper', mainFile: 'main.tex', mainCandidates: ['main.tex'], engine: 'xelatex', trusted: true, files: [{ path: 'main.tex', size: 10, editable: true, directory: false }] }
    const after = { ...before, files: [{ ...before.files[0], size: 30 }] }
    const compiled = { 'main.tex': { content: 'Already compiled new source' } }
    assert.equal(paperRenderInputsChanged(before, after, compiled, compiled), false)
    assert.equal(paperRenderInputsChanged(before, after, compiled, { 'main.tex': { content: 'Actual external source edit' } }), true)
    assert.equal(paperRenderInputsChanged(before, after, compiled, {}), true)
  })
  it('invalidates a preview when project inputs or unloaded resources change', () => {
    const before: PaperProject = { id: 'p', rootLabel: '/paper', name: 'Paper', mainFile: 'main.tex', mainCandidates: ['main.tex'], engine: 'xelatex', trusted: true, files: [{ path: 'figure.png', size: 10, editable: false, directory: false }] }
    assert.equal(paperRenderInputsChanged(before, { ...before, files: [{ ...before.files[0], size: 20 }] }, {}, {}), true)
    assert.equal(paperRenderInputsChanged(before, { ...before, engine: 'pdflatex' }, {}, {}), true)
    assert.equal(paperRenderInputsChanged(before, { ...before, mainFile: 'other.tex' }, {}, {}), true)
    assert.equal(paperRenderInputsChanged(before, { ...before, files: [] }, {}, {}), true)
    assert.equal(paperRenderInputsChanged(before, { ...before, files: [...before.files, { path: 'added.tex', size: 2, editable: true, directory: false }] }, {}, {}), true)
  })
})
