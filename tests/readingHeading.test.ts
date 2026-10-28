import test from 'node:test'
import assert from 'node:assert/strict'
import { readingHeadingAt } from '../src/renderer/readingHeadingModel'

const offsets = [{ id: 'first', top: 80 }, { id: 'nested', top: 350 }, { id: 'last', top: 850 }]
const viewport = { anchor: 32, maxScroll: 1000 }
test('reading highlight follows section boundaries and stays empty before the first title', () => {
  assert.equal(readingHeadingAt(offsets, 0, viewport), undefined)
  assert.equal(readingHeadingAt(offsets, 48, viewport), 'first')
  assert.equal(readingHeadingAt(offsets, 317, viewport), 'first')
  assert.equal(readingHeadingAt(offsets, 318, viewport), 'nested')
  assert.equal(readingHeadingAt(offsets, 818, viewport), 'last')
})
test('the bottom of a scrollable page selects its final section even when it cannot reach the top', () => {
  assert.equal(readingHeadingAt(offsets, 600, { anchor: 32, maxScroll: 600 }), 'last')
  assert.equal(readingHeadingAt(offsets, 0, { anchor: 32, maxScroll: 0 }), undefined)
  assert.equal(readingHeadingAt([], 100, viewport), undefined)
  assert.equal(readingHeadingAt(offsets, -20, viewport), undefined)
})
test('long reading outlines need a bounded number of offset reads per scroll', () => {
  const values = Array.from({ length: 10000 }, (_, index) => ({ id: String(index), top: index * 100 }))
  let reads = 0
  const tracked = new Proxy(values, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver) } })
  assert.equal(readingHeadingAt(tracked, 500068, { anchor: 32, maxScroll: 1000000 }), '5001')
  assert.ok(reads < 20, `${reads} offset reads for one scroll`)
})
