import { FileText, Landmark } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

/**
 * Compatibility route component. Operational credit control lives only in the
 * selected Branch Settings page; this component intentionally has no
 * operational setting editor or tenant-policy write.
 */
export default function CustomerCreditPolicySettings() {
  const { t } = useTranslation('receivables')
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="customer-credit-workspace-heading">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-50 text-primary-700"><Landmark size={18} /></span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-700">{t('eyebrow')}</p>
          <h2 id="customer-credit-workspace-heading" className="mt-1 text-lg font-bold text-slate-950">{t('title')}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{t('credit.workspaceCompatibility')}</p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link to="/reports/receivables" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary-700 px-4 text-sm font-bold text-white hover:bg-primary-800"><Landmark size={15} />{t('credit.openWorkspace')}</Link>
        <Link to="/branch-settings?section=credit" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"><FileText size={15} />{t('credit.openBranchSettings')}</Link>
      </div>
    </section>
  )
}
