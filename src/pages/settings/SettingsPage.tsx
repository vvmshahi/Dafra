import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CreditCard, Landmark, UserCircle, Printer } from 'lucide-react'
import SubscriptionTab from './SubscriptionTab'
import AccountTab      from './AccountTab'
import PrinterTab      from './PrinterTab'
import CustomerCreditPolicySettings from './CustomerCreditPolicySettings'
import { isElectron }  from '@/lib/electron'
import { useAuth } from '@/hooks/useAuth'
import { useTranslation } from 'react-i18next'
import ComplianceReadinessCard from '@/components/compliance/ComplianceReadinessCard'
import { ENABLE_OFFICIAL_SELLER_IDENTITY } from '@/lib/releaseFlags'
import { PageHeader } from '@/components/ui/PageHeader'

/* ── Tab config ─────────────────────────────────────────────── */

type TabId = 'subscription' | 'account' | 'printer' | 'customer-credit'

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
  const { profile } = useAuth()
  const [params] = useSearchParams()
  const role = String(profile?.role ?? '')
  const canConfigureCustomerCredit = role === 'owner' || role === 'admin'
  const tabs = canConfigureCustomerCredit ? [...TABS, { id: 'customer-credit' as const, icon: Landmark }] : TABS
  const requestedTab = params.get('tab')
  const initialTab = requestedTab && tabs.some(tab => tab.id === requestedTab) ? requestedTab as TabId : 'subscription'
  const [active, setActive] = useState<TabId>(initialTab)

  useEffect(() => {
    if (requestedTab && tabs.some(tab => tab.id === requestedTab)) {
      setActive(requestedTab as TabId)
    } else if (requestedTab) {
      setActive('subscription')
    }
  }, [requestedTab, canConfigureCustomerCredit])

  const canViewBusinessType = role === 'owner' || role === 'admin'

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={t('pageTitle')} description={t('pageSubtitle')} />

      {/* Tab bar */}
      <div className="card p-1.5 flex gap-1 overflow-x-auto" aria-label={t('pageTitle')}>
        {tabs.map(tab => {
          const Icon    = tab.icon
          const isActive = tab.id === active
          return (
            <button
              key={tab.id}
              type="button"
              data-tab={tab.id}
              aria-pressed={isActive}
              onClick={() => setActive(tab.id)}
              className={`flex min-h-10 flex-1 items-center justify-center gap-2.5 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.98] ${
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

      {/* Tab content */}
      <section aria-live="polite" aria-label={t(`tabs.${active}.label`)}>
        {active === 'subscription' && <SubscriptionTab />}
        {active === 'account'      && <AccountTab />}
        {active === 'printer'      && <PrinterTab />}
        {active === 'customer-credit' && canConfigureCustomerCredit && <CustomerCreditPolicySettings />}
      </section>
      {active === 'subscription' && ENABLE_OFFICIAL_SELLER_IDENTITY && canViewBusinessType && <ComplianceReadinessCard manage />}
    </div>
  )
}
