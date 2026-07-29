import { useCallback, useState, type ReactNode } from 'react'
import { Check, Menu, X } from 'lucide-react'
import { useDialogFocus } from '@/hooks/useDialogFocus'

export interface StudioSection {
  id: string
  label: string
  icon?: React.ElementType
}

export function DocumentStudioHeader({
  title,
  context,
  helpLabel,
  helpText,
  navigation,
  status,
}: {
  title: string
  context?: string
  helpLabel: string
  helpText: string
  navigation: ReactNode
  status: ReactNode
}) {
  return <header className="document-studio-header mb-2 flex min-h-[72px] shrink-0 flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
    <div className="min-w-0 shrink-0">
      <div className="flex items-center gap-1.5">
        <h1 className="truncate text-sm font-bold text-gray-950">{title}</h1>
        <button type="button" title={helpText} aria-label={helpLabel} className="grid h-7 w-7 place-items-center rounded-lg text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
          <span className="text-[11px] font-bold" aria-hidden="true">i</span>
        </button>
      </div>
      {context && <p className="max-w-44 truncate text-[10px] font-medium text-gray-500">{context}</p>}
    </div>
    <div className="mx-auto min-w-0">{navigation}</div>
    <div className="ms-auto shrink-0">{status}</div>
  </header>
}

interface SectionNavigationProps {
  sections: readonly StudioSection[]
  activeSection: string
  onSelect: (id: string) => void
  label: string
}

export function DocumentStudioSectionNav({
  sections,
  activeSection,
  onSelect,
  label,
}: SectionNavigationProps) {
  return <nav
    className="document-studio-section-nav shrink-0 border-b border-gray-200 bg-[#f5f8f6] p-2 xl:w-[124px] xl:border-b-0 xl:border-e"
    aria-label={label}
    onKeyDown={event => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-studio-section]'))
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (current < 0) return
      event.preventDefault()
      const rtl = document.documentElement.dir === 'rtl'
      const delta = event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowUp'
          ? -1
          : event.key === 'ArrowRight'
            ? rtl ? -1 : 1
            : event.key === 'ArrowLeft'
              ? rtl ? 1 : -1
              : 0
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + delta + buttons.length) % buttons.length
      buttons[next]?.focus()
      buttons[next]?.click()
    }}
  >
    <div className="flex flex-wrap gap-1 xl:flex-col">
      {sections.map(section => {
        const selected = section.id === activeSection
        const Icon = section.icon
        return <button
          key={section.id}
          data-studio-section
          type="button"
          aria-current={selected ? 'page' : undefined}
          onClick={() => onSelect(section.id)}
          className={`group flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[11px] font-semibold outline-none transition-[background-color,color,transform] duration-150 active:scale-[.97] focus-visible:ring-2 focus-visible:ring-primary-500 ${
            selected ? 'bg-[#173d2a] text-white shadow-sm' : 'text-gray-600 hover:bg-white hover:text-gray-950'
          }`}
        >
          {Icon && <Icon size={13} aria-hidden="true" className={selected ? 'text-emerald-200' : 'text-gray-400 group-hover:text-primary-600'} />}
          <span className="whitespace-nowrap xl:whitespace-normal">{section.label}</span>
        </button>
      })}
    </div>
  </nav>
}

export function DocumentStudioPreviewToolbar({
  title,
  meta,
  children,
}: {
  title: string
  meta?: ReactNode
  children?: ReactNode
}) {
  return <div className="document-studio-preview-toolbar flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2">
    <div className="min-w-0">
      <h2 className="truncate text-xs font-bold text-gray-950">{title}</h2>
      {meta && <div className="mt-0.5 text-[10px] text-gray-500">{meta}</div>}
    </div>
    {children && <div className="flex flex-wrap items-center justify-end gap-1.5">{children}</div>}
  </div>
}

export function DocumentStudioActionFooter({
  status,
  children,
}: {
  status: ReactNode
  children: ReactNode
}) {
  return <footer className="document-studio-action-footer z-30 flex min-h-[58px] shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white px-3 py-2">
    <div className="min-w-0 text-xs" aria-live="polite" aria-atomic="true">{status}</div>
    <div className="flex shrink-0 items-center gap-2">{children}</div>
  </footer>
}

interface WorkspaceProps {
  sectionNavigation: ReactNode
  configuration: ReactNode
  previewToolbar: ReactNode
  preview: ReactNode
  actionFooter: ReactNode
  configurationLabel: string
  previewLabel: string
  settingsLabel: string
  closeSettingsLabel: string
  previewOverflow?: 'auto' | 'hidden'
}

export function DocumentStudioWorkspace({
  sectionNavigation,
  configuration,
  previewToolbar,
  preview,
  actionFooter,
  configurationLabel,
  previewLabel,
  settingsLabel,
  closeSettingsLabel,
  previewOverflow = 'auto',
}: WorkspaceProps) {
  const drawerState = useDrawerState()
  const dialogRef = useDialogFocus(drawerState.open, drawerState.close)

  return <section className="document-studio-workspace relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_12px_34px_rgba(15,36,25,0.08)]">
    <div className="document-studio-canvas relative grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(400px,440px)_minmax(0,1fr)]">
      <aside className="hidden min-h-0 border-e border-gray-200 bg-white xl:flex" aria-label={configurationLabel}>
        {sectionNavigation}
        <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable]">{configuration}</div>
      </aside>

      <section className="document-studio-preview flex min-h-0 min-w-0 flex-col bg-[#e9eeeb]" aria-label={previewLabel}>
        <div className="relative">
          <button
            type="button"
            onClick={drawerState.openDrawer}
            className="absolute start-3 top-2 z-10 inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-bold text-gray-700 shadow-sm transition-transform duration-150 active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 xl:hidden"
            aria-haspopup="dialog"
            aria-expanded={drawerState.open}
          >
            <Menu size={14} aria-hidden="true" />{settingsLabel}
          </button>
          <div className="max-xl:[&>.document-studio-preview-toolbar]:ps-28">{previewToolbar}</div>
        </div>
        <div className={`document-studio-preview-canvas min-h-0 flex-1 overscroll-contain p-3 [scrollbar-gutter:stable] ${previewOverflow === 'hidden' ? 'overflow-hidden' : 'overflow-auto'}`}>
          {preview}
        </div>
      </section>

      {drawerState.open && <>
        <button type="button" aria-label={closeSettingsLabel} onClick={drawerState.close} className="absolute inset-0 z-40 bg-gray-950/25 xl:hidden" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={configurationLabel}
          className="document-studio-drawer absolute inset-y-0 start-0 z-50 flex w-[min(92%,440px)] flex-col border-e border-gray-200 bg-white shadow-2xl transition-transform duration-200 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] xl:hidden"
        >
          <div className="flex min-h-12 shrink-0 items-center justify-between border-b border-gray-200 px-3">
            <strong className="text-xs text-gray-950">{configurationLabel}</strong>
            <button data-autofocus type="button" onClick={drawerState.close} aria-label={closeSettingsLabel} className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 transition-transform duration-150 active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"><X size={16} /></button>
          </div>
          {sectionNavigation}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{configuration}</div>
        </div>
      </>}
    </div>
    {actionFooter}
  </section>
}

function useDrawerState() {
  const [open, setOpen] = useState(false)
  return {
    open,
    openDrawer: useCallback(() => setOpen(true), []),
    close: useCallback(() => setOpen(false), []),
  }
}

export function SavedStatus({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 text-emerald-700"><Check size={14} aria-hidden="true" />{children}</span>
}
