import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { createHash } from 'node:crypto'
import { FileService, getSettings, putSettings } from '../src/main/files'
import { isPaperTextPath } from '../src/shared/paper'
import { PaperService, paperDiagnostics, type PaperServiceOptions, type PaperCompileJob } from '../src/main/paperService'

async function harness(t: TestContext, overrides: Partial<PaperServiceOptions> = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'markflow-paper-')), root = path.join(base, 'project')
  await fs.mkdir(root); await fs.writeFile(path.join(root, 'main.tex'), '\\documentclass{article}\n\\begin{document}Disk\\input{section}\\end{document}\n'); await fs.writeFile(path.join(root, 'section.tex'), 'Disk section\n')
  const directories: Array<string | null> = [root], picks: Array<string | null> = [], outputs: Array<string | null> = [], jobs: PaperCompileJob[] = []
  const service = new PaperService({
    userData: path.join(base, 'profile'), chooseDirectory: async () => directories.shift() ?? null,
    chooseFile: async () => picks.shift() ?? null, chooseOutput: async () => outputs.shift() ?? null,
    runtime: async () => ({ available: true, root: base, binDir: base, latexmk: 'latexmk', engines: { xelatex: 'xelatex', pdflatex: 'pdflatex' }, version: 'test-runtime' }),
    environment: () => ({}), runCompile: async job => { jobs.push(job); await fs.writeFile(path.join(job.output, 'markflow.pdf'), '%PDF-1.7\nmock'); return { code: 0, log: 'Build completed' } }, ...overrides,
  })
  t.after(async () => { service.dispose(); await fs.rm(base, { recursive: true, force: true }) })
  const project = (await service.open())!
  return { base, root, service, project, directories, picks, outputs, jobs }
}

test('external projects require explicit session trust; opaque project IDs and paths protect reads', async t => {
  const h = await harness(t), file = await h.service.read(h.project.id, 'main.tex')
  assert.equal(h.project.trusted, false)
  const request = { projectId: h.project.id, mainFile: 'main.tex', engine: 'xelatex' as const, buffers: [file], revision: 1 }
  const blocked = await h.service.build(request)
  assert.equal(blocked.status, 'error'); assert.match(blocked.diagnostics[0].message, /信任/); assert.equal(h.jobs.length, 0)
  await assert.rejects(() => h.service.read(h.root, 'main.tex'))
  await assert.rejects(() => h.service.read(h.project.id, '../secret.tex'))
  await assert.rejects(() => h.service.read(h.project.id, 'C:/secret.tex'))
  await h.service.trust(h.project.id)
  assert.equal((await h.service.build(request)).status, 'success')
  const recent = (await h.service.open('recent'))!
  assert.equal(recent.rootLabel, h.root); assert.equal(recent.trusted, false)
})

test('all unsaved buffers compile together without rewriting source or recovery drafts', async t => {
  const h = await harness(t), main = await h.service.read(h.project.id, 'main.tex'), section = await h.service.read(h.project.id, 'section.tex')
  const buffer = { ...section, content: 'Unsaved section\n' }; await h.service.draft(h.project.id, buffer)
  await h.service.trust(h.project.id)
  const result = await h.service.build({ projectId: h.project.id, mainFile: 'main.tex', engine: 'xelatex', buffers: [{ ...main, content: main.content.replace('Disk', 'Unsaved main') }, buffer], revision: 8 })
  assert.equal(result.status, 'success'); assert.equal(result.revision, 8)
  assert.match(await fs.readFile(path.join(h.jobs[0].cwd, 'main.tex'), 'utf8'), /Unsaved main/)
  assert.equal(await fs.readFile(path.join(h.jobs[0].cwd, 'section.tex'), 'utf8'), 'Unsaved section\n')
  assert.equal(await fs.readFile(path.join(h.root, 'section.tex'), 'utf8'), 'Disk section\n')
  assert.equal((await h.service.read(h.project.id, 'section.tex')).draft?.content, buffer.content)
  assert.equal(Buffer.from(await h.service.pdf(h.project.id, result.artifactId!)).subarray(0, 5).toString(), '%PDF-')
  await fs.writeFile(path.join(h.root, 'section.tex'), 'External edit')
  const conflict = await h.service.build({ projectId: h.project.id, mainFile: 'main.tex', engine: 'xelatex', buffers: [buffer], revision: 9 })
  assert.equal(conflict.status, 'error'); assert.match(conflict.diagnostics[0].message, /磁盘变化/)
  assert.ok((await h.service.pdf(h.project.id, result.artifactId!)).length)
})

