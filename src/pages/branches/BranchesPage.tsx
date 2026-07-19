import BranchesTab from '@/pages/settings/BranchesTab'
import { Building2, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function BranchesPage() {
  const { t } = useTranslation('branches')
  return (
    <div className="max-w-6xl space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-[#0F2419] px-5 py-6 shadow-card-lg sm:px-7">
        <div className="absolute inset-x-0 top-0 h-1 bg-gold-500" />
        <div className="relative flex items-start gap-4">
          <div className="hidden h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15 sm:flex">
            <Building2 size={20} className="text-gold-300" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-gold-300">{t('workspace')}</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-white">{t('title')}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-primary-100/80">
              {t('subtitle')}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-primary-100 bg-primary-50/70 px-4 py-3.5">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-white text-primary-600 shadow-card">
          <ShieldCheck size={15} />
        </div>
        <div>
          <p className="text-sm font-bold text-primary-900">{t('zatcaNoticeTitle')}</p>
          <p className="mt-0.5 text-xs leading-5 text-primary-800/75">
            {t('zatcaNoticeBody')}
          </p>
        </div>
      </div>

      <BranchesTab />
    </div>
  )
}
