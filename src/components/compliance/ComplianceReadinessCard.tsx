import { useEffect,useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { complianceCapability,getComplianceReadiness } from '@/lib/complianceIdentity'
import type { ComplianceReadiness } from '@/types/complianceIdentity'

export default function ComplianceReadinessCard({branchId,manage=false}:{branchId?:string|null;manage?:boolean}){
 const {t}=useTranslation('settings'); const [data,setData]=useState<ComplianceReadiness|null>(null); const [enabled,setEnabled]=useState<boolean|null>(null)
 useEffect(()=>{let stop=false;(async()=>{try{const c=await complianceCapability();if(stop)return;setEnabled(c.available);if(c.available&&branchId)setData(await getComplianceReadiness(branchId))}catch{if(!stop)setEnabled(false)}})();return()=>{stop=true}},[branchId])
 if(enabled===null)return null
 return <div className="card p-4"><div className="flex items-start gap-3"><ShieldCheck size={18} className="mt-0.5 text-primary-600"/><div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-gray-900">{t('officialSeller.title')}</h3>{!enabled?<p className="mt-1 text-xs text-gray-500">{t('officialSeller.notEnabled')}</p>:<><p className="mt-1 text-xs text-gray-500">{t(`officialSeller.status.${data?.status??'missing'}`)} · {t(`officialSeller.mode.${data?.mode??'legacy'}`)}</p><p className="mt-2 text-[11px] text-emerald-700">{t('officialSeller.displaySafety')}</p>{manage&&<Link className="mt-3 inline-flex text-xs font-semibold text-primary-700" to="/settings/official-seller">{t('officialSeller.manage')}</Link>}</>}</div></div></div>
}
