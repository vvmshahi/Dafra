import { useState, useEffect } from 'react'
import { CheckCircle2, AlertTriangle, MessageCircle, Mail, CreditCard } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useSubscription } from '@/hooks/useSubscription'
import { supportConfig } from '@/config/support'

const WA_LINK    = supportConfig.whatsappLink
const EMAIL_LINK = supportConfig.emailLink

function ContactButtons({ label = 'Contact Us to Renew' }: { label?: string }) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 mt-5">
      <a
        href={WA_LINK}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
      >
        <MessageCircle size={16} /> WhatsApp Us
      </a>
      <a
        href={EMAIL_LINK}
        className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
      >
        <Mail size={16} /> Email Us
      </a>
    </div>
  )
}

export default function SubscriptionTab() {
  const { profile } = useAuth()
  const sub = useSubscription()

  const [endsAt,    setEndsAt]    = useState<string | null>(null)
  const [planName,  setPlanName]  = useState<string>('')
  const [branches,  setBranches]  = useState(0)
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    const tid = profile?.tenant_id
    if (!tid) { setLoading(false); return }
    ;(async () => {
      const [subRes, branchRes] = await Promise.all([
        (supabase as any)
          .from('tenant_subscriptions')
          .select('ends_at, subscription_plans(name)')
          .eq('tenant_id', tid)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('branches').select('id', { count: 'exact', head: true }).eq('tenant_id', tid),
      ])
      setEndsAt(subRes.data?.ends_at ?? null)
      setPlanName(subRes.data?.subscription_plans?.name ?? '')
      setBranches(branchRes.count ?? 0)
      setLoading(false)
    })()
  }, [profile?.tenant_id])

  if (loading || sub.status === 'loading') {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl h-36 animate-pulse bg-gray-100" />
        <div className="card p-6 h-24 animate-pulse bg-gray-50" />
      </div>
    )
  }

  // Lifetime free
  if (sub.isLifetimeFree) {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-4 bg-emerald-50 border border-emerald-100 rounded-2xl p-6">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={24} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-base font-bold text-emerald-800">Lifetime Free Account</p>
            <p className="text-sm text-emerald-700 mt-1">
              Your account has full access with no subscription fees.
            </p>
            {planName && <p className="text-xs text-emerald-600 mt-2">Plan: {planName}</p>}
          </div>
        </div>
        <div className="card p-5 flex gap-4">
          <CreditCard size={18} className="text-gray-300 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-gray-500">
            <p className="font-medium text-gray-700">Branches</p>
            <p>{branches} / {sub.maxBranches} used</p>
          </div>
        </div>
      </div>
    )
  }

  // Expired / grace period / blocked
  if (sub.isBlocked || sub.status === 'grace_period') {
    const inGrace = sub.status === 'grace_period'
    const needsActivation = sub.status === 'activation_required'
    return (
      <div className="space-y-5">
        <div className={`flex items-start gap-4 border rounded-2xl p-6 ${inGrace ? 'bg-red-50 border-red-100' : 'bg-red-50 border-red-200'}`}>
          <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={24} className="text-red-600" />
          </div>
          <div>
            <p className="text-base font-bold text-red-800">
              {needsActivation
                ? 'Subscription Activation Required'
                : inGrace
                ? `Subscription Expired — ${sub.daysUntilExpiry} day${sub.daysUntilExpiry !== 1 ? 's' : ''} left`
                : 'Subscription Suspended'}
            </p>
            <p className="text-sm text-red-700 mt-1">
              {needsActivation
                ? 'This workspace needs manual subscription activation before invoicing can be used.'
                : inGrace
                ? 'Invoicing will be paused when the grace period ends. Renew now to avoid interruption.'
                : 'Your account has been suspended. Contact us to reactivate.'}
            </p>
            <ContactButtons label={needsActivation ? 'Contact Us to Activate' : 'Renew Now'} />
          </div>
        </div>
      </div>
    )
  }

  // Expiring soon
  if (sub.showWarning) {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-4 bg-amber-50 border border-amber-100 rounded-2xl p-6">
          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={24} className="text-amber-600" />
          </div>
          <div>
            <p className="text-base font-bold text-amber-800">
              Expires in {sub.daysUntilExpiry} day{sub.daysUntilExpiry !== 1 ? 's' : ''}
            </p>
            {endsAt && (
              <p className="text-sm text-amber-700 mt-1">
                Expiry date: {new Date(endsAt).toLocaleDateString('en-SA')}
              </p>
            )}
            {planName && <p className="text-xs text-amber-600 mt-1">Plan: {planName}</p>}
            <ContactButtons />
          </div>
        </div>
        <div className="card p-5 flex gap-4">
          <CreditCard size={18} className="text-gray-300 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-gray-500">
            <p className="font-medium text-gray-700">Branches</p>
            <p>{branches} / {sub.maxBranches} used</p>
          </div>
        </div>
      </div>
    )
  }

  // Active
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4 bg-emerald-50 border border-emerald-100 rounded-2xl p-6">
        <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 size={24} className="text-emerald-600" />
        </div>
        <div>
          <p className="text-base font-bold text-emerald-800">Subscription Active</p>
          {planName && <p className="text-sm text-emerald-700 mt-0.5">Plan: {planName}</p>}
          {endsAt && (
            <p className="text-sm text-emerald-700 mt-0.5">
              Renews / Expires: {new Date(endsAt).toLocaleDateString('en-SA')}
            </p>
          )}
        </div>
      </div>

      <div className="card p-5 flex gap-4">
        <CreditCard size={18} className="text-gray-300 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-gray-500">
          <p className="font-medium text-gray-700">Branches</p>
          <p>{branches} / {sub.maxBranches} used</p>
        </div>
      </div>

      <div className="card p-6">
        <p className="text-sm font-semibold text-gray-900 mb-1">To renew or upgrade, contact us:</p>
        <p className="text-xs text-gray-400 mb-4">We'll update your subscription within a few hours.</p>
        <ContactButtons />
      </div>
    </div>
  )
}
