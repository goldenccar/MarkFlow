import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { PaperService, type PaperCompileJob, type PaperServiceOptions } from '../src/main/paperService'
import { ensureMarkDocument, parseMarks } from '../src/shared/marks'
import type { PaperMarkRequest } from '../src/shared/paper'
import { getSettings } from '../src/main/files'

async function harness(t: TestContext, overrides: Partial<PaperServiceOptions> = {}) {
  await fs.mkdir('.test-data', { recursive: true })
  const base = await fs.mkdtemp(path.resolve('.test-data/paper-mark-service-'))
  const sources = path.join(base, 'sources'), outputs = path.join(base, 'outputs'), picks: string[] = [], exports: string[] = [], jobs: PaperCompileJob[] = []
  await fs.mkdir(sources); await fs.mkdir(outputs)
  const originalFile = path.join(sources, 'original.md'); await fs.writeFile(originalFile, '# Disk version\n\nOriginal fact.')
  let directoryCalls = 0
  const service = new PaperService({
    userData: path.join(base, 'profile'), chooseDirectory: async () => { directoryCalls++; return outputs },
    chooseFile: async () => picks.shift() ?? null, chooseOutput: async () => exports.shift() ?? null,
    authorizeCurrent: async source => { if (source.root !== undefined && source.root !== 'authorized-project') throw new Error('Project not authorized.'); return { sourcePath: originalFile, assetRoot: sources } },
    runtime: async () => ({ available: true, root: base, binDir: base, latexmk: 'mock-latexmk', engines: { xelatex: 'mock-xelatex' } }), environment: () => ({}),
    runCompile: async job => { jobs.push(job); await fs.writeFile(path.join(job.output, 'markflow.pdf'), '%PDF-1.7\nmock'); return { code: 0, log: '' } },
    ...overrides,
  })
  t.after(async () => { service.dispose(); assert.ok(base.startsWith(path.resolve('.test-data') + path.sep)); await fs.rm(base, { recursive: true, force: true }) })
  const request = (content = '# Unsaved title\n\nUnsaved fact.', name = 'derived'): PaperMarkRequest => ({ source: { kind: 'current', content }, template: 'chinese', title: 'Shared source', author: 'Author', abstract: '', name })
  return { base, sources, outputs, picks, exports, jobs, originalFile, service, request, directoryCalls: () => directoryCalls }
}

test('Mark generation uses unsaved current text, preserves original source and records stable source IDs', async t => {
  const h = await harness(t), original = await fs.readFile(h.originalFile, 'utf8'), content = ensureMarkDocument('# Unsaved title\n\nUnsaved shared fact.')
  const result = await h.service.fromMark(h.request(content))
  assert.ok(result?.project)
  assert.equal(result.project.trusted, true)
  assert.equal((await getSettings(path.join(h.base, 'profile'))).lastProject, result.project.rootLabel)
  assert.equal(await fs.readFile(h.originalFile, 'utf8'), original)
  const source = JSON.parse(await fs.readFile(path.join(result.project.rootLabel, 'markflow-source.json'), 'utf8'))
  assert.equal(source.content, content)
  assert.deepEqual(result.project.origin?.marks.map(mark => mark.markId), parseMarks(content).map(mark => mark.id))
  const main = await h.service.read(result.project.id, 'main.tex')
  assert.match(main.content, /Unsaved shared fact/)
  assert.ok(!main.content.includes('Original fact'))
})

test('repeated Mark generation creates a new project without replacing the previous snapshot', async t => {
  const h = await harness(t)
  const first = await h.service.fromMark(h.request('# First snapshot', 'Same name'))
  const second = await h.service.fromMark(h.request('# Second snapshot', 'Same name'))
  assert.ok(first?.project); assert.ok(second?.project)
  assert.equal(first.project.name, 'Same name'); assert.equal(second.project.name, 'Same name (2)')
  assert.match((await h.service.read(first.project.id, 'main.tex')).content, /First snapshot/)
  assert.match((await h.service.read(second.project.id, 'main.tex')).content, /Second snapshot/)
  assert.ok(first.project.origin); assert.ok(second.project.origin)
})