test('save preserves BOM/EOL, rejects stale writes, and retains a newer recovery snapshot', async t => {
  const h = await harness(t), file = path.join(h.root, 'section.tex')
  await fs.writeFile(file, '\ufeffFirst\r\nSecond\r\n')
  const original = await h.service.read(h.project.id, 'section.tex')
  assert.equal(original.content, 'First\nSecond\n')
  await h.service.draft(h.project.id, { ...original, content: 'Latest unsaved\n' })
  const saved = await h.service.save(h.project.id, { ...original, content: 'Saved\n' })
  assert.equal(await fs.readFile(file, 'utf8'), '\ufeffSaved\r\n')
  assert.equal((await h.service.read(h.project.id, 'section.tex')).draft?.content, 'Latest unsaved\n')
  await assert.rejects(() => h.service.save(h.project.id, { ...original, content: 'Stale\n' }), /其他程序修改/)
  assert.notEqual(saved.revision, original.revision)
})

test('cancellation and compiler errors retain the previous valid artifact', async t => {
  let mode: 'ok' | 'error' | 'wait' = 'ok', entered!: () => void
  const h = await harness(t, { runCompile: async job => {
    if (mode === 'wait') { entered(); await new Promise<void>(resolve => job.signal.addEventListener('abort', () => resolve(), { once: true })); return { code: 1, log: 'cancelled' } }
    if (mode === 'error') return { code: 1, log: './main.tex:12: Undefined control sequence.' }
    await fs.writeFile(path.join(job.output, 'markflow.pdf'), '%PDF-1.7\nvalid'); return { code: 0, log: '' }
  } })
  await h.service.trust(h.project.id)
  const request = { projectId: h.project.id, mainFile: 'main.tex', engine: 'xelatex' as const, buffers: [], revision: 1 }
  const good = await h.service.build(request)
  mode = 'error'; const bad = await h.service.build({ ...request, revision: 2 })
  assert.equal(bad.status, 'error'); assert.equal(bad.diagnostics[0].line, 12)
  assert.ok((await h.service.pdf(h.project.id, good.artifactId!)).length)
  mode = 'wait'; const waiting = new Promise<void>(resolve => { entered = resolve }), pending = h.service.build({ ...request, revision: 3 }); await waiting
  await h.service.cancel(h.project.id); assert.equal((await pending).status, 'cancelled')
  assert.ok((await h.service.pdf(h.project.id, good.artifactId!)).length)
})

