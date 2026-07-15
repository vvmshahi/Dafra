import { useEffect, useState } from 'react'
import { Check, FileText, Loader2, Printer, RefreshCw, RotateCcw, Save, SlidersHorizontal, TestTube2 } from 'lucide-react'
import {
  DEFAULT_PRINTER_SETTINGS,
  clearPrinterSettings,
  getPrinterSettings,
  getPrinters,
  isElectron,
  receiptPresetDefaults,
  savePrinterSettings,
  testPrint,
  testPrintA4,
  type PrinterSettings,
  type ReceiptPaperPreset,
} from '@/lib/electron'
import { Button } from '@/components/ui/Button'
import { Switch as Toggle } from '@/components/ui/Switch'

type Status = {
  type: 'success' | 'error' | 'info'
  text: string
} | null

const numberInput = 'input h-10 tabular-nums'

function statusClasses(type: NonNullable<Status>['type']) {
  if (type === 'success') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
  if (type === 'error') return 'border-red-100 bg-red-50 text-red-700'
  return 'border-blue-100 bg-blue-50 text-blue-700'
}

function printerStateLabel(printer: any): string {
  if (printer?.status === 0 || printer?.status == null) return 'Ready'
  return 'Check printer'
}

function FieldHelp({ children }: { children: string }) {
  return <p className="text-[11px] leading-relaxed text-gray-400">{children}</p>
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  help,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  help?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-semibold text-gray-500">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        className={numberInput}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
      />
      {help ? <FieldHelp>{help}</FieldHelp> : null}
    </label>
  )
}

