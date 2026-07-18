import { useTranslation } from 'react-i18next'

interface Props {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' }

export function LoadingSpinner({ size = 'md', className = '' }: Props) {
  const { t } = useTranslation('common')
  return (
    <div
      className={`animate-spin rounded-full border-2 border-gray-300 border-t-primary-600 ${sizes[size]} ${className}`}
      role="status"
      aria-label={t('loading')}
    />
  )
}
