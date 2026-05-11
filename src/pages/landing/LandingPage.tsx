import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MeemLogo } from '@/components/MeemLogo'
import {
  CheckCircle2, Zap, GitBranch, BarChart3, Package, Globe,
  Star, ChevronDown, ChevronUp, Menu, X, ArrowRight,
  Shield, MessageCircle, Mail,
} from 'lucide-react'

const WA_LINK    = 'https://wa.me/919895953210'
const EMAIL_LINK = 'mailto:vvmshahin@gmail.com'

function scrollToContact() {
  document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })
}

// ── Islamic geometric SVG pattern ─────────────────────────────────────────────
function GeometricPattern({ opacity = 0.04 }: { opacity?: number }) {
  return (
    <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="geo-land" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M24 4 L56 4 L76 24 L76 56 L56 76 L24 76 L4 56 L4 24 Z"
            fill="none" stroke={`rgba(255,255,255,${opacity})`} strokeWidth="1" />
          <rect x="22" y="22" width="36" height="36" transform="rotate(45 40 40)"
            fill="none" stroke={`rgba(200,169,110,${opacity * 1.8})`} strokeWidth="1" />
          <path d="M40 28 L43 36 L52 36 L45 42 L48 50 L40 45 L32 50 L35 42 L28 36 L37 36 Z"
            fill="none" stroke={`rgba(255,255,255,${opacity * 0.8})`} strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#geo-land)" />
    </svg>
  )
}

