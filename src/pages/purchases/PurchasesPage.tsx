import { useAuth } from '@/hooks/useAuth'
import { resolveBusinessType } from '@/lib/utils/businessType'
import PurchaseHistoryTab from '@/pages/inventory/PurchaseHistoryTab'

export default function PurchasesPage() {
  const { tenant } = useAuth()
  const isService = resolveBusinessType(tenant?.business_type) === 'service'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Purchases</h1>
        <p className="mt-1 text-xs text-gray-400">
          {isService
            ? 'Record supplier bills and materials for reports and VAT.'
            : 'Record supplier bills, materials, and receiving.'}
        </p>
      </div>

      <PurchaseHistoryTab />
    </div>
  )
}
