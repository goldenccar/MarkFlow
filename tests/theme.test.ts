import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { defaultSettings, type ThemePreference } from '../src/shared/types'
import { isThemePreference, resolveTheme } from '../src/shared/theme'
import { getSettings, putSettings } from '../src/main/files'
import { windowPalette } from '../src/main/windowTheme'

test('system appearance is resolved at display time while explicit choices ignore the OS', () => {
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('system', true), 'dark')
  for (const preference of ['light', 'dark'] as const) {
    assert.equal(resolveTheme(preference, false), preference)
    assert.equal(resolveTheme(preference, true), preference)
  }
  for (const value of ['system', 'light', 'dark']) assert.equal(isThemePreference(value), true)
  for (const value of [undefined, null, 'auto', '', 0, {}, true]) assert.equal(isThemePreference(value), false)
})

test('native palettes follow system changes for both modules without replacing the saved preference', () => {
  for (const mode of ['markdown', 'latex-math'] as const) {
    const appearance = { theme: 'system', mode } as const
    assert.deepEqual(windowPalette(appearance, false), windowPalette({ theme: 'light', mode }, true))
    assert.deepEqual(windowPalette(appearance, true), windowPalette({ theme: 'dark', mode }, false))
    assert.notDeepEqual(windowPalette(appearance, false), windowPalette(appearance, true))
    assert.equal(appearance.theme, 'system')
  }
})

test('new installations and legacy settings without a theme default to system', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oops-theme-default-'))
  try {
    assert.equal(defaultSettings.theme, 'system')
    assert.equal((await getSettings(directory)).theme, 'system')
    await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ threshold: 777, fontSize: 18 }))
    const migrated = await getSettings(directory)
    assert.equal(migrated.theme, 'system')
    assert.equal(migrated.threshold, 777)
    assert.equal(migrated.fontSize, 18)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('existing explicit choices and system preference survive settings reads and writes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oops-theme-persist-'))
  try {
    for (const theme of ['light', 'dark', 'system'] satisfies ThemePreference[]) {
      await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ ...defaultSettings, theme, fontSize: 22 }))
      const saved = await getSettings(directory)
      assert.equal(saved.theme, theme)
      await putSettings(directory, { ...saved, threshold: 777 })
      assert.equal((await getSettings(directory)).theme, theme)
      const raw = JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8'))
      assert.equal(raw.theme, theme)
      assert.equal(raw.fontSize, 22)
      resolveTheme(theme, true); resolveTheme(theme, false)
      assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).theme, theme)
    }
    await assert.rejects(putSettings(directory, { ...defaultSettings, theme: 'auto' as ThemePreference }), /设置值无效/)
    assert.equal((await getSettings(directory)).theme, 'system')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
