import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Barcode, CheckCircle2, FileText, Printer, ReceiptText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { isElectron } from '@/lib/electron'
import BarcodeLabelSettingsPanel from '@/components/barcodes/BarcodeLabelSettingsPanel'
import BarcodePrinterSetupPanel from '@/components/barcodes/BarcodePrinterSetupPanel'
import PrinterTab from '@/pages/settings/PrinterTab'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DocumentStudioHeader } from '@/components/printing/DocumentStudioShell'
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
  const requestedWorkspace = workspaceFromQuery(searchParams.get('tab'), electron)
  const [active, setActive] = useState<Workspace>(requestedWorkspace)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [dirty, setDirty] = useState(false)
  const [pendingWorkspace, setPendingWorkspace] = useState<Workspace | null>(null)
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
    if (requestedWorkspace !== active) {
      if (dirty) {
        setPendingWorkspace(requestedWorkspace)
        const restored = new URLSearchParams(searchParams)
        restored.set('tab', queryValue[active])
        setSearchParams(restored, { replace: true })
      } else {
        setActive(requestedWorkspace)
      }
      return
    }
    if (!requested || requested === queryValue[requestedWorkspace]) return
    const next = new URLSearchParams(searchParams)
    next.set('tab', queryValue[requestedWorkspace])
    setSearchParams(next, { replace: true })
  }, [active, dirty, requestedWorkspace, searchParams, setSearchParams])

  const commitWorkspace = (workspace: Workspace) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', queryValue[workspace])
    next.delete('section')
    setActive(workspace)
    setSearchParams(next)
  }
  const selectWorkspace = (workspace: Workspace) => {
    if (workspace === active) return
    if (dirty) {
      setPendingWorkspace(workspace)
      return
    }
    commitWorkspace(workspace)
  }

  const branchName = branch?.name_ar || branch?.name || ''

  return <div className="printing-workspace-shell mx-auto flex max-w-[1600px] flex-col overflow-hidden">
    <DocumentStudioHeader
      title={t('workspace.title')}
      context={branchName}
      helpLabel={t('workspace.about')}
      helpText={t('workspace.subtitle')}
      navigation={<nav className="inline-flex max-w-full shrink-0 gap-1 overflow-x-auto rounded-lg bg-[#edf3ef] p-1" role="tablist" aria-label={t('workspace.title')}>
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
            if (dirty && tabs[next].id !== active) return
            tabRefs.current[next]?.focus()
          }}
          className={`flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-start outline-none transition-[background-color,color,transform] duration-150 active:scale-[.97] focus-visible:ring-2 focus-visible:ring-primary-500 ${
            selected ? 'bg-[#173d2a] text-white shadow-sm' : 'text-gray-600 hover:bg-white'
          }`}
        >
          <Icon size={14} aria-hidden="true" />
          <span className="whitespace-nowrap text-xs font-bold">{t(`workspace.tabs.${tab.id}.label`)}</span>
        </button>
      })}
      </nav>}
      status={<div className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold ${dirty ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`} role="status">
        {dirty ? <AlertCircle size={12} aria-hidden="true" /> : <CheckCircle2 size={12} aria-hidden="true" />}
        {t(dirty ? 'workspace.status.unsaved' : 'workspace.status.saved')}
      </div>}
    />

    <main className="min-h-0 flex-1 overflow-hidden" id={`printing-panel-${active}`} role="tabpanel" aria-labelledby={`printing-tab-${active}`}>
    {active === 'receipts' && <InvoiceSettingsPage key="receipts" embedded workspace="receipts" onDirtyChange={setDirty} />}
    {active === 'invoices' && <InvoiceSettingsPage key="invoices" embedded workspace="invoices" onDirtyChange={setDirty} />}
    {active === 'barcodeLabels' && branchId && <BarcodeLabelSettingsPanel branchId={branchId} businessName={businessName} printerAdjustment={<BarcodePrinterSetupPanel branchId={branchId} businessName={businessName} compact />} onDirtyChange={setDirty} />}
    {electron && active === 'printerSetup' && branchId && <div className="space-y-8">
      <BarcodePrinterSetupPanel branchId={branchId} businessName={businessName} />
      <section className="border-t border-gray-200 pt-8"><PrinterTab /></section>
    </div>}
    </main>
    <ConfirmDialog open={pendingWorkspace !== null} kind="discard" onClose={() => setPendingWorkspace(null)} onConfirm={() => {
      const next = pendingWorkspace
      setPendingWorkspace(null)
      setDirty(false)
      if (next) commitWorkspace(next)
    }} />
  </div>
}
