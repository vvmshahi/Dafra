import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'

export type ConfirmationKind = 'discard' | 'delete' | 'cancel' | 'restoreDefaults' | 'sessionTimeout' | 'signOut' | 'retry'

interface ConfirmDialogProps {
  open: boolean
  kind: ConfirmationKind
  name?: string
  busy?: boolean
  destructive?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  open,
  kind,
  name,
  busy = false,
  destructive = kind === 'delete',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const { t } = useTranslation(['dialogs', 'common'])
  const dialogRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus())

    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  const titleId = `confirmation-${kind}-title`
  const bodyId = `confirmation-${kind}-body`

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!busy) onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return

    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ))
    if (!focusable.length) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}
    >
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={handleKeyDown}
        className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-5 text-start shadow-2xl"
      >
        <h2 id={titleId} className="text-base font-semibold text-gray-900" dir="auto">
          {t(`dialogs:${kind}.title`, { name: name ?? t('common:delete') })}
        </h2>
        <p id={bodyId} className="mt-2 text-sm leading-6 text-gray-500">{t(`dialogs:${kind}.body`)}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {t('common:close')}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'danger' : 'primary'}
            loading={busy}
            onClick={onConfirm}
          >
            {t(`dialogs:${kind}.confirm`)}
          </Button>
        </div>
      </section>
    </div>
  )
}
