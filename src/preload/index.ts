import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Library, OopsAPI } from '../shared/types'

let currentRoot = ''
const scoped = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, currentRoot, ...args)
async function rememberLibrary<T extends Library | { library: Library } | null>(request: Promise<T>): Promise<T> {
  const result = await request
  if (result) currentRoot = 'library' in result ? result.library.root : result.root
  return result
}

const listen = (channel: string, fn: (...args: any[]) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, ...args: any[]) => fn(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}
const api: OopsAPI = {
  platform: process.platform,
  setWindowAppearance: (appearance) => ipcRenderer.invoke('view:appearance', appearance),
  fonts: () => ipcRenderer.invoke('fonts:list'),
  chooseLibrary: () => rememberLibrary(ipcRenderer.invoke('library:choose')),
  openProject: (root) => rememberLibrary(ipcRenderer.invoke('project:open', root)),
  listUntitled: () => ipcRenderer.invoke('untitled:list'),
  putUntitled: (draft) => ipcRenderer.invoke('untitled:put', draft),
  deleteUntitled: (id) => ipcRenderer.invoke('untitled:delete', id),
  saveUntitled: (request) => rememberLibrary(ipcRenderer.invoke('untitled:save', request)),
  chooseFile: () => rememberLibrary(ipcRenderer.invoke('file:choose')),
  openRecent: (root, path) => rememberLibrary(ipcRenderer.invoke('library:recent', root, path)),
  openDropped: (file) => rememberLibrary(ipcRenderer.invoke('library:drop', webUtils.getPathForFile(file))),
  tree: () => scoped('files:tree'),
  listArchive: () => scoped('files:archive-list'),
  archive: (path) => scoped('files:archive', path),
  unarchive: (path) => scoped('files:unarchive', path),
  read: (path) => scoped('files:read', path),
  save: (request) => scoped('files:save', request),
  draft: (draft) => scoped('files:draft', draft),
  clearDraft: (path) => scoped('files:clear-draft', path),
  create: (path, directory) => scoped('files:create', path, directory),
  move: (from, to) => scoped('files:move', from, to),
  remove: (path) => scoped('files:remove', path),
  exportCopy: (content) => ipcRenderer.invoke('files:export', content),
  settings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:put', settings),
  gitStatus: () => scoped('git:status'),
  gitInit: (identity) => scoped('git:init', identity),
  gitConfigure: (remote, branch, identity) => scoped('git:configure', remote, branch, identity),
  gitRecord: (paths, message) => scoped('git:record', paths, message),
  history: (path) => scoped('git:history', path),
  version: (path, oid) => scoped('git:version', path, oid),
  sync: () => scoped('git:sync'),
  abortMerge: () => scoped('git:abort'),
  resolveConflict: (path, choice) => scoped('git:resolve', path, choice),
  finishMerge: () => scoped('git:finish'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  openAttachment: (path) => scoped('open:attachment', path),
  copyText: (value) => ipcRenderer.invoke('clipboard:write-text', value),
  find: (query) => ipcRenderer.invoke('view:find', query),
  stopFind: () => ipcRenderer.invoke('view:stop-find'),
  onAction: (fn) => listen('app:action', fn),
  onFilesChanged: (fn) => listen('app:files-changed', fn),
  onCloseRequest: (fn) => listen('app:close-request', fn),
  closeReady: () => ipcRenderer.send('app:close-ready'),
}
contextBridge.exposeInMainWorld('oops', api)
