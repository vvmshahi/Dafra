import { Link, useNavigate } from 'react-router-dom'
import { MeemLogo } from '@/components/MeemLogo'
import { supportConfig } from '@/config/support'
import {
  ArrowRight, BarChart3, CheckCircle2, CreditCard, Download,
  GitBranch, Mail, Menu, MessageCircle, Package, Receipt,
  ShieldCheck, Store, X,
} from 'lucide-react'
import { useEffect, useState, type MouseEvent } from 'react'

const WA_LINK = supportConfig.whatsappLink
const EMAIL_LINK = supportConfig.emailLink

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

function Pattern() {
  return (
    <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <pattern id="kubri-home-pattern" x="0" y="0" width="96" height="96" patternUnits="userSpaceOnUse">
          <path d="M28 6h40l22 22v40L68 90H28L6 68V28Z" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
          <path d="M48 20l28 28-28 28-28-28Z" fill="none" stroke="rgba(200,169,110,0.065)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#kubri-home-pattern)" />
    </svg>
  )
}

function ProductMockup() {
  const products = [
    ['Retail item', '45.00'],
    ['Repair service', '80.00'],
    ['Coffee order', '18.00'],
    ['Gift box', '35.00'],
    ['Rice 5kg', '28.00'],
    ['Water pack', '12.00'],
  ]

  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <div className="absolute -inset-8 rounded-[32px] bg-gold-500/10 blur-3xl" />
      <div className="absolute -right-4 top-10 hidden rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white shadow-2xl backdrop-blur md:block">
        <p className="text-[11px] font-semibold text-gold-200">Owner dashboard</p>
        <p className="mt-1 text-xs text-white/70">3 branches in view</p>
      </div>
      <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[#071510] shadow-[0_30px_110px_rgba(0,0,0,0.42)]">
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-gold-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
          </div>
          <span className="rounded-full bg-[#0F2419] px-3 py-1 text-[10px] font-semibold text-white/60">app.kubri.shop/pos</span>
        </div>

        <div className="grid min-h-[340px] grid-cols-[1fr_152px] bg-[#0A1D13] sm:grid-cols-[1fr_180px]">
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">Register session open</p>
                <p className="mt-1 text-sm font-bold text-white">Main counter</p>
              </div>
              <span className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-bold text-emerald-200">
                ZATCA Phase 2 ready
              </span>
            </div>
            <div className="mb-4 grid grid-cols-4 gap-2">
              {['All', 'Retail', 'Food', 'Service'].map((cat, index) => (
                <span key={cat} className={`rounded-xl px-2 py-2 text-center text-[10px] font-semibold ${
                  index === 0 ? 'bg-gold-500 text-[#0F2419]' : 'bg-white/[0.06] text-white/60'
                }`}>
                  {cat}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {products.map(([name, price]) => (
                <div key={name} className="min-h-[76px] rounded-2xl border border-white/10 bg-white/[0.055] p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-xl bg-gold-400/10">
                    <Package size={13} className="text-gold-300" />
                  </div>
                  <p className="truncate text-[11px] font-semibold text-white/80">{name}</p>
                  <p className="mt-1 text-[10px] font-bold text-gold-300">SAR {price}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col border-l border-white/10 bg-[#0F2419]/90 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Current order</p>
            <div className="mt-3 flex-1 space-y-2">
              {[
                ['Repair service', '1', '80.00'],
                ['Retail item', '2', '90.00'],
                ['Coffee order', '1', '18.00'],
              ].map(([name, qty, price]) => (
                <div key={name} className="rounded-xl bg-white/[0.055] p-2">
                  <p className="truncate text-[10px] font-semibold text-white/80">{name}</p>
                  <div className="mt-1 flex justify-between text-[10px]">
                    <span className="text-white/40">x{qty}</span>
                    <span className="font-bold text-gold-300">SAR {price}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-1 border-t border-white/10 pt-3">
              <div className="flex justify-between text-[10px] text-white/50">
                <span>VAT</span><span>SAR 24.52</span>
              </div>
              <div className="flex justify-between text-xs font-black text-white">
                <span>Total</span><span className="text-gold-300">SAR 188.00</span>
              </div>
            </div>
            <button className="mt-3 rounded-xl bg-gold-500 py-2 text-[11px] font-black text-[#0F2419]">
              Complete sale
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Header() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const navLinks = [
    { label: 'Features', type: 'section', target: 'features' },
    { label: 'Pricing', type: 'route', target: '/pricing' },
    { label: 'Windows app', type: 'section', target: 'windows' },
    { label: 'FAQ', type: 'route', target: '/faq' },
    { label: 'Contact', type: 'section', target: 'contact' },
  ] as const

  return (
    <header className={`fixed left-0 right-0 top-0 z-50 transition-all duration-300 ${scrolled ? 'bg-[#071510]/90 shadow-[0_12px_50px_rgba(0,0,0,0.25)] backdrop-blur-xl' : 'bg-transparent'}`}>
      <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8">
        <nav className="flex h-14 items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.055] px-3 shadow-inner shadow-white/5 backdrop-blur-xl">
          <Link to="/" className="flex-shrink-0"><MeemLogo size="sm" /></Link>
          <div className="hidden flex-1 items-center justify-center gap-1 md:flex">
            {navLinks.map(link => (
              link.type === 'section' ? (
                <button key={link.label} onClick={() => scrollTo(link.target)}
                  className="rounded-xl px-3 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white">
                  {link.label}
                </button>
              ) : (
                <Link key={link.label} to={link.target}
                  className="rounded-xl px-3 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white">
                  {link.label}
                </Link>
              )
            ))}
          </div>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <Link to="/login" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white/75 transition-colors hover:border-white/30 hover:bg-white/[0.06] hover:text-white">
              Sign in
            </Link>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-gold-500 px-4 py-2 text-sm font-black text-[#0F2419] shadow-lg shadow-gold-500/20 transition-all hover:-translate-y-0.5 hover:bg-gold-400">
              Get Started <ArrowRight size={14} />
            </a>
          </div>
          <button onClick={() => setOpen(v => !v)} className="ml-auto rounded-xl p-2 text-white/75 hover:bg-white/[0.07] md:hidden">
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </nav>
      </div>
      {open && (
        <div className="mx-4 mt-2 rounded-2xl border border-white/10 bg-[#071510]/95 p-3 shadow-2xl backdrop-blur-xl md:hidden">
          {navLinks.map(link => (
            link.type === 'section' ? (
              <button key={link.label} onClick={() => { setOpen(false); scrollTo(link.target) }}
                className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-white/75 hover:bg-white/[0.07] hover:text-white">
                {link.label}
              </button>
            ) : (
              <Link key={link.label} to={link.target} onClick={() => setOpen(false)}
                className="block rounded-xl px-3 py-2.5 text-sm font-semibold text-white/75 hover:bg-white/[0.07] hover:text-white">
                {link.label}
              </Link>
            )
          ))}
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
            <button onClick={() => navigate('/login')} className="rounded-xl border border-white/10 px-3 py-2.5 text-sm font-semibold text-white/80">Sign in</button>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-gold-500 px-3 py-2.5 text-center text-sm font-black text-[#0F2419]">Get Started</a>
          </div>
        </div>
      )}
    </header>
  )
}

const FEATURES = [
  {
    icon: Receipt,
    title: 'Fast POS checkout',
    desc: 'A focused counter workflow for sales, receipts, customers, and branch controls.',
  },
  {
    icon: ShieldCheck,
    title: 'ZATCA Phase 2 invoicing',
    desc: 'ZATCA-ready workflows for Saudi e-invoicing with safe business setup.',
  },
  {
    icon: CreditCard,
    title: 'Payments and split payments',
    desc: 'Track cash, card, and split tenders cleanly across every invoice.',
  },
  {
    icon: Package,
    title: 'Stock and purchases',
    desc: 'Products, suppliers, purchase receiving, and branch inventory in one place.',
  },
  {
    icon: Store,
    title: 'Register session closing',
    desc: 'Open shifts, close registers, review totals, and keep cash checks organized.',
  },
  {
    icon: BarChart3,
    title: 'VAT support reports',
    desc: 'Sales, purchases, expenses, and VAT summaries prepared for owner review.',
  },
  {
    icon: GitBranch,
    title: 'Multi-branch dashboard',
    desc: 'See every branch from one owner dashboard with sales, sessions, reports, and settings in one place.',
  },
]

function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#071510] pt-28">
      <Pattern />
      <div className="absolute left-[8%] top-20 h-[540px] w-[540px] rounded-full bg-primary-500/25 blur-3xl" />
      <div className="absolute bottom-[-160px] right-[10%] h-[520px] w-[520px] rounded-full bg-gold-500/10 blur-3xl" />
      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl grid-cols-1 items-center gap-14 px-4 pb-20 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
        <div>
          <h1 className="max-w-3xl text-4xl font-black leading-[1.04] tracking-tight text-white sm:text-6xl lg:text-7xl">
            Your simple bridge to ZATCA Phase 2 invoicing.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/80 sm:text-xl">
            Run POS sales, payments, stock, register sessions, and VAT reports from one simple platform built for Saudi businesses.
          </p>
          <div className="mt-8 grid max-w-xl grid-cols-1 gap-3 text-sm font-semibold text-white/80 sm:grid-cols-2">
            {[
              'ZATCA Phase 2 workflows',
              'Cash, card, and split payments',
              'Register session closing',
              'Multi-branch dashboards',
            ].map(item => (
              <div key={item} className="flex items-center gap-2">
                <CheckCircle2 size={16} className="flex-shrink-0 text-gold-300" />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gold-500 px-6 py-4 text-sm font-black text-[#0F2419] shadow-xl shadow-gold-500/20 transition-all hover:-translate-y-0.5 hover:bg-gold-400">
              Get Started <ArrowRight size={17} />
            </a>
            <Link to="/pricing" className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-4 text-sm font-bold text-white transition-all hover:border-white/30 hover:bg-white/[0.08]">
              View Pricing
            </Link>
          </div>
        </div>
        <ProductMockup />
      </div>
    </section>
  )
}

function Features() {
  return (
    <section id="features" className="relative overflow-hidden bg-[#0F2419] py-24">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0)),radial-gradient(circle_at_80%_10%,rgba(200,169,110,0.16),transparent_30%)]" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <h2 className="text-3xl font-black leading-tight text-white sm:text-5xl">Built for the daily rhythm of Saudi branches.</h2>
          <p className="max-w-2xl text-base leading-7 text-white/70 lg:ml-auto">
            From the counter to the owner dashboard, Kubri keeps sales, tax workflows, stock, sessions, and reports moving together.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
          {FEATURES.map((feature, index) => (
            <article
              key={feature.title}
              className={`group min-h-[220px] rounded-[24px] border border-white/10 bg-white/[0.065] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.20)] backdrop-blur transition-all hover:-translate-y-1 hover:border-gold-400/40 hover:bg-white/[0.09] ${
                index === 0 || index === 1 ? 'lg:col-span-3' : index === 6 ? 'lg:col-span-6' : 'lg:col-span-2'
              }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-gold-400/20 bg-gold-400/10 shadow-inner shadow-white/5">
                <feature.icon size={22} className="text-gold-300" />
              </div>
              <h3 className="mt-6 text-lg font-bold text-white">{feature.title}</h3>
              <p className="mt-3 text-sm leading-6 text-white/65">{feature.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function PricingTeaser() {
  return (
    <section className="bg-[#071510] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-white/[0.09] to-white/[0.035] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.28)] backdrop-blur md:p-8">
        <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-sm font-bold text-gold-300">Start from SAR 100/month</p>
            <h2 className="mt-3 text-3xl font-black text-white">Simple pricing for each branch.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">Yearly option available. Includes a 7-day money-back guarantee.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link to="/pricing" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gold-500 px-5 py-3 text-sm font-black text-[#0F2419] hover:bg-gold-400">
              View Pricing <ArrowRight size={15} />
            </Link>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold text-white hover:bg-white/[0.07]">
              Get Started
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function WindowsSection() {
  function preventDownload(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
  }

  return (
    <section id="windows" className="bg-[#0F2419] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1fr_0.85fr] lg:items-center">
        <div className="rounded-[28px] border border-white/10 bg-white/[0.06] p-8 shadow-[0_24px_90px_rgba(0,0,0,0.20)]">
          <h2 className="text-3xl font-black text-white sm:text-4xl">Built for the counter.</h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-white/70">
            Use Kubri on your Windows POS device for a focused counter experience with products, payments, invoices, and register sessions in one view.
          </p>
          <a href="#" onClick={preventDownload}
            className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-[#0F2419] hover:bg-gold-100">
            <Download size={17} /> Download for Windows
          </a>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {['Touch-friendly POS', 'Fast invoice flow', 'Branch-ready settings'].map(item => (
            <div key={item} className="rounded-2xl border border-gold-400/20 bg-gold-400/10 px-5 py-4 text-sm font-bold text-gold-100">
              {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ContactSection() {
  return (
    <section id="contact" className="relative overflow-hidden bg-[#071510] px-4 py-20 sm:px-6 lg:px-8">
      <Pattern />
      <div className="relative mx-auto max-w-4xl text-center">
        <h2 className="text-3xl font-black text-white sm:text-5xl">Bring Kubri to your counter.</h2>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/70">
          Talk to us and get your business ready for ZATCA Phase 2 workflows.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-4 text-sm font-black text-white shadow-xl shadow-emerald-950/30 hover:bg-emerald-600 sm:w-auto">
            <MessageCircle size={17} /> WhatsApp
          </a>
          <a href={EMAIL_LINK}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-6 py-4 text-sm font-bold text-white hover:bg-white/[0.08] sm:w-auto">
            <Mail size={17} /> support@kubri.shop
          </a>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="bg-[#050F0B] px-4 py-12 text-white/60 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_0.8fr_0.8fr]">
          <div>
            <MeemLogo size="sm" />
            <p className="mt-4 max-w-sm text-sm leading-6">Kubri POS for Saudi businesses that need sales, ZATCA Phase 2 workflows, stock, sessions, VAT reports, and branch visibility.</p>
            <p className="mt-3 text-sm font-semibold text-gold-300">kubri.shop</p>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white">Product</p>
            <button onClick={() => scrollTo('features')} className="block text-sm hover:text-white">Features</button>
            <Link to="/pricing" className="block text-sm hover:text-white">Pricing</Link>
            <button onClick={() => scrollTo('windows')} className="block text-sm hover:text-white">Windows app</button>
            <Link to="/faq" className="block text-sm hover:text-white">FAQ</Link>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white">Contact</p>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="block text-sm hover:text-white">WhatsApp support</a>
            <a href={EMAIL_LINK} className="block text-sm hover:text-white">support@kubri.shop</a>
            <Link to="/terms" className="block text-sm hover:text-white">Terms</Link>
            <Link to="/privacy" className="block text-sm hover:text-white">Privacy</Link>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Kubri. All rights reserved.</p>
          <p>Built for Saudi businesses.</p>
        </div>
      </div>
    </footer>
  )
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#071510]">
      <Header />
      <Hero />
      <Features />
      <PricingTeaser />
      <WindowsSection />
      <ContactSection />
      <Footer />
    </div>
  )
}
