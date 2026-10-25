import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { changeCount, shouldAutoCommit } from '../src/shared/changes'

describe('net grapheme changes', () => {
  it('counts the documented separated addition, deletion and replacement as 230', () => {
    const baseline = `start\n${'删'.repeat(30)}\nkeep\n${'甲'.repeat(80)}\nend`
    const current = `${'增'.repeat(120)}start\n\nkeep\n${'乙'.repeat(80)}\nend`
    assert.equal(changeCount(baseline, current), 230)
  })
  it('counts additions, deletions and the larger side of adjacent replacements', () => {
    assert.equal(changeCount('', '你好 ab\n'), 6)
    assert.equal(changeCount('abcd', ''), 4)
    assert.equal(changeCount('aQQQb', 'aWWb'), 3)
    assert.equal(changeCount('aQQb', 'aWWWWWb'), 5)
    assert.equal(changeCount('abc', 'XYZ'), 3)
  })
  it('counts zero after undo and never mutates line endings', () => {
    const source = '甲\r\n乙\r丙\n'
    assert.equal(changeCount(source, source), 0)
    assert.equal(changeCount(source, '甲\n乙\n丙\n'), 0)
    assert.equal(source, '甲\r\n乙\r丙\n')
  })
  it('uses visible graphemes for emoji, flags and combining marks', () => {
    assert.equal(changeCount('', '👨‍👩‍👧‍👦🇨🇳e\u0301👍🏽'), 4)
    assert.equal(changeCount('e\u0301', 'a\u0301'), 1)
  })
  it('uses unchanged text to separate replacement runs', () => {
    assert.equal(changeCount('aXXbYYc', 'aQbRRRc'), 5)
    // Equal edges are pinned before Myers matching, including repeated characters.
    assert.equal(changeCount('aa', 'ba'), 1)
    assert.equal(changeCount('aa', 'bba'), 2)
  })
  it('handles large pastes, deletions and disjoint replacements without a quadratic diff', () => {
    const size = 100_000
    const before = 'ab'.repeat(size / 2)
    const after = 'cd'.repeat(size / 2)
    assert.equal(changeCount(before, after, { timeout: 10 }), size)
    assert.equal(changeCount('prefix' + before + 'suffix', 'prefix' + after + 'suffix', { timeout: 10 }), size)
    assert.equal(changeCount(before, before + after, { timeout: 10 }), size)
    assert.equal(changeCount(before, '', { timeout: 10 }), size)
  })
  it('can stop an expensive exact diff without returning an approximate count', () => {
    assert.throws(() => changeCount('ab'.repeat(10_000), 'bc'.repeat(10_000), { timeout: 1 }), /处理时限/)
  })
})

describe('auto commit threshold', () => {
  it('returns one decision for the captured snapshot at 499, 500 and 1200', () => {
    assert.equal(shouldAutoCommit(499, 500, false, true), false)
    assert.equal(shouldAutoCommit(500, 500, false, true), true)
    assert.equal(shouldAutoCommit(1200, 500, false, true), true)
  })
  it('waits for composition and respects settings changes or disabled recording', () => {
    assert.equal(shouldAutoCommit(500, 500, true, true), false)
    assert.equal(shouldAutoCommit(500, 500, false, false), false)
    assert.equal(shouldAutoCommit(500, 501, false, true), false)
    assert.equal(shouldAutoCommit(499, 200, false, true), true)
    for (const invalid of [0, -1, 1.5, NaN, Infinity]) assert.equal(shouldAutoCommit(500, invalid, false, true), false)
  })
})
