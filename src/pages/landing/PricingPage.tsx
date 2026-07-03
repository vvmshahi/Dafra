import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Download, MessageCircle } from 'lucide-react'
import { MeemLogo } from '@/components/MeemLogo'
import { supportConfig } from '@/config/support'

const WA_LINK = supportConfig.whatsappLink

const FEATURES = [
  'ZATCA Phase 2 workflows',
  'QR invoices',
  'POS checkout',
  'Cash, card, and split payments',
  'Stock and purchases',
  'Register session closing',
  'VAT support reports',
  'Multi-branch dashboard',
  'Windows app',
]

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
  return (
    <div className="min-h-screen bg-[#071510] text-white">
      <header className="relative overflow-hidden border-b border-white/10 bg-[#0F2419]">
        <Pattern />
        <div className="relative z-10 mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/"><MeemLogo size="sm" /></Link>
          <div className="flex items-center gap-2">
            <Link to="/faq" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/[0.06] hover:text-white sm:inline">FAQ</Link>
            <Link to="/login" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/[0.06]">Sign in</Link>
          </div>
        </div>
        <div className="relative z-10 mx-auto max-w-7xl px-4 pb-8 pt-6 sm:px-6 lg:px-8">
          <Link to="/" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-white/60 hover:text-white">
            <ArrowLeft size={15} /> Home
          </Link>
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div>
              <h1 className="text-3xl font-black leading-tight sm:text-5xl">Simple pricing for every branch.</h1>
              <p className="mt-3 max-w-xl text-base leading-7 text-white/70">Start with one branch and add more as your business grows.</p>
            </div>
            <div className="rounded-2xl border border-gold-400/20 bg-gold-400/10 px-5 py-4 text-sm font-semibold text-gold-100 lg:ml-auto">
              7-day money-back guarantee
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="grid gap-5 lg:grid-cols-[0.86fr_1.14fr]">
          <div className="rounded-[26px] border border-white/10 bg-white/[0.07] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.26)] backdrop-blur">
            <p className="text-sm font-bold text-gold-300">Kubri POS</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-2xl bg-[#071510] p-5">
                <p className="text-sm font-semibold text-white/60">Monthly</p>
                <p className="mt-1 text-4xl font-black text-white">SAR 100</p>
                <p className="mt-1 text-sm text-white/60">/ month / branch</p>
              </div>
              <div className="rounded-2xl border border-gold-400/20 bg-gold-400/10 p-5">
                <p className="text-sm font-semibold text-gold-200">Yearly</p>
                <p className="mt-1 text-4xl font-black text-white">SAR 1,000</p>
                <p className="mt-1 text-sm text-gold-100/70">/ year / branch</p>
              </div>
            </div>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gold-500 px-5 py-3.5 text-sm font-black text-[#0F2419] hover:bg-gold-400">
              <MessageCircle size={17} /> Get Started
            </a>
          </div>

          <div className="rounded-[26px] border border-white/10 bg-white/[0.055] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.20)] backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-black">Included in every branch</h2>
              <Download size={20} className="text-gold-300" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {FEATURES.map(feature => (
                <div key={feature} className="flex min-h-[54px] items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3">
                  <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-gold-300" />
                  <span className="text-sm leading-6 text-white/75">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
