import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { blockBreak, parseBlocks } from '../src/shared/blocks'

const apply = (source: string, from: number, to = from, soft = false) => {
  const edit = blockBreak(source, from, to, soft)
  return source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
}

describe('raw Markdown blocks', () => {
  it('keeps offsets and complete structured blocks without reserializing syntax', () => {
    const source = '\n\n# 标题\n\n```js\nconst value = "# literal"\n```\n\n- [x] one\n- two\n\n> quote\n> line\n\n$$\nx^2\n$$\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n'
    const blocks = parseBlocks(source)
    assert.deepEqual(blocks.map(block => block.type), ['heading', 'code', 'listItem', 'listItem', 'blockquote', 'math', 'table', 'empty'])
    for (const block of blocks) assert.equal(block.raw, source.slice(block.from, block.to))
    assert.equal(blocks[0].from, 2)
    assert.equal(blocks[0].label, '标题')
    assert.equal(blocks[0].level, 1)
    assert.ok(blocks[1].raw.includes('# literal'))
    assert.equal(blocks.at(-1)!.to, source.length)
    assert.equal(blocks.at(-1)!.raw, '')
    assert.equal(new Set(blocks.map(block => block.id)).size, blocks.length)
  })
  it('does not turn blank lines into content or lose CRLF source offsets', () => {
    assert.deepEqual(parseBlocks(' \n\n').map(block => [block.type, block.from, block.to]), [['empty', 3, 3]])
    const source = '\r\n# A\r\n\r\ntext  \r\nline\r\n\r\n'
    for (const block of parseBlocks(source)) assert.equal(block.raw, source.slice(block.from, block.to))
    assert.equal(apply(source, source.indexOf('text') + 4), source.replace('text', 'text\r\n\r\n'))
  })
  it('provides an immediate empty tree node and independent top-level list items', () => {
    assert.equal(parseBlocks('')[0].type, 'empty')
    assert.deepEqual(parseBlocks('paragraph\n\n').map(block => block.type), ['paragraph', 'empty'])
    const list = parseBlocks('- first\n  - nested\n- second\n- ')
    assert.deepEqual(list.map(block => block.type), ['listItem', 'listItem', 'listItem'])
    assert.equal(list[0].raw, '- first\n  - nested')
    assert.equal(list[2].label, '列表项')
  })
})

describe('live block breaks', () => {
  it('Enter splits ordinary text into blocks while Shift+Enter is a visible same-block hard break', () => {
    assert.equal(apply('hello world', 5), 'hello\n\n world')
    const hardBreak = apply('hello world', 5, 5, true)
    assert.equal(hardBreak, 'hello  \n world')
    assert.equal(parseBlocks(hardBreak).length, 1)
    assert.equal(parseBlocks(apply('hello world', 5)).length, 2)
  })
  it('replaces selected text only and preserves surrounding blank lines', () => {
    const source = '\n\nalpha OLD omega\n\n\nlast\n\n'
    assert.equal(apply(source, 8, 11), '\n\nalpha \n\n omega\n\n\nlast\n\n')
    assert.equal(apply('', 0), '\n\n')
    assert.equal(apply('abc', 3), 'abc\n\n')
  })
  it('preserves literal code and math newlines; Enter after the closing fence starts a block', () => {
    for (const source of ['```js\nalpha\n```', '$$\nalpha\n$$']) {
      const at = source.indexOf('alpha') + 3
      assert.equal(apply(source, at), source.slice(0, at) + '\n' + source.slice(at))
      assert.equal(apply(source, at, at, true), source.slice(0, at) + '\n' + source.slice(at))
      assert.equal(apply(source, source.length), source + '\n\n')
    }
  })
  it('continues list items, resets checkboxes, exits empty items and retains hard-break indentation', () => {
    assert.equal(apply('- one', 5), '- one\n- ')
    assert.equal(apply('3. one', 6), '3. one\n4. ')
    assert.equal(apply('- [x] one', 9), '- [x] one\n- [ ] ')
    assert.equal(apply('- one\n- ', 8), '- one\n\n')
    assert.equal(apply('- one', 5, 5, true), '- one  \n  ')
  })
  it('splits quotes and keeps Shift+Enter inside the quoted block', () => {
    assert.equal(apply('> one', 5), '> one\n\n> ')
    assert.equal(apply('> one', 5, 5, true), '> one  \n> ')
  })
})
