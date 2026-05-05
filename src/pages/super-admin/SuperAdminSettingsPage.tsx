import { CheckCircle2, MessageCircle, Mail, Package } from 'lucide-react'

const WA_LINK    = 'https://wa.me/919895953210'
const EMAIL_LINK = 'mailto:vvmshahin@gmail.com'

const PLANS = [
  {
    name:     'Phase 1',
    subtitle: 'ZATCA QR Code Invoicing',
    price:    50,
    features: [
      'ZATCA Phase 1 QR Code',
      'POS Billing Terminal',
      'Invoice Management',
      'Expense Tracking',
      'Sales Reports',
      '1 Branch included',
    ],
  },
  {
    name:     'Phase 2',
    subtitle: 'Full ZATCA Compliance',
    price:    100,
    features: [
      'Everything in Phase 1',
      'ZATCA Phase 2 Digital Signing',
      'Automatic ZATCA Reporting',
      'XML Invoice Generation',
      'Phase 2 QR Code',
      '1 Branch included',
    ],
  },
]

export default function SuperAdminSettingsPage() {
  return (
    <div className="space-y-8 max-w-3xl">

      <div>
        <h1 className="text-xl font-bold text-gray-900">Platform Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">Subscription plan reference and support contacts</p>
      </div>

      {/* Plan reference — read only */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Subscription Plans</h2>
        <p className="text-xs text-gray-400 mb-4">
          Pricing and limits are managed in the database (subscription_plans table).
          Contact the developer to update them.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PLANS.map((plan, idx) => (
            <div key={plan.name} className="card p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  idx === 0 ? 'bg-amber-50' : 'bg-primary-50'
                }`}>
                  <Package size={16} className={idx === 0 ? 'text-amber-600' : 'text-primary-600'} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{plan.name}</p>
                  <p className="text-[11px] text-gray-400">{plan.subtitle}</p>
                </div>
              </div>
              <p className="text-2xl font-black text-gray-900 mb-3">
                SAR {plan.price}
                <span className="text-xs font-normal text-gray-400"> / branch / month</span>
              </p>
              <ul className="space-y-1.5 border-t border-gray-100 pt-3">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
                    <CheckCircle2 size={11} className="text-emerald-500 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Support contact */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Support Contact</h2>
        <div className="card p-5">
          <p className="text-xs text-gray-500 mb-4">
            For technical issues, database changes, or billing support:
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-4 py-2.5 rounded-xl transition-colors text-sm"
            >
              <MessageCircle size={15} /> WhatsApp: +91 9895953210
            </a>
            <a
              href={EMAIL_LINK}
              className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold px-4 py-2.5 rounded-xl transition-colors text-sm"
            >
              <Mail size={15} /> vvmshahin@gmail.com
            </a>
          </div>
        </div>
      </section>

    </div>
  )
}
