import type { MarkId } from './mark'

/** Design contract only: no pagination, canvas, PDF SDK or export engine is loaded by MarkFlow. */
export interface PointPt { x: number; y: number }
export interface RectPt extends PointPt { width: number; height: number }
/** [a,b,c,d,e,f], x'=ax+cy+e and y'=bx+dy+f. Coordinates are points at 1/72 inch. */
export type AffineTransform = [number, number, number, number, number, number]
export interface MarkPlacement {
  /** bounds is the local box; transform alone maps it into page coordinates. */
  id: string; markId: MarkId; bounds: RectPt; transform: AffineTransform; zIndex: number
  region: 'body' | 'header' | 'footer' | 'overlay'; locked?: boolean
  crop?: { x: number; y: number; width: number; height: number }
}
export interface PageTemplate {
  id: string; size: { width: number; height: number }; margins: { top: number; right: number; bottom: number; left: number }
  repeat: MarkPlacement[]
}
export type PageSource =
  | { kind: 'flow'; sections: Array<{ templateId: string; markIds: MarkId[]; startNumber?: number }> }
  | { kind: 'fixed'; pages: Array<{ id: string; templateId: string; placements: MarkPlacement[] }> }
  | { kind: 'imported-pdf'; assetId: string; pages: Array<{ id: string; sourcePage: number; rotation: 0 | 90 | 180 | 270; overlays: MarkPlacement[] }> }

/** Derived fragments may span pages without splitting the identity or text of the original Mark. */
export interface PageFragment {
  markId: MarkId; placementId: string; pageId: string; bounds: RectPt
  textRange?: { encoding: 'utf16'; from: number; to: number }
}
export interface LayoutResult {
  documentRevision: string; templateRevision: string; fontMetricsRevision: string
  pages: Array<{ id: string; number: number; fragments: PageFragment[] }>
}
/** Optional deterministic translation, evaluated from time; no scripts or arbitrary expressions. */
export interface TranslationTrack { placementId: string; durationMs: number; from: PointPt; to: PointPt; easing: 'linear' }
