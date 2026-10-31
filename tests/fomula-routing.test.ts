import { it } from 'node:test'
import assert from 'node:assert/strict'
import { isLatexDocument } from '../src/renderer/documents/formulaSource'

it('routes complete TeX to PDF without mistaking formulas or commented examples for a document', () => {
  assert.equal(isLatexDocument('\\documentclass[UTF8]{ctexart}\n\\begin{document}\n文字\\end{document}'), true)
  assert.equal(isLatexDocument('\ufeff  \\documentclass {article}'), true)
  assert.equal(isLatexDocument('\\input{preamble}\n\\begin{document}'), true)
  assert.equal(isLatexDocument('% \\documentclass{article}\n\\frac{1}{2}'), false)
  assert.equal(isLatexDocument('\\text{documentclass}\n\\alpha + \\beta'), false)
})