test('source package captures compiled content and excludes hidden scripts and build products', async t => {
  const h = await harness(t); await h.service.trust(h.project.id)
  await fs.writeFile(path.join(h.root, '.latexmkrc'), 'UNTRUSTED SCRIPT'); await fs.mkdir(path.join(h.root, 'build')); await fs.writeFile(path.join(h.root, 'build', 'old.tex'), 'not source')
  const result = await h.service.build({ projectId: h.project.id, mainFile: 'main.tex', engine: 'pdflatex', buffers: [], revision: 4 })
  assert.equal(result.status, 'success')
  const output = path.join(h.base, 'paper.zip'); h.outputs.push(output)
  await h.service.configure(h.project.id, 'main.tex', 'xelatex')
  assert.equal(await h.service.export(h.project.id, result.artifactId!, 'source'), output)
  const zip = await JSZip.loadAsync(await fs.readFile(output))
  assert.ok(zip.file('main.tex')); assert.equal(zip.file('.latexmkrc'), null); assert.equal(zip.file('build/old.tex'), null)
  assert.equal(JSON.parse(await zip.file('markflow-build.json')!.async('text')).engine, 'pdflatex')
  h.picks.push(output); h.directories.push(h.base)
  const imported = (await h.service.open('zip'))!
  assert.equal(imported.engine, 'pdflatex'); assert.equal(imported.mainFile, 'main.tex'); assert.equal(imported.trusted, false)
  assert.ok((await getSettings(path.join(h.base, 'profile'))).projects.some(project => project.root === imported.rootLabel))
  h.outputs.push(path.join(h.root, 'output.pdf')); await assert.rejects(() => h.service.export(h.project.id, result.artifactId!, 'pdf'), /源项目/)
})

test('displayed PDF stays available when several newer build results have not been accepted by the editor', async t => {
  const h = await harness(t); await h.service.trust(h.project.id)
  const request = { projectId: h.project.id, mainFile: 'main.tex', engine: 'xelatex' as const, buffers: [], revision: 1 }
  const displayed = await h.service.build(request)
  await h.service.pdf(h.project.id, displayed.artifactId!)
  for (let revision = 2; revision <= 6; revision++) assert.equal((await h.service.build({ ...request, revision })).status, 'success')
  assert.ok((await h.service.pdf(h.project.id, displayed.artifactId!)).length)
  h.outputs.push(path.join(h.base, 'displayed.pdf'))
  assert.ok(await h.service.export(h.project.id, displayed.artifactId!, 'pdf'))
})

test('ZIP traversal is rejected before extraction and invalid file creation cannot overwrite sources', async t => {
  const h = await harness(t), zip = new JSZip(), archive = path.join(h.base, 'bad.zip')
  zip.file('../outside.tex', 'bad'); await fs.writeFile(archive, await zip.generateAsync({ type: 'nodebuffer' })); h.picks.push(archive)
  await assert.rejects(() => h.service.open('zip'), /相对路径/)
  await assert.rejects(() => h.service.addFile(h.project.id, 'main.tex'))
  await assert.rejects(() => h.service.addFile(h.project.id, '.latexmkrc'))
  await assert.rejects(() => h.service.addFile(h.project.id, '../outside.tex'))
  assert.match(await fs.readFile(path.join(h.root, 'main.tex'), 'utf8'), /documentclass/)
})

test('built-in templates are real projects with main file, bibliography and safe text interpolation', async t => {
  const h = await harness(t); h.directories.push(h.base)
  const project = (await h.service.create({ name: 'New paper', template: 'chinese', title: 'A%\\input{secret}', author: 'A&B' }))!
  assert.equal(project.trusted, true); assert.equal(project.mainFile, 'main.tex'); assert.equal(project.engine, 'xelatex')
  const main = await h.service.read(project.id, 'main.tex')
  assert.match(main.content, /fontset=fandol/); assert.match(main.content, /A\\%\\textbackslash\{\}input\\\{secret\\\}/)
  assert.ok(project.files.some(file => file.path === 'references.bib'))
  assert.ok(project.files.some(file => file.path === 'sections/introduction.tex'))
})

test('diagnostics preserve file/line and distinguish warnings', () => {
  const items = paperDiagnostics('./sections/chapter.tex:42: Missing $ inserted.\nLaTeX Warning: Reference undefined.', 'main.tex')
  assert.deepEqual(items[0], { severity: 'error', file: 'sections/chapter.tex', line: 42, message: 'Missing $ inserted.' })
  assert.equal(items[1].severity, 'warning')
})

