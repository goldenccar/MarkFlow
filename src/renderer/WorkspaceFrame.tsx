import { forwardRef, type HTMLAttributes } from 'react'
import { Icon } from './Icons'
import './workspace-frame.css'

export const WorkspaceHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function WorkspaceHeader({ className = '', ...props }, ref) {
  return <div ref={ref} className={`document-bar workspace-header ${className}`} {...props} />
})
export const WorkspaceToolbar = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function WorkspaceToolbar({ className = '', ...props }, ref) {
  return <div ref={ref} className={`editor-toolbar workspace-editor-toolbar ${className}`} {...props} />
})
export const WorkspaceSidebar = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function WorkspaceSidebar({ className = '', ...props }, ref) {
  return <aside ref={ref} className={`sidebar workspace-sidebar ${className}`} {...props} />
})
export function WorkspacePaneHeading({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`workspace-pane-heading ${className}`} {...props} />
}
type Layout = 'preview' | 'source' | 'split'
const layoutNames = { preview: '实时预览', source: '源码', split: '对照' }
const layoutHints = { preview: '实时排版与编辑', source: '查看源码', split: '源码与预览对照' }
export function WorkspaceLayoutSwitch({ layouts, value, onChange }: { layouts: readonly Layout[]; value: Layout; onChange(layout: Layout): void }) {
  return <div className="segmented layout-switch" aria-label="显示布局">{layouts.map(layout => <button key={layout} aria-label={layoutNames[layout]} title={layoutHints[layout]} aria-pressed={value === layout} className={value === layout ? 'active' : ''} onClick={() => onChange(layout)}><Icon name={layout} />{layoutNames[layout]}</button>)}</div>
}
