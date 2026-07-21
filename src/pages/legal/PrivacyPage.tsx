import { ArrowLeft, ArrowRight, Mail, MessageCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CompactLanguageSelector } from '@/components/localization/CompactLanguageSelector'
import { MeemLogo } from '@/components/MeemLogo'
import { supportConfig } from '@/config/support'

const WA_LINK = supportConfig.whatsappLink
const EMAIL_LINK = supportConfig.emailLink

const sections = [
  {
    title: 'Information we collect',
    body: 'Kubri may collect account details, business and branch details, staff access information, customer and supplier records, product data, invoices, sales, purchases, expenses, payments, register sessions, and support messages needed to operate the service.',
  },
  {
    title: 'How we use information',
    body: 'We use information to provide POS, invoicing, reporting, branch access, support, billing, troubleshooting, security checks, and ZATCA workflow features requested or enabled by the business.',
  },
  {
    title: 'Operational and technical logs',
    body: 'Kubri may keep technical logs needed to operate, secure, debug, and support the service. These logs are used for practical service operations and should not be treated as a replacement for business records.',
  },
  {
    title: 'Sharing and service providers',
    body: 'We do not sell customer data. Information may be processed by infrastructure, authentication, storage, communication, payment, or support providers used to run Kubri. Where configured by the business, invoice data may be submitted through relevant ZATCA workflows.',
  },
  {
    title: 'Security and access',
    body: 'We use reasonable safeguards for a SaaS business application, including authenticated access and role-based controls. Customers must manage staff access carefully, protect passwords, and promptly remove users who no longer need access.',
  },
  {
    title: 'Retention and deletion',
    body: 'Business records may need to be kept for tax, accounting, audit, support, legal, or operational reasons. Deletion or export requests are reviewed against those requirements and any active subscription or pilot agreement.',
  },
  {
    title: 'Business review',
    body: 'Businesses remain responsible for reviewing their records, reports, tax data, and submissions with their accountant or advisor. Kubri helps organize workflows but does not make final tax or legal decisions for the business.',
  },
]

function Pattern() {
  return (
    <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <pattern id="kubri-privacy-pattern" x="0" y="0" width="96" height="96" patternUnits="userSpaceOnUse">
          <path d="M28 6h40l22 22v40L68 90H28L6 68V28Z" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
          <path d="M48 20l28 28-28 28-28-28Z" fill="none" stroke="rgba(200,169,110,0.065)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#kubri-privacy-pattern)" />
    </svg>
  )
}

export default function PrivacyPage() {
  const { t, i18n } = useTranslation('legal')
  const isArabic = i18n.language.startsWith('ar')
  const actionBaseClass = 'group relative isolate inline-flex h-10 items-center justify-center overflow-hidden rounded-full px-4 text-sm font-black transition-[background,border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B76A]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071510] active:scale-[0.98]'

  return (
    <div className="min-h-screen bg-[#071510] text-white">
      <header className="relative overflow-hidden border-b border-white/10 bg-[#0F2419]">
        <Pattern />
        <div className="relative z-10 mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4"><Link to="/"><MeemLogo size="sm" /></Link><CompactLanguageSelector inverse /></div>
          <div className="flex items-center gap-2">
            <Link to="/terms" className="hidden rounded-full px-3 py-2 text-sm font-semibold text-white/78 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B76A]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071510] sm:inline">{t('terms')}</Link>
            <Link to="/login" className={`${actionBaseClass} border border-white/[0.10] bg-white/[0.06] text-white/[0.90] hover:border-white/[0.18] hover:bg-white/[0.10] hover:text-white`}>
              <span className="absolute inset-0 -z-10 translate-x-[-105%] rounded-full bg-white/[0.08] opacity-0 transition-[opacity,transform] duration-300 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
              <span className="relative transition-transform duration-200 group-hover:-translate-x-1.5">{t('signIn')}</span>
              <ArrowRight size={14} className="absolute right-3 translate-x-2 opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
            </Link>
          </div>
        </div>

        <div className="relative z-10 mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-6 lg:px-8">
          <Link to="/" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-white/60 hover:text-white">
            <ArrowLeft size={15} /> {t('home')}
          </Link>
          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#D8B76A]">{t('privacy')}</p>
              <h1 className="mt-2 text-3xl font-black leading-tight sm:text-5xl">{t('privacyTitle')}</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-white/70">
                {t('privacyIntro')}
              </p>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl border border-[#D8B76A]/20 bg-[#D8B76A]/10 px-4 py-3 text-sm text-[#F1DFA8] lg:ml-auto">
              <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-bold hover:text-white">
                <MessageCircle size={15} /> {t('support')}
              </a>
              <a href={EMAIL_LINK} className="inline-flex items-center gap-2 font-bold hover:text-white">
                <Mail size={15} /> {supportConfig.email}
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="relative overflow-hidden bg-[#F6F2E8] px-4 py-6 text-[#173326] sm:px-6 sm:py-8 lg:px-8">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#C8A96E]/70 to-transparent" />
        </div>

        <section className="relative z-10 mx-auto max-w-4xl">
          {isArabic && <p className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{t('arabicUnavailable')}</p>}
          <div className="rounded-[26px] border border-[#D9CBAA] bg-[#FFFDF7] p-4 shadow-[0_22px_68px_rgba(15,36,25,0.13)] sm:p-6">
            <div className="space-y-3" dir="ltr" lang="en">
              {sections.map(section => (
                <section key={section.title} className="rounded-2xl border border-[#E1D7BC] bg-[#FBF7EB] p-4">
                  <h2 className="text-sm font-black uppercase tracking-[0.16em] text-[#A77F29]">{section.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-[#496154]">{section.body}</p>
                </section>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-[#D9CBAA] bg-gradient-to-br from-[#F8F2E3] to-[#EEF5EA] p-4 text-sm leading-6 text-[#496154]">
              {t('privacyQuestions')} <a href={EMAIL_LINK} className="font-black text-[#0F3A2A] hover:text-[#A77F29]" dir="ltr">{supportConfig.email}</a>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
