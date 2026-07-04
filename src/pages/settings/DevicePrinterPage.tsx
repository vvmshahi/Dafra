import { ArrowLeft, Printer } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { isElectron } from '@/lib/electron'
import PrinterTab from './PrinterTab'

export default function DevicePrinterPage() {
  const navigate = useNavigate()

  if (!isElectron()) {
    return (
      <div className="max-w-2xl space-y-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <div className="card p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100">
              <Printer size={17} className="text-gray-500" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">Device Printer</h1>
              <p className="mt-1 text-sm text-gray-500">
                Direct receipt printing is available in the Kubri desktop app.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50">
            <Printer size={18} className="text-primary-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Device Printer</h1>
            <p className="text-xs text-gray-400">These printer settings are saved on this device.</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft size={14} />
          Back
        </Button>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
        <p className="text-xs leading-relaxed text-blue-700">
          USB, network, and Bluetooth printers appear here after they are installed in Windows or macOS.
        </p>
      </div>

      <PrinterTab />
    </div>
  )
}
