import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { controlledTeXEnvironment, inspectPaperRuntime, type PaperRuntime } from '../src/main/paperRuntime'

test('missing explicit TeX runtime does not fall through to a system PATH executable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'markflow-runtime-'))
  try {
    const result = await inspectPaperRuntime({ root: directory })
    assert.equal(result.available, false)
    assert.deepEqual(result.engines, {})
    assert.equal(result.root, directory)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('compiler environment uses managed tools and local caches without inheriting credentials', () => {
  const runtime: PaperRuntime = { available: true, root: path.resolve('vendor/tex/TinyTeX'), binDir: path.resolve('vendor/tex/TinyTeX/bin/windows'), latexmk: '', engines: {}, biberCacheKey: 'test-runtime-1' }
  const build = path.resolve('.test-data/paper-build')
  const previous = process.env.MARKFLOW_TEST_SECRET
  process.env.MARKFLOW_TEST_SECRET = 'must-not-inherit'
  try {
    const env = controlledTeXEnvironment(runtime, build)
    assert.equal(env.MARKFLOW_TEST_SECRET, undefined)
    assert.equal(env.NODE_OPTIONS, undefined)
    assert.equal(env.TEXMFOUTPUT, build)
    assert.equal(env.TEXMF_OUTPUT_DIRECTORY, build)
    assert.equal(env.shell_escape, 'f')
    assert.equal(env.openout_any, 'p')
    assert.equal(env.PATH?.split(path.delimiter)[0], runtime.binDir)
    assert.equal(env.HOME, path.join(build, '.runtime'))
    assert.equal(env.USERPROFILE, path.join(build, '.runtime'))
    if (process.platform === 'win32') {
      assert.equal(env.PAR_GLOBAL_TEMP, path.join(os.tmpdir(), 'mf-biber-test-runtime-1'))
      assert.ok(!env.PAR_GLOBAL_TEMP?.includes(build))
    }
  } finally {
    if (previous === undefined) delete process.env.MARKFLOW_TEST_SECRET
    else process.env.MARKFLOW_TEST_SECRET = previous
  }
})