test('concurrent template creation chooses unused names without overwriting an existing project', async t => {
  const h = await harness(t), existing = path.join(h.base, 'New paper')
  await fs.mkdir(existing); await fs.writeFile(path.join(existing, 'main.tex'), 'Existing user content')
  h.directories.push(h.base, h.base)
  const request = { name: 'New paper', template: 'article' as const, title: 'New title', author: '' }
  const projects = await Promise.all([h.service.create(request), h.service.create(request)])
  assert.deepEqual(projects.map(project => project!.name).sort(), ['New paper (2)', 'New paper (3)'])
  assert.equal((await getSettings(path.join(h.base, 'profile'))).projects.length, 3)
  assert.equal(await fs.readFile(path.join(existing, 'main.tex'), 'utf8'), 'Existing user content')
  for (const project of projects) assert.match((await h.service.read(project!.id, 'main.tex')).content, /New title/)
})

test('session reservations cap concurrent creates before directories are written and recover after release', async t => {
  const h = await harness(t), request = { name: 'Capped', template: 'article' as const, title: '', author: '' }
  h.directories.push(...Array<string>(8).fill(h.base))
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => h.service.create(request)))
  const created = outcomes.filter(result => result.status === 'fulfilled').map(result => result.value!)
  assert.equal(created.length, 5)
  for (const outcome of outcomes) if (outcome.status === 'rejected') assert.match(String(outcome.reason), /请先关闭/)
  assert.equal((await fs.readdir(h.base)).filter(name => name.startsWith('Capped')).length, 5)
  await h.service.release(created[0].id)
  h.directories.push(h.base)
  assert.ok(await h.service.create(request))
  await assert.rejects(() => h.service.open('recent'), /请先关闭/)
})

test('an unsuccessful create releases its reservation for the next attempt', async t => {
  const h = await harness(t), request = { name: 'Retry', template: 'article' as const, title: '', author: '' }
  for (let index = 0; index < 6; index++) {
    h.directories.push(path.join(h.base, 'missing-parent'))
    await assert.rejects(() => h.service.create(request), /ENOENT/)
  }
  h.directories.push(h.base)
  assert.ok(await h.service.create(request))
})

test('opening nested TeX and bibliography preserves the authorized project root and explicit main choice', async t => {
  const h = await harness(t), nested = path.join(h.root, 'nested')
  await fs.mkdir(nested)
  await fs.writeFile(path.join(nested, 'first.tex'), '\\documentclass{article}\n\\begin{document}First\\end{document}')
  await fs.writeFile(path.join(nested, 'second.tex'), '\\documentclass{article}\n\\begin{document}Second\\end{document}')
  await fs.writeFile(path.join(nested, 'fragment.tex'), 'x^2')
  const project = await h.service.openDocument(h.root, 'nested/second.tex')
  assert.equal(project.rootLabel, await fs.realpath(h.root))
  assert.equal(project.trusted, false)
  assert.equal(project.mainFile, 'nested/second.tex')
  assert.deepEqual(project.mainCandidates, ['main.tex', 'nested/first.tex', 'nested/second.tex'])
  await assert.rejects(() => h.service.read(project.id, '../main.tex'), /相对路径/)
  const fragment = await h.service.openDocument(h.root, 'nested/fragment.tex')
  assert.equal(fragment.mainFile, null)
  assert.deepEqual(fragment.mainCandidates, ['main.tex', 'nested/first.tex', 'nested/second.tex'])
  await assert.rejects(() => h.service.openDocument(h.root, '../outside.tex'), /相对路径/)
  await fs.writeFile(path.join(nested, 'refs.bib'), '@book{example,title={Book}}')
  const bibliography = await h.service.openDocument(h.root, 'nested/refs.bib')
  assert.equal(bibliography.rootLabel, h.root)
  assert.match((await h.service.read(bibliography.id, 'nested/refs.bib')).content, /Book/)
  await assert.rejects(() => h.service.openDocument(h.root, 'image.png'), /LaTeX 文本/)
})

