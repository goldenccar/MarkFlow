// Tests recognize only the complete, versioned registry written by the application.
// Ordinary comments, examples, malformed entries and unsupported versions stay body text.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fonts = new Set(['system', 'fangsong', 'fangsong-gb2312', 'kaiti', 'kaiti-gb2312', 'microsoft-yahei', 'alibaba-puhuiti'])
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
function splitRegistry(source) {
  if (typeof source !== 'string') return null
  const marker = '<!-- oops:marks ', at = source.lastIndexOf(marker)
  if (at < 0) return null
  const separator = /(?:\r?\n){2}$/.exec(source.slice(0, at)), tail = source.slice(at).trimEnd()
  if (!separator || !tail.endsWith(' -->')) return null
  try {
    const metadata = JSON.parse(tail.slice(marker.length, -4))
    if (!object(metadata) || metadata.v !== 1 || metadata.complete !== true || !uuid.test(metadata.documentId)
      || typeof metadata.bodyHash !== 'string' || !/^\d+:[\da-f]+:[\da-f]+$/.test(metadata.bodyHash)
      || !Number.isSafeInteger(metadata.revision) || metadata.revision < 0 || !Array.isArray(metadata.marks)) return null
    if (!metadata.marks.every(mark => object(mark) && uuid.test(mark.id) && typeof mark.type === 'string'
      && typeof mark.raw === 'string' && typeof mark.before === 'string' && typeof mark.after === 'string'
      && Number.isSafeInteger(mark.from) && Number.isSafeInteger(mark.to) && mark.from >= 0 && mark.to >= mark.from
      && object(mark.style) && (mark.style.fontFamily === undefined || fonts.has(mark.style.fontFamily))
      && (mark.style.fontSize === undefined || Number.isFinite(mark.style.fontSize) && mark.style.fontSize >= 10 && mark.style.fontSize <= 96)
      && (mark.orphan === undefined || typeof mark.orphan === 'boolean')
      && (mark.occurrences === undefined || Number.isSafeInteger(mark.occurrences) && mark.occurrences >= 1))) return null
    if (new Set(metadata.marks.map(mark => mark.id)).size !== metadata.marks.length) return null
    if (metadata.retiredIds !== undefined && (!Array.isArray(metadata.retiredIds) || !metadata.retiredIds.every(id => uuid.test(id))
      || new Set(metadata.retiredIds).size !== metadata.retiredIds.length || metadata.marks.some(mark => !mark.orphan && metadata.retiredIds.includes(mark.id)))) return null
    const start = at - separator[0].length
    return { body: source.slice(0, start), suffix: source.slice(start), metadata }
  } catch { return null }
}
export function readRegistry(source) { return splitRegistry(source)?.metadata ?? null }
export function markdownBody(source) { return splitRegistry(source)?.body ?? source }
export function replaceMarkdownBody(source, body) { return body + (splitRegistry(source)?.suffix ?? '') }
