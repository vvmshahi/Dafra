import { useAuth } from '@/hooks/useAuth'
import { resolveBusinessType } from '@/lib/utils/businessType'
import PurchaseHistoryTab from '@/pages/inventory/PurchaseHistoryTab'
import { useTranslation } from 'react-i18next'

export default function PurchasesPage() {
  const { tenant } = useAuth()
  const { t } = useTranslation('purchases')
  const isService = resolveBusinessType(tenant?.business_type) === 'service'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-xs text-gray-400">
          {isService
            ? t('subtitleService')
            : t('subtitleTrading')}
        </p>
      </div>

      <PurchaseHistoryTab />
    </div>
  )
}
