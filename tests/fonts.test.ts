import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fontOptions } from '../src/main/fonts'
import { getSettings, putSettings } from '../src/main/files'
import { defaultSettings, fontFamilies, type Settings } from '../src/shared/types'

test('font availability matches exact installed families, preserving separate GB2312 options', () => {
  const fonts = fontOptions(['FangSong (TrueType)', 'KaiTi (TrueType)', 'Microsoft YaHei & Microsoft YaHei UI (TrueType)', 'Unknown font'])
  assert.deepEqual(fonts.filter(font => font.available).map(font => font.id), ['system', 'fangsong', 'kaiti', 'microsoft-yahei'])
  assert.ok(fonts.filter(font => !font.available).every(font => font.source === 'fallback'))
  const legacy = fontOptions(['仿宋_GB2312 (TrueType)', '楷体_GB2312 (TrueType)', 'Alibaba PuHuiTi 3.0 (OpenType)'])
  assert.deepEqual(legacy.filter(font => font.available).map(font => font.id), ['system', 'fangsong-gb2312', 'kaiti-gb2312', 'alibaba-puhuiti'])
  assert.deepEqual(fontOptions([]).filter(font => font.available).map(font => font.id), ['system'])
})

test('font settings migrate old profiles, persist all supported choices and reject arbitrary CSS', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'oopsmd-fonts-'))
  try {
    const { fontFamily: _fontFamily, ...old } = defaultSettings
    await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify(old))
    assert.equal((await getSettings(userData)).fontFamily, 'system')
    for (const fontFamily of fontFamilies) {
      await putSettings(userData, { ...defaultSettings, fontFamily })
      assert.equal((await getSettings(userData)).fontFamily, fontFamily)
    }
    for (const fontFamily of ['Arial', 'url(https://example.invalid/font)', '', null, 2]) {
      await assert.rejects(putSettings(userData, { ...defaultSettings, fontFamily } as Settings), /设置值无效/)
    }
    assert.equal((await getSettings(userData)).fontFamily, 'alibaba-puhuiti')
  } finally { await fs.rm(userData, { recursive: true, force: true }) }
})
