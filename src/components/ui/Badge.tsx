type Variant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'gold' | 'teal'

const styles: Record<Variant, string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  danger:  'bg-red-50 text-red-700 ring-red-600/20',
  info:    'bg-blue-50 text-blue-700 ring-blue-600/20',
  neutral: 'bg-gray-50 text-gray-600 ring-gray-500/20',
  gold:    'bg-amber-50 text-amber-800 ring-amber-600/20',
  teal:    'bg-teal-50 text-teal-800 ring-teal-600/20',
}

interface Props {
  variant?: Variant
  children: React.ReactNode
  dot?: boolean
}

const dotColors: Record<Variant, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger:  'bg-red-500',
  info:    'bg-blue-500',
  neutral: 'bg-gray-400',
  gold:    'bg-amber-500',
  teal:    'bg-teal-500',
}

export function Badge({ variant = 'neutral', children, dot = false }: Props) {
  return (
    <span className={`badge ${styles[variant]}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />}
      {children}
    </span>
  )
}