export default function PrinterTab() {
  const [printers, setPrinters] = useState<any[]>([])
  const [form, setForm] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingReceipt, setTestingReceipt] = useState(false)
  const [testingA4, setTestingA4] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const selectedReceiptPrinter = printers.find(printer => printer.name === form.receiptPrinterName)
  const selectedA4Printer = printers.find(printer => printer.name === form.a4PrinterName)

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
      if (settings.receiptPrinterName && !list.some(printer => printer.name === settings.receiptPrinterName)) {
        setStatus({ type: 'error', text: 'Saved receipt printer was not found on this device. Refresh or choose another printer.' })
      } else if (settings.a4PrinterName && !list.some(printer => printer.name === settings.a4PrinterName)) {
        setStatus({ type: 'error', text: 'Saved A4 printer was not found on this device. Refresh or choose another printer.' })
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

  const setPreset = (preset: ReceiptPaperPreset) => {
    const defaults = receiptPresetDefaults(preset)
    setForm(prev => ({
      ...prev,
      receiptPaperPreset: preset,
      receiptPaperWidthMm: preset === 'custom' ? prev.receiptPaperWidthMm : defaults.receiptPaperWidthMm,
      receiptPrintableWidthMm: preset === 'custom' ? prev.receiptPrintableWidthMm : defaults.receiptPrintableWidthMm,
    }))
    setStatus(null)
  }

  const resetCalibration = () => {
    const defaults = receiptPresetDefaults(form.receiptPaperPreset)
    setForm(prev => ({
      ...prev,
      receiptPaperWidthMm: prev.receiptPaperPreset === 'custom' ? prev.receiptPaperWidthMm : defaults.receiptPaperWidthMm,
      receiptPrintableWidthMm: prev.receiptPaperPreset === 'custom' ? Math.min(prev.receiptPaperWidthMm - 1, defaults.receiptPrintableWidthMm) : defaults.receiptPrintableWidthMm,
      receiptScalePercent: 100,
      receiptMarginLeftMm: 2,
      receiptMarginRightMm: 2,
      receiptMarginTopMm: 0,
      receiptMarginBottomMm: 0,
      receiptHorizontalOffsetMm: 0,
      receiptVerticalOffsetMm: 0,
      receiptFontSize: 'normal',
      receiptDensity: 'normal',
    }))
    setStatus({ type: 'info', text: 'Receipt calibration reset. Save settings to keep it.' })
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

  const handleTestReceipt = async () => {
    setTestingReceipt(true)
    setStatus(null)
    try {
      const result = await testPrint(form)
      setStatus(result.success
        ? { type: 'success', text: 'Test receipt sent to printer.' }
        : { type: 'error', text: result.message || result.errorType || 'Test receipt failed.' })
    } catch (error) {
      setStatus({ type: 'error', text: error instanceof Error ? error.message : 'Test receipt failed.' })
    } finally {
      setTestingReceipt(false)
    }
  }

  const handleTestA4 = async () => {
    setTestingA4(true)
    setStatus(null)
    try {
      const result = await testPrintA4()
      setStatus(result.success
        ? { type: 'success', text: 'A4 test page sent to printer.' }
        : { type: 'error', text: result.message || result.errorType || 'A4 test print failed.' })
    } catch (error) {
      setStatus({ type: 'error', text: error instanceof Error ? error.message : 'A4 test print failed.' })
    } finally {
      setTestingA4(false)
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
            <p className="mt-1 text-xs text-gray-500">Browser receipt and A4 printing continue to use the normal print dialog.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
              <Printer size={16} className="text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Device printer profile</p>
              <p className="text-xs text-gray-400">Saved locally on this computer for receipt and A4 printing.</p>
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
          <div className="space-y-6">
            <section className="space-y-4">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                <Printer size={15} className="text-primary-600" />
                <h3 className="text-sm font-bold text-gray-900">Receipt printer</h3>
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_170px_170px]">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-gray-500">Receipt printer</span>
                  <select
                    className="input"
                    value={form.receiptPrinterName ?? ''}
                    onChange={event => update('receiptPrinterName', event.target.value || null)}
                  >
                    <option value="">Select receipt printer...</option>
                    {printers.map(printer => (
                      <option key={printer.name} value={printer.name}>{printer.name}</option>
                    ))}
                  </select>
                  {printers.length === 0 ? (
                    <p className="text-[11px] text-amber-600">No printers found on this device.</p>
                  ) : selectedReceiptPrinter ? (
                    <p className="text-[11px] text-gray-400">{printerStateLabel(selectedReceiptPrinter)}</p>
                  ) : (
                    <p className="text-[11px] text-gray-400">{printers.length} printer{printers.length !== 1 ? 's' : ''} detected.</p>
                  )}
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-gray-500">Paper preset</span>
                  <select className="input" value={form.receiptPaperPreset} onChange={event => setPreset(event.target.value as ReceiptPaperPreset)}>
                    <option value="80mm">80 mm</option>
                    <option value="58mm">58 mm</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>

                <NumberField
                  label="Copies"
                  value={form.receiptCopies}
                  min={1}
                  max={3}
                  onChange={value => update('receiptCopies', Math.max(1, Math.min(3, Math.floor(value) || 1)))}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {form.receiptPaperPreset === 'custom' && (
                  <NumberField
                    label="Paper width (mm)"
                    value={form.receiptPaperWidthMm}
                    min={40}
                    max={120}
                    step={0.5}
                    help="Use the physical roll width."
                    onChange={value => update('receiptPaperWidthMm', value)}
                  />
                )}
                <NumberField
                  label="Printable content width (mm)"
                  value={form.receiptPrintableWidthMm}
                  min={30}
                  max={Math.max(30, form.receiptPaperWidthMm - 1)}
                  step={0.5}
                  help="Reduce this if the right side of the receipt is cut off."
                  onChange={value => update('receiptPrintableWidthMm', value)}
                />

                <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <label className="flex items-center justify-between gap-4">
                    <span>
                      <span className="block text-sm font-semibold text-gray-900">Auto-print after sale</span>
                      <span className="block text-[11px] text-gray-400">Print once after checkout succeeds</span>
                    </span>
                    <Toggle checked={form.autoPrintReceiptAfterSale} onChange={value => update('autoPrintReceiptAfterSale', value)} />
                  </label>
                </div>

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
            </section>

            <details className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-gray-900">
                <SlidersHorizontal size={15} className="text-primary-600" />
                Advanced calibration
              </summary>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <NumberField label="Scale (%)" value={form.receiptScalePercent} min={70} max={110} help="Reduce all receipt content proportionally." onChange={value => update('receiptScalePercent', Math.round(value))} />
                <NumberField label="Left margin (mm)" value={form.receiptMarginLeftMm} min={0} max={10} step={0.5} onChange={value => update('receiptMarginLeftMm', value)} />
                <NumberField label="Right margin (mm)" value={form.receiptMarginRightMm} min={0} max={10} step={0.5} onChange={value => update('receiptMarginRightMm', value)} />
                <NumberField label="Top margin (mm)" value={form.receiptMarginTopMm} min={0} max={10} step={0.5} onChange={value => update('receiptMarginTopMm', value)} />
                <NumberField label="Bottom margin (mm)" value={form.receiptMarginBottomMm} min={0} max={10} step={0.5} onChange={value => update('receiptMarginBottomMm', value)} />
                <NumberField label="Horizontal offset (mm)" value={form.receiptHorizontalOffsetMm} min={-10} max={10} step={0.5} help="Move the receipt left or right." onChange={value => update('receiptHorizontalOffsetMm', value)} />
                <NumberField label="Vertical offset (mm)" value={form.receiptVerticalOffsetMm} min={-10} max={10} step={0.5} onChange={value => update('receiptVerticalOffsetMm', value)} />
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-gray-500">Font size</span>
                  <select className="input" value={form.receiptFontSize} onChange={event => update('receiptFontSize', event.target.value as PrinterSettings['receiptFontSize'])}>
                    <option value="small">Small</option>
                    <option value="normal">Normal</option>
                    <option value="large">Large</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-gray-500">Density</span>
                  <select className="input" value={form.receiptDensity} onChange={event => update('receiptDensity', event.target.value as PrinterSettings['receiptDensity'])}>
                    <option value="compact">Compact</option>
                    <option value="normal">Normal</option>
                    <option value="spacious">Spacious</option>
                  </select>
                </label>
              </div>
            </details>

            <section className="space-y-4">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                <FileText size={15} className="text-primary-600" />
                <h3 className="text-sm font-bold text-gray-900">A4 printer</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-gray-500">A4 printer</span>
                  <select className="input" value={form.a4PrinterName ?? ''} onChange={event => update('a4PrinterName', event.target.value || null)}>
                    <option value="">Use system default printer</option>
                    {printers.map(printer => (
                      <option key={printer.name} value={printer.name}>{printer.name}</option>
                    ))}
                  </select>
                  {selectedA4Printer ? <p className="text-[11px] text-gray-400">{printerStateLabel(selectedA4Printer)}</p> : null}
                </label>
                <NumberField label="A4 copies" value={form.a4Copies} min={1} max={3} onChange={value => update('a4Copies', Math.max(1, Math.min(3, Math.floor(value) || 1)))} />
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
              <Button onClick={handleSave} loading={saving} className="gap-2">
                {saving ? null : <Save size={14} />}
                Save printer settings
              </Button>
              <Button variant="secondary" onClick={handleTestReceipt} loading={testingReceipt} disabled={!form.receiptPrinterName || testingReceipt} className="gap-2">
                {testingReceipt ? null : <TestTube2 size={14} />}
                Print test receipt
              </Button>
              <Button variant="secondary" onClick={handleTestA4} loading={testingA4} disabled={testingA4} className="gap-2">
                {testingA4 ? null : <FileText size={14} />}
                Print test A4 invoice
              </Button>
              <Button variant="ghost" onClick={resetCalibration} disabled={saving || testingReceipt || testingA4} className="gap-2">
                <SlidersHorizontal size={14} />
                Reset receipt calibration
              </Button>
              <Button variant="ghost" onClick={handleClear} disabled={saving || testingReceipt || testingA4} className="gap-2">
                <RotateCcw size={14} />
                Reset all
              </Button>
            </div>
          </div>
        )}
      </div>

      {form.receiptPrinterName && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
          <Check size={15} className="mt-0.5 flex-shrink-0 text-emerald-600" />
          <p className="text-[11px] leading-relaxed text-emerald-700">
            {form.receiptPrinterName} is selected for {form.receiptPaperPreset === 'custom' ? `${form.receiptPaperWidthMm} mm` : form.receiptPaperPreset} receipts with {form.receiptPrintableWidthMm} mm printable content.
          </p>
        </div>
      )}
    </div>
  )
}
