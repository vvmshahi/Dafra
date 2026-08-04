import type { ReactNode } from 'react'

type Tone = 'slate' | 'green' | 'teal' | 'amber' | 'debt'

const styles: Record<Tone, string> = {
  slate: 'bg-gradient-to-br from-[#334155] to-[#1e293b] text-white',
  green: 'bg-gradient-to-br from-[#1B6B3A] to-[#0F2419] text-white',
  teal: 'bg-gradient-to-br from-[#285e61] to-[#1f3f43] text-white',
  amber: 'bg-gradient-to-br from-[#9a3412] to-[#5c1d0b] text-white',
  debt: 'bg-gradient-to-br from-[#7f1d1d] to-[#450a0a] text-white',
}

export function WorkspaceMetric({
  label,
  value,
  detail,
  tone = 'slate',
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: Tone
}) {
  const muted = 'text-white/65'
  return (
    <article className={`min-w-0 rounded-xl p-3.5 shadow-card ${styles[tone]}`} aria-label={label}>
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${muted}`}>{label}</p>
      <p className="mt-1 truncate text-xl font-bold tabular-nums">{value}</p>
      {detail && <p className={`mt-1 min-h-4 text-[11px] leading-snug ${muted}`}>{detail}</p>}
    </article>
  )
}
