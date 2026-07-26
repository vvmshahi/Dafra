import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface FilterPanelProps {
  id: string
  title: ReactNode
  description?: ReactNode
  icon: LucideIcon
  children: ReactNode
  accentClassName?: string
  className?: string
}

export function FilterPanel({
  id,
  title,
  description,
  icon: Icon,
  children,
  accentClassName = 'bg-gray-100 text-gray-500',
  className = '',
}: FilterPanelProps) {
  return (
    <section className={`card space-y-4 p-4 ${className}`} aria-labelledby={id}>
      <div className="flex min-w-0 items-center gap-2">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${accentClassName}`}>
          <Icon size={15} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 id={id} className="text-sm font-bold text-gray-900 [overflow-wrap:anywhere]">
            {title}
          </h2>
          {description && (
            <p className="text-xs text-gray-500 [overflow-wrap:anywhere]">
              {description}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  )
}

export function FilterPresetRow({
  label,
  children,
}: {
  label: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-gutter:stable]"
      role="group"
      aria-label={typeof label === 'string' ? label : undefined}
    >
      {children}
    </div>
  )
}

const columnClasses = {
  2: 'sm:grid-cols-2',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  6: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
} as const

export function ResponsiveFilterGrid({
  children,
  columns = 4,
  className = '',
}: {
  children: ReactNode
  columns?: keyof typeof columnClasses
  className?: string
}) {
  return (
    <div className={`grid grid-cols-1 gap-3 ${columnClasses[columns]} ${className}`}>
      {children}
    </div>
  )
}
