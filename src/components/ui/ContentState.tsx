import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { LoadingSpinner } from './LoadingSpinner'

type ContentStateKind = 'loading' | 'empty' | 'error'

interface ContentStateProps {
  kind: ContentStateKind
  title?: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  action?: ReactNode
  className?: string
}

export function ContentState({
  kind,
  title,
  description,
  icon: Icon,
  action,
  className = '',
}: ContentStateProps) {
  const isError = kind === 'error'

  return (
    <div
      className={`flex min-h-48 flex-col items-center justify-center px-5 py-12 text-center ${className}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-busy={kind === 'loading'}
    >
      {kind === 'loading' ? (
        <LoadingSpinner size="lg" />
      ) : Icon ? (
        <div
          className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${
            isError ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-400'
          }`}
          aria-hidden="true"
        >
          <Icon size={24} />
        </div>
      ) : null}
      {title && (
        <p className={`font-semibold [overflow-wrap:anywhere] ${isError ? 'text-red-700' : 'text-gray-700'}`}>
          {title}
        </p>
      )}
      {description && (
        <p className="mt-1 max-w-md text-sm leading-6 text-gray-500 [overflow-wrap:anywhere]">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
