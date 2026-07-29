import { useEffect, useMemo, useRef } from 'react'
import { Barcode, FileText, Printer, ReceiptText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { isElectron } from '@/lib/electron'
import BarcodeLabelSettingsPanel from '@/components/barcodes/BarcodeLabelSettingsPanel'
import BarcodePrinterSetupPanel from '@/components/barcodes/BarcodePrinterSetupPanel'
import PrinterTab from '@/pages/settings/PrinterTab'
import InvoiceSettingsPage from './InvoiceSettingsPage'

type Workspace = 'receipts' | 'invoices' | 'barcodeLabels' | 'printerSetup'

const allTabs: { id: Workspace; icon: React.ElementType }[] = [
  { id: 'receipts', icon: ReceiptText },
  { id: 'invoices', icon: FileText },
  { id: 'barcodeLabels', icon: Barcode },
  { id: 'printerSetup', icon: Printer },
]

const queryValue: Record<Workspace, string> = {
  receipts: 'receipts',
  invoices: 'invoices',
  barcodeLabels: 'barcode-labels',
  printerSetup: 'printer-setup',
}

function workspaceFromQuery(value: string | null, electron: boolean): Workspace {
  if (value === 'invoices') return 'invoices'
  if (value === 'barcode-labels' || value === 'barcodeLabels') return 'barcodeLabels'
  if (electron && (value === 'printer-setup' || value === 'printerSetup')) return 'printerSetup'
  return 'receipts'
}

export default function PrintingDocumentsPage() {
  const { t } = useTranslation('printing')
  const { branch, tenant, profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const electron = isElectron()
  const tabs = useMemo(
    () => allTabs.filter(tab => tab.id !== 'printerSetup' || electron),
    [electron],
  )
  const active = workspaceFromQuery(searchParams.get('tab'), electron)
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

  useEffect(() => {
    const requested = searchParams.get('tab')
    if (!requested || requested === queryValue[active]) return
    const next = new URLSearchParams(searchParams)
    next.set('tab', queryValue[active])
    setSearchParams(next, { replace: true })
  }, [active, searchParams, setSearchParams])

  const selectWorkspace = (workspace: Workspace) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', queryValue[workspace])
    setSearchParams(next)
  }

  return <div className="printing-workspace-shell mx-auto flex max-w-[1440px] flex-col overflow-hidden">
    <header className="shrink-0 border-b border-gray-200 pb-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">{t('workspace.eyebrow')}</p>
      <h1 className="mt-0.5 text-xl font-bold text-gray-950">{t('workspace.title')}</h1>
      <p className="mt-0.5 max-w-2xl text-xs leading-5 text-gray-500">{t('workspace.subtitle')}</p>
    </header>

    <nav className="mt-3 inline-flex w-fit max-w-full shrink-0 gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 shadow-sm" role="tablist" aria-label={t('workspace.title')}>
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
          onClick={() => selectWorkspace(tab.id)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const rtl = document.documentElement.dir === 'rtl'
            const delta = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + delta + tabs.length) % tabs.length
            selectWorkspace(tabs[next].id)
            tabRefs.current[next]?.focus()
          }}
          className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-start outline-none transition-[background-color,color,transform] duration-150 active:scale-[.98] focus-visible:ring-2 focus-visible:ring-primary-500 ${
            selected ? 'bg-[#10261a] text-white shadow-sm ring-2 ring-primary-200 ring-offset-1' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Icon size={14} aria-hidden="true" />
          <span className="whitespace-nowrap text-xs font-bold">{t(`workspace.tabs.${tab.id}.label`)}</span>
        </button>
      })}
    </nav>

    <main className={`mt-3 min-h-0 flex-1 overscroll-contain pe-1 ${active === 'invoices' || active === 'receipts' ? 'overflow-hidden' : 'overflow-y-auto'}`} id={`printing-panel-${active}`} role="tabpanel" aria-labelledby={`printing-tab-${active}`}>
    {active === 'receipts' && <InvoiceSettingsPage key="receipts" embedded workspace="receipts" />}
    {active === 'invoices' && <InvoiceSettingsPage key="invoices" embedded workspace="invoices" />}
    {active === 'barcodeLabels' && branchId && <div className="space-y-8">
      <BarcodeLabelSettingsPanel branchId={branchId} businessName={businessName} />
      {!electron && <details className="group rounded-2xl border border-gray-200 bg-white"><summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold text-gray-900">{t('barcodeLabels.calibration.disclosure')}</summary><section className="border-t border-gray-200 p-4"><BarcodePrinterSetupPanel branchId={branchId} businessName={businessName} /></section></details>}
    </div>}
    {electron && active === 'printerSetup' && branchId && <div className="space-y-8">
      <BarcodePrinterSetupPanel branchId={branchId} businessName={businessName} />
      <section className="border-t border-gray-200 pt-8"><PrinterTab /></section>
    </div>}
    </main>
  </div>
}