test('derived sources reject save, recovery drafts, file insertion and compile-buffer edits; detach is independently editable', async t => {
  const h = await harness(t), result = await h.service.fromMark(h.request())
  assert.ok(result?.project)
  const project = result.project, main = await h.service.read(project.id, 'main.tex'), modified = { ...main, content: main.content + '\nChanged.' }
  await assert.rejects(() => h.service.save(project.id, modified), /Mark/)
  await assert.rejects(() => h.service.draft(project.id, modified), /Mark/)
  await assert.rejects(() => h.service.addFile(project.id, 'extra.tex'), /Mark/)
  const invalid = await h.service.build({ projectId: project.id, mainFile: 'main.tex', engine: 'xelatex', buffers: [modified], revision: 1 })
  assert.equal(invalid.status, 'error'); assert.equal(h.jobs.length, 0)
  const detached = await h.service.detach(project.id)
  assert.ok(detached); assert.equal(detached.origin, undefined); assert.equal(detached.trusted, false)
  assert.equal((await getSettings(path.join(h.base, 'profile'))).lastProject, detached.rootLabel)
  const editable = await h.service.read(detached.id, 'main.tex')
  await h.service.save(detached.id, { ...editable, content: editable.content + '\nIndependent change.' })
  assert.equal((await h.service.read(project.id, 'main.tex')).content, main.content)
  assert.match((await h.service.read(detached.id, 'main.tex')).content, /Independent change/)
})

test('generated source maps and configuration survive snapshot, source ZIP, re-open and recompile', async t => {
  const h = await harness(t), created = await h.service.fromMark(h.request())
  assert.ok(created?.project)
  const project = created.project, build = await h.service.build({ projectId: project.id, mainFile: 'main.tex', engine: 'xelatex', buffers: [], revision: 1 })
  assert.equal(build.status, 'success')
  assert.ok(build.artifactId)
  const exported = path.join(h.base, 'generated.zip'); h.exports.push(exported)
  await h.service.export(project.id, build.artifactId, 'source')
  const zip = await JSZip.loadAsync(await fs.readFile(exported))
  for (const file of ['markflow-origin.json', 'markflow-source.json', 'markflow-source-map.json', 'markflow-presentation.json', 'main.tex']) assert.ok(zip.file(file), `${file} must survive the source package`)
  h.picks.push(exported)
  const reopened = await h.service.open('zip')
  assert.ok(reopened); assert.equal(reopened.trusted, false); assert.deepEqual(reopened.origin, project.origin)
  await h.service.trust(reopened.id)
  const rebuilt = await h.service.build({ projectId: reopened.id, mainFile: 'main.tex', engine: 'xelatex', buffers: [], revision: 2 })
  assert.equal(rebuilt.status, 'success')
  assert.equal(await fs.readFile(path.join(h.jobs[1].cwd, 'markflow-source-map.json'), 'utf8'), await fs.readFile(path.join(project.rootLabel, 'markflow-source-map.json'), 'utf8'))
})

test('assets require the granted source root, preserve their bytes, and invalid input never creates output', async t => {
  const h = await harness(t)
  const image = await fs.readFile('examples/compiler/assets/test-blocks.png')
  await fs.writeFile(path.join(h.sources, 'sample.png'), image)
  const valid = await h.service.fromMark(h.request('![Shared image](sample.png)', 'image-project'))
  assert.ok(valid?.project)
  const asset = valid.project.files.find(file => file.path.startsWith('assets/') && !file.directory)!
  assert.deepEqual(await fs.readFile(path.join(valid.project.rootLabel, asset.path)), image)
  const before = await fs.readdir(h.outputs), picks = h.directoryCalls()
  const escaped = await h.service.fromMark(h.request('![Outside](../outside.png)', 'escaped'))
  assert.ok(escaped && !escaped.project && escaped.diagnostics.some(item => item.severity === 'error'))
  const unsupported = await h.service.fromMark(h.request('> Unsupported block', 'unsupported'))
  assert.ok(unsupported && !unsupported.project && unsupported.diagnostics.some(item => item.severity === 'error'))
  await assert.rejects(() => h.service.fromMark({ ...h.request(), source: { kind: 'current', content: 'No access', root: 'not-authorized', path: 'notes.md' } }), /authorized/)
  assert.equal(h.directoryCalls(), picks)
  assert.deepEqual(await fs.readdir(h.outputs), before)
})

