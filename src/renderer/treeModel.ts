import type { ArchiveEntry, FileEntry } from '../shared/types'

const key = (value: string) => value.toLocaleLowerCase('en-US')
export function coversPath(parent: string, child: string): boolean {
  return key(parent) === key(child) || key(child).startsWith(key(parent) + '/')
}
export function archiveOwner(records: ArchiveEntry[], path: string): ArchiveEntry | undefined {
  return records.find(record => coversPath(record.path, path))
}
export function filterTree(entries: FileEntry[], records: ArchiveEntry[], archived: boolean): FileEntry[] {
  return entries.flatMap(entry => {
    const hidden = !!archiveOwner(records, entry.path)
    if (hidden) return archived ? [entry] : []
    if (!entry.directory) return archived ? [] : [entry]
    const children = filterTree(entry.children ?? [], records, archived)
    return archived && !children.length ? [] : [{ ...entry, children }]
  })
}
export function moveDestination(from: string, folder: string): string | null {
  if (!from || coversPath(from, folder)) return null
  const destination = `${folder ? folder + '/' : ''}${from.split('/').at(-1)}`
  return key(destination) === key(from) ? null : destination
}
