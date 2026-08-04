import { BarChart3, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReportProps } from './reportUtils'

export default function CustomerReport(_: ReportProps) {
  const { t } = useTranslation('customerIntelligence')
  return (
    <section className="card overflow-hidden">
      <div className="h-1 bg-gradient-to-r from-emerald-500 via-primary-500 to-teal-400" />
      <div className="p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center gap-6">
        <div className="flex items-start gap-4 flex-1">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0">
            <Users size={21} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t('reports.title')}</h2>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl leading-relaxed">
              {t('reports.subtitle')}
            </p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <BarChart3 size={14} />
              {t('commercialActivity')} · {t('notBalance')}
            </div>
          </div>
        </div>
        <div className="shrink-0 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-800">
          {t('reports.subtitle')}
        </div>
      </div>
    </section>
  )
}
