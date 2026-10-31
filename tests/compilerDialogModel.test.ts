import test from 'node:test'
import assert from 'node:assert/strict'
import { canLocateCompilerDiagnostic, compilerDiagnosticLocation, compilerDiagnosticReason } from '../src/renderer/compilerDialogModel'
import type { Diagnostic } from '../src/compiler/types'
import type { CompilerSession } from '../src/shared/compilerUi'

const session: CompilerSession = { id: 'opaque', sourceKind: 'current', sourceLabel: 'C:/project/note.md', assetRootLabel: 'C:/project', presentationLabel: null, fonts: [] }
const error = (patch: Partial<Diagnostic>): Diagnostic => ({ code: 'LAYOUT_OVERFLOW', severity: 'error', message: 'Content does not fit.', ...patch })

test('compiler diagnostics preserve Chinese reasons and explain common English failures', () => {
  assert.equal(compilerDiagnosticReason(error({ message: '首版不支持代码块。' })), '首版不支持代码块。')
  assert.match(compilerDiagnosticReason(error({})), /超出页面/)
  assert.match(compilerDiagnosticReason(error({ code: 'FONT_MISSING' })), /高级设置/)
  assert.match(compilerDiagnosticReason(error({ code: 'ASSET_ROOT_REQUIRED' })), /素材文件夹/)
  assert.match(compilerDiagnosticReason(error({ code: 'NEW_ERROR' })), /操作未完成/)
})

test('compiler source labels retain Mark, precise location, JSON pointer and field', () => {
  const result = compilerDiagnosticLocation(error({ markId: 'mark-a', source: { file: 'note.md', from: 10, line: 3, column: 2, pointer: '/marks/1' }, field: 'style.fontSize' }))
  assert.match(result, /Mark mark-a/)
  assert.match(result, /第 3 行，第 2 列/)
  assert.match(result, /\/marks\/1/)
  assert.match(result, /style.fontSize/)
  assert.match(compilerDiagnosticLocation(error({ source: { file: 'note.md', from: 0 } })), /字符位置 1/)
})

test('only current source diagnostics can navigate, never imported or presentation offsets', () => {
  assert.equal(canLocateCompilerDiagnostic(error({ markId: 'a' }), session), true)
  assert.equal(canLocateCompilerDiagnostic(error({ source: { file: session.sourceLabel, from: 0 } }), session), true)
  assert.equal(canLocateCompilerDiagnostic(error({ source: { file: 'presentation.json', from: 0 } }), session), false)
  assert.equal(canLocateCompilerDiagnostic(error({ source: { file: session.sourceLabel, from: -1 } }), session), false)
  assert.equal(canLocateCompilerDiagnostic(error({ markId: 'a' }), { ...session, sourceKind: 'sample' }), false)
  assert.equal(canLocateCompilerDiagnostic(error({ markId: 'a' }), { ...session, sourceKind: 'file' }), false)
  assert.equal(canLocateCompilerDiagnostic(error({ markId: 'a' }), null), false)
})
