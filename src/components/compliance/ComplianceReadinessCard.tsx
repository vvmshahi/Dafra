import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { complianceCapability, getComplianceReadiness } from '@/lib/complianceIdentity'
import { supabase } from '@/lib/supabase'
import type { ComplianceReadiness } from '@/types/complianceIdentity'

type PublicState = 'incomplete' | 'confirmed' | 'reconfirm'
function publicState(data: ComplianceReadiness | null): PublicState {
  if (!data) return 'incomplete'
  if (data.status === 'revalidation_required') return 'reconfirm'
  if (data.status === 'verified') return 'confirmed'
  return 'incomplete'
}

export default function ComplianceReadinessCard({ branchId, manage = false, invoiceGuidance = false }: { branchId?: string | null; manage?: boolean; invoiceGuidance?: boolean }) {
  const { t } = useTranslation('settings')
  const [data, setData] = useState<ComplianceReadiness | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let stopped = false
    ;(async () => {
      try {
        const capability = await complianceCapability()
        if (stopped) return
        setEnabled(capability.available)
        if (capability.available) {
          let targetBranchId = branchId
          if (!targetBranchId) {
            const { data: branch } = await supabase.from('branches').select('id').order('is_main_branch', { ascending: false }).order('created_at').limit(1).maybeSingle()
            targetBranchId = branch?.id
          }
          if (targetBranchId) {
            const readiness = await getComplianceReadiness(targetBranchId)
            if (!stopped) setData(readiness)
          }
        }
      } catch { if (!stopped) setEnabled(false) }
    })()
    return () => { stopped = true }
  }, [branchId])
  if (enabled === null) return null
  const state = publicState(data)
  const Icon = state === 'confirmed' ? CheckCircle2 : state === 'reconfirm' ? AlertTriangle : ShieldCheck
  const action = state === 'confirmed' ? 'view' : state === 'reconfirm' ? 'confirmChanges' : 'complete'
  return <div className="card p-4"><div className="flex items-start gap-3"><Icon size={18} className={`mt-0.5 ${state === 'confirmed' ? 'text-emerald-600' : 'text-amber-600'}`}/><div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-gray-900">{t('officialSeller.simpleTitle')}</h3>{!enabled ? <p className="mt-1 text-xs text-gray-500">{t('officialSeller.notEnabled')}</p> : <><p className="mt-1 text-xs text-gray-600">{t(`officialSeller.publicState.${state}`)}</p><p className="mt-2 text-[11px] leading-5 text-gray-500">{invoiceGuidance ? t('officialSeller.invoiceGuidance') : t('officialSeller.simpleCardHelp')}</p>{manage && <Link className="mt-3 inline-flex text-xs font-semibold text-primary-700" to="/settings/official-seller">{t(`officialSeller.cardAction.${action}`)}</Link>}</>}</div></div></div>
}
