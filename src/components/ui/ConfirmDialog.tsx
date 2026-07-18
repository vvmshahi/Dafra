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
  if (!open) return null

  const titleId = `confirmation-${kind}-title`
  const bodyId = `confirmation-${kind}-body`

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-5 text-start shadow-2xl"
      >
        <h2 id={titleId} className="text-base font-semibold text-gray-900" dir="auto">
          {t(`dialogs:${kind}.title`, { name: name ?? t('common:delete') })}
        </h2>
        <p id={bodyId} className="mt-2 text-sm leading-6 text-gray-500">{t(`dialogs:${kind}.body`)}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
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
