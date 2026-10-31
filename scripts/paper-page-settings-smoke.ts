import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PaperService } from '../src/main/paperService'
import { controlledTeXEnvironment, inspectPaperRuntime } from '../src/main/paperRuntime'
import { applyPaperPageSettings, defaultPaperPageSettings } from '../src/shared/paperPageSettings'

const base = await fs.mkdtemp(path.resolve('.test-data/paper-page-settings-'))
const projects = path.join(base, 'projects'); await fs.mkdir(projects)
// Use the repository fixture to exercise the actual image decoder and asset path handling.
const logo = path.join(base, 'test-logo.png')
await fs.copyFile(path.resolve('examples/compiler/assets/test-blocks.png'), logo)
const runtime = await inspectPaperRuntime()
assert.ok(runtime.available, runtime.message)
const service = new PaperService({ userData: path.join(base, 'profile'), chooseDirectory: async () => projects, chooseFile: async () => logo, chooseOutput: async () => null, runtime: async () => runtime, environment: controlledTeXEnvironment })
try {
  const project = await service.create({ template: 'chinese', name: 'page-settings', title: '中文页面设置与自适应页眉验证', author: 'MarkFlow' }); assert.ok(project)
  const asset = await service.importAsset(project.id); assert.ok(asset)
  const main = await service.read(project.id, 'main.tex'), settings = defaultPaperPageSettings()
  settings.paper = 'a5'; settings.orientation = 'landscape'; settings.margins = { top: 18, bottom: 18, left: 20, right: 20 }
  settings.header.left = '长页眉自动换行测试。'.repeat(3); settings.header.right = '{title}'
  settings.footer.center = '第 {page} 页 / 共 {pages} 页'; settings.pageNumber = 'none'
  settings.logo = { path: asset.path, position: 'center', widthMm: 20 }; settings.headerRule = true; settings.hideFirstPage = true
  const content = applyPaperPageSettings(main.content, settings)
  await fs.writeFile(path.join(base, 'configured-main.tex'), content)
  const result = await service.build({ projectId: project.id, mainFile: 'main.tex', engine: project.engine, buffers: [{ ...main, content }], revision: 1 })
  await fs.writeFile(path.join(base, 'compile.log'), result.log)
  assert.equal(result.status, 'success', JSON.stringify(result.diagnostics)); assert.ok(result.artifactId)
  assert.ok(!result.log.includes('headheight is too small'), 'Long headers must reserve sufficient vertical space.')
  assert.equal((await service.read(project.id, 'main.tex')).content, main.content, 'Configuration must remain an unsaved editor change.')
  const pdf = await service.pdf(project.id, result.artifactId); await fs.writeFile(path.join(base, 'configured.pdf'), pdf)
  const loading = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, cMapUrl: path.resolve('node_modules/pdfjs-dist/cmaps').replaceAll('\\', '/') + '/', cMapPacked: true, standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' })
  try {
    const document = await loading.promise; assert.ok(document.numPages >= 2)
    const texts: string[] = []
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n), [,, width, height] = page.view
      assert.ok(Math.abs(width - 595.28) < 1 && Math.abs(height - 419.53) < 1, `Wrong page size ${width} × ${height}`)
      texts.push((await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(''))
    }
    assert.ok(!texts[0].includes('长页眉自动换行测试'), 'First-page header must be hidden.')
    assert.ok(texts.slice(1).some(text => text.includes('长页眉自动换行测试')), 'Following pages must render the real header.')
    await fs.writeFile(path.join(base, 'pdf-text.json'), JSON.stringify(texts, null, 2))
    assert.ok(texts.slice(1).some(text => text.replace(/\s/g, '').includes(`共${document.numPages}页`)), 'Total-page references must resolve.')
    console.log(JSON.stringify({ base, status: result.status, pages: document.numPages, durationMs: result.durationMs, diagnostics: result.diagnostics }, null, 2))
  } finally { await loading.destroy() }
  // Empty headers and the two-column template must also compile without height warnings.
  for (const template of ['article', 'twocolumn'] as const) {
    const extra = await service.create({ template, name: `default-${template}`, title: 'Default page settings', author: 'Author' }); assert.ok(extra)
    const original = await service.read(extra.id, 'main.tex'), defaults = defaultPaperPageSettings()
    defaults.columns = template === 'twocolumn' ? 2 : 1
    const compiled = await service.build({ projectId: extra.id, mainFile: 'main.tex', engine: extra.engine, buffers: [{ ...original, content: applyPaperPageSettings(original.content, defaults) }], revision: 1 })
    await fs.writeFile(path.join(base, `${template}.log`), compiled.log)
    assert.equal(compiled.status, 'success', JSON.stringify(compiled.diagnostics))
    assert.ok(!compiled.log.includes('headheight is too small'), 'Empty headers must not produce height warnings.')
    console.log(JSON.stringify({ template, status: compiled.status, durationMs: compiled.durationMs, diagnostics: compiled.diagnostics }))
  }
} finally { service.dispose() }
