import { useEffect, useRef } from 'react'
import { CalendarClock, ReceiptText, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface Props {
  open: boolean
  kind: 'daily' | 'fixed'
  editing: boolean
  saving: boolean
  canSubmit: boolean
  compact?: boolean
  showSubmit?: boolean
  subtitle?: string
  onClose: () => void
  onSubmit: (event: React.FormEvent) => void
  children: React.ReactNode
}

export default function ExpenseModalShell({
  open, kind, editing, saving, canSubmit, compact = false, showSubmit = true, subtitle, onClose, onSubmit, children,
}: Props) {
  const { t } = useTranslation(['expenses', 'common'])
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const fixed = kind === 'fixed'

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault()
        onClose()
        window.setTimeout(() => previousFocusRef.current?.focus(), 0)
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!nodes.length) return
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault()
        nodes.at(-1)?.focus()
      } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
        event.preventDefault()
        nodes[0].focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, open, saving])

  if (!open) return null
  const Icon = fixed ? CalendarClock : ReceiptText

  return (
    <div className="fixed inset-y-0 left-0 right-0 z-50 flex items-center justify-center bg-black/55 p-2 md:left-[var(--app-sidebar-width)] md:p-5"
      onMouseDown={event => event.target === event.currentTarget && !saving && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${kind}-expense-modal-title`}
        aria-describedby={`${kind}-expense-modal-description`}
        className={`flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-2xl border border-white/20 bg-[#fffdf7] shadow-2xl md:max-h-[min(92vh,860px)] ${compact ? 'max-w-[640px]' : 'max-w-[920px]'}`}>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-[#B5943E]/35 bg-[#0F2419] px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[#F3D98B]/35 bg-[#173f2a] text-[#F3D98B]">
                <Icon size={18} aria-hidden="true" />
              </span>
              <div>
                <h2 id={`${kind}-expense-modal-title`} className="text-base font-black text-[#FFF9E8]">
                  {t(editing ? (fixed ? 'expenses:editFixed' : 'expenses:editDaily') : (fixed ? 'expenses:addFixed' : 'expenses:addDaily'))}
                </h2>
                <p id={`${kind}-expense-modal-description`} className="mt-0.5 text-xs text-white/65">
                  {subtitle ?? t(fixed ? 'expenses:modal.fixedSubtitle' : 'expenses:modal.dailySubtitle')}
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={saving} aria-label={t('common:close')}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-white/65 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D98B] active:scale-[0.97] disabled:opacity-50">
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto bg-[#fffdf7] px-4 py-4 sm:px-6">{children}</div>
          <footer className="flex flex-shrink-0 flex-col-reverse gap-2 border-t border-gray-200 bg-white px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}
              className="w-full active:scale-[0.97] sm:w-auto">{t('common:cancel')}</Button>
            {showSubmit && <Button type="submit" loading={saving} disabled={saving || !canSubmit}
              className="w-full bg-[#0F2419] hover:bg-[#173f2a] active:scale-[0.97] sm:w-auto">
              {t(editing ? 'expenses:actions.saveChanges' : (fixed ? 'expenses:addFixed' : 'expenses:addDaily'))}
            </Button>}
          </footer>
        </form>
      </div>
    </div>
  )
}
