import { useState, useEffect } from 'react'
import { Printer, RefreshCw, X } from 'lucide-react'
import { clearPrinter, getDefaultPrinter, getPrinters } from '@/lib/electron'
import { PrinterSetupModal } from '@/components/PrinterSetupModal'
import { Button } from '@/components/ui/Button'

export default function PrinterTab() {
  const [defaultPrinter, setDefaultPrinter] = useState<string | null>(null)
  const [printerCount,   setPrinterCount]   = useState<number>(0)
  const [loading,        setLoading]        = useState(true)
  const [showModal,      setShowModal]      = useState(false)

  const load = async () => {
    setLoading(true)
    const [def, list] = await Promise.all([getDefaultPrinter(), getPrinters()])
    setDefaultPrinter(def)
    setPrinterCount(list.length)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleModalClose = () => {
    setShowModal(false)
    load()
  }

  return (
    <div className="space-y-4">

      {/* Current default printer */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center">
            <Printer size={16} className="text-primary-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Default Printer</p>
            <p className="text-xs text-gray-400">Used for silent printing from the POS and invoices</p>
          </div>
        </div>

        {loading ? (
          <div className="h-14 rounded-xl bg-gray-50 animate-pulse" />
        ) : defaultPrinter ? (
          <div className="flex items-center gap-3 bg-primary-50 border border-primary-100 rounded-xl px-4 py-3">
            <div className="w-8 h-8 rounded-lg bg-primary-500 flex items-center justify-center flex-shrink-0">
              <Printer size={14} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{defaultPrinter}</p>
              <p className="text-xs text-primary-600">Active default</p>
            </div>
            <button
              onClick={async () => {
                await clearPrinter()
                setDefaultPrinter(null)
              }}
              className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
              title="Remove default printer"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <div className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center flex-shrink-0">
              <Printer size={14} className="text-gray-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-500">No default printer set</p>
              <p className="text-xs text-gray-400">Print dialogs will open on each print</p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={() => setShowModal(true)} className="gap-2">
            <Printer size={14} />
            {defaultPrinter ? 'Change Printer' : 'Select Printer'}
          </Button>
          <Button variant="ghost" onClick={load} className="gap-2" disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Info */}
      <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <span className="text-blue-500 flex-shrink-0 mt-0.5 text-sm">ℹ️</span>
        <p className="text-[11px] text-blue-700 leading-relaxed">
          {printerCount} printer{printerCount !== 1 ? 's' : ''} detected on this device.
          Selecting a default printer enables silent printing — receipts print instantly
          without a dialog box. Recommended for thermal receipt printers.
        </p>
      </div>

      {showModal && <PrinterSetupModal onClose={handleModalClose} />}
    </div>
  )
}
