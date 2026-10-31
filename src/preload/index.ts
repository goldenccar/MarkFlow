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
  paperRuntime: () => ipcRenderer.invoke('paper:runtime'),
  paperEnvironment: () => ipcRenderer.invoke('paper:environment'),
  paperInstallEnvironment: (importFile) => ipcRenderer.invoke('paper:install-environment', importFile),
  paperCancelEnvironment: () => ipcRenderer.invoke('paper:cancel-environment'),
  paperRollbackEnvironment: () => ipcRenderer.invoke('paper:rollback-environment'),
  paperOpen: (kind) => ipcRenderer.invoke('paper:open', kind),
  paperOpenDocument: (root, path) => ipcRenderer.invoke('paper:open-document', root, path),
  paperActivate: (id) => rememberLibrary(ipcRenderer.invoke('paper:activate', id)),
  paperCreate: (request) => ipcRenderer.invoke('paper:create', request),
  paperFromMark: (request) => ipcRenderer.invoke('paper:from-mark', request),
  paperDetach: (id) => ipcRenderer.invoke('paper:detach', id),
  paperRefresh: (id) => ipcRenderer.invoke('paper:refresh', id),
  paperConfigure: (id, main, engine) => ipcRenderer.invoke('paper:configure', id, main, engine),
  paperTrust: (id) => ipcRenderer.invoke('paper:trust', id),
  paperRead: (id, file) => ipcRenderer.invoke('paper:read', id, file),
  paperSave: (id, buffer) => ipcRenderer.invoke('paper:save', id, buffer),
  paperDraft: (id, buffer) => ipcRenderer.invoke('paper:draft', id, buffer),
  paperDiscardDraft: (id, file) => ipcRenderer.invoke('paper:discard-draft', id, file),
  paperMoveDraft: (id, from, to) => ipcRenderer.invoke('paper:move-draft', id, from, to),
  paperAddFile: (id, file) => ipcRenderer.invoke('paper:add-file', id, file),
  paperImportAsset: (id) => ipcRenderer.invoke('paper:import-asset', id),
  paperBuild: (request) => ipcRenderer.invoke('paper:build', request),
  paperCancel: (id) => ipcRenderer.invoke('paper:cancel', id),
  paperPdf: (id, artifact) => ipcRenderer.invoke('paper:pdf', id, artifact),
  paperLocate: (id, artifact, query) => ipcRenderer.invoke('paper:locate', id, artifact, query),
  paperExport: (id, artifact, target) => ipcRenderer.invoke('paper:export', id, artifact, target),
  paperRelease: (id) => ipcRenderer.invoke('paper:release', id),
  compilerCreate: (source) => ipcRenderer.invoke('compiler:create', source),
  compilerChoose: (id, selection, family) => ipcRenderer.invoke('compiler:choose', id, selection, family),
  compilerUseAutomatic: (id) => ipcRenderer.invoke('compiler:automatic', id),
  compilerExport: (request) => ipcRenderer.invoke('compiler:export', request),
  compilerOpen: (id, reveal) => ipcRenderer.invoke('compiler:open', id, reveal),
  compilerRelease: (id) => ipcRenderer.invoke('compiler:release', id),
  chooseLibrary: () => rememberLibrary(ipcRenderer.invoke('library:choose')),
  openProject: (root) => rememberLibrary(ipcRenderer.invoke('project:open', root)),
  createProject: (name) => rememberLibrary(ipcRenderer.invoke('project:create', name)),
  inspectProjectLink: (url) => ipcRenderer.invoke('project:inspect-link', url),
  cloneProject: (url, name) => rememberLibrary(ipcRenderer.invoke('project:clone', url, name)),
  forgetProject: async (root) => {
    const settings = await ipcRenderer.invoke('project:forget', root)
    if (currentRoot === root) currentRoot = ''
    return settings
  },
  relocateProject: (root) => rememberLibrary(ipcRenderer.invoke('project:relocate', root)),
  setProjectSyncMode: (root, mode) => ipcRenderer.invoke('project:sync-mode', root, mode),
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
  checkRemote: () => scoped('git:check'),
  updateFromRemote: () => scoped('git:update'),
  pushChanges: () => scoped('git:push'),
  publishBranch: () => scoped('git:publish'),
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
