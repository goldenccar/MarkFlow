import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, PDFWorker, RenderTask } from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import { Icon } from './Icons'
import { WorkspacePaneHeading } from './WorkspaceFrame'
import SelectControl from './SelectControl'

interface Props {
  data: Uint8Array | null; revision: number | null; stale: boolean; busy: boolean
  onLocate?(page: number, x: number, y: number): void
  location?: { page: number; x?: number; y?: number; nonce: number } | null
}

function PdfPage({ document, number, width, root, onLocate, location }: { document: PDFDocumentProxy; number: number; width: number; root: HTMLDivElement | null; onLocate?: Props['onLocate']; location?: Props['location'] }) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(number <= 2), [ratio, setRatio] = useState(1.414), [error, setError] = useState('')
  const pointScale = useRef(width / 595.28)
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setNear(entries.some(entry => entry.isIntersecting)), { root, rootMargin: '700px' })
    if (host.current) observer.observe(host.current)
    return () => observer.disconnect()
  }, [root])
  useEffect(() => {
    if (!near) return
    let disposed = false, task: RenderTask | undefined, page: PDFPageProxy | undefined
    void document.getPage(number).then(async next => {
      if (disposed || !canvas.current) return
      page = next
      const natural = next.getViewport({ scale: 1 }), scale = width / natural.width
      pointScale.current = scale
      setRatio(natural.height / natural.width)
      const viewport = next.getViewport({ scale }), pixelRatio = Math.min(2, window.devicePixelRatio || 1)
      const target = canvas.current
      target.width = Math.round(viewport.width * pixelRatio); target.height = Math.round(viewport.height * pixelRatio)
      task = next.render({ canvas: target, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] })
      await task.promise
    }).catch(cause => { if (!disposed && cause?.name !== 'RenderingCancelledException') setError(String(cause?.message ?? cause)) })
    return () => { disposed = true; task?.cancel(); page?.cleanup() }
  }, [document, number, width, near])
  useEffect(() => {
    if (location?.page !== number || !host.current || !root) return
    setNear(true)
    root.scrollTop += host.current.getBoundingClientRect().top - root.getBoundingClientRect().top + (location.y ?? 0) * pointScale.current - Math.min(120, root.clientHeight / 3)
  }, [location, number, root])
  return <div className="paper-pdf-page" ref={host} data-page={number} style={{ width, minHeight: width * ratio }} aria-label={`PDF 第 ${number} 页`} onClick={event => {
    if ((!event.ctrlKey && !event.metaKey) || !onLocate) return
    const bounds = event.currentTarget.getBoundingClientRect()
    onLocate(number, (event.clientX - bounds.left) / pointScale.current, (event.clientY - bounds.top) / pointScale.current)
  }}>
    {near && <canvas ref={canvas} style={{ width, height: width * ratio }} />}
    {error && <div className="paper-page-error">此页显示失败：{error}</div>}
    <span className="paper-page-number">{number}</span>
    {location?.page === number && <span key={location.nonce} className="paper-pdf-location" style={{ left: (location.x ?? 0) * pointScale.current, top: (location.y ?? 0) * pointScale.current }} aria-hidden="true" />}
  </div>
}

