import { Link, useNavigate } from 'react-router-dom'
import { MeemLogo } from '@/components/MeemLogo'
import { supportConfig } from '@/config/support'
import {
  Apple, ArrowRight, BarChart3, Boxes, Building2, CheckCircle2,
  ClipboardCheck, CreditCard, Mail, Menu, MessageCircle, Monitor,
  Package, Receipt, ShieldCheck, ShoppingCart, X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PublicLanguageToggle } from '@/components/localization/PublicLanguageToggle'
import { desktopDownloads } from '@/config/desktopDownloads'

const WA_LINK = supportConfig.whatsappLink
const WA_NUMBER = supportConfig.whatsappNumber
const EMAIL_LINK = supportConfig.emailLink
const KUBRI_WORDMARK_SRC = '/brand/kubiri-wordmark.png?v=kubri-2'

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
  const { t } = useTranslation('public')
  const productNames = t('mockup.products', { returnObjects: true }) as string[]
  const categories = t('mockup.categories', { returnObjects: true }) as string[]
  const products = productNames.map((name, index) => [name, ['45.00', '80.00', '18.00', '35.00', '28.00', '12.00'][index]])

  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <div className="absolute -inset-8 rounded-[32px] bg-gold-500/10 blur-3xl" />
      <div className="absolute -right-4 top-10 hidden rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white shadow-2xl shadow-black/20 backdrop-blur-xl md:block">
        <p className="text-[11px] font-semibold text-gold-200">{t('mockup.owner')}</p>
        <p className="mt-1 text-xs text-white/70">{t('mockup.branches')}</p>
      </div>
      <div className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[#071510] shadow-[0_32px_120px_rgba(0,0,0,0.46)] ring-1 ring-white/[0.04]">
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
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">{t('mockup.session')}</p>
                <p className="mt-1 text-sm font-bold text-white">{t('mockup.counter')}</p>
              </div>
              <span className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-bold text-emerald-200">
                {t('mockup.ready')}
              </span>
            </div>
            <div className="mb-4 grid grid-cols-4 gap-2">
              {categories.map((cat, index) => (
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
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">{t('mockup.order')}</p>
            <div className="mt-3 flex-1 space-y-2">
              {[
                [productNames[1], '1', '80.00'], [productNames[0], '2', '90.00'], [productNames[2], '1', '18.00'],
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
                <span>{t('mockup.total')}</span><span className="text-gold-300">SAR 188.00</span>
              </div>
            </div>
            <button className="mt-3 rounded-xl bg-gold-500 py-2 text-[11px] font-black text-[#0F2419] shadow-lg shadow-black/20">
              {t('mockup.complete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Header() {
  const { t } = useTranslation('public')
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const navLinks = [
    { label: t('nav.features'), type: 'section', target: 'features' },
    { label: t('nav.pricing'), type: 'route', target: '/pricing' },
    { label: t('nav.download'), type: 'section', target: 'windows' },
    { label: t('nav.faq'), type: 'route', target: '/faq' },
    { label: t('nav.contact'), type: 'section', target: 'contact' },
  ] as const

  const navItemClass = 'group relative isolate overflow-hidden rounded-2xl px-3.5 py-2 text-sm font-semibold text-white/[0.74] transition-[color,background,transform] duration-200 before:absolute before:inset-x-2 before:top-0 before:h-px before:scale-x-0 before:bg-gold-300/80 before:opacity-0 before:blur-[1px] before:transition-[transform,opacity] before:duration-200 after:absolute after:inset-0 after:-z-10 after:rounded-2xl after:bg-[radial-gradient(circle_at_50%_0%,rgba(200,169,110,0.28),transparent_54%)] after:opacity-0 after:transition-opacity after:duration-200 hover:bg-white/[0.055] hover:text-white hover:before:scale-x-100 hover:before:opacity-100 hover:after:opacity-100 active:scale-[0.98]'
  const actionBaseClass = 'group relative isolate inline-flex h-10 items-center justify-center overflow-hidden rounded-full px-4 text-sm font-black transition-[background,border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071510] active:scale-[0.98]'

  return (
    <header className={`fixed left-0 right-0 top-0 z-50 transition-[background,box-shadow] duration-300 ${scrolled ? 'bg-[#071510]/75 shadow-[0_18px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl' : 'bg-transparent'}`}>
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
        <nav className="relative grid h-[62px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[auto_auto_minmax(0,1fr)_auto] md:gap-4">
          <div className="justify-self-start">
            <PublicLanguageToggle />
          </div>
          <Link to="/" className="z-10 flex-shrink-0 justify-self-start transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98]">
            <MeemLogo size="md" />
          </Link>
          <div className="hidden items-center justify-center rounded-[26px] border border-white/[0.13] bg-[#06120D]/[0.72] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_24px_80px_rgba(0,0,0,0.30)] ring-1 ring-white/[0.035] backdrop-blur-2xl md:flex md:justify-self-center">
            {navLinks.map(link => (
              link.type === 'section' ? (
                <button key={link.label} onClick={() => scrollTo(link.target)}
                  className={navItemClass}>
                  {link.label}
                </button>
              ) : (
                <Link key={link.label} to={link.target}
                  className={navItemClass}>
                  {link.label}
                </Link>
              )
            ))}
          </div>

          <div className="hidden items-center justify-end gap-1.5 rounded-full border border-white/[0.12] bg-[#06120D]/[0.66] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_62px_rgba(0,0,0,0.24)] ring-1 ring-white/[0.035] backdrop-blur-2xl md:flex md:justify-self-end">
            <Link to="/login" state={{ from: '/' }} className={`${actionBaseClass} border border-white/[0.10] bg-white/[0.06] text-white/[0.90] hover:border-white/[0.18] hover:bg-white/[0.10] hover:text-white`}>
              <span className="absolute inset-0 -z-10 translate-x-[-105%] rounded-full bg-white/[0.08] opacity-0 transition-[opacity,transform] duration-300 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
              <span className="relative pr-0 transition-transform duration-200 group-hover:-translate-x-1.5">{t('nav.signIn')}</span>
              <ArrowRight size={14} className="absolute right-3 translate-x-2 opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
            </Link>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
              className={`${actionBaseClass} border border-gold-200/60 bg-gold-500 pl-5 pr-5 text-[#071510] shadow-[0_10px_30px_rgba(200,169,110,0.26)] hover:-translate-y-0.5 hover:border-gold-100 hover:shadow-[0_18px_48px_rgba(200,169,110,0.34)]`}>
              <span className="absolute inset-0 -z-10 translate-x-[-105%] rounded-full bg-[#0F2419] opacity-0 transition-[opacity,transform] duration-300 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
              <span className="relative transition-[color,transform] duration-200 group-hover:-translate-x-1.5 group-hover:text-white group-focus-visible:text-white">{t('nav.getStarted')}</span>
              <ArrowRight size={14} className="absolute right-3 translate-x-2 text-white opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
            </a>
          </div>

          <button onClick={() => setOpen(v => !v)} aria-label={open ? t('nav.closeMenu') : t('nav.menu')} className="ml-auto rounded-[18px] border border-white/[0.10] bg-[#06120D]/[0.58] p-3 text-white/75 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-2xl transition-colors hover:bg-white/[0.07] md:hidden">
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </nav>
      </div>
      {open && (
        <div className="mx-4 mt-2 rounded-[22px] border border-white/10 bg-[#071510]/95 p-3 shadow-2xl shadow-black/30 backdrop-blur-2xl md:hidden">
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
            <button onClick={() => navigate('/login', { state: { from: '/' } })} className="rounded-xl border border-white/10 px-3 py-2.5 text-sm font-semibold text-white/80">{t('nav.signIn')}</button>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-gold-500 px-3 py-2.5 text-center text-sm font-black text-[#0F2419]">{t('nav.getStarted')}</a>
          </div>
        </div>
      )}
    </header>
  )
}

const FEATURES = [
  {
    icon: ShoppingCart,
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
    icon: Boxes,
    title: 'Stock and purchases',
    desc: 'Products, suppliers, purchase receiving, and branch inventory in one place.',
  },
  {
    icon: ClipboardCheck,
    title: 'Register session closing',
    desc: 'Open shifts, close registers, review totals, and keep cash checks organized.',
  },
  {
    icon: BarChart3,
    title: 'VAT support reports',
    desc: 'Sales, purchases, expenses, and VAT summaries prepared for owner review.',
  },
  {
    icon: Building2,
    title: 'Multi-branch dashboard',
    desc: 'See every branch from one owner dashboard with sales, sessions, reports, and settings in one place.',
  },
]

function FeatureCardPattern() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-70"
      style={{
        backgroundImage:
          'linear-gradient(rgba(27,107,58,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(27,107,58,0.055) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
        maskImage: 'linear-gradient(135deg, black 0%, rgba(0,0,0,0.72) 34%, transparent 76%)',
      }}
    />
  )
}

function FeatureCard({ feature, featured = false }: {
  feature: typeof FEATURES[number]
  featured?: boolean
}) {
  const { t } = useTranslation('public')
  const featureIndex = FEATURES.indexOf(feature)
  return (
    <article
      className={`group relative isolate flex min-h-[260px] overflow-hidden rounded-[28px] border border-[#D9E4DA] bg-gradient-to-br from-white via-[#FBFAF5] to-[#EEF7F1] p-6 shadow-[0_18px_60px_rgba(7,21,16,0.08)] ring-1 ring-white transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-1 hover:border-gold-300 hover:shadow-[0_26px_80px_rgba(7,21,16,0.13)] ${
        featured ? 'lg:col-span-2' : ''
      }`}
    >
      <FeatureCardPattern />
      <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gold-400/15 blur-3xl transition-opacity duration-200 group-hover:opacity-90" aria-hidden="true" />
      <div className="absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-primary-500/20 via-gold-400/50 to-transparent" aria-hidden="true" />

      <div className={`relative z-10 flex h-full w-full flex-col ${featured ? 'lg:max-w-2xl' : ''}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-13 w-13 items-center justify-center rounded-[20px] border border-primary-500/10 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_30px_rgba(27,107,58,0.10)] transition-[background,box-shadow,transform] duration-200 group-hover:-translate-y-0.5 group-hover:bg-[#EEF7F1] group-hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_36px_rgba(27,107,58,0.14)]">
            <feature.icon size={23} className="text-primary-700" aria-hidden="true" />
          </div>
          <div className="mt-1 h-2 w-10 rounded-full bg-gradient-to-r from-gold-300/80 to-primary-500/30 opacity-70" aria-hidden="true" />
        </div>

        <div className="mt-8">
          <h3 className="text-xl font-black leading-tight text-[#071510]">{t(`features.items.${featureIndex}.title`)}</h3>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#52665A]">{t(`features.items.${featureIndex}.description`)}</p>
        </div>

        <div className="mt-auto pt-8">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary-700/55">
            <span className="h-px w-8 bg-primary-700/20" aria-hidden="true" />
            Kubri
          </div>
        </div>
      </div>
    </article>
  )
}

function Hero() {
  const { t } = useTranslation('public')
  const heroItems = t('hero.items', { returnObjects: true }) as string[]
  return (
    <section className="relative overflow-hidden border-b border-[#D9E1D8] bg-[#071510] pt-28">
      <Pattern />
      <div className="absolute left-[8%] top-20 h-[540px] w-[540px] rounded-full bg-primary-500/25 blur-3xl" />
      <div className="absolute bottom-[-160px] right-[10%] h-[520px] w-[520px] rounded-full bg-gold-500/10 blur-3xl" />
      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl grid-cols-1 items-center gap-14 px-4 pb-24 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
        <div>
          <h1 className="max-w-3xl text-4xl font-black leading-[1.04] tracking-tight text-white sm:text-6xl lg:text-7xl">
            {t('hero.title')}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/80 sm:text-xl">
            {t('hero.subtitle')}
          </p>
          <div className="mt-8 grid max-w-xl grid-cols-1 gap-3 text-sm font-semibold text-white/[0.82] sm:grid-cols-2">
            {heroItems.map(item => (
              <div key={item} className="flex items-center gap-2">
                <CheckCircle2 size={16} className="flex-shrink-0 text-gold-300" />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gold-500 px-6 py-4 text-sm font-black text-[#0F2419] shadow-xl shadow-gold-500/25 transition-[background,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:bg-gold-400 hover:shadow-gold-500/30 active:translate-y-0 active:scale-[0.98]">
              {t('nav.getStarted')} <ArrowRight size={17} />
            </a>
            <Link to="/pricing" className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-4 text-sm font-bold text-white transition-[background,border-color,transform] duration-150 hover:border-white/30 hover:bg-white/[0.08] active:scale-[0.98]">
              {t('hero.viewPricing')}
            </Link>
          </div>
        </div>
        <ProductMockup />
      </div>
    </section>
  )
}

function Features() {
  const { t } = useTranslation('public')
  return (
    <section id="features" className="relative scroll-mt-28 overflow-hidden bg-[#F7F5EF] py-28">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(200,169,110,0.13),transparent_30%),linear-gradient(180deg,#F7F5EF_0%,#FFFFFF_45%,#F7F5EF_100%)]" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-7 border-b border-[#DDE6DD] pb-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px w-10 bg-gradient-to-r from-primary-600/50 to-gold-400/70" aria-hidden="true" />
              <p className="text-xs font-black uppercase tracking-[0.22em] text-primary-700/70">{t('features.eyebrow')}</p>
            </div>
            <h2 className="max-w-3xl text-3xl font-black leading-tight text-[#071510] sm:text-5xl">
              {t('features.title')}
            </h2>
          </div>
          <p className="max-w-2xl text-base leading-7 text-[#385246] lg:ml-auto">
            {t('features.subtitle')}
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature, index) => (
            <FeatureCard
              key={feature.title}
              feature={feature}
              featured={index === 6}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function PricingGlowLink({ to, children, primary = false }: {
  to: string
  children: ReactNode
  primary?: boolean
}) {
  const baseClass = 'group relative isolate inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl px-5 py-3 text-sm font-black transition-[border-color,box-shadow,transform] duration-200 before:absolute before:inset-[-1px] before:-z-20 before:rounded-2xl before:bg-gradient-to-r before:from-gold-300 before:via-primary-300 before:to-gold-500 before:opacity-0 before:blur-md before:transition-opacity before:duration-200 after:absolute after:inset-[1px] after:-z-10 after:rounded-[15px] after:transition-colors after:duration-200 hover:-translate-y-0.5 hover:before:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071510] active:translate-y-0 active:scale-[0.98]'
  const toneClass = primary
    ? 'border border-gold-200/60 bg-gold-500 text-[#071510] shadow-[0_16px_42px_rgba(200,169,110,0.25)] after:bg-gold-500 hover:border-gold-100 hover:shadow-[0_22px_62px_rgba(200,169,110,0.34)] hover:after:bg-gold-400'
    : 'border border-white/12 bg-white/[0.055] text-white shadow-[0_16px_42px_rgba(0,0,0,0.18)] after:bg-[#0B1D14]/95 hover:border-white/25 hover:shadow-[0_20px_58px_rgba(0,0,0,0.25)] hover:after:bg-[#10281B]/95'

  return (
    <Link to={to} className={`${baseClass} ${toneClass}`}>
      <span className="relative z-10">{children}</span>
      <ArrowRight size={15} className="relative z-10 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  )
}

function PricingGlowAnchor({ href, children }: {
  href: string
  children: ReactNode
}) {
  const className = 'group relative isolate inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl border border-white/12 bg-white/[0.055] px-5 py-3 text-sm font-black text-white shadow-[0_16px_42px_rgba(0,0,0,0.18)] transition-[border-color,box-shadow,transform] duration-200 before:absolute before:inset-[-1px] before:-z-20 before:rounded-2xl before:bg-gradient-to-r before:from-primary-300 before:via-gold-300 before:to-primary-500 before:opacity-0 before:blur-md before:transition-opacity before:duration-200 after:absolute after:inset-[1px] after:-z-10 after:rounded-[15px] after:bg-[#0B1D14]/95 after:transition-colors after:duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:shadow-[0_20px_58px_rgba(0,0,0,0.25)] hover:before:opacity-70 hover:after:bg-[#10281B]/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071510] active:translate-y-0 active:scale-[0.98]'

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      <span className="relative z-10">{children}</span>
    </a>
  )
}

function PricingTeaser() {
  const { t } = useTranslation('public')
  return (
    <section className="relative overflow-hidden border-y border-white/10 bg-[#071510] px-4 py-20 sm:px-6 lg:px-8">
      <Pattern />
      <div className="absolute left-[12%] top-0 h-72 w-72 rounded-full bg-primary-500/20 blur-3xl" aria-hidden="true" />
      <div className="absolute bottom-[-100px] right-[15%] h-72 w-72 rounded-full bg-gold-500/12 blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[32px] border border-white/10 bg-[#071510]/85 p-6 shadow-[0_30px_110px_rgba(0,0,0,0.34)] ring-1 ring-white/[0.05] backdrop-blur md:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(200,169,110,0.16),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.025))]" aria-hidden="true" />
        <div className="relative grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-sm font-black text-gold-300">{t('pricingTeaser.price')}</p>
            <h2 className="mt-3 text-3xl font-black text-white">{t('pricingTeaser.title')}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">{t('pricingTeaser.subtitle')}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <PricingGlowLink to="/pricing" primary>
              {t('hero.viewPricing')}
            </PricingGlowLink>
            <PricingGlowAnchor href={WA_LINK}>
              {t('nav.getStarted')}
            </PricingGlowAnchor>
          </div>
        </div>
      </div>
    </section>
  )
}

function WhatsAppIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12.04 2.25a9.65 9.65 0 0 0-8.4 14.38L2.5 21.75l5.23-1.1a9.66 9.66 0 1 0 4.31-18.4Zm0 1.75a7.91 7.91 0 0 1 6.77 12.01 7.9 7.9 0 0 1-9.05 3.13l-.29-.11-3.89.82.84-3.76-.15-.31A7.9 7.9 0 0 1 12.04 4Zm-3.36 4.1c-.18 0-.46.06-.7.33-.24.27-.92.9-.92 2.18s.95 2.54 1.08 2.71c.13.18 1.84 2.95 4.54 4.02 2.24.88 2.7.7 3.19.66.49-.04 1.58-.64 1.8-1.27.22-.62.22-1.15.16-1.27-.07-.11-.24-.18-.51-.31-.27-.13-1.58-.78-1.82-.87-.24-.09-.42-.13-.6.13-.18.27-.69.87-.84 1.04-.15.18-.31.2-.58.07-.27-.13-1.13-.42-2.15-1.33-.79-.71-1.33-1.58-1.49-1.85-.15-.27-.02-.41.12-.54.12-.12.27-.31.4-.47.13-.16.18-.27.27-.45.09-.18.04-.33-.02-.47-.07-.13-.6-1.44-.82-1.98-.22-.52-.44-.45-.6-.46h-.51Z" />
    </svg>
  )
}

function WindowsSection() {
  const { t } = useTranslation('public')
  const downloadButtonClass = 'group flex min-h-36 flex-1 flex-col items-start justify-between gap-6 rounded-[24px] border border-[#D8E2D8] bg-white/80 p-6 text-left text-[#071510] shadow-[0_18px_48px_rgba(7,21,16,0.08)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-[0_24px_60px_rgba(7,21,16,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/80 focus-visible:ring-offset-2 active:translate-y-0 active:scale-[0.99] sm:p-7'

  return (
    <section id="windows" className="relative scroll-mt-28 overflow-hidden bg-[#F7F5EF] px-4 py-20 sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(200,169,110,0.14),transparent_31%),radial-gradient(circle_at_86%_70%,rgba(27,107,58,0.10),transparent_34%),linear-gradient(180deg,#F7F5EF_0%,#FFFFFF_42%,#F7F5EF_100%)]" />
      <div className="relative mx-auto max-w-5xl rounded-[30px] border border-[#DDE6DD] bg-white/78 p-7 shadow-[0_22px_70px_rgba(7,21,16,0.10)] ring-1 ring-white backdrop-blur sm:p-10">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-black text-[#071510] sm:text-4xl">{t('desktop.title')}</h2>
          <p className="mt-3 text-base leading-7 text-[#52665A]">{t('desktop.subtitle')}</p>
        </div>
        <div className="mx-auto mt-8 flex max-w-3xl flex-col gap-4 md:flex-row">
          <a href={desktopDownloads.macos.dmg.href} download className={downloadButtonClass} aria-label={t('desktop.macDownloadLabel')}>
            <span className="flex items-center gap-3 text-lg font-black">
              <Apple size={24} aria-hidden="true" /> {t('desktop.downloadMac')}
            </span>
            <span className="text-sm font-semibold text-[#65766B]">{t('desktop.macPlatform')}</span>
          </a>
          <a href={desktopDownloads.windows.installer.href} download className={downloadButtonClass} aria-label={t('desktop.windowsDownloadLabel')}>
            <span className="flex items-center gap-3 text-lg font-black">
              <Monitor size={24} aria-hidden="true" /> {t('desktop.downloadWindows')}
            </span>
            <span className="text-sm font-semibold text-[#65766B]">{t('desktop.windowsPlatform')}</span>
          </a>
        </div>
      </div>

    </section>
  )
}

function ContactSection() {
  const { t } = useTranslation('public')
  return (
    <section id="contact" className="relative overflow-hidden border-y border-white/10 bg-[#071510] px-4 py-24 sm:px-6 lg:px-8">
      <Pattern />
      <div className="absolute left-1/2 top-12 h-72 w-72 -translate-x-1/2 rounded-full bg-gold-500/10 blur-3xl" />
      <div className="relative mx-auto max-w-4xl rounded-[32px] border border-white/10 bg-white/[0.045] px-6 py-12 text-center shadow-[0_28px_100px_rgba(0,0,0,0.24)] ring-1 ring-white/[0.04] backdrop-blur sm:px-10">
        <h2 className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2 text-3xl font-black text-white sm:gap-x-2 sm:text-5xl" aria-label={t('contact.aria')}>
          <span aria-hidden="true">{t('contact.before')}</span>
          <img
            src={KUBRI_WORDMARK_SRC}
            alt=""
            aria-hidden="true"
            className="inline-block h-[0.98em] w-auto -translate-y-[0.08em] object-contain sm:h-[1.04em]"
          />
          <span aria-hidden="true">{t('contact.after')}</span>
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/70">
          {t('contact.text')}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-300/30 bg-emerald-500 px-6 py-4 text-sm font-black text-white shadow-xl shadow-emerald-950/30 transition-[border-color,background,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-emerald-200/60 hover:bg-emerald-600 hover:shadow-emerald-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071510] active:translate-y-0 active:scale-[0.98] sm:w-auto">
            <WhatsAppIcon className="h-4 w-4" /> WhatsApp {WA_NUMBER}
          </a>
          <a href={EMAIL_LINK}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/[0.055] px-6 py-4 text-sm font-bold text-white shadow-[0_16px_42px_rgba(0,0,0,0.18)] transition-[background,border-color,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.09] hover:shadow-[0_20px_58px_rgba(0,0,0,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071510] active:translate-y-0 active:scale-[0.98] sm:w-auto">
            <Mail size={17} /> support@kubri.shop
          </a>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  const { t } = useTranslation('public')
  return (
    <footer className="relative overflow-hidden border-t border-gold-400/15 bg-[#050F0B] px-4 py-14 text-white/65 sm:px-6 lg:px-8">
      <Pattern />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_10%,rgba(200,169,110,0.12),transparent_30%),radial-gradient(circle_at_85%_24%,rgba(27,107,58,0.24),transparent_34%),linear-gradient(180deg,#071510_0%,#050F0B_100%)]" />
      <div className="relative mx-auto max-w-7xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_0.8fr_0.8fr]">
          <div>
            <MeemLogo size="md" />
            <p className="mt-4 max-w-sm text-sm leading-6">{t('footer.description')}</p>
            <p className="mt-3 text-sm font-black text-gold-300">kubri.shop</p>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-white">{t('footer.product')}</p>
            <button onClick={() => scrollTo('features')} className="block text-sm font-semibold text-white/70 hover:text-gold-200">{t('nav.features')}</button>
            <Link to="/pricing" className="block text-sm font-semibold text-white/70 hover:text-gold-200">{t('nav.pricing')}</Link>
            <button onClick={() => scrollTo('windows')} className="block text-sm font-semibold text-white/70 hover:text-gold-200">{t('nav.download')}</button>
            <Link to="/faq" className="block text-sm font-semibold text-white/70 hover:text-gold-200">{t('nav.faq')}</Link>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-white">{t('footer.contact')}</p>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="block text-sm font-semibold text-white/70 hover:text-gold-200">WhatsApp {WA_NUMBER}</a>
            <a href={EMAIL_LINK} className="block text-sm font-semibold text-white/70 hover:text-gold-200">support@kubri.shop</a>
            <Link to="/terms" className="block text-sm font-semibold text-white/70 hover:text-gold-200">{t('footer.terms')}</Link>
            <Link to="/privacy" className="block text-sm font-semibold text-white/70 hover:text-gold-200">{t('footer.privacy')}</Link>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs font-semibold text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <p>{t('footer.rights')}</p>
          <p>{t('footer.built')}</p>
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
