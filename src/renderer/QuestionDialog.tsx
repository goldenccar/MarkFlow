import { useId, useLayoutEffect, useRef, useState } from 'react'
import './question-dialog.css'

interface Props {
  title: string
  detail?: string
  initial?: string
  buttons: string[]
  onAnswer: (answer: string | null) => void
}

export default function QuestionDialog({ title, detail, initial, buttons, onAnswer }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const composing = useRef(false)
  const answered = useRef(false)
  const [answer, setAnswer] = useState(initial ?? '')
  const titleId = useId(), detailId = useId()
  const finish = (result: string | null) => {
    if (answered.current) return
    answered.current = true
    onAnswer(result)
  }

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Native modal dialogs make the rest of the document inert and contain Tab focus.
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus({ preventScroll: true })
    return () => {
      dialog.close()
      if (previous?.isConnected && !previous.matches(':disabled') && !previous.closest('[inert]')) previous.focus({ preventScroll: true })
    }
  }, [])

  return <dialog ref={dialogRef} className="modal question-dialog" aria-labelledby={titleId} aria-describedby={detail ? detailId : undefined}
    onCancel={event => { event.preventDefault(); if (!composing.current) finish(null) }}
    onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
    onKeyDown={event => {
      if (event.key !== 'Escape' && event.key !== 'Enter') return
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) { event.preventDefault(); event.stopPropagation(); return }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null) }
    }}>
    <form onSubmit={event => { event.preventDefault(); if (!composing.current) finish(initial !== undefined ? answer : buttons[0]) }}>
      <h2 id={titleId}>{title}</h2>
      {detail && <p id={detailId}>{detail}</p>}
      {initial !== undefined && <input data-initial-focus value={answer} onChange={event => setAnswer(event.target.value)} aria-label={title} />}
      <div className="modal-buttons">{buttons.map((label, index) => <button data-initial-focus={index === 0 && initial === undefined ? '' : undefined} key={label} type={index === 0 ? 'submit' : 'button'} className={index === 0 ? 'primary' : ''} onClick={index === 0 ? undefined : () => finish(label === '取消' ? null : label)}>{label}</button>)}</div>
    </form>
  </dialog>
}