export default function PaperPdfPreview({ data, revision, stale, busy, onLocate, location }: Props) {
  const scroll = useRef<HTMLDivElement>(null), loadingRef = useRef<PDFDocumentLoadingTask | null>(null), workerRef = useRef<Worker | null>(null)
  const pdfWorkerRef = useRef<PDFWorker | null>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null), [error, setError] = useState('')
  const [displayRevision, setDisplayRevision] = useState<number | null>(null)
  const [containerWidth, setContainerWidth] = useState(640), [zoom, setZoom] = useState(1), [page, setPage] = useState('1')
  useEffect(() => {
    if (!scroll.current) return
    const observer = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width))
    observer.observe(scroll.current); return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!data) return
    let disposed = false, task: PDFDocumentLoadingTask | undefined
    void import('pdfjs-dist').then(async pdfjs => {
      if (disposed) return
      if (!workerRef.current) workerRef.current = new PdfWorker()
      if (!pdfWorkerRef.current) pdfWorkerRef.current = pdfjs.PDFWorker.create({ port: workerRef.current })
      const localAsset = (name: string) => new URL(`./pdfjs/${name}/`, window.document.baseURI).href
      task = pdfjs.getDocument({ data: new Uint8Array(data), worker: pdfWorkerRef.current, disableAutoFetch: true, useSystemFonts: true, cMapUrl: localAsset('cmaps'), cMapPacked: true, standardFontDataUrl: localAsset('standard_fonts'), wasmUrl: localAsset('wasm'), useWorkerFetch: false })
      const next = await task.promise
      if (disposed) { void task.destroy(); return }
      const previous = loadingRef.current
      loadingRef.current = task; setDocument(next); setDisplayRevision(revision); setError('')
      // Retain the scroll position while the new pages replace the last successful result.
      if (previous) setTimeout(() => void previous.destroy(), 0)
    }).catch(cause => { if (!disposed) setError(String(cause?.message ?? cause)) })
    return () => { disposed = true; if (task && task !== loadingRef.current) void task.destroy() }
  }, [data])
  useEffect(() => () => { void loadingRef.current?.destroy(); loadingRef.current = null; pdfWorkerRef.current?.destroy(); pdfWorkerRef.current = null; workerRef.current?.terminate(); workerRef.current = null }, [])
  const width = Math.max(260, Math.min(850, containerWidth - 48)) * zoom
  const jump = () => {
    const value = Math.min(document?.numPages ?? 1, Math.max(1, Number(page) || 1))
    setPage(String(value)); scroll.current?.querySelector<HTMLElement>(`[data-page="${value}"]`)?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  return <section className="paper-preview" aria-label="论文 PDF 预览">
    <WorkspacePaneHeading className="paper-pane-heading">
      <span><Icon name="preview" size={14} />PDF 预览 {document && <small>{document.numPages} 页</small>}</span>
      <div className="paper-preview-controls">
        <input aria-label="跳转 PDF 页码" type="number" min="1" max={document?.numPages ?? 1} value={page} onChange={event => setPage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') jump() }} disabled={!document} />
        <button title="跳转页码" aria-label="跳转页码" className="icon-button" onClick={jump} disabled={!document}><Icon name="arrowRight" size={13} /></button>
        <SelectControl aria-label="PDF 缩放" value={zoom} onChange={event => setZoom(Number(event.target.value))}>
          <option value="0.75">75%</option><option value="1">适合宽度</option><option value="1.25">125%</option><option value="1.5">150%</option>
        </SelectControl>
      </div>
    </WorkspacePaneHeading>
    <div className="paper-preview-state" role="status">{busy ? '正在编译 · 保留上一份成品' : document ? stale || displayRevision !== revision ? `预览尚未更新 · 源版本 ${displayRevision}` : `已更新 · 源版本 ${displayRevision}` : '编译后显示真实 PDF 页面'}<span>{onLocate && displayRevision === revision ? 'Ctrl / ⌘ 点击定位源码' : '独立滚动'}</span></div>
    {error && <div className="paper-notice paper-error">PDF 显示失败：{error}</div>}
    <div className="paper-pdf-scroll" ref={scroll}>
      {document ? <div className="paper-pdf-pages">{Array.from({ length: document.numPages }, (_, index) => <PdfPage key={`${document.fingerprints[0]}:${index}`} document={document} number={index + 1} width={width} root={scroll.current} onLocate={displayRevision === revision ? onLocate : undefined} location={location} />)}</div>
        : <div className="paper-preview-empty"><Icon name="file" size={38} /><h3>成品会显示在这里</h3><p>编辑左侧源码，然后点击“编译”。<br />这里使用实际生成的 PDF，包含页眉、页脚与跨页结果。</p></div>}
    </div>
  </section>
}
