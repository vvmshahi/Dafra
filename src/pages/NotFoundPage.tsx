import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'

export default function NotFoundPage() {
  const { t } = useTranslation('common')
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <h1 className="text-7xl font-bold text-primary-600 mb-4">404</h1>
      <p className="text-xl text-gray-700 mb-2">{t('errors.pageNotFoundTitle')}</p>
      <p className="text-gray-400 mb-8">{t('errors.pageNotFoundBody')}</p>
      <Link to="/dashboard">
        <Button>{t('goToDashboard')}</Button>
      </Link>
    </div>
  )
}
