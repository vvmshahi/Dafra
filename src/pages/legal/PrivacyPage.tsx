import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { MeemLogo } from '@/components/MeemLogo'
import { supportConfig } from '@/config/support'

const sections = [
  {
    title: 'Data We Collect',
    body: 'We collect account, tenant, branch, user, product, customer, supplier, invoice, payment, purchase, inventory, expense, audit, and support information needed to operate Meem.',
  },
  {
    title: 'How We Use Data',
    body: 'We use data to provide the POS and invoicing service, maintain branch access, calculate reports, support ZATCA-ready workflows, troubleshoot issues, prevent abuse, and communicate about service or billing matters.',
  },
  {
    title: 'Storage and Security',
    body: 'Meem uses Supabase-backed authentication, database, storage, and Edge Function infrastructure. We use row-level access controls, private storage paths where appropriate, and browser-safe error messages that avoid exposing secrets.',
  },
  {
    title: 'Sharing',
    body: 'We do not sell customer data. Data may be processed by infrastructure providers and, where enabled by the customer, submitted to ZATCA or related government systems as part of e-invoicing workflows.',
  },
  {
    title: 'Customer Responsibilities',
    body: 'Customers are responsible for entering accurate personal and business data, managing staff access, protecting passwords, and reviewing invoices, reports, and tax submissions.',
  },
  {
    title: 'Retention and Deletion',
    body: 'Business records may need to be retained for tax, audit, legal, or operational reasons. Deletion requests are reviewed against those obligations and the customer subscription agreement.',
  },
]

export default function PrivacyPage() {
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
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Starter privacy content</p>
            <h1 className="text-2xl font-bold text-gray-900 mt-2">Privacy Policy</h1>
            <p className="text-sm text-gray-500 mt-2">
              This practical privacy overview is suitable for pilot readiness and should be reviewed by a qualified lawyer before broad public launch.
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
            Privacy questions: <a href={supportConfig.emailLink} className="font-semibold text-primary-700 hover:underline">{supportConfig.email}</a>
          </div>
        </div>
      </main>
    </div>
  )
}

