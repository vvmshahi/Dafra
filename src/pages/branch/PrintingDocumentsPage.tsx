import { useRef, useState } from 'react'
import { Barcode, FileText, Printer, ReceiptText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { isElectron } from '@/lib/electron'
import BarcodeLabelSettingsPanel from '@/components/barcodes/BarcodeLabelSettingsPanel'
import BarcodePrinterSetupPanel from '@/components/barcodes/BarcodePrinterSetupPanel'
import PrinterTab from '@/pages/settings/PrinterTab'
import InvoiceSettingsPage from './InvoiceSettingsPage'

type Workspace = 'receipts' | 'invoices' | 'barcodeLabels' | 'printerSetup'

const tabs: { id: Workspace; icon: React.ElementType }[] = [
  { id: 'receipts', icon: ReceiptText },
  { id: 'invoices', icon: FileText },
  { id: 'barcodeLabels', icon: Barcode },
  { id: 'printerSetup', icon: Printer },
]

export default function PrintingDocumentsPage() {
  const { t } = useTranslation('printing')
  const { branch, tenant, profile } = useAuth()
  const [active, setActive] = useState<Workspace>('invoices')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const branchId = branch?.id || profile?.branch_id || ''
  const businessName = tenant?.business_name_ar
    || tenant?.business_name
    || tenant?.name
    || branch?.business_name_ar
    || branch?.business_name
    || branch?.name_ar
    || branch?.name
    || null

  return <div className="mx-auto max-w-[1440px] space-y-5 pb-20">
    <header className="border-b border-gray-200 pb-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">{t('workspace.eyebrow')}</p>
      <h1 className="mt-1 text-2xl font-bold text-gray-950">{t('workspace.title')}</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">{t('workspace.subtitle')}</p>
    </header>

    <nav className="grid grid-cols-2 gap-2 rounded-2xl border border-primary-900/60 bg-white p-2 lg:grid-cols-4" role="tablist" aria-label={t('workspace.title')}>
      {tabs.map((tab, index) => {
        const Icon = tab.icon
        const selected = active === tab.id
        return <button
          key={tab.id}
          id={`printing-tab-${tab.id}`}
          ref={node => { tabRefs.current[index] = node }}
          type="button"
          role="tab"
          aria-selected={selected}
          aria-controls={`printing-panel-${tab.id}`}
          tabIndex={selected ? 0 : -1}
          onClick={() => setActive(tab.id)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const rtl = document.documentElement.dir === 'rtl'
            const delta = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + delta + tabs.length) % tabs.length
            setActive(tabs[next].id)
            tabRefs.current[next]?.focus()
          }}
          className={`flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 text-start outline-none transition-[background-color,color,transform] duration-150 active:scale-[.98] focus-visible:ring-2 focus-visible:ring-primary-500 ${
            selected ? 'bg-[#10261a] text-white shadow-sm ring-2 ring-primary-200 ring-offset-1' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${selected ? 'bg-white/10' : 'bg-gray-100'}`}><Icon size={15} aria-hidden="true" /></span>
          <span className="min-w-0"><span className="block text-xs font-bold">{t(`workspace.tabs.${tab.id}.label`)}</span><span className={`mt-0.5 block text-[10px] ${selected ? 'text-white/65' : 'text-gray-400'}`}>{t(`workspace.tabs.${tab.id}.help`)}</span></span>
        </button>
      })}
    </nav>

    <main id={`printing-panel-${active}`} role="tabpanel" aria-labelledby={`printing-tab-${active}`}>
    {active === 'receipts' && <InvoiceSettingsPage key="receipts" embedded workspace="receipts" />}
    {active === 'invoices' && <InvoiceSettingsPage key="invoices" embedded workspace="invoices" />}
    {active === 'barcodeLabels' && branchId && <BarcodeLabelSettingsPanel branchId={branchId} businessName={businessName} />}
    {active === 'printerSetup' && branchId && <div className="space-y-8">
      <BarcodePrinterSetupPanel branchId={branchId} businessName={businessName} />
      {isElectron() && <section className="border-t border-gray-200 pt-8"><PrinterTab /></section>}
    </div>}
    </main>
  </div>
}
