import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, ArrowRight, ArrowLeft, Building2, GitBranch, CreditCard } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { SubscriptionPlan } from '@/types'

/* ── Types ──────────────────────────────────────────────────── */

interface OnboardingData {
  // Step 1 — Company
  company_name:     string
  company_name_ar:  string
  vat_number:       string
  cr_number:        string
  city:             string
  country:          string
  phone:            string
  website:          string
  // Step 2 — Branch
  branch_name:      string
  branch_name_ar:   string
  vat_mode:         'exclusive' | 'inclusive'
  invoice_prefix:   string
  building_number:  string
  street:           string
  district:         string
  postal_code:      string
  // Step 3 — Plan
  plan_id:          string
}

const INITIAL: OnboardingData = {
  company_name: '', company_name_ar: '',
  vat_number: '', cr_number: '',
  city: '', country: 'SA', phone: '', website: '',
  branch_name: '', branch_name_ar: '',
  vat_mode: 'exclusive', invoice_prefix: 'INV',
  building_number: '', street: '', district: '', postal_code: '',
  plan_id: '',
}

/* ── Step indicator ─────────────────────────────────────────── */

const STEPS = [
  { n: 1, label: 'Company',  icon: Building2  },
  { n: 2, label: 'Branch',   icon: GitBranch  },
  { n: 3, label: 'Plan',     icon: CreditCard },
]

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0">
      {STEPS.map((step, i) => {
        const done   = step.n < current
        const active = step.n === current
        const Icon   = step.icon
        return (
          <div key={step.n} className="flex items-center">
            {/* Node */}
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
                {step.label}
              </span>
            </div>
            {/* Connector */}
            {i < STEPS.length - 1 && (
              <div className={`h-px w-16 mx-2 mb-5 transition-all ${
                step.n < current ? 'bg-gold-500' : 'bg-white/20'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Section label ──────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 mt-5 first:mt-0">
      {children}
    </p>
  )
}

/* ── Step 1: Company Details ────────────────────────────────── */

function Step1({
  data, onChange,
}: {
  data: OnboardingData
  onChange: (k: keyof OnboardingData, v: string) => void
}) {
  const set = (k: keyof OnboardingData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange(k, e.target.value)

  return (
    <div>
      <SectionLabel>Business identity</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Company Name (English)" value={data.company_name} onChange={set('company_name')} placeholder="Al-Faris Trading Co." required />
        <Input label="Company Name (Arabic)" value={data.company_name_ar} onChange={set('company_name_ar')} placeholder="شركة الفارس التجارية" />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Input label="VAT Registration Number" value={data.vat_number} onChange={set('vat_number')} placeholder="301234567890123" maxLength={15} helperText="15-digit Saudi VAT number" />
        <Input label="Commercial Registration (CR)" value={data.cr_number} onChange={set('cr_number')} placeholder="1234567890" />
      </div>

      <SectionLabel>Location &amp; contact</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        <Input label="City" value={data.city} onChange={set('city')} placeholder="Riyadh" />
        <div>
          <label className="label">Country</label>
          <select value={data.country} onChange={set('country')} className="input">
            <option value="SA">Saudi Arabia 🇸🇦</option>
            <option value="AE">UAE 🇦🇪</option>
            <option value="BH">Bahrain 🇧🇭</option>
            <option value="KW">Kuwait 🇰🇼</option>
            <option value="OM">Oman 🇴🇲</option>
            <option value="QA">Qatar 🇶🇦</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Input label="Phone" type="tel" value={data.phone} onChange={set('phone')} placeholder="+966 5x xxx xxxx" />
        <Input label="Website (optional)" type="url" value={data.website} onChange={set('website')} placeholder="https://company.com" />
      </div>
    </div>
  )
}

/* ── Step 2: Branch Setup ───────────────────────────────────── */

function Step2({
  data, onChange,
}: {
  data: OnboardingData
  onChange: (k: keyof OnboardingData, v: string) => void
}) {
  const set = (k: keyof OnboardingData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange(k, e.target.value)

  return (
    <div>
      <SectionLabel>Branch identity</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Branch Name (English)" value={data.branch_name} onChange={set('branch_name')} placeholder="Main Branch" />
        <Input label="Branch Name (Arabic)" value={data.branch_name_ar} onChange={set('branch_name_ar')} placeholder="الفرع الرئيسي" />
      </div>

      <SectionLabel>Invoice settings</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        {/* VAT mode */}
        <div>
          <label className="label">VAT Mode</label>
          <div className="grid grid-cols-2 gap-2">
            {(['exclusive', 'inclusive'] as const).map(m => (
              <button key={m} type="button" onClick={() => onChange('vat_mode', m)}
                className={`border rounded-xl px-3 py-2.5 text-left transition-all ${
                  data.vat_mode === m
                    ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}>
                <p className="text-xs font-semibold capitalize text-gray-800">{m}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {m === 'exclusive' ? 'VAT on top' : 'VAT included'}
                </p>
              </button>
            ))}
          </div>
        </div>
        <Input label="Invoice Prefix" value={data.invoice_prefix} onChange={e => onChange('invoice_prefix', e.target.value.toUpperCase())} placeholder="INV" maxLength={10} helperText="e.g. INV, FAT, ORD" />
      </div>

      <SectionLabel>Branch address (ZATCA mandatory)</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Building Number" value={data.building_number} onChange={set('building_number')} placeholder="1234" />
        <Input label="Street" value={data.street} onChange={set('street')} placeholder="King Fahd Road" />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Input label="District" value={data.district} onChange={set('district')} placeholder="Al-Olaya" />
        <Input label="Postal Code" value={data.postal_code} onChange={set('postal_code')} placeholder="12345" />
      </div>

      <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">
        These details appear on every ZATCA-compliant invoice. You can edit them anytime in Settings → Branches.
      </p>
    </div>
  )
}

/* ── Step 3: Plan Selection ─────────────────────────────────── */

const PLAN_DISPLAY = [
  {
    title:    'Phase 1',
    subtitle: 'ZATCA QR Code Invoicing',
    price:    99,
    badge:    null as string | null,
    features: [
      'ZATCA Phase 1 QR code',
      '1 branch included',
      'Up to 3 users',
      'Basic reports',
      'POS billing',
    ],
  },
  {
    title:    'Phase 2',
    subtitle: 'Full ZATCA Compliance',
    price:    249,
    badge:    'Most Popular',
    features: [
      'Everything in Phase 1',
      'ZATCA Phase 2 XML + digital signing',
      'API reporting and clearance',
      'Advanced reports + P&L',
      'Priority support',
    ],
  },
]

function Step3({
  data, onChange, plans, loadingPlans,
}: {
  data: OnboardingData
  onChange: (k: keyof OnboardingData, v: string) => void
  plans: SubscriptionPlan[]
  loadingPlans: boolean
}) {
  // Map display position → real plan ID (DB plans ordered price ASC)
  const planIds = [plans[0]?.id ?? '', plans[1]?.id ?? '']

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500 leading-relaxed">
        Choose the plan that fits your ZATCA compliance needs. You'll start with a{' '}
        <strong className="text-gray-700">14-day free trial</strong> — no payment required.
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
                key={plan.title}
                type="button"
                onClick={() => planId && onChange('plan_id', planId)}
                className={`relative text-left rounded-2xl border-2 p-5 transition-all flex flex-col gap-4 ${
                  selected
                    ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-500/20 shadow-md'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                {/* Most Popular badge */}
                {plan.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gold-500 text-[#0F2419] text-[10px] font-black px-3 py-1 rounded-full whitespace-nowrap shadow-sm">
                    {plan.badge}
                  </span>
                )}

                {/* Header */}
                <div className="flex items-start justify-between mt-1">
                  <div>
                    <p className="font-black text-gray-900 text-base">{plan.title}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{plan.subtitle}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    selected ? 'bg-primary-500 border-primary-500' : 'border-gray-300'
                  }`}>
                    {selected && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </div>

                {/* Price */}
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black text-gray-900">SAR {plan.price}</span>
                    <span className="text-xs text-gray-400">/month</span>
                  </div>
                  <p className="text-[11px] text-emerald-600 mt-0.5 font-medium">14-day free trial</p>
                </div>

                {/* Feature list */}
                <ul className="space-y-2 border-t border-gray-100 pt-3 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-[12px] text-gray-600">
                      <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* Select pill */}
                <div className={`rounded-xl py-2 text-center text-sm font-semibold transition-all ${
                  selected
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                  {selected ? 'Selected' : 'Select'}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2.5 bg-[#0F2419]/5 border border-[#0F2419]/10 rounded-xl px-4 py-3">
        <span className="text-base">🎁</span>
        <p className="text-xs text-gray-600">
          <strong>14-day free trial on any plan.</strong> No credit card needed — upgrade or cancel anytime.
        </p>
      </div>
    </div>
  )
}

/* ── Main page ──────────────────────────────────────────────── */

const STORAGE_KEY = (userId: string) => `dafra_onboarding_${userId}`

export default function OnboardingPage() {
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

  // Pre-fill branch name from company name
  useEffect(() => {
    if (data.branch_name === '' && data.company_name) {
      setData(prev => ({ ...prev, branch_name: prev.company_name }))
    }
  }, [data.company_name])

  // Fetch plans on mount
  useEffect(() => {
    supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('price_monthly')
      .then(({ data: rows }) => {
        const list = (rows as SubscriptionPlan[]) ?? []
        setPlans(list)
        // Auto-select Phase 2 (second plan, "Most Popular") by default
        const defaultPlan = list[1] ?? list[0]
        if (defaultPlan) setData(prev => ({ ...prev, plan_id: prev.plan_id || defaultPlan.id }))
        setLoadingPlans(false)
      })
  }, [])

  const onChange = (k: keyof OnboardingData, v: string) =>
    setData(prev => ({ ...prev, [k]: v }))

  const canContinue = () => {
    if (step === 1) return data.company_name.trim().length > 0
    if (step === 2) return true
    if (step === 3) return data.plan_id.length > 0 || !loadingPlans
    return false
  }

  const handleComplete = async () => {
    setError('')
    setSubmitting(true)
    try {
      // Cast args as any — the hand-written Functions type doesn't satisfy
      // supabase-js@2.45's strict RPC overload for jsonb-returning functions.
      const { error } = await (supabase.rpc as any)('complete_onboarding', {
        p_company_name:    data.company_name.trim(),
        p_company_name_ar: data.company_name_ar.trim(),
        p_vat_number:      data.vat_number.trim(),
        p_cr_number:       data.cr_number.trim(),
        p_city:            data.city.trim(),
        p_country:         data.country,
        p_phone:           data.phone.trim(),
        p_website:         data.website.trim(),
        p_branch_name:     data.branch_name.trim(),
        p_branch_name_ar:  data.branch_name_ar.trim(),
        p_vat_mode:        data.vat_mode,
        p_invoice_prefix:  data.invoice_prefix.trim(),
        p_building_number: data.building_number.trim(),
        p_street:          data.street.trim(),
        p_district:        data.district.trim(),
        p_postal_code:     data.postal_code.trim(),
        p_plan_id:         data.plan_id || undefined,
      })
      if (error) throw error

      // Clear persisted progress before redirecting
      if (user?.id) localStorage.removeItem(STORAGE_KEY(user.id))

      // Refresh auth context so profile now has tenant_id + role = 'owner'
      await refreshProfile()
      navigate('/dashboard', { replace: true })
    } catch (err: any) {
      const msg = err?.message ?? 'Setup failed. Please try again.'
      setError(msg.startsWith('ALREADY_ONBOARDED') ? 'Your account is already set up.' : msg)
    } finally {
      setSubmitting(false)
    }
  }

  const stepTitles = [
    { heading: 'Tell us about your business',       sub: 'This information appears on every invoice you generate.' },
    { heading: 'Set up your first branch',          sub: 'Your main location for invoicing and ZATCA compliance.'  },
    { heading: 'Choose your plan',                  sub: 'Start free for 14 days. No payment required now.'        },
  ]
  const { heading, sub } = stepTitles[step - 1]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Dark green header */}
      <div className="bg-[#0F2419] px-6 py-8">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-xl bg-gold-500 flex items-center justify-center shadow-lg">
            <span className="text-[#0F2419] font-black text-xl" style={{ fontFamily: 'Cairo, sans-serif' }}>د</span>
          </div>
          <div>
            <p className="text-white font-bold text-2xl leading-none" style={{ fontFamily: 'Cairo, sans-serif' }}>دفرة</p>
            <p className="text-gold-400 text-xs tracking-widest uppercase">Dafra</p>
          </div>
        </div>

        <StepIndicator current={step} />

        <div className="text-center mt-8">
          <h1 className="text-2xl font-black text-white">{heading}</h1>
          <p className="text-white/50 text-sm mt-1.5">{sub}</p>
          {user?.email && (
            <p className="text-white/30 text-xs mt-2">Signed in as {user.email}</p>
          )}
        </div>
      </div>

      {/* Form card */}
      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">

          <div className="p-8">
            {step === 1 && <Step1 data={data} onChange={onChange} />}
            {step === 2 && <Step2 data={data} onChange={onChange} />}
            {step === 3 && <Step3 data={data} onChange={onChange} plans={plans} loadingPlans={loadingPlans} />}

            {error && (
              <div className="mt-4 flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3 rounded-xl">
                <span>⚠</span> {error}
              </div>
            )}
          </div>

          {/* Footer navigation */}
          <div className="px-8 py-5 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
            <div>
              {step > 1 && (
                <Button variant="ghost" onClick={() => setStep(s => s - 1)} disabled={submitting}>
                  <ArrowLeft size={15} /> Back
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">Step {step} of {STEPS.length}</span>
              {step < 3 ? (
                <Button onClick={() => setStep(s => s + 1)} disabled={!canContinue()}>
                  Continue <ArrowRight size={15} />
                </Button>
              ) : (
                <Button onClick={handleComplete} loading={submitting} disabled={!canContinue()}>
                  Launch my account <ArrowRight size={15} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
