import { Link } from 'react-router-dom'
import { ArrowLeft, Mail, MessageCircle } from 'lucide-react'
import { MeemLogo } from '@/components/MeemLogo'
import { supportConfig } from '@/config/support'

const WA_LINK = supportConfig.whatsappLink
const EMAIL_LINK = supportConfig.emailLink

const FAQS = [
  {
    q: 'What is Kubri?',
    a: 'Kubri is a POS and ZATCA-ready invoicing platform for Saudi businesses that need sales, payments, stock, sessions, VAT reports, and branch visibility in one system.',
  },
  {
    q: 'Does Kubri support ZATCA Phase 2 workflows?',
    a: 'Yes. Kubri supports ZATCA Phase 2 workflows when your business setup and account activation are completed correctly.',
  },
  {
    q: 'Can I use Kubri on a Windows POS device?',
    a: 'Yes. Kubri is designed for counter use and includes a Download for Windows option for POS devices.',
  },
  {
    q: 'How does pricing work?',
    a: 'Kubri starts at SAR 100 per month per branch. A yearly option is available at SAR 1,000 per year per branch.',
  },
  {
    q: 'Can I manage multiple branches?',
    a: 'Yes. Owners can review branch sales, register sessions, reports, stock, and settings from one dashboard.',
  },
  {
    q: 'How do I get support?',
    a: 'Contact us through WhatsApp or email support@kubri.shop.',
  },
  {
    q: 'Is internet required?',
    a: 'Kubri is designed for a stable internet connection, especially for ZATCA Phase 2 workflows, reports, and cloud sync.',
  },
]

function Pattern() {
  return (
    <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <pattern id="kubri-faq-pattern" x="0" y="0" width="96" height="96" patternUnits="userSpaceOnUse">
          <path d="M28 6h40l22 22v40L68 90H28L6 68V28Z" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
          <path d="M48 20l28 28-28 28-28-28Z" fill="none" stroke="rgba(200,169,110,0.065)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#kubri-faq-pattern)" />
    </svg>
  )
}

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-[#071510] text-white">
      <header className="relative overflow-hidden border-b border-white/10 bg-[#0F2419]">
        <Pattern />
        <div className="relative z-10 mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/"><MeemLogo size="sm" /></Link>
          <div className="flex items-center gap-2">
            <Link to="/pricing" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/[0.06] hover:text-white sm:inline">Pricing</Link>
            <Link to="/login" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/[0.06]">Sign in</Link>
          </div>
        </div>
        <div className="relative z-10 mx-auto max-w-7xl px-4 pb-8 pt-6 sm:px-6 lg:px-8">
          <Link to="/" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-white/60 hover:text-white">
            <ArrowLeft size={15} /> Home
          </Link>
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div>
              <h1 className="text-3xl font-black leading-tight sm:text-5xl">Clear answers before you start.</h1>
              <p className="mt-3 max-w-xl text-base leading-7 text-white/70">Everything important about Kubri, ZATCA Phase 2 workflows, Windows POS use, pricing, and support.</p>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl border border-gold-400/20 bg-gold-400/10 px-5 py-4 text-sm text-gold-100 lg:ml-auto">
              <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-bold hover:text-white">
                <MessageCircle size={15} /> WhatsApp support
              </a>
              <a href={EMAIL_LINK} className="inline-flex items-center gap-2 font-bold hover:text-white">
                <Mail size={15} /> support@kubri.shop
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-2">
          {FAQS.map(faq => (
            <section key={faq.q} className="rounded-[22px] border border-white/10 bg-white/[0.06] p-5 shadow-[0_22px_80px_rgba(0,0,0,0.18)]">
              <h2 className="text-base font-black text-white">{faq.q}</h2>
              <p className="mt-2 text-sm leading-6 text-white/70">{faq.a}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
