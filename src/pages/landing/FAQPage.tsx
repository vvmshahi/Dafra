import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ChevronDown, Mail, MessageCircle } from 'lucide-react'
import { MeemLogo } from '@/components/MeemLogo'
import { supportConfig } from '@/config/support'

const WA_LINK = supportConfig.whatsappLink
const EMAIL_LINK = supportConfig.emailLink

const FAQ_GROUPS = [
  {
    title: 'Product, setup, and pricing',
    items: [
      {
        q: 'What is Kubri?',
        a: 'Kubri is a POS and invoicing platform for Saudi businesses that need sales, payments, stock, sessions, purchases, expenses, VAT reports, and branch visibility in one system.',
      },
      {
        q: 'How does pricing work?',
        a: 'Kubri is priced per active branch: SAR 100/month or SAR 1,000/year per branch. Owner dashboard access is included.',
      },
      {
        q: 'Is there a money-back guarantee?',
        a: 'Yes. Kubri includes a 7-day money-back guarantee for new customers.',
      },
      {
        q: 'How do I get started?',
        a: 'Contact Kubri through WhatsApp or email. The team will help with account setup, branch setup, invoice settings, and onboarding.',
      },
      {
        q: 'Can I add more branches later?',
        a: 'Yes. You can add branches as your business grows, subject to your active branch limit and subscription.',
      },
      {
        q: 'Does Kubri replace my accountant?',
        a: 'No. Kubri helps organize sales, VAT-support reports, purchases, and expenses, but business owners remain responsible for correct setup, review, and professional advice where needed.',
      },
    ],
  },
  {
    title: 'ZATCA, devices, and operations',
    items: [
      {
        q: 'Does Kubri support ZATCA Phase 2 workflows?',
        a: 'Yes. Kubri supports ZATCA Phase 2 invoicing workflows when business setup, account activation, and required ZATCA onboarding steps are completed correctly.',
      },
      {
        q: 'Can I use Kubri on Windows or Mac?',
        a: 'Yes. Kubri supports desktop app workflows for Windows and Mac, along with browser access where applicable.',
      },
      {
        q: 'Can branch users manage day-to-day operations?',
        a: 'Yes. Branch users can manage branch operations such as POS sales, invoices, products, inventory, customers, suppliers, purchases, expenses, reports, and day closing according to their branch access.',
      },
      {
        q: 'Can owners view all branch activity?',
        a: 'Yes. Owners can view branch sales, sessions, reports, stock, purchases, expenses, and operational visibility from the owner dashboard.',
      },
      {
        q: 'Is internet required?',
        a: 'Kubri is designed as a connected cloud platform, so a stable internet connection is required for normal use, syncing, and ZATCA-related workflows.',
      },
      {
        q: 'How do I get support?',
        a: 'Contact WhatsApp support or email support@kubri.shop.',
      },
    ],
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
  const [openItem, setOpenItem] = useState('')
  const actionBaseClass = 'group relative isolate inline-flex h-10 items-center justify-center overflow-hidden rounded-full px-4 text-sm font-black transition-[background,border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B76A]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071510] active:scale-[0.98]'

  return (
    <div className="min-h-screen bg-[#071510] text-white">
      <header className="relative overflow-hidden border-b border-white/10 bg-[#0F2419]">
        <Pattern />
        <div className="relative z-10 mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/"><MeemLogo size="sm" /></Link>
          <div className="flex items-center gap-2">
            <Link to="/pricing" className="hidden rounded-full px-3 py-2 text-sm font-semibold text-white/78 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B76A]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071510] sm:inline">Pricing</Link>
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
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div>
              <h1 className="text-3xl font-black leading-tight sm:text-5xl">Clear answers before you start.</h1>
              <p className="mt-3 max-w-xl text-base leading-7 text-white/70">Everything important about Kubri, ZATCA Phase 2 workflows, desktop app use, pricing, and support.</p>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl border border-[#D8B76A]/20 bg-[#D8B76A]/10 px-4 py-3 text-sm text-[#F1DFA8] lg:ml-auto">
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

      <main className="relative overflow-hidden bg-[#F6F2E8] px-4 py-6 text-[#173326] sm:px-6 sm:py-7 lg:px-8">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-14rem] top-[-16rem] h-[32rem] w-[32rem] rounded-full bg-[#D8B76A]/25 blur-3xl" />
          <div className="absolute bottom-[-18rem] right-[-12rem] h-[36rem] w-[36rem] rounded-full bg-[#0F3A2A]/15 blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#C8A96E]/70 to-transparent" />
        </div>

        <section className="relative z-10 mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#A77F29]">FAQ</p>
            <h2 className="mt-2 text-2xl font-black leading-tight text-[#10291E] sm:text-3xl">Short answers, ready for setup.</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-[#496154]">
              Tap a question to expand it. The essentials stay compact, readable, and easy to scan before you start.
            </p>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {FAQ_GROUPS.map(group => (
              <section key={group.title} className="rounded-[26px] border border-[#D9CBAA] bg-[#FFFDF7] p-4 shadow-[0_22px_68px_rgba(15,36,25,0.13)] sm:p-5">
                <h3 className="px-1 text-sm font-black uppercase tracking-[0.16em] text-[#A77F29]">{group.title}</h3>
                <div className="mt-3 space-y-2.5">
                  {group.items.map(item => {
                    const isOpen = openItem === item.q
                    const panelId = `faq-panel-${item.q.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

                    return (
                      <div key={item.q} className={`rounded-2xl border bg-[#FBF7EB] transition-[border-color,box-shadow] duration-200 ${isOpen ? 'border-[#C8A96E] shadow-[0_12px_30px_rgba(15,36,25,0.08)]' : 'border-[#E1D7BC] hover:border-[#C8A96E]/70'}`}>
                        <button
                          type="button"
                          onClick={() => setOpenItem(isOpen ? '' : item.q)}
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          className="flex w-full items-start justify-between gap-3 rounded-2xl px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B76A]/75 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFFDF7]"
                        >
                          <span className="text-sm font-black leading-5 text-[#10291E]">{item.q}</span>
                          <ChevronDown size={18} className={`mt-0.5 flex-shrink-0 text-[#8A6A28] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                        </button>
                        <div
                          id={panelId}
                          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                        >
                          <div className="overflow-hidden">
                            <p className="px-4 pb-3 pt-0 text-sm leading-6 text-[#496154]">{item.a}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
