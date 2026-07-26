import { useAuth } from '@/hooks/useAuth'
import { isStockModuleVisible, resolveBusinessType } from '@/lib/utils/businessType'
import PurchaseHistoryTab from '@/pages/inventory/PurchaseHistoryTab'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/ui/PageHeader'

export default function PurchasesPage() {
  const { tenant, branch } = useAuth()
  const { t } = useTranslation('purchases')
  const isService = resolveBusinessType(tenant?.business_type) === 'service'
  const stockEnabled = isStockModuleVisible({
    businessType: tenant?.business_type,
    stockEnabled: branch?.stock_enabled,
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        description={isService ? t('subtitleService') : t('subtitleTrading')}
      />

      <PurchaseHistoryTab stockEnabled={stockEnabled} />
    </div>
  )
}
