import type { ResolvedTheme, ThemePreference } from '../shared/types'
import { Icon } from './Icons'
import ThemePicker from './ThemePicker'
import { WorkspaceHeader } from './WorkspaceFrame'

interface Props {
  project: string; root?: string; filename: string; type: string; formula: boolean
  dirty: boolean; state?: string; busy: boolean; canSave: boolean; canHistory: boolean
  theme: ThemePreference; resolvedTheme: ResolvedTheme; saveShortcut: string
  onOpen(): void; onTheme(theme: ThemePreference): void; onHistory(): void; onSave(): void
}

/** The app row stays identical across editors; engine commands belong below it. */
export default function ApplicationBar(props: Props) {
  return <WorkspaceHeader aria-label="应用栏">
    <span className="document-project title-path" title={props.root}>{props.project}</span><span className="breadcrumb-separator">/</span>
    <span className="document-name">{props.filename}</span>{props.dirty && <span className="unsaved-dot" title="未保存" />}
    {props.state && <span className="document-state">{props.state}</span>}<span className="document-spacer" />
    <span className="document-type" title={props.type + '文档'}><Icon name={props.formula ? 'math' : 'file'} />{props.type}</span>
    <button className="icon-button" title="打开文件" aria-label="打开文件" disabled={props.busy} onClick={props.onOpen}><Icon name="folderOpen" /></button>
    <ThemePicker preference={props.theme} resolved={props.resolvedTheme} onChange={props.onTheme} />
    <button className="icon-button" title="版本历史" aria-label="版本历史" disabled={props.busy || !props.canHistory} onClick={props.onHistory}><Icon name="history" /></button>
    <button className="primary" disabled={props.busy || !props.canSave} onClick={props.onSave}><Icon name="save" />保存 <kbd>{props.saveShortcut}</kbd></button>
  </WorkspaceHeader>
}
