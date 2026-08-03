import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CreditCard, UserCircle, Printer } from 'lucide-react'
import SubscriptionTab from './SubscriptionTab'
import AccountTab      from './AccountTab'
import PrinterTab      from './PrinterTab'
import { isElectron }  from '@/lib/electron'
import { useAuth } from '@/hooks/useAuth'
import { useTranslation } from 'react-i18next'
import ComplianceReadinessCard from '@/components/compliance/ComplianceReadinessCard'
import { ENABLE_OFFICIAL_SELLER_IDENTITY } from '@/lib/releaseFlags'
import { PageHeader } from '@/components/ui/PageHeader'

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
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const role = String(profile?.role ?? '')
  const tabs = TABS
  const requestedTab = params.get('tab')
  const initialTab = requestedTab && tabs.some(tab => tab.id === requestedTab) ? requestedTab as TabId : 'subscription'
  const [active, setActive] = useState<TabId>(initialTab)

  useEffect(() => {
    if (requestedTab && tabs.some(tab => tab.id === requestedTab)) {
      setActive(requestedTab as TabId)
    } else if (requestedTab) {
      setActive('subscription')
    }
  }, [requestedTab])

  const canViewBusinessType = role === 'owner' || role === 'admin'

  function selectTab(tab: TabId) {
    const next = new URLSearchParams(params)
    next.set('tab', tab)
    setParams(next)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="border-b border-slate-200 pb-5">
        <PageHeader title={t('pageTitle')} description={t('pageSubtitle')} />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-1.5" role="tablist" aria-label={t('pageTitle')}>
        {tabs.map(tab => {
          const Icon    = tab.icon
          const isActive = tab.id === active
          return (
            <button
              key={tab.id}
              type="button"
              data-tab={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`settings-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              className={`flex min-h-10 flex-1 items-center justify-center gap-2.5 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold outline-none transition-[background-color,color,box-shadow,transform] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary-500 ${
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
      <section id={`settings-panel-${active}`} role="tabpanel" aria-live="polite" aria-label={t(`tabs.${active}.label`)}>
        {active === 'subscription' && <SubscriptionTab />}
        {active === 'account'      && <AccountTab />}
        {active === 'printer'      && <PrinterTab />}
      </section>
      {active === 'subscription' && ENABLE_OFFICIAL_SELLER_IDENTITY && canViewBusinessType && <ComplianceReadinessCard manage />}
    </div>
  )
}
