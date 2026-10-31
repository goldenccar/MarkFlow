import test from 'node:test'
import assert from 'node:assert/strict'
import { dirtyProjectPaths, isExternalShare, remoteSummary } from '../src/renderer/projectState'
import type { DocumentTab } from '../src/renderer/tabs'
import type { GitStatus } from '../src/shared/types'

const tab = (id: string, root: string, dirty = false): DocumentTab => ({ id, root, path: `${id}.md`, title: id, mode: 'markdown', pinned: false, dirty })
const buffer = (id: string, root: string, dirty = false) => ({ tabId: id, root, file: { path: `${id}.md` }, content: dirty ? 'new' : 'old', cleanContent: 'old' })

test('disk-changing project actions include inactive, closed cached and unrestored dirty tabs', () => {
  const current = buffer('active', 'A')
  const buffers = new Map([['active', current], ['inactive', buffer('inactive', 'A', true)], ['closed', buffer('closed', 'A', true)], ['other', buffer('other', 'B', true)]])
  const tabs = [tab('active', 'A'), tab('inactive', 'A'), tab('unrestored', 'A', true), tab('other', 'B', true)]
  assert.deepEqual(dirtyProjectPaths('A', tabs, buffers, current), ['inactive.md', 'unrestored.md', 'closed.md'])
})

test('loaded content overrides a stale dirty flag and independent drafts do not block unrelated project updates', () => {
  const saved = buffer('saved', 'A')
  const draft = { ...buffer('scratch', 'A', true), untitledId: 'draft-id' }
  assert.deepEqual(dirtyProjectPaths('A', [tab('saved', 'A', true), { ...tab('scratch', 'A', true), untitledId: 'draft-id' }], new Map([['saved', saved], ['scratch', draft]]), draft), [])
  assert.deepEqual(dirtyProjectPaths('A', [], new Map(), buffer('current', 'A', true)), ['current.md'])
})

test('remote state never presents cached counts as fresh after an unchecked or failed fetch', () => {
  const stale = { repository: true, ahead: 8, behind: 9, remoteState: 'unchecked' } as GitStatus
  assert.equal(remoteSummary(stale), '远端状态待检查')
  assert.equal(remoteSummary({ ...stale, remoteState: 'unavailable' }), '远端检查失败 · 本地可用')
  assert.equal(remoteSummary({ ...stale, remoteState: 'missing-branch' }), '远端分支不存在')
  assert.equal(remoteSummary({ ...stale, remoteState: 'behind' }), '有 9 个远端版本可更新')
})

test('external share guidance accepts actual provider domains, not lookalikes', () => {
  assert.equal(isExternalShare('https://www.jianguoyun.com/p/example'), true)
  assert.equal(isExternalShare('https://nutstore.net/example'), true)
  assert.equal(isExternalShare('https://jianguoyun.com.evil.invalid/p/example'), false)
  assert.equal(isExternalShare('https://github.com/owner/repo'), false)
  assert.equal(isExternalShare('not a URL'), false)
})
