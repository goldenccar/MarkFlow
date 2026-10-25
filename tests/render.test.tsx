import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { Preview } from '../src/renderer/Preview'
import { assetUrl, getHeadings, resolveLink } from '../src/renderer/markdown'
import { ensureMarkDocument, parseMarks, setMarkStyle } from '../src/shared/marks'

function render(content: string, mode: 'markdown' | 'latex-math' = 'markdown') {
  return renderToStaticMarkup(<Preview content={content} mode={mode} path="笔记/当前 文档.md" onNavigate={() => {}} onExternal={() => {}} />)
}

describe('Markdown and math rendering', () => {
  it('supports GFM, code and math without parsing code examples as math', () => {
    const result = render('| A | B |\n| - | - |\n| 1 | 2 |\n\n~~old~~ $x^2$\n\n```js\nconst x = "$x$"\n```')
    assert.ok(result.includes('table-scroll'))
    assert.ok(result.includes('<del>old</del>'))
    assert.ok(result.includes('katex'))
    assert.ok(result.includes('hljs-keyword'))
    assert.ok(result.includes('$x$'))
    assert.ok(result.includes('复制代码'))
  })
  it('renders only the selected Mark font and size, and never exposes its metadata', () => {
    const body = 'First\n\nSecond\n\n- one\n- two'
    const content = setMarkStyle(setMarkStyle(body, 0, { fontFamily: 'fangsong', fontSize: 24 }), body.indexOf('- two'), { fontSize: 20 })
    const result = render(content)
    assert.match(result, /<p style="[^"]*font-family:[^"]*FangSong[^>]*font-size:24px[^>]*>First<\/p>/)
    assert.match(result, /<p data-mark-id="[^"]+">Second<\/p>/)
    assert.match(result, /<li style="font-size:20px;?"[^>]*>two<\/li>/)
    assert.ok(!result.includes('oops:marks')); assert.ok(!result.includes('bodyHash'))
  })
  it('renders stable identities for unstyled headings, paragraphs, list items, code, tables and formulas', () => {
    const content = ensureMarkDocument('# Heading\n\nFirst\n\nSecond\n\n- item\n- [x] done\n\n```js\nconst n = 1\n```\n\n| A |\n| - |\n| B |\n\n$$\nx^2\n$$\n\n```math\ny^2\n```')
    const result = render(content), marks = parseMarks(content)
    const rendered = [...result.matchAll(/data-mark-id="([^"]+)"/g)].map(match => match[1])
    assert.deepEqual(rendered, marks.map(mark => mark.id))
    assert.ok(result.includes('katex')); assert.ok(result.includes('复制代码'))
  })
  it('preserves formula Mark typography when KaTeX replaces its rendering nodes', () => {
    const content = setMarkStyle('$$\nx^2\n$$', 0, { fontFamily: 'fangsong', fontSize: 24 }), id = parseMarks(content)[0].id
    const result = render(content)
    assert.match(result, new RegExp(`<div[^>]*data-mark-id="${id}"[^>]*style="[^\"]*font-size:24px;?"`))
    assert.ok(result.includes('katex')); assert.ok(result.includes('FangSong'))
  })
  it('excludes Mark metadata when switching a styled formula into Geek mode', () => {
    const source = setMarkStyle('x^2 + y^2', 0, { fontSize: 24 })
    assert.equal(render(source, 'latex-math'), render('x^2 + y^2', 'latex-math'))
    assert.ok(!render(source, 'latex-math').includes('公式尚不能渲染'))
  })
  it('uses the same unique anchors for outline and rendered headings and ignores code headings', () => {
    const content = '# 中文 *标题*\n\n```md\n# not a heading\n```\n\n## 中文 标题\n\n中文 标题\n------\n\n# 中文 标题-1'
    const headings = getHeadings(content)
    assert.deepEqual(headings.map(item => item.id), ['中文-标题', '中文-标题-1', '中文-标题-2', '中文-标题-1-1'])
    assert.deepEqual(headings.map(item => item.line), [1, 7, 9, 12])
    const result = render(content)
    for (const heading of headings) assert.ok(result.includes(`id="${heading.id}"`))
  })
  it('never executes HTML or allows script links and remote images', () => {
    const result = render('<script>alert(1)</script>\n\n[run](javascript:alert%281%29)\n\n![remote](https://example.com/track.png)\n\n<img src=x onerror=alert(1)>')
    assert.ok(!result.includes('<script'))
    assert.ok(!result.includes('javascript:'))
    assert.ok(!result.includes('src="https://'))
    assert.ok(!result.includes('onerror'))
  })
  it('renders only attribute-free formatting tags while rejecting arbitrary HTML', () => {
    const result = render('<u>under</u> <sup>2</sup> <sub>x</sub> <mark>marked</mark> <u onclick="alert(1)">unsafe</u> <script>bad</script>')
    for (const tag of ['<u>under</u>', '<sup>2</sup>', '<sub>x</sub>', '<mark>marked</mark>']) assert.ok(result.includes(tag), result)
    assert.ok(!result.includes('onclick')); assert.ok(!result.includes('<script>')); assert.ok(!result.includes('<u>unsafe'))
  })
  it('renders local Chinese and space image paths through the scoped asset protocol', () => {
    assert.ok(render('![图](../附件/样例%20图.png)').includes(assetUrl('附件/样例 图.png')))
  })
  it('does not resolve untitled document images against a previously active project', () => {
    const result = renderToStaticMarkup(<Preview content="![图](secret.png)" mode="markdown" path="未命名.md" localFiles={false} onNavigate={() => {}} onExternal={() => {}} />)
    assert.ok(!result.includes('<img'))
    assert.ok(!result.includes('oops-asset:'))
  })
  it('shows invalid formulas without losing the source and isolates macros per render', () => {
    const broken = '\\frac{a}'
    const result = render(broken, 'latex-math')
    assert.ok(result.includes('公式尚不能渲染'))
    assert.ok(result.includes(broken))
    assert.ok(!render('\\gdef\\abc{123}\\abc', 'latex-math').includes('公式尚不能渲染'))
    assert.ok(render('\\abc', 'latex-math').includes('公式尚不能渲染'))
    assert.ok(!render('$\\gdef\\abc{123}$ $\\abc$').includes('katex-error'))
    assert.ok(render('$\\abc$').includes('color:#bf3434'))
    assert.ok(render('$\\frac{a}$').includes('katex-error'))
  })
})

describe('relative links', () => {
  it('normalizes relative paths, spaces, Chinese and encoded anchors', () => {
    assert.deepEqual(resolveLink('../图/文件%20名.md#标题%201', '笔记/当前.md'), { kind: 'local', path: '图/文件 名.md', anchor: '标题 1' })
    assert.deepEqual(resolveLink('#title', '当前.md'), { kind: 'local', path: '当前.md', anchor: 'title' })
  })
  it('rejects path escapes, absolute paths, alternate streams and dangerous protocols', () => {
    for (const value of ['../../outside.md', '/outside', '\\\\server\\file', 'file:///C:/secret', 'C:\\secret', 'javascript:alert(1)', 'data:text/html,x', '%2foutside', '%2e%2e/%2e%2e/secret', 'file%3Astream', 'bad%ZZ']) {
      assert.deepEqual(resolveLink(value, 'notes/doc.md'), { kind: 'blocked' }, value)
    }
  })
  it('accepts deliberate HTTP navigation but rejects embedded credentials', () => {
    assert.deepEqual(resolveLink('https://example.com/a', 'doc.md'), { kind: 'external', url: 'https://example.com/a' })
    assert.deepEqual(resolveLink('https://user:pass@example.com', 'doc.md'), { kind: 'blocked' })
  })
})
