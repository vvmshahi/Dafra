import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, ArrowRight, ArrowLeft, Building2, CreditCard } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { MeemLogo } from '@/components/MeemLogo'
import { AuthenticatedLanguageSwitch } from '@/components/localization/AuthenticatedLanguageSwitch'
import type { SubscriptionPlan } from '@/types'
import { useTranslation } from 'react-i18next'

/* ── Types ──────────────────────────────────────────────────── */

interface OnboardingData {
  company_name: string
  city:         string
  phone:        string
  website:      string
  plan_id:      string
}

const INITIAL: OnboardingData = {
  company_name: '',
  city: '', phone: '', website: '',
  plan_id: '',
}

/* ── Step indicator ─────────────────────────────────────────── */

const STEPS = [
  { n: 1, key: 'business', icon: Building2 },
  { n: 2, key: 'plan',     icon: CreditCard },
]

function StepIndicator({ current }: { current: number }) {
  const { t } = useTranslation('onboarding')
  return (
    <div className="flex items-center justify-center gap-0">
      {STEPS.map((step, i) => {
        const done   = step.n < current
        const active = step.n === current
        const Icon   = step.icon
        return (
          <div key={step.n} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                done   ? 'bg-gold-500 border-gold-500'
                : active ? 'bg-white border-white shadow-lg scale-110'
                : 'bg-white/10 border-white/20'
              }`}>
                {done
                  ? <CheckCircle2 size={18} className="text-[#0F2419]" />
                  : <Icon size={16} className={active ? 'text-primary-600' : 'text-white/40'} />
                }
              </div>
              <span className={`text-[10px] font-semibold tracking-wide ${
                active ? 'text-white' : done ? 'text-gold-400' : 'text-white/30'
              }`}>
                {t(`steps.${step.key}`)}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-20 mx-2 mb-5 transition-all ${
                step.n < current ? 'bg-gold-500' : 'bg-white/20'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 mt-5 first:mt-0">
      {children}
    </p>
  )
}

/* ── Step 1: Business Details ───────────────────────────────── */

function Step1({
  data, onChange,
}: {
  data: OnboardingData
  onChange: (k: keyof OnboardingData, v: string) => void
}) {
  const { t } = useTranslation('onboarding')
  const set = (k: keyof OnboardingData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange(k, e.target.value)

  return (
    <div>
      <SectionLabel>{t('company.identity')}</SectionLabel>
      <Input label={t('company.name')} value={data.company_name} onChange={set('company_name')}
        placeholder={t('company.namePlaceholder')} required dir="auto" />

      <SectionLabel>{t('company.locationContact')}</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        <Input label={t('company.city')} value={data.city} onChange={set('city')} placeholder={t('company.cityPlaceholder')} required dir="auto" />
        <Input label={t('company.phone')} type="tel" value={data.phone} onChange={set('phone')}
          placeholder="+966 5x xxx xxxx" required dir="ltr" />
      </div>
      <div className="mt-3">
        <Input label={t('company.website')} type="url" value={data.website} onChange={set('website')}
          placeholder="https://company.com" dir="ltr" />
      </div>
    </div>
  )
}

/* ── Step 2: Plan Selection ─────────────────────────────────── */

const PLAN_DISPLAY = [
  {
    key:      'phase1',
    price:    50,
    badge:    false,
  },
  {
    key:      'phase2',
    price:    100,
    badge:    true,
  },
]

function Step2({
  data, onChange, plans, loadingPlans,
}: {
  data: OnboardingData
  onChange: (k: keyof OnboardingData, v: string) => void
  plans: SubscriptionPlan[]
  loadingPlans: boolean
}) {
  const { t } = useTranslation('onboarding')
  const planIds = [plans[0]?.id ?? '', plans[1]?.id ?? '']

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500 leading-relaxed">
        {t('plan.guidance')}
      </p>

      {loadingPlans ? (
        <div className="grid grid-cols-2 gap-4">
          {[1, 2].map(i => <div key={i} className="h-80 rounded-2xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {PLAN_DISPLAY.map((plan, idx) => {
            const planId   = planIds[idx]
            const selected = planId ? data.plan_id === planId : idx === 0

            return (
              <button
                key={plan.key}
                type="button"
                onClick={() => planId && onChange('plan_id', planId)}
                className={`relative text-left rounded-2xl border-2 p-5 transition-all flex flex-col gap-4 ${
                  selected
                    ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-500/20 shadow-md'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                {plan.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gold-500 text-[#0F2419] text-[10px] font-black px-3 py-1 rounded-full whitespace-nowrap shadow-sm">
                    {t(`plan.${plan.key}.badge`)}
                  </span>
                )}

                <div className="flex items-start justify-between mt-1">
                  <div>
                    <p className="font-black text-gray-900 text-base">{t(`plan.${plan.key}.title`)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{t(`plan.${plan.key}.subtitle`)}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    selected ? 'bg-primary-500 border-primary-500' : 'border-gray-300'
                  }`}>
                    {selected && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </div>

                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black text-gray-900" dir="ltr">{t('plan.price', { price: plan.price })}</span>
                    <span className="text-xs text-gray-400">{t('plan.period')}</span>
                  </div>
                </div>

                <ul className="space-y-2 border-t border-gray-100 pt-3 flex-1">
                  {[1, 2, 3, 4, 5, 6].map(feature => (
                    <li key={feature} className="flex items-start gap-2 text-[12px] text-gray-600">
                      <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                      {t(`plan.${plan.key}.feature${feature}`)}
                    </li>
                  ))}
                </ul>

                <div className={`rounded-xl py-2 text-center text-sm font-semibold transition-all ${
                  selected ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                  {t(selected ? 'plan.selected' : 'plan.select')}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2.5 bg-[#0F2419]/5 border border-[#0F2419]/10 rounded-xl px-4 py-3">
        <span className="text-base">ℹ️</span>
        <p className="text-xs text-gray-600">
          {t('plan.activationHelp')}
        </p>
      </div>
    </div>
  )
}

/* ── Main page ──────────────────────────────────────────────── */

const STORAGE_KEY = (userId: string) => `meem_onboarding_${userId}`

export default function OnboardingPage() {
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()
  const { user, refreshProfile } = useAuth()

  const [step, setStep]         = useState(1)
  const [data, setData]         = useState<OnboardingData>({ ...INITIAL })
  const [plans, setPlans]       = useState<SubscriptionPlan[]>([])
  const [loadingPlans, setLoadingPlans] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState('')

  // Load persisted progress when user is available
  useEffect(() => {
    if (!user?.id) return
    const saved = localStorage.getItem(STORAGE_KEY(user.id))
    if (!saved) return
    try {
      const { step: savedStep, data: savedData } = JSON.parse(saved)
      if (typeof savedStep === 'number') setStep(savedStep)
      if (savedData && typeof savedData === 'object') setData(prev => ({ ...prev, ...savedData }))
    } catch {
      // ignore corrupt data
    }
  }, [user?.id])

  // Persist progress on every step/data change
  useEffect(() => {
    if (!user?.id) return
    localStorage.setItem(STORAGE_KEY(user.id), JSON.stringify({ step, data }))
  }, [step, data, user?.id])

  // Fetch subscription plans
  useEffect(() => {
    supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('price_monthly')
      .then(({ data: rows, error: plansError }) => {
        if (plansError) {
          console.error('Failed to load onboarding plans', plansError)
          setError(t('errors.planLoad'))
        }
        const list = (rows as SubscriptionPlan[]) ?? []
        setPlans(list)
        const defaultPlan = list[1] ?? list[0]
        if (defaultPlan) setData(prev => ({ ...prev, plan_id: prev.plan_id || defaultPlan.id }))
        setLoadingPlans(false)
      })
  }, [t])

  const onChange = (k: keyof OnboardingData, v: string) =>
    setData(prev => ({ ...prev, [k]: v }))

  const canContinue = () => {
    if (step === 1) return (
      data.company_name.trim().length > 0 &&
      data.city.trim().length > 0 &&
      data.phone.trim().length > 0
    )
    if (step === 2) return data.plan_id.length > 0 || !loadingPlans
    return false
  }

  const handleComplete = async () => {
    setError('')
    setSubmitting(true)
    try {
      const { error } = await (supabase.rpc as any)('complete_onboarding', {
        p_company_name:    data.company_name.trim(),
        p_company_name_ar: '',
        p_vat_number:      '',
        p_cr_number:       '',
        p_city:            data.city.trim(),
        p_phone:           data.phone.trim(),
        p_website:         data.website.trim(),
        p_plan_id:         data.plan_id || undefined,
      })
      if (error) throw error

      if (user?.id) localStorage.removeItem(STORAGE_KEY(user.id))
      await refreshProfile()
      navigate('/dashboard', { replace: true })
    } catch (err: any) {
      console.error('Failed to complete onboarding', err)
      const msg = String(err?.message ?? '')
      setError(msg.startsWith('ALREADY_ONBOARDED') ? t('errors.alreadySetup')
        : /jwt|session|auth/i.test(msg) ? t('errors.sessionExpired')
        : /permission|forbidden|42501/i.test(msg) ? t('errors.permissionDenied')
        : t('errors.setupFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const stepTitles = [
    { heading: t('company.heading'), sub: t('company.subtitle') },
    { heading: t('plan.heading'), sub: t('plan.subtitle') },
  ]
  const { heading, sub } = stepTitles[step - 1]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Dark green header */}
      <div className="relative bg-[#0F2419] px-6 py-8">
        <AuthenticatedLanguageSwitch inverse className="absolute end-6 top-6" />
        <div className="flex justify-center mb-8">
          <MeemLogo size="lg" />
        </div>

        <StepIndicator current={step} />

        <div className="text-center mt-8">
          <h1 className="text-2xl font-black text-white">{heading}</h1>
          <p className="text-white/50 text-sm mt-1.5">{sub}</p>
          {user?.email && (
            <p className="text-white/30 text-xs mt-2">{t('company.signedInAs', { email: user.email })}</p>
          )}
        </div>
      </div>

      {/* Form card */}
      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">

          <div className="p-8">
            {step === 1 && <Step1 data={data} onChange={onChange} />}
            {step === 2 && <Step2 data={data} onChange={onChange} plans={plans} loadingPlans={loadingPlans} />}

            {error && (
              <div className="mt-4 flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3 rounded-xl">
                <span>⚠</span> {error}
              </div>
            )}
          </div>

          <div className="px-8 py-5 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
            <div>
              {step > 1 && (
                <Button variant="ghost" onClick={() => setStep(s => s - 1)} disabled={submitting}>
                  <ArrowLeft size={15} /> {t('actions.back')}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400" dir="ltr">{t('steps.stepOf', { current: step, total: STEPS.length })}</span>
              {step < 2 ? (
                <Button onClick={() => setStep(s => s + 1)} disabled={!canContinue()}>
                  {t('actions.continue')} <ArrowRight size={15} />
                </Button>
              ) : (
                <Button onClick={handleComplete} loading={submitting} disabled={!canContinue()}>
                  {t('actions.launch')} <ArrowRight size={15} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