test('generated snapshot rejects missing hashed metadata and externally changed provenance before invoking TeX', async t => {
  const h = await harness(t)
  for (const [name, mutation] of [
    ['missing', async (root: string) => fs.rm(path.join(root, 'markflow-presentation.json'))],
    ['missing-origin', async (root: string) => fs.rm(path.join(root, 'markflow-origin.json'))],
    ['origin-edit', async (root: string) => { const file = path.join(root, 'markflow-origin.json'), origin = JSON.parse(await fs.readFile(file, 'utf8')); origin.label = 'Changed external origin'; await fs.writeFile(file, JSON.stringify(origin)) }],
  ] as const) {
    const created = await h.service.fromMark(h.request('# Heading\n\nFact', name))
    assert.ok(created?.project)
    await mutation(created.project.rootLabel)
    const result = await h.service.build({ projectId: created.project.id, mainFile: 'main.tex', engine: 'xelatex', buffers: [], revision: 1 })
    assert.equal(result.status, 'error', name)
  }
  assert.equal(h.jobs.length, 0)
})

test('current nested Markdown resolves images relative to its file while keeping the project grant', async t => {
  let sourcePath = '', assetRoot = ''
  const h = await harness(t, { authorizeCurrent: async () => ({ sourcePath, assetRoot }) })
  assetRoot = h.sources; sourcePath = path.join(h.sources, 'notes', 'paper.md')
  await fs.mkdir(path.dirname(sourcePath))
  const image = await fs.readFile('examples/compiler/assets/test-blocks.png')
  await fs.writeFile(path.join(h.sources, 'notes', 'near.png'), image)
  await fs.writeFile(path.join(h.sources, 'shared.png'), image)
  for (const [name, reference] of [['near', 'near.png'], ['shared', '../shared.png']]) {
    const result = await h.service.fromMark(h.request(`![Image](${reference})`, name))
    assert.ok(result?.project)
    const asset = result.project.files.find(file => file.path.startsWith('assets/') && !file.directory)!
    assert.deepEqual(await fs.readFile(path.join(result.project.rootLabel, asset.path)), image)
  }
  const result = await h.service.fromMark(h.request('![Outside](../../outside.png)', 'outside'))
  assert.ok(result && !result.project && result.diagnostics.some(item => item.severity === 'error'))
  assert.ok(!(await fs.readdir(h.outputs)).includes('outside'))
})

test('local structured Mark source and bibliography form data use the same generation path', async t => {
  const h = await harness(t)
  h.picks.push(path.resolve('examples/compiler/content.json'))
  const selected = await h.service.fromMark({ ...h.request('', 'structured'), source: { kind: 'file' } })
  assert.ok(selected?.project)
  assert.ok(selected.project.origin?.marks.some(mark => mark.markId === 'fact-coverage'))
  const cited = await h.service.fromMark({ ...h.request('Reference [@knuth1984].', 'cited'), references: [{ id: 'knuth1984', title: 'The TeXbook', author: 'Donald E. Knuth', year: '1984' }] })
  assert.ok(cited?.project)
  assert.match((await h.service.read(cited.project.id, 'main.tex')).content, /\\cite\{knuth1984\}/)
  assert.match((await h.service.read(cited.project.id, 'references.bib')).content, /Donald E\. Knuth/)
})
