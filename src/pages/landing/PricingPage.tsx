import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Apple,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  MessageCircle,
  Package,
  QrCode,
  Receipt,
  Store,
  Users,
} from 'lucide-react'
import { MeemLogo } from '@/components/MeemLogo'
import { supportConfig } from '@/config/support'

const WA_LINK = supportConfig.whatsappLink
const CURRENCY = 'SAR'

const FEATURES = [
  { label: 'ZATCA Phase 2 workflows', icon: FileText },
  { label: 'QR invoices', icon: QrCode },
  { label: 'POS checkout', icon: Store },
  { label: 'Cash, card, and split payments', icon: CreditCard },
  { label: 'Stock and purchases', icon: Package },
  { label: 'Register session closing', icon: Receipt },
  { label: 'VAT support reports', icon: CheckCircle2 },
  { label: 'Multi-branch dashboard', icon: Building2 },
  { label: 'Windows app', icon: Download },
  { label: 'Mac app', icon: Apple },
  { label: 'Owner dashboard included', icon: Users },
  { label: 'Branch user access', icon: Users },
]

const PLANS = {
  monthly: {
    label: 'Monthly',
    price: `${CURRENCY} 100`,
    period: '/ month / branch',
    helper: 'Pay month to month.',
  },
  yearly: {
    label: 'Yearly',
    price: `${CURRENCY} 1,000`,
    period: '/ year / branch',
    helper: `Save ${CURRENCY} 200 compared with monthly billing.`,
  },
} as const

type BillingCycle = keyof typeof PLANS

