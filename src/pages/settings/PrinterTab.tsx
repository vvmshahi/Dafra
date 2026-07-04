import { useEffect, useState } from 'react'
import { Check, Loader2, Printer, RefreshCw, RotateCcw, Save, TestTube2 } from 'lucide-react'
import {
  DEFAULT_PRINTER_SETTINGS,
  clearPrinterSettings,
  getPrinterSettings,
  getPrinters,
  isElectron,
  savePrinterSettings,
  testPrint,
  type PrinterSettings,
} from '@/lib/electron'
import { Button } from '@/components/ui/Button'

type Status = {
  type: 'success' | 'error' | 'info'
  text: string
} | null

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-primary-500' : 'bg-gray-200'
      }`}
      aria-pressed={checked}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function statusClasses(type: NonNullable<Status>['type']) {
  if (type === 'success') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
  if (type === 'error') return 'border-red-100 bg-red-50 text-red-700'
  return 'border-blue-100 bg-blue-50 text-blue-700'
}

function printerStateLabel(printer: any): string {
  if (printer?.status === 0 || printer?.status == null) return 'Ready'
  return 'Check printer'
}

export default function PrinterTab() {
  const [printers, setPrinters] = useState<any[]>([])
  const [form, setForm] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const selectedPrinter = printers.find(printer => printer.name === form.selectedPrinterName)

  const load = async () => {
    if (!isElectron()) {
      setLoading(false)
      return
    }

    setLoading(true)
    setStatus(null)
    try {
      const [settings, list] = await Promise.all([getPrinterSettings(), getPrinters()])
      setForm(settings)
      setPrinters(list)
      if (settings.selectedPrinterName && !list.some(printer => printer.name === settings.selectedPrinterName)) {
        setStatus({ type: 'error', text: 'Saved printer was not found on this device. Refresh or choose another printer.' })
      }
    } catch (error) {
      setStatus({ type: 'error', text: error instanceof Error ? error.message : 'Unable to load printers.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const update = <K extends keyof PrinterSettings>(key: K, value: PrinterSettings[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setStatus(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const saved = await savePrinterSettings(form)
      setForm(saved)
      setStatus({ type: 'success', text: 'Printer settings saved on this device.' })
    } catch (error) {
      setStatus({ type: 'error', text: error instanceof Error ? error.message : 'Unable to save printer settings.' })
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const reset = await clearPrinterSettings()
      setForm(reset)
      setStatus({ type: 'info', text: 'Printer settings reset on this device.' })
    } catch (error) {
      setStatus({ type: 'error', text: error instanceof Error ? error.message : 'Unable to reset printer settings.' })
    } finally {
      setSaving(false)
    }
  }

  const handleTestPrint = async () => {
    setTesting(true)
    setStatus(null)
    try {
      const result = await testPrint(form)
      if (result.success) {
        setStatus({ type: 'success', text: 'Test receipt sent to printer.' })
      } else {
        setStatus({ type: 'error', text: result.message || result.errorType || 'Test print failed.' })
      }
    } catch (error) {
      setStatus({ type: 'error', text: error instanceof Error ? error.message : 'Test print failed.' })
    } finally {
      setTesting(false)
    }
  }

  if (!isElectron()) {
    return (
      <div className="card p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100">
            <Printer size={16} className="text-gray-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Direct printing is available in the Kubri desktop app.</p>
            <p className="mt-1 text-xs text-gray-500">Browser receipt printing continues to use the normal print preview.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
              <Printer size={16} className="text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Receipt Printer</p>
              <p className="text-xs text-gray-400">These printer settings are saved on this device.</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>

        {status && (
          <div className={`rounded-xl border px-4 py-3 text-xs font-medium ${statusClasses(status.type)}`}>
            {status.text}
          </div>
        )}

        {loading ? (
          <div className="flex h-40 items-center justify-center rounded-xl bg-gray-50 text-gray-400">
            <Loader2 size={20} className="mr-2 animate-spin" />
            <span className="text-sm">Loading printers...</span>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500">Available printers</span>
                <select
                  className="input"
                  value={form.selectedPrinterName ?? ''}
                  onChange={event => update('selectedPrinterName', event.target.value || null)}
                >
                  <option value="">Select receipt printer...</option>
                  {printers.map(printer => (
                    <option key={printer.name} value={printer.name}>
                      {printer.name}
                    </option>
                  ))}
                </select>
                {printers.length === 0 ? (
                  <p className="text-[11px] text-amber-600">No printers found on this device.</p>
                ) : selectedPrinter ? (
                  <p className="text-[11px] text-gray-400">{printerStateLabel(selectedPrinter)}</p>
                ) : (
                  <p className="text-[11px] text-gray-400">{printers.length} printer{printers.length !== 1 ? 's' : ''} detected.</p>
                )}
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500">Paper width</span>
                <select
                  className="input"
                  value={form.paperWidth}
                  onChange={event => update('paperWidth', Number(event.target.value) === 58 ? 58 : 80)}
                >
                  <option value={80}>80mm</option>
                  <option value={58}>58mm</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <label className="flex items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">Auto-print after sale</span>
                    <span className="block text-[11px] text-gray-400">Send receipt after checkout</span>
                  </span>
                  <Toggle checked={form.autoPrintAfterSale} onChange={value => update('autoPrintAfterSale', value)} />
                </label>
              </div>

              <label className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <span className="block text-sm font-semibold text-gray-900">Copies</span>
                <input
                  type="number"
                  min={1}
                  max={3}
                  className="input mt-2 h-10"
                  value={form.copies}
                  onChange={event => {
                    const value = Math.max(1, Math.min(3, Math.floor(Number(event.target.value) || 1)))
                    update('copies', value)
                  }}
                />
              </label>

              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <label className="flex items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">Fallback preview</span>
                    <span className="block text-[11px] text-gray-400">Open receipt page if direct print fails</span>
                  </span>
                  <Toggle checked={form.fallbackToPreview} onChange={value => update('fallbackToPreview', value)} />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
              <Button onClick={handleSave} loading={saving} className="gap-2">
                {saving ? null : <Save size={14} />}
                Save Settings
              </Button>
              <Button
                variant="secondary"
                onClick={handleTestPrint}
                loading={testing}
                disabled={!form.selectedPrinterName || testing}
                className="gap-2"
              >
                {testing ? null : <TestTube2 size={14} />}
                Test Print
              </Button>
              <Button variant="ghost" onClick={handleClear} disabled={saving || testing} className="gap-2">
                <RotateCcw size={14} />
                Reset
              </Button>
            </div>
          </div>
        )}
      </div>

      {form.selectedPrinterName && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
          <Check size={15} className="mt-0.5 flex-shrink-0 text-emerald-600" />
          <p className="text-[11px] leading-relaxed text-emerald-700">
            {form.selectedPrinterName} is selected for direct receipt printing. Browser users still use normal print preview.
          </p>
        </div>
      )}
    </div>
  )
}