// ── POS Mockup ────────────────────────────────────────────────────────────────
function POSMockup() {
  const items = [
    { name: 'قهوة عربية', price: '12', emoji: '☕' },
    { name: 'كابتشينو',   price: '18', emoji: '🥛' },
    { name: 'كرواسان',    price: '14', emoji: '🥐' },
    { name: 'عصير برتقال',price: '16', emoji: '🍊' },
    { name: 'ماء معدني',  price: '5',  emoji: '💧' },
    { name: 'شاي أخضر',   price: '10', emoji: '🍵' },
  ]
  const cart = [
    { name: 'قهوة عربية', qty: 2, price: 24 },
    { name: 'كرواسان',    qty: 1, price: 14 },
  ]
  return (
    <div className="relative w-full max-w-[520px] mx-auto">
      {/* Glow effect */}
      <div className="absolute -inset-4 bg-gold-500/20 rounded-3xl blur-2xl" />
      {/* Screen */}
      <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
        {/* Browser chrome */}
        <div className="bg-gray-900 px-4 py-2.5 flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
          </div>
          <div className="flex-1 bg-gray-800 rounded text-[10px] text-gray-400 px-3 py-0.5 mx-3 text-center">
            app.meem.sa/pos
          </div>
        </div>
        {/* POS body */}
        <div className="bg-[#0a1e12] flex h-[280px] sm:h-[320px]">
          {/* Left: product grid */}
          <div className="flex-1 p-3 overflow-hidden">
            {/* Search bar */}
            <div className="bg-white/5 rounded-lg px-3 py-1.5 mb-3 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-white/20" />
              <div className="h-1.5 bg-white/10 rounded flex-1" />
            </div>
            {/* Category tabs */}
            <div className="flex gap-1.5 mb-3">
              {['الكل', 'مشروبات', 'طعام'].map((c, i) => (
                <span key={c} className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${
                  i === 0 ? 'bg-gold-500 text-[#0F2419]' : 'bg-white/10 text-white/60'
                }`}>{c}</span>
              ))}
            </div>
            {/* Products */}
            <div className="grid grid-cols-3 gap-1.5">
              {items.map(item => (
                <div key={item.name}
                  className="bg-white/5 hover:bg-white/10 rounded-lg p-2 cursor-pointer transition-colors border border-white/5">
                  <div className="text-base mb-1">{item.emoji}</div>
                  <p className="text-[8px] text-white/80 font-medium leading-tight mb-0.5" dir="rtl">{item.name}</p>
                  <p className="text-[9px] text-gold-400 font-bold">{item.price} ر.س</p>
                </div>
              ))}
            </div>
          </div>
          {/* Right: cart */}
          <div className="w-[130px] sm:w-[150px] bg-[#0F2419]/80 border-l border-white/5 flex flex-col p-2">
            <p className="text-[9px] text-white/40 font-semibold uppercase tracking-wider mb-2">الطلب</p>
            <div className="flex-1 space-y-1.5 overflow-hidden">
              {cart.map(ci => (
                <div key={ci.name} className="bg-white/5 rounded p-1.5">
                  <p className="text-[8px] text-white/80 mb-0.5" dir="rtl">{ci.name}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] text-white/40">×{ci.qty}</span>
                    <span className="text-[8px] text-gold-400 font-bold">{ci.price} ر.س</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-white/10 pt-2 mt-2 space-y-1">
              <div className="flex justify-between">
                <span className="text-[8px] text-white/40">الضريبة</span>
                <span className="text-[8px] text-white/60">5.70 ر.س</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[8px] text-white/60 font-medium">الإجمالي</span>
                <span className="text-[9px] text-gold-400 font-bold">43.70 ر.س</span>
              </div>
            </div>
            <button className="mt-2 w-full bg-gold-500 rounded text-[9px] text-[#0F2419] font-bold py-1.5">
              دفع الآن
            </button>
          </div>
        </div>
        {/* Status bar */}
        <div className="bg-gray-900 px-4 py-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] text-gray-400">متصل · ZATCA Phase 1 ✓</span>
          </div>
          <span className="text-[9px] text-gray-500">الرياض — فرع الملز</span>
        </div>
      </div>
      {/* Floating badges */}
      <div className="absolute -left-4 top-12 bg-white rounded-xl shadow-xl px-3 py-2 flex items-center gap-2 border border-gray-100">
        <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
          <CheckCircle2 size={14} className="text-emerald-500" />
        </div>
        <div>
          <p className="text-[9px] text-gray-400">ZATCA</p>
          <p className="text-[10px] font-bold text-gray-800">Compliant ✓</p>
        </div>
      </div>
      <div className="absolute -right-4 bottom-16 bg-white rounded-xl shadow-xl px-3 py-2 flex items-center gap-2 border border-gray-100">
        <div className="w-7 h-7 rounded-lg bg-gold-50 flex items-center justify-center">
          <Zap size={14} className="text-gold-600" />
        </div>
        <div>
          <p className="text-[9px] text-gray-400">فاتورة جديدة</p>
          <p className="text-[10px] font-bold text-gray-800">خلال 3 ثوانٍ</p>
        </div>
      </div>
    </div>
  )
}

// ── Navbar ────────────────────────────────────────────────────────────────────
function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open,     setOpen]     = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function scrollTo(id: string) {
    setOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      scrolled
        ? 'bg-[#0F2419]/95 backdrop-blur-md shadow-lg border-b border-white/5'
        : 'bg-transparent'
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16 gap-8">
          {/* Logo */}
          <Link to="/" className="flex-shrink-0">
            <MeemLogo size="sm" />
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-6 flex-1">
            {[
              { label: 'Features', id: 'features' },
              { label: 'Pricing',  id: 'pricing' },
              { label: 'FAQ',      id: 'faq' },
              { label: 'Contact',  id: 'contact' },
            ].map(l => (
              <button
                key={l.id}
                onClick={() => scrollTo(l.id)}
                className="text-white/70 hover:text-white text-sm font-medium transition-colors"
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3 ml-auto">
            <Link to="/login"
              className="text-white/80 hover:text-white text-sm font-medium px-4 py-2 rounded-xl border border-white/20 hover:border-white/40 transition-colors">
              Login
            </Link>
            <button
              onClick={scrollToContact}
              className="flex items-center gap-1.5 bg-gold-500 hover:bg-gold-400 text-[#0F2419] text-sm font-bold px-4 py-2 rounded-xl transition-colors shadow-lg shadow-gold-500/20">
              Get Started <ArrowRight size={14} />
            </button>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden ml-auto p-2 text-white/80 hover:text-white"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-[#0F2419]/98 backdrop-blur-md border-t border-white/10 px-4 py-4 space-y-2">
          {[
            { label: 'Features', id: 'features' },
            { label: 'Pricing',  id: 'pricing' },
            { label: 'FAQ',      id: 'faq' },
            { label: 'Contact',  id: 'contact' },
          ].map(l => (
            <button
              key={l.id}
              onClick={() => scrollTo(l.id)}
              className="block w-full text-left text-white/80 hover:text-white text-sm font-medium px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors"
            >
              {l.label}
            </button>
          ))}
          <div className="pt-2 space-y-2 border-t border-white/10">
            <Link to="/login" onClick={() => setOpen(false)}
              className="block text-center text-white/80 text-sm font-medium px-4 py-2.5 rounded-xl border border-white/20">
              Login
            </Link>
            <button onClick={() => { setOpen(false); scrollToContact() }}
              className="block w-full text-center bg-gold-500 text-[#0F2419] text-sm font-bold px-4 py-2.5 rounded-xl">
              Get Started — Contact Us
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}

// ── Hero ──────────────────────────────────────────────────────────────────────
function HeroSection() {
  return (
    <section id="hero" className="relative min-h-screen bg-[#0F2419] flex items-center overflow-hidden pt-16">
      <GeometricPattern />
      {/* Gradient blobs */}
      <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-[#1B6B3A]/30 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-gold-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">

          {/* Left: Copy */}
          <div className="space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 text-white/80 text-xs px-3.5 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              معتمد من هيئة الزكاة والضريبة والجمارك — ZATCA Certified
            </div>

            {/* Arabic headline */}
            <div>
              <h1
                className="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-tight"
                style={{ fontFamily: 'Cairo, sans-serif' }}
                dir="rtl"
              >
                نظام فوترة ذكي
                <br />
                <span className="text-gold-400">للمطاعم والكافيهات</span>
              </h1>
              <p className="text-xl text-white/60 mt-4 font-light leading-relaxed max-w-lg">
                Smart POS & ZATCA-Compliant Invoicing<br />
                for Saudi SMEs
              </p>
            </div>

            {/* Sub-points */}
            <div className="grid grid-cols-2 gap-3">
              {[
                'ZATCA Phase 1 & 2',
                'Arabic + English',
                'Multi-branch POS',
                'VAT Reports',
              ].map(f => (
                <div key={f} className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-gold-400 flex-shrink-0" />
                  <span className="text-sm text-white/70">{f}</span>
                </div>
              ))}
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={scrollToContact}
                className="flex items-center gap-2 bg-gold-500 hover:bg-gold-400 text-[#0F2419] font-bold px-6 py-3.5 rounded-xl transition-all shadow-xl shadow-gold-500/30 hover:shadow-gold-500/40 hover:-translate-y-0.5"
              >
                Get Started — Contact Us <ArrowRight size={16} />
              </button>
              <button
                onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                className="flex items-center gap-2 border border-white/20 text-white hover:bg-white/10 font-medium px-6 py-3.5 rounded-xl transition-all"
              >
                See Features
              </button>
            </div>

            {/* Social proof */}
            <div className="flex items-center gap-4 pt-2">
              <div className="flex -space-x-2">
                {['م', 'أ', 'خ', 'ف'].map((c, i) => (
                  <div key={i} className={`w-8 h-8 rounded-full border-2 border-[#0F2419] flex items-center justify-center text-xs font-bold text-white ${
                    ['bg-emerald-600','bg-blue-600','bg-purple-600','bg-amber-600'][i]
                  }`}>{c}</div>
                ))}
              </div>
              <div>
                <div className="flex items-center gap-0.5">
                  {[...Array(5)].map((_, i) => <Star key={i} size={12} fill="#C8A96E" className="text-gold-400" />)}
                </div>
                <p className="text-xs text-white/50 mt-0.5">Trusted by Saudi SMEs</p>
              </div>
            </div>
          </div>

          {/* Right: Mockup */}
          <div className="lg:pl-8">
            <POSMockup />
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce">
        <span className="text-white/40 text-xs">Scroll</span>
        <ChevronDown size={16} className="text-white/40" />
      </div>
    </section>
  )
}

// ── Features ──────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: Shield,
    title: 'ZATCA Compliant',
    titleAr: 'متوافق مع الزكاة',
    desc: 'Phase 1 QR codes and Phase 2 cryptographic signing. Fully certified for Saudi e-invoicing regulations.',
    color: 'text-emerald-600', bg: 'bg-emerald-50',
  },
  {
    icon: Zap,
    title: 'Fast POS',
    titleAr: 'نقطة بيع سريعة',
    desc: 'Tap to bill in seconds. Barcode scanner support, cash and card payments, instant receipt printing.',
    color: 'text-gold-600', bg: 'bg-gold-50',
  },
  {
    icon: GitBranch,
    title: 'Multi-Branch',
    titleAr: 'إدارة متعددة الفروع',
    desc: 'Manage all your locations from one dashboard. Separate inventory, staff, and reports per branch.',
    color: 'text-primary-600', bg: 'bg-primary-50',
  },
  {
    icon: BarChart3,
    title: 'Smart Reports',
    titleAr: 'تقارير ذكية',
    desc: 'Daily P&L, VAT summary, top products, and customer insights. Export-ready for tax filing.',
    color: 'text-violet-600', bg: 'bg-violet-50',
  },
  {
    icon: Package,
    title: 'Inventory Control',
    titleAr: 'إدارة المخزون',
    desc: 'Track stock levels, set reorder alerts, manage suppliers and purchase orders seamlessly.',
    color: 'text-blue-600', bg: 'bg-blue-50',
  },
  {
    icon: Globe,
    title: 'Works Everywhere',
    titleAr: 'يعمل في كل مكان',
    desc: 'Web browser, tablet, Windows POS terminal. Works with your existing hardware.',
    color: 'text-rose-600', bg: 'bg-rose-50',
  },
]

function FeaturesSection() {
  return (
    <section id="features" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <span className="inline-block text-xs font-semibold text-primary-600 bg-primary-50 px-3 py-1 rounded-full mb-4 uppercase tracking-wide">
            Features
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            Everything you need to run your business
          </h2>
          <p className="text-gray-500 mt-4 max-w-xl mx-auto">
            One platform for your POS, invoicing, inventory, and compliance — built specifically for Saudi restaurants and cafés.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map(f => (
            <div
              key={f.title}
              className="group p-6 rounded-2xl border border-gray-100 hover:border-primary-100 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 bg-white"
            >
              <div className={`w-11 h-11 rounded-xl ${f.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                <f.icon size={20} className={f.color} />
              </div>
              <h3 className="text-base font-semibold text-gray-900">{f.title}</h3>
              <p className="text-xs text-gray-400 mt-0.5 mb-2" style={{ fontFamily: 'Cairo, sans-serif' }} dir="rtl">{f.titleAr}</p>
              <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Pricing ───────────────────────────────────────────────────────────────────
function PricingSection() {
  const [annual, setAnnual] = useState(false)

  return (
    <section id="pricing" className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <span className="inline-block text-xs font-semibold text-primary-600 bg-primary-50 px-3 py-1 rounded-full mb-4 uppercase tracking-wide">
            Pricing
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            Simple, transparent pricing
          </h2>
          <p className="text-gray-500 mt-4">Per branch · No hidden fees</p>

          {/* Monthly / Annual toggle */}
          <div className="flex items-center justify-center gap-3 mt-6">
            <span className={`text-sm font-medium ${!annual ? 'text-gray-900' : 'text-gray-400'}`}>Monthly</span>
            <button
              onClick={() => setAnnual(v => !v)}
              className={`relative w-12 h-6 rounded-full transition-colors ${annual ? 'bg-primary-500' : 'bg-gray-200'}`}
            >
              <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${annual ? 'translate-x-6' : ''}`} />
            </button>
            <span className={`text-sm font-medium ${annual ? 'text-gray-900' : 'text-gray-400'}`}>
              Annual <span className="text-emerald-600 font-semibold text-xs ml-1">Save 2 months</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {/* Phase 1 */}
          <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col">
            <div className="mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Phase 1</p>
              <p className="text-sm text-gray-500 mb-4">ZATCA QR Code Invoicing</p>
              <div className="flex items-end gap-1">
                <span className="text-4xl font-black text-gray-900">SAR {annual ? '500' : '50'}</span>
                <span className="text-gray-500 mb-1.5 ml-1">/ branch / {annual ? 'year' : 'month'}</span>
              </div>
            </div>

            <ul className="space-y-3 flex-1 my-8">
              {[
                'ZATCA Phase 1 QR Code',
                'POS Billing Terminal',
                'Invoice Management',
                'Expense Tracking',
                'Inventory Management',
                'Sales Reports',
                '1 Branch included',
              ].map(f => (
                <li key={f} className="flex items-center gap-3 text-sm text-gray-700">
                  <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={scrollToContact}
              className="block w-full text-center bg-gray-900 hover:bg-gray-800 text-white font-semibold py-3.5 rounded-xl transition-colors"
            >
              Get Started
            </button>
          </div>

          {/* Phase 2 — Popular */}
          <div className="relative bg-[#0F2419] rounded-2xl border-2 border-gold-400 p-8 flex flex-col shadow-xl shadow-primary-900/20">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
              <span className="bg-gold-500 text-[#0F2419] text-xs font-black px-4 py-1 rounded-full shadow-lg">
                ★ MOST POPULAR
              </span>
            </div>

            <GeometricPattern opacity={0.03} />

            <div className="relative z-10 mb-2">
              <p className="text-xs font-semibold text-gold-400/80 uppercase tracking-wider mb-1">Phase 2</p>
              <p className="text-sm text-white/50 mb-4">Full ZATCA Compliance</p>
              <div className="flex items-end gap-1">
                <span className="text-4xl font-black text-white">SAR {annual ? '1,000' : '100'}</span>
                <span className="text-white/60 mb-1.5 ml-1">/ branch / {annual ? 'year' : 'month'}</span>
              </div>
            </div>

            <ul className="relative z-10 space-y-3 flex-1 my-8">
              {[
                'Everything in Phase 1',
                'ZATCA Phase 2 Digital Signing',
                'Automatic ZATCA Reporting',
                'XML Invoice Generation',
                'Phase 2 QR Code',
                '1 Branch included',
                'Additional branches: +SAR 100/month',
              ].map(f => (
                <li key={f} className="flex items-center gap-3 text-sm text-white/85">
                  <CheckCircle2 size={15} className="text-gold-400 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={scrollToContact}
              className="relative z-10 block w-full text-center bg-gold-500 hover:bg-gold-400 text-[#0F2419] font-bold py-3.5 rounded-xl transition-colors shadow-lg shadow-gold-500/20"
            >
              Get Started
            </button>
          </div>
        </div>

        {/* Branch note */}
        <p className="text-center text-sm text-gray-400 mt-6">
          Additional branches billed at the same rate per branch per month.
        </p>

        {/* Contact section */}
        <div id="contact" className="mt-16 bg-white rounded-2xl border border-gray-200 p-8 md:p-12 text-center shadow-sm">
          <h3 className="text-2xl font-bold text-gray-900">Ready to get started?</h3>
          <p className="text-gray-500 mt-3 max-w-md mx-auto">
            Contact us to set up your account. We'll have you running within 24 hours.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8">
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-6 py-3.5 rounded-xl transition-colors shadow-md w-full sm:w-auto justify-center"
            >
              <MessageCircle size={18} />
              WhatsApp Us
            </a>
            <a
              href={EMAIL_LINK}
              className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold px-6 py-3.5 rounded-xl transition-colors w-full sm:w-auto justify-center"
            >
              <Mail size={18} />
              Email Us
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Testimonials ──────────────────────────────────────────────────────────────
const TESTIMONIALS = [
  {
    name:    'محمد الرشيد',
    nameEn:  'Mohammed Al-Rashid',
    role:    'مالك مقهى — الرياض',
    rating:  5,
    text:    'ميم غيّرت طريقة إدارتي للمقهى. الآن أصدر فواتير ZATCA في ثوانٍ والتقارير تصلني يومياً.',
  },
  {
    name:    'فاطمة القحطاني',
    nameEn:  'Fatima Al-Qahtani',
    role:    'مديرة مطعم — جدة',
    rating:  5,
    text:    'النظام سهل جداً ويعمل على الآيباد بدون أي مشاكل. فريق الدعم سريع جداً في الرد.',
  },
  {
    name:    'خالد العتيبي',
    nameEn:  'Khalid Al-Otaibi',
    role:    'صاحب سلسلة مطاعم — الدمام',
    rating:  5,
    text:    'أفضل نظام POS جربته. تقارير يومية مع حسابات الضريبة تلقائياً وربط مباشر مع ZATCA.',
  },
]

function TestimonialsSection() {
  return (
    <section className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <span className="inline-block text-xs font-semibold text-primary-600 bg-primary-50 px-3 py-1 rounded-full mb-4 uppercase tracking-wide">
            Testimonials
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            What our clients say
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TESTIMONIALS.map(t => (
            <div key={t.name} className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
              {/* Stars */}
              <div className="flex items-center gap-0.5 mb-4">
                {[...Array(t.rating)].map((_, i) => (
                  <Star key={i} size={14} fill="#C8A96E" className="text-gold-400" />
                ))}
              </div>
              {/* Quote */}
              <p className="text-sm text-gray-700 leading-relaxed mb-6" dir="rtl" style={{ fontFamily: 'Cairo, sans-serif' }}>
                "{t.text}"
              </p>
              {/* Author */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {t.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900" style={{ fontFamily: 'Cairo, sans-serif' }}>{t.name}</p>
                  <p className="text-xs text-gray-400">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── FAQ ───────────────────────────────────────────────────────────────────────
const FAQS = [
  {
    q: 'What is ZATCA e-invoicing?',
    a: 'ZATCA (زكاة وضريبة وجمارك) mandates that all VAT-registered businesses in Saudi Arabia issue electronic invoices. Phase 1 (from Dec 2021) requires QR codes on simplified invoices. Phase 2 (from 2023 onward) requires cryptographic digital signing and integration with the ZATCA portal.',
  },
  {
    q: 'Is Meem certified by ZATCA?',
    a: 'Yes. Meem generates fully compliant ZATCA Phase 1 QR codes using the TLV (Tag-Length-Value) encoding standard. Phase 2 compliance with digital signing is available on our Phase 2 plan and is currently in the ZATCA certification process.',
  },
  {
    q: 'Can I use it offline?',
    a: 'The POS works smoothly with a stable internet connection. For offline use, invoices are queued locally and synced automatically once connectivity is restored. ZATCA submission is queued during downtime.',
  },
  {
    q: 'How do I migrate from my current system?',
    a: 'Our onboarding team can help you import your product catalog and customer data. We provide a simple CSV import for products, customers, and suppliers. The process typically takes under an hour.',
  },
  {
    q: 'Is my data secure?',
    a: 'All data is hosted on Supabase with row-level security — each business can only access their own data. Data is encrypted at rest and in transit (TLS 1.3). Servers are hosted in AWS regions close to Saudi Arabia.',
  },
  {
    q: 'How do I get support?',
    a: 'Phase 1 plan includes email support with a 24-hour response time. Phase 2 plan includes priority WhatsApp support with responses within 2 hours during business hours. We also have comprehensive Arabic documentation.',
  },
]

function FAQItem({ faq }: { faq: typeof FAQS[0] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-5 text-left gap-4"
      >
        <span className="text-sm font-semibold text-gray-900">{faq.q}</span>
        <div className={`flex-shrink-0 w-6 h-6 rounded-lg ${open ? 'bg-primary-50 text-primary-600' : 'bg-gray-100 text-gray-500'} flex items-center justify-center transition-colors`}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>
      {open && (
        <div className="pb-5 -mt-1">
          <p className="text-sm text-gray-600 leading-relaxed">{faq.a}</p>
        </div>
      )}
    </div>
  )
}

function FAQSection() {
  return (
    <section id="faq" className="py-24 bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <span className="inline-block text-xs font-semibold text-primary-600 bg-primary-50 px-3 py-1 rounded-full mb-4 uppercase tracking-wide">
            FAQ
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            Common questions
          </h2>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 px-8 shadow-sm">
          {FAQS.map(f => <FAQItem key={f.q} faq={f} />)}
        </div>
      </div>
    </section>
  )
}

// ── CTA Banner ────────────────────────────────────────────────────────────────
function CTABanner() {
  return (
    <section className="py-20 bg-[#0F2419] relative overflow-hidden">
      <GeometricPattern opacity={0.03} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-gold-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="relative z-10 max-w-3xl mx-auto px-4 text-center space-y-6">
        <h2 className="text-3xl sm:text-4xl font-black text-white" style={{ fontFamily: 'Cairo, sans-serif' }}>
          ابدأ رحلتك مع ميم اليوم
        </h2>
        <p className="text-white/60">Contact us and we'll have your account ready within 24 hours.</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-8 py-4 rounded-xl transition-all shadow-xl hover:-translate-y-0.5"
          >
            <MessageCircle size={18} /> WhatsApp Us
          </a>
          <a
            href={EMAIL_LINK}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-semibold px-8 py-4 rounded-xl transition-all"
          >
            <Mail size={18} /> Email Us
          </a>
        </div>
      </div>
    </section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────
function Footer() {
  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }
  return (
    <footer className="bg-[#071510] text-white/50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div className="md:col-span-2 space-y-3">
            <MeemLogo size="sm" />
            <p className="text-sm leading-relaxed max-w-xs">
              Smart POS & ZATCA-compliant invoicing for Saudi restaurants, cafés and retail — نظام فوترة متوافق مع الزكاة
            </p>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              All systems operational
            </div>
          </div>

          {/* Links */}
          <div className="space-y-3">
            <p className="text-white text-xs font-semibold uppercase tracking-wider">Product</p>
            {['Features', 'Pricing', 'FAQ'].map(l => (
              <button
                key={l}
                onClick={() => scrollTo(l.toLowerCase())}
                className="block text-sm hover:text-white transition-colors"
              >
                {l}
              </button>
            ))}
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <p className="text-white text-xs font-semibold uppercase tracking-wider">Contact</p>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm hover:text-white transition-colors">
              <MessageCircle size={14} />
              WhatsApp Support
            </a>
            <a href={EMAIL_LINK}
              className="flex items-center gap-2 text-sm hover:text-white transition-colors">
              <Mail size={14} />
              vvmshahin@gmail.com
            </a>
          </div>
        </div>

        <div className="border-t border-white/10 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <p>© 2026 Meem Platform. All rights reserved.</p>
          <p className="flex items-center gap-1.5">
            Made with pride in Saudi Arabia 🇸🇦
          </p>
        </div>
      </div>
    </footer>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="scroll-smooth">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <PricingSection />
      <TestimonialsSection />
      <FAQSection />
      <CTABanner />
      <Footer />
    </div>
  )
}