function Pattern() {
  return (
    <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <pattern id="kubri-pricing-pattern" x="0" y="0" width="96" height="96" patternUnits="userSpaceOnUse">
          <path d="M28 6h40l22 22v40L68 90H28L6 68V28Z" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
          <path d="M48 20l28 28-28 28-28-28Z" fill="none" stroke="rgba(200,169,110,0.065)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#kubri-pricing-pattern)" />
    </svg>
  )
}

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly')
  const selectedPlan = PLANS[billingCycle]
  const actionBaseClass = 'group relative isolate inline-flex h-10 items-center justify-center overflow-hidden rounded-full px-4 text-sm font-black transition-[background,border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B76A]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071510] active:scale-[0.98]'

  return (
    <div className="min-h-screen bg-[#071510] text-white">
      <header className="relative overflow-hidden border-b border-white/10 bg-[#0F2419]">
        <Pattern />
        <div className="relative z-10 mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/"><MeemLogo size="sm" /></Link>
          <div className="flex items-center gap-2">
            <Link to="/faq" className="hidden rounded-full px-3 py-2 text-sm font-semibold text-white/78 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B76A]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071510] sm:inline">FAQ</Link>
            <Link to="/login" className={`${actionBaseClass} border border-white/[0.10] bg-white/[0.06] text-white/[0.90] hover:border-white/[0.18] hover:bg-white/[0.10] hover:text-white`}>
              <span className="absolute inset-0 -z-10 translate-x-[-105%] rounded-full bg-white/[0.08] opacity-0 transition-[opacity,transform] duration-300 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
              <span className="relative transition-transform duration-200 group-hover:-translate-x-1.5">Sign in</span>
              <ArrowRight size={14} className="absolute right-3 translate-x-2 opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
            </Link>
          </div>
        </div>
        <div className="relative z-10 mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-6 lg:px-8">
          <Link to="/" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-white/60 hover:text-white">
            <ArrowLeft size={15} /> Home
          </Link>
          <div>
            <div>
              <h1 className="text-3xl font-black leading-tight sm:text-5xl">Simple pricing for every branch.</h1>
              <p className="mt-3 max-w-xl text-base leading-7 text-white/70">Start with one branch and add more as your business grows.</p>
            </div>
          </div>
        </div>
      </header>

      <main className="relative overflow-hidden bg-[#F6F2E8] px-4 py-6 text-[#173326] sm:px-6 sm:py-7 lg:px-8">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-14rem] top-[-16rem] h-[32rem] w-[32rem] rounded-full bg-[#D8B76A]/25 blur-3xl" />
          <div className="absolute bottom-[-18rem] right-[-12rem] h-[36rem] w-[36rem] rounded-full bg-[#0F3A2A]/15 blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#C8A96E]/70 to-transparent" />
        </div>

        <section className="relative z-10 mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#A77F29]">Kubri pricing</p>
            <h2 className="mt-2 text-2xl font-black leading-tight text-[#10291E] sm:text-3xl">
              One clear price per active branch.
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-[#496154]">
              Choose monthly or yearly billing. Owner dashboard is included, and every branch gets the same core POS, invoicing, stock, reporting, and app access.
            </p>
          </div>

          <div className="mt-5 overflow-hidden rounded-[26px] border border-[#D9CBAA] bg-[#FFFDF7] shadow-[0_26px_76px_rgba(15,36,25,0.16)]">
            <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
              <div className="relative overflow-hidden bg-[#10291E] p-5 text-white sm:p-6">
                <Pattern />
                <div className="relative z-10">
                  <div className="inline-flex rounded-full border border-white/10 bg-black/20 p-1 shadow-inner">
                    {(Object.keys(PLANS) as BillingCycle[]).map(planKey => {
                      const plan = PLANS[planKey]
                      const isSelected = billingCycle === planKey

                      return (
                        <button
                          key={planKey}
                          type="button"
                          onClick={() => setBillingCycle(planKey)}
                          className={`rounded-full px-4 py-2 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B76A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#10291E] ${
                            isSelected
                              ? 'bg-[#D8B76A] text-[#10291E] shadow-[0_10px_24px_rgba(216,183,106,0.22)]'
                              : 'text-white/75 hover:bg-white/[0.08] hover:text-white'
                          }`}
                          aria-pressed={isSelected}
                        >
                          {plan.label}
                        </button>
                      )
                    })}
                  </div>

                  <div className="mt-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-sm font-bold text-[#E8D6A4]">Kubri</p>
                      {billingCycle === 'yearly' && (
                        <span className="rounded-full border border-[#D8B76A]/35 bg-[#D8B76A]/15 px-3 py-1 text-xs font-black text-[#F3DE9A]">
                          Save 17% yearly
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
                      <span className="text-5xl font-black tracking-normal text-white sm:text-6xl">{selectedPlan.price}</span>
                      <span className="pb-1.5 text-sm font-bold text-white/62">{selectedPlan.period}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-white/62">{selectedPlan.helper}</p>
                  </div>

                  <div className="mt-5 space-y-2.5 rounded-2xl border border-white/10 bg-white/[0.06] p-3.5">
                    <div className="flex gap-3">
                      <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0 text-[#D8B76A]" />
                      <p className="text-sm leading-6 text-white/76">Owner dashboard included. Pricing is based on active branches.</p>
                    </div>
                    <div className="flex gap-3">
                      <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0 text-[#D8B76A]" />
                      <p className="text-sm leading-6 text-white/76">Includes a 7-day money-back guarantee.</p>
                    </div>
                  </div>

                  <a
                    href={WA_LINK}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D8B76A] px-5 py-3.5 text-sm font-black text-[#10291E] shadow-[0_14px_30px_rgba(216,183,106,0.24)] transition hover:bg-[#E6C779] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0D997] focus-visible:ring-offset-2 focus-visible:ring-offset-[#10291E]"
                  >
                    <MessageCircle size={18} />
                    Get Started
                    <ArrowRight size={17} />
                  </a>
                </div>
              </div>

              <div className="p-5 sm:p-6">
                <div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#A77F29]">Included</p>
                    <h3 className="mt-1.5 text-xl font-black text-[#10291E]">Everything a branch needs to run.</h3>
                  </div>
                </div>

                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {FEATURES.map(feature => {
                    const Icon = feature.icon

                    return (
                      <div
                        key={feature.label}
                        className="flex min-h-[54px] items-start gap-2.5 rounded-2xl border border-[#E1D7BC] bg-[#FBF7EB] p-2.5 shadow-[0_8px_22px_rgba(15,36,25,0.045)]"
                      >
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[#10291E] text-[#D8B76A]">
                          <Icon size={16} strokeWidth={2.2} />
                        </span>
                        <span className="pt-1 text-sm font-bold leading-5 text-[#284334]">{feature.label}</span>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4 rounded-2xl border border-[#D9CBAA] bg-gradient-to-br from-[#F8F2E3] to-[#EEF5EA] p-4">
                  <p className="text-sm font-black text-[#10291E]">Simple branch-based billing</p>
                  <p className="mt-1.5 text-sm leading-6 text-[#496154]">
                    Add or reduce branches as your operations change. Each active branch uses the same pricing and product access.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