test('opening a TeX file rejects linked paths outside its authorized root and oversized sources', async t => {
  const h = await harness(t), outside = path.join(h.base, 'outside')
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'main.tex'), '\\documentclass{article}')
  await fs.symlink(outside, path.join(h.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(() => h.service.openDocument(h.root, 'linked/main.tex'), /移出项目|链接/)
  const oversized = path.join(h.root, 'large.tex')
  await fs.writeFile(oversized, ''); await fs.truncate(oversized, 4 * 1024 * 1024 + 1)
  await assert.rejects(() => h.service.openDocument(h.root, 'large.tex'), /4 MiB/)
})

test('Paper uses the system project registry, preserves metadata and resolves only live opaque sessions', async t => {
  const h = await harness(t), profile = path.join(h.base, 'profile')
  let settings = await getSettings(profile)
  assert.equal(settings.projects[0].root, h.root)
  settings.projects[0].syncMode = 'external'
  settings.projects[0].remote = 'https://github.com/example/paper.git'
  await putSettings(profile, settings)
  const reopened = await h.service.open('recent')
  assert.ok(reopened); assert.equal(reopened.trusted, false)
  settings = await getSettings(profile)
  assert.equal(settings.projects.length, 1)
  assert.equal(settings.projects[0].syncMode, 'external')
  assert.equal(settings.projects[0].remote, 'https://github.com/example/paper.git')
  assert.equal(await h.service.projectRoot(reopened.id), h.root)
  await assert.rejects(h.service.projectRoot(h.root), /会话/)
  await h.service.release(reopened.id)
  await assert.rejects(h.service.projectRoot(reopened.id), /会话/)
  await assert.rejects(fs.stat(path.join(profile, 'paper', 'recent.json')), { code: 'ENOENT' })
  const beforeCancel = await getSettings(profile)
  assert.equal(await h.service.open(), null)
  assert.deepEqual(await getSettings(profile), beforeCancel)
  h.directories.push(h.base)
  const created = await h.service.create({ name: 'Registered', template: 'article', title: 'Title', author: '' })
  assert.ok(created)
  assert.equal((await getSettings(profile)).lastProject, created.rootLabel)
})

test('the shared file tree shows Paper resources while only the Paper reader accepts auxiliary text', async t => {
  const h = await harness(t), files = new FileService(h.root, path.join(h.base, 'profile'))
  for (const name of ['refs.bib', 'custom.cls', 'custom.sty', 'custom.bst', 'custom.bbx', 'custom.cbx', 'custom.lbx', 'custom.cfg', 'custom.def', 'custom.clo']) {
    await fs.writeFile(path.join(h.root, name), 'Text source')
    assert.equal(isPaperTextPath(name.toUpperCase()), true)
    assert.equal((await h.service.read(h.project.id, name)).content, 'Text source')
    await assert.rejects(files.read(name), /仅支持/)
  }
  await fs.writeFile(path.join(h.root, 'figure.png'), Buffer.from([0, 1, 2]))
  assert.ok((await files.tree()).some(file => file.path === 'figure.png'))
  await assert.rejects(h.service.read(h.project.id, 'figure.png'), /源文件/)
  await fs.writeFile(path.join(h.root, 'binary.tex'), Buffer.from([0, 1, 2]))
  await assert.rejects(h.service.read(h.project.id, 'binary.tex'), /二进制/)
  assert.equal(isPaperTextPath('figure.png'), false)
})

test('refresh recomputes candidates and clears a missing configured main without silently choosing another', async t => {
  const h = await harness(t)
  await fs.rename(path.join(h.root, 'main.tex'), path.join(h.root, 'renamed.tex'))
  const refreshed = await h.service.refresh(h.project.id)
  assert.equal(refreshed.mainFile, null)
  assert.deepEqual(refreshed.mainCandidates, ['renamed.tex'])
  await h.service.configure(h.project.id, 'renamed.tex', 'xelatex')
  await fs.writeFile(path.join(h.root, 'renamed.tex'), 'Now a fragment')
  assert.deepEqual((await h.service.refresh(h.project.id)).mainCandidates, [])
})

