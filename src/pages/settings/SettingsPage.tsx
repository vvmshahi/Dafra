import { useState } from 'react'
import { Building2, ShieldCheck, CreditCard, UserCircle } from 'lucide-react'
import BranchesTab     from './BranchesTab'
import ZatcaTab        from './ZatcaTab'
import SubscriptionTab from './SubscriptionTab'
import AccountTab      from './AccountTab'

/* ── Tab config ─────────────────────────────────────────────── */

type TabId = 'branches' | 'zatca' | 'subscription' | 'account'

const TABS: { id: TabId; label: string; icon: React.ElementType; desc: string }[] = [
  { id: 'branches',     label: 'Branches',     icon: Building2,   desc: 'Locations, invoice settings & ZATCA config' },
  { id: 'zatca',        label: 'ZATCA',        icon: ShieldCheck, desc: 'Certificates & e-invoicing compliance'     },
  { id: 'subscription', label: 'Subscription', icon: CreditCard,  desc: 'Plan, billing & usage limits'             },
  { id: 'account',      label: 'Account',      icon: UserCircle,  desc: 'Profile, name, phone & password'          },
]

/* ── Page ───────────────────────────────────────────────────── */

export default function SettingsPage() {
  const [active, setActive] = useState<TabId>('branches')

  const current = TABS.find(t => t.id === active)!

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
              <span>{tab.label}</span>
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
          <h2 className="text-sm font-bold text-gray-900">{current.label}</h2>
          <p className="text-xs text-gray-400">{current.desc}</p>
        </div>
      </div>

      {/* Tab content */}
      {active === 'branches'     && <BranchesTab />}
      {active === 'zatca'        && <ZatcaTab />}
      {active === 'subscription' && <SubscriptionTab />}
      {active === 'account'      && <AccountTab />}
    </div>
  )
}
