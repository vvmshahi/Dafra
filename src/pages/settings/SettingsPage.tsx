import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CreditCard, UserCircle, Printer } from 'lucide-react'
import SubscriptionTab from './SubscriptionTab'
import AccountTab      from './AccountTab'
import PrinterTab      from './PrinterTab'
import { isElectron }  from '@/lib/electron'
import { useAuth } from '@/hooks/useAuth'
import { resolveBusinessType } from '@/lib/utils/businessType'
import { useTranslation } from 'react-i18next'
import ComplianceReadinessCard from '@/components/compliance/ComplianceReadinessCard'

/* ── Tab config ─────────────────────────────────────────────── */

type TabId = 'subscription' | 'account' | 'printer'

const BASE_TABS: { id: TabId; icon: React.ElementType }[] = [
  { id: 'subscription', icon: CreditCard }, { id: 'account', icon: UserCircle },
]

const ELECTRON_TABS: { id: TabId; icon: React.ElementType }[] = [
  { id: 'printer', icon: Printer },
]

const TABS = isElectron() ? [...BASE_TABS, ...ELECTRON_TABS] : BASE_TABS

/* ── Page ───────────────────────────────────────────────────── */

export default function SettingsPage() {
  const { t } = useTranslation('settings')
  const { profile, tenant } = useAuth()
  const [params] = useSearchParams()
  const requestedTab = params.get('tab')
  const initialTab = requestedTab && TABS.some(tab => tab.id === requestedTab) ? requestedTab as TabId : 'subscription'
  const [active, setActive] = useState<TabId>(initialTab)

  useEffect(() => {
    if (requestedTab && TABS.some(tab => tab.id === requestedTab)) {
      setActive(requestedTab as TabId)
    } else if (requestedTab) {
      setActive('subscription')
    }
  }, [requestedTab])

  const current = TABS.find(t => t.id === active)!
  const role = String(profile?.role ?? '')
  const canViewBusinessType = role === 'owner' || role === 'admin'
  const tenantBusinessType = resolveBusinessType(tenant?.business_type)

  return (
    <div className="max-w-4xl space-y-6">

      {/* Tab bar */}
      <div className="card p-1.5 flex gap-1 overflow-x-auto">
        {TABS.map(tab => {
          const Icon    = tab.icon
          const isActive = tab.id === active
          return (
            <button
              key={tab.id}
              data-tab={tab.id}
              onClick={() => setActive(tab.id)}
              className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap flex-1 justify-center transition-all ${
                isActive
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              <Icon size={15} />
              <span>{t(`tabs.${tab.id}.label`)}</span>
            </button>
          )
        })}
      </div>

      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center">
          <current.icon size={16} className="text-primary-600" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-gray-900">{t(`tabs.${current.id}.label`)}</h2>
          <p className="text-xs text-gray-400">{t(`tabs.${current.id}.description`)}</p>
        </div>
      </div>

      {canViewBusinessType && tenant && (
        <div className="card p-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('businessType.title')}</p>
            <p className="text-sm font-bold text-gray-900 mt-1">{t(`businessType.${tenantBusinessType}.label`)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t(`businessType.${tenantBusinessType}.description`)}</p>
          </div>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-semibold text-gray-500">
            {t('businessType.readOnly')}
          </span>
        </div>
      )}
      {canViewBusinessType && <ComplianceReadinessCard manage />}

      {/* Tab content */}
      {active === 'subscription' && <SubscriptionTab />}
      {active === 'account'      && <AccountTab />}
      {active === 'printer'      && <PrinterTab />}
    </div>
  )
}