test('moving a directory migrates closed Paper drafts, retains conflicts, and discarded paths cannot escape', async t => {
  const h = await harness(t)
  await fs.mkdir(path.join(h.root, 'sections'))
  await fs.writeFile(path.join(h.root, 'sections', 'one.tex'), 'Disk one')
  await fs.writeFile(path.join(h.root, 'sections', 'refs.bib'), 'Disk bibliography')
  for (const file of ['sections/one.tex', 'sections/refs.bib']) {
    const disk = await h.service.read(h.project.id, file)
    await h.service.draft(h.project.id, { ...disk, content: 'Recovery ' + file })
  }
  await fs.rename(path.join(h.root, 'sections'), path.join(h.root, 'chapters'))
  await h.service.moveDraft(h.project.id, 'sections', 'chapters')
  for (const file of ['chapters/one.tex', 'chapters/refs.bib']) assert.match((await h.service.read(h.project.id, file)).draft!.content, /^Recovery sections\//)
  await h.service.discardDraft(h.project.id, 'chapters/refs.bib')
  assert.equal((await h.service.read(h.project.id, 'chapters/refs.bib')).draft, undefined)
  await assert.rejects(h.service.discardDraft(h.project.id, '../outside.tex'), /相对路径/)
  await assert.rejects(h.service.moveDraft(h.project.id, 'chapters', '../outside'), /路径无效/)
  const original = await h.service.read(h.project.id, 'section.tex')
  await h.service.draft(h.project.id, { ...original, content: 'Original recovery' })
  await assert.rejects(h.service.moveDraft(h.project.id, 'section.tex', 'chapters/one.tex'), /不同论文恢复记录/)
  assert.equal((await h.service.read(h.project.id, 'section.tex')).draft!.content, 'Original recovery')
  assert.match((await h.service.read(h.project.id, 'chapters/one.tex')).draft!.content, /Recovery/)
})

test('system moves preflight closed-session recoveries before disk mutation, and failed migration retains the complete old draft', async t => {
  const h = await harness(t), disk = await h.service.read(h.project.id, 'section.tex')
  await h.service.draft(h.project.id, { ...disk, content: 'Closed session recovery' })
  await h.service.release(h.project.id)
  const move = await h.service.prepareDraftMove(h.root, 'section.tex', 'renamed.tex')
  await fs.rename(path.join(h.root, 'section.tex'), path.join(h.root, 'renamed.tex'))
  t.mock.method(fs, 'link', async () => { throw Object.assign(new Error('Recovery disk blocked'), { code: 'EACCES' }) })
  await assert.rejects(move.finish(), /Recovery disk blocked/)
  t.mock.restoreAll()
  assert.equal(await fs.readFile(path.join(h.root, 'renamed.tex'), 'utf8'), disk.content)
  await move.finish()
  const reopened = await h.service.openDocument(h.root, 'renamed.tex')
  assert.equal((await h.service.read(reopened.id, 'renamed.tex')).draft!.content, 'Closed session recovery')
  await h.service.moveDraft(reopened.id, 'section.tex', 'renamed.tex')
  assert.equal((await h.service.read(reopened.id, 'renamed.tex')).draft!.content, 'Closed session recovery')
  await fs.writeFile(path.join(h.root, 'target.tex'), 'Target disk')
  const target = await h.service.read(reopened.id, 'target.tex')
  await h.service.draft(reopened.id, { ...target, content: 'Target recovery' })
  await assert.rejects(h.service.prepareDraftMove(h.root, 'renamed.tex', 'target.tex'), /不同论文恢复记录/)
  assert.equal(await fs.readFile(path.join(h.root, 'renamed.tex'), 'utf8'), disk.content)
  await fs.writeFile(path.join(h.root, '.hidden.md'), 'Ordinary Markdown')
  await (await h.service.prepareDraftMove(h.root, '.hidden.md', '.renamed.md')).finish()
  await h.service.assertRemovalSafe(h.root, '.hidden.md')
})

test('removal refuses closed dirty Paper drafts but accepts a draft identical to disk', async t => {
  const h = await harness(t), disk = await h.service.read(h.project.id, 'section.tex')
  await h.service.draft(h.project.id, { ...disk, content: 'Unsaved closed document' })
  await h.service.release(h.project.id)
  await assert.rejects(h.service.assertRemovalSafe(h.root, 'section.tex'), /未保存.*恢复草稿/)
  const reopened = (await h.service.open('recent'))!
  await h.service.draft(reopened.id, disk)
  const removal = await h.service.assertRemovalSafe(h.root, 'section.tex')
  assert.equal(await fs.readFile(path.join(h.root, 'section.tex'), 'utf8'), disk.content)
  await fs.rm(path.join(h.root, 'section.tex')); await removal.finish()
  await fs.writeFile(path.join(h.root, 'section.tex'), 'Different newly created file')
  assert.equal((await h.service.read(reopened.id, 'section.tex')).draft, undefined)
})

test('project relocation copies Paper drafts and main configuration, retains backups, and rejects conflicting targets', async t => {
  const h = await harness(t), profile = path.join(h.base, 'profile'), disk = await h.service.read(h.project.id, 'section.tex')
  await h.service.configure(h.project.id, 'main.tex', 'pdflatex')
  await h.service.draft(h.project.id, { ...disk, content: 'First edit' })
  const target = path.join(h.base, 'relocated')
  await fs.rename(h.root, target)
  await h.service.draft(h.project.id, { ...disk, content: 'Latest edit after root moved' })
  await h.service.migrateProjectData(h.root, target)
  await h.service.migrateProjectData(h.root, target)
  await h.service.releaseRoot(h.root)
  await assert.rejects(h.service.read(h.project.id, 'section.tex'), /会话/)
  const reopened = await h.service.openDocument(target, 'section.tex')
  assert.equal(reopened.engine, 'pdflatex'); assert.equal(reopened.mainFile, 'main.tex')
  assert.equal((await h.service.read(reopened.id, 'section.tex')).draft!.content, 'Latest edit after root moved')
  const digest = (value: string) => createHash('sha256').update(value).digest('hex')
  const oldDraft = path.join(profile, 'paper', 'drafts', digest(h.root), digest('section.tex') + '.json')
  assert.match(await fs.readFile(oldDraft, 'utf8'), /Latest edit after root moved/)
  await h.service.draft(reopened.id, { ...disk, content: 'Different destination recovery' })
  await assert.rejects(h.service.migrateProjectData(h.root, target), /不同论文恢复记录/)
  assert.equal((await h.service.read(reopened.id, 'section.tex')).draft!.content, 'Different destination recovery')
  assert.match(await fs.readFile(oldDraft, 'utf8'), /Latest edit after root moved/)
})

test('Paper recovery migration rejects storage links and target directory escapes without changing the source', async t => {
  const h = await harness(t), disk = await h.service.read(h.project.id, 'section.tex')
  await h.service.draft(h.project.id, { ...disk, content: 'Keep recovery' })
  const target = path.join(h.base, 'target'), outside = path.join(h.base, 'outside')
  await fs.mkdir(target); await fs.mkdir(outside)
  const digest = (value: string) => createHash('sha256').update(value).digest('hex')
  const destination = path.join(h.base, 'profile', 'paper', 'drafts', digest(target))
  await fs.symlink(outside, destination, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(h.service.migrateProjectData(h.root, target), /设备数据目录之外/)
  assert.deepEqual(await fs.readdir(outside), [])
  assert.equal((await h.service.read(h.project.id, 'section.tex')).draft!.content, 'Keep recovery')
})
