import type { ReactNode } from 'react'

export interface WorkspaceTabItem {
  id: string
  label: ReactNode
  icon?: React.ElementType
}

export function WorkspaceTabNav({
  items,
  activeId,
  onSelect,
  label,
  className = '',
}: {
  items: readonly WorkspaceTabItem[]
  activeId: string
  onSelect: (id: string) => void
  label: string
  className?: string
}) {
  return (
    <nav
      className={`flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-[#f5f8f6] p-1 ${className}`}
      role="tablist"
      aria-label={label}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-workspace-tab]'))
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (current < 0) return
        event.preventDefault()
        const rtl = document.documentElement.dir === 'rtl'
        const delta = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + delta + buttons.length) % buttons.length
        buttons[next]?.focus()
        buttons[next]?.click()
      }}
    >
      {items.map(item => {
        const selected = item.id === activeId
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            data-workspace-tab
            role="tab"
            aria-selected={selected}
            aria-controls={`workspace-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(item.id)}
            className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold outline-none transition-[background-color,color,box-shadow,transform] active:scale-[.98] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 ${selected ? 'bg-[#173d2a] text-white shadow-sm' : 'text-gray-600 hover:bg-white hover:text-gray-950'}`}
          >
            {Icon && <Icon size={14} aria-hidden="true" className={selected ? 'text-emerald-200' : 'text-gray-400'} />}
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
