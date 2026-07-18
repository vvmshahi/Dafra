import type { LucideIcon } from 'lucide-react'
import { useLocale } from '@/localization/useLocale'

interface DirectionalIconProps {
  icon: LucideIcon
  size?: number
  className?: string
}

export function DirectionalIcon({ icon: Icon, size, className = '' }: DirectionalIconProps) {
  const { isRtl } = useLocale()
  return <Icon size={size} className={`${isRtl ? 'rotate-180' : ''} ${className}`} aria-hidden="true" />
}

