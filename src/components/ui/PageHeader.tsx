import { useId, type ReactNode } from 'react'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  className?: string
  titleId?: string
}

export function PageHeader({
  title,
  description,
  eyebrow,
  meta,
  actions,
  className = '',
  titleId,
}: PageHeaderProps) {
  const generatedId = useId()
  const headingId = titleId ?? `page-title-${generatedId.replace(/:/g, '')}`

  return (
    <header
      className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className}`}
      aria-labelledby={headingId}
    >
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600">
            {eyebrow}
          </p>
        )}
        <div className={`flex min-w-0 flex-wrap items-center gap-2 ${eyebrow ? 'mt-1' : ''}`}>
          <h1 id={headingId} className="min-w-0 text-lg font-bold text-gray-900 [overflow-wrap:anywhere]">
            {title}
          </h1>
          {meta}
        </div>
        {description && (
          <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500 [overflow-wrap:anywhere]">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {actions}
        </div>
      )}
    </header>
  )
}
