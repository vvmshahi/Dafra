import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { MeemLogo } from '@/components/MeemLogo'
import { supportConfig } from '@/config/support'

const sections = [
  {
    title: 'Service',
    body: 'Kubri provides cloud-based POS, invoicing, stock, purchase, reporting, and ZATCA-ready e-invoicing workflow tools for small businesses. Features may vary by plan, branch setup, and enabled integrations.',
  },
  {
    title: 'Your Responsibilities',
    body: 'You are responsible for entering accurate business, VAT, branch, customer, product, invoice, payment, and return information. You must keep login credentials secure and only give access to authorized staff.',
  },
  {
    title: 'ZATCA and VAT',
    body: 'Kubri is built to support Saudi VAT and ZATCA e-invoicing workflows. Compliance depends on correct business setup, successful setup where required, and continued use according to ZATCA requirements. Kubri does not replace your accountant, tax advisor, or legal advisor.',
  },
  {
    title: 'Subscriptions and Payment',
    body: 'Subscription pricing, branch limits, guarantee periods, renewal, suspension, and cancellation terms are confirmed during setup or in a written agreement. A payment gateway may be added later; until then, billing may be handled through direct payment channels.',
  },
  {
    title: 'Availability and Support',
    body: 'We aim to keep the service reliable, but cloud services, internet connectivity, Supabase, payment providers, printers, and ZATCA systems may experience downtime. Support requests should be sent through the support channels shown below.',
  },
  {
    title: 'Limitations',
    body: 'To the maximum extent allowed by law, Kubri is provided without guarantees of uninterrupted operation or error-free tax filing. You should review reports, invoices, ZATCA statuses, and VAT returns before relying on them for submission.',
  },
]

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ArrowLeft size={16} />
          Back
        </Link>
        <MeemLogo size="sm" />
      </header>

      <main className="flex-1 px-6 py-10">
        <div className="max-w-3xl mx-auto bg-white border border-gray-100 rounded-2xl p-6 sm:p-8 space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Starter legal content</p>
            <h1 className="text-2xl font-bold text-gray-900 mt-2">Terms of Service</h1>
            <p className="text-sm text-gray-500 mt-2">
              These starter terms are intended for pilot launch readiness and should be reviewed by a qualified lawyer before broad public launch.
            </p>
          </div>

          <div className="space-y-5">
            {sections.map(section => (
              <section key={section.title}>
                <h2 className="text-sm font-bold text-gray-900">{section.title}</h2>
                <p className="text-sm text-gray-600 leading-relaxed mt-1">{section.body}</p>
              </section>
            ))}
          </div>

          <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 text-sm text-gray-600">
            Questions or support requests: <a href={supportConfig.emailLink} className="font-semibold text-primary-700 hover:underline">{supportConfig.email}</a>
          </div>
        </div>
      </main>
    </div>
  )
}
