import { useAuth } from '@/hooks/useAuth'
import { resolveBusinessType } from '@/lib/utils/businessType'
import PurchaseHistoryTab from '@/pages/inventory/PurchaseHistoryTab'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Plus } from 'lucide-react'

export default function PurchasesPage() {
  const { tenant } = useAuth()
  const { t } = useTranslation('purchases')
  const isService = resolveBusinessType(tenant?.business_type) === 'service'

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        description={isService ? t('subtitleService') : t('subtitleTrading')}
        actions={<Button size="sm" onClick={() => window.dispatchEvent(new Event('kubri:open-purchase'))} className="border border-[#0B1C13] !bg-[#173F2A] text-[#FFF8E7] shadow-[0_3px_8px_rgba(15,36,25,0.18)] hover:!bg-[#0F2419] focus-visible:ring-[#173F2A]"><Plus size={14}/>{t('new')}</Button>}
      />

      <PurchaseHistoryTab />
    </div>
  )
}
