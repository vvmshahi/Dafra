import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/localization/useLocale'
import type { ReportProps } from './reportUtils'

export default function CustomerReport({ startDate, endDate, branchId }: ReportProps) {
  const { t } = useTranslation('customerIntelligence')
  const { isRtl } = useLocale()
  const params = new URLSearchParams({ start: startDate, end: endDate })
  if (branchId) params.set('branch', branchId)

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
        <Link
          to={`/reports/customers?${params.toString()}`}
          className="btn-primary px-4 py-2.5 text-sm rounded-xl flex-shrink-0"
        >
          {t('reports.openDedicated')}
          <ArrowRight size={15} className={isRtl ? 'rotate-180' : ''} />
        </Link>
      </div>
    </section>
  )
}
