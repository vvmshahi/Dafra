import { CheckCircle2, MessageCircle, Mail, Package } from 'lucide-react'
import { supportConfig } from '@/config/support'
import { useTranslation } from 'react-i18next'

const WA_LINK    = supportConfig.whatsappLink
const EMAIL_LINK = supportConfig.emailLink

const PLANS = [
  {
    key:      'phase1',
    price:    50,
  },
  {
    key:      'phase2',
    price:    100,
  },
]

export default function SuperAdminSettingsPage() {
  const { t } = useTranslation('admin')
  return (
    <div className="space-y-8 max-w-3xl">

      <div>
        <h1 className="text-xl font-bold text-gray-900">{t('settings.title')}</h1>
        <p className="text-sm text-gray-400 mt-0.5">{t('settings.subtitle')}</p>
      </div>

      {/* Plan reference — read only */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">{t('settings.plans')}</h2>
        <p className="text-xs text-gray-400 mb-4">
          {t('settings.plansHelp')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PLANS.map((plan, idx) => (
            <div key={plan.key} className="card p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  idx === 0 ? 'bg-amber-50' : 'bg-primary-50'
                }`}>
                  <Package size={16} className={idx === 0 ? 'text-amber-600' : 'text-primary-600'} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{t(`plans.${plan.key}.name`)}</p>
                  <p className="text-[11px] text-gray-400">{t(`plans.${plan.key}.subtitle`)}</p>
                </div>
              </div>
              <p className="text-2xl font-black text-gray-900 mb-3">
                <span dir="ltr">{t('settings.price', { price: plan.price })}</span>
                <span className="text-xs font-normal text-gray-400">{t('settings.period')}</span>
              </p>
              <ul className="space-y-1.5 border-t border-gray-100 pt-3">
                {[1,2,3,4,5,6].map(feature => (
                  <li key={feature} className="flex items-center gap-2 text-xs text-gray-600">
                    <CheckCircle2 size={11} className="text-emerald-500 flex-shrink-0" />
                    {t(`plans.${plan.key}.f${feature}`)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Support contact */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('settings.support')}</h2>
        <div className="card p-5">
          <p className="text-xs text-gray-500 mb-4">
            {t('settings.supportHelp')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-4 py-2.5 rounded-xl transition-colors text-sm"
            >
              <MessageCircle size={15} /> {t('settings.whatsapp')}
            </a>
            <a
              href={EMAIL_LINK}
              className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold px-4 py-2.5 rounded-xl transition-colors text-sm"
            >
              <Mail size={15} /> {supportConfig.email}
            </a>
          </div>
        </div>
      </section>

    </div>
  )
}
