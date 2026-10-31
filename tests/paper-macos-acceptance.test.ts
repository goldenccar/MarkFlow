import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('macOS acceptance exposes its required packaged application without starting a test', () => {
  const result = spawnSync(process.execPath, ['scripts/paper-macos-acceptance.mjs', '--help'], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /--app .*MarkFlow\.app/)
  assert.doesNotMatch(result.stdout, /native-and-packaged-desktop-passed/)
})

test('macOS acceptance cannot report success on another operating system', { skip: process.platform === 'darwin' }, () => {
  const result = spawnSync(process.execPath, ['scripts/paper-macos-acceptance.mjs', '--app', 'unavailable.app'], { encoding: 'utf8', timeout: 5000 })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /macOS acceptance requires a real Mac/)
  assert.doesNotMatch(result.stdout, /native-and-packaged-desktop-passed/)
})
