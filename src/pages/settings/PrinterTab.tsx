import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, FileText, Loader2, Printer, RefreshCw, RotateCcw, Save, SlidersHorizontal, TestTube2 } from 'lucide-react'
import {
  DEFAULT_PRINTER_SETTINGS,
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
import ThermalReceipt from '@/components/print/ThermalReceipt'

type PrinterView = 'thermal' | 'a4'
type Status = { type: 'success' | 'error' | 'info'; text: string } | null

function statusClasses(type: NonNullable<Status>['type']) {
  if (type === 'success') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
  if (type === 'error') return 'border-red-100 bg-red-50 text-red-700'
  return 'border-blue-100 bg-blue-50 text-blue-700'
}

function printerStatus(name: string | null, printers: any[]) {
  if (!name) return { label: 'Not configured', tone: 'neutral' as const }
  if (printers.some(printer => printer.name === name)) return { label: 'Configured', tone: 'success' as const }
  return { label: 'Printer unavailable', tone: 'error' as const }
}

function StatusPill({ label, tone }: { label: string; tone: 'neutral' | 'success' | 'error' }) {
  const styles = tone === 'success'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : tone === 'error'
      ? 'bg-red-50 text-red-700 border-red-100'
      : 'bg-gray-50 text-gray-500 border-gray-100'
  return <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${styles}`}>{label}</span>
}

function NumberField({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-semibold text-gray-500">{label}</span>
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={event => onChange(Number(event.target.value))}
        className="input h-10 tabular-nums" />
    </label>
  )
}

function SettingToggle({ title, help, checked, onChange }: {
  title: string; help: string; checked: boolean; onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <span>
        <span className="block text-sm font-semibold text-gray-900">{title}</span>
        <span className="block text-[11px] leading-relaxed text-gray-400">{help}</span>
      </span>
      <Toggle checked={checked} onChange={onChange} />
    </label>
  )
}

const SAMPLE_ITEMS = [{ name: 'Kubri sample item', qty: 2, unitPrice: 10, lineTotal: 20 }]

export default function PrinterTab() {
  const [activeView, setActiveView] = useState<PrinterView>('thermal')
  const [printers, setPrinters] = useState<any[]>([])
  const [form, setForm] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS)
  const [saved, setSaved] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved])
  const thermalStatus = printerStatus(form.receiptPrinterName, printers)
  const a4Status = form.a4PrinterName
    ? printerStatus(form.a4PrinterName, printers)
    : { label: 'System default', tone: 'neutral' as const }

  const load = async () => {
    if (!isElectron()) { setLoading(false); return }
    setLoading(true)
    setStatus(null)
    try {
      const [settings, list] = await Promise.all([getPrinterSettings(), getPrinters()])
      setForm(settings)
      setSaved(settings)
      setPrinters(list)
    } catch (error) {
      setStatus({ type: 'error', text: error instanceof Error ? error.message : 'Unable to load printers.' })
    } finally {
      setLoading(false)
    }
  }

  const refreshPrinters = async () => {
    setLoading(true)
    setStatus(null)
    try {
      setPrinters(await getPrinters())
      setStatus({ type: 'info', text: 'Printer list refreshed. Unsaved settings were preserved.' })
    } catch (error) {
      setStatus({ type: 'error', text: error instanceof Error ? error.message : 'Unable to refresh printers.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const update = <K extends keyof PrinterSettings>(key: K, value: PrinterSettings[K]) => {
    setForm(current => ({ ...current, [key]: value }))
    setStatus(null)
  }

  const setPreset = (preset: ReceiptPaperPreset) => {
    const defaults = receiptPresetDefaults(preset)
    setForm(current => ({
      ...current,
      receiptPaperPreset: preset,
      receiptPaperWidthMm: preset === 'custom' ? current.receiptPaperWidthMm : defaults.receiptPaperWidthMm,
      receiptPrintableWidthMm: preset === 'custom' ? current.receiptPrintableWidthMm : defaults.receiptPrintableWidthMm,
    }))
    setStatus(null)
  }

  const save = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const next = await savePrinterSettings(form)
      setForm(next)
      setSaved(next)
      setStatus({ type: 'success', text: 'Printer settings saved on this device.' })
    } catch (error) {
      setStatus({ type: 'error', text: error instanceof Error ? error.message : 'Unable to save printer settings.' })
    } finally {
      setSaving(false)
    }
  }

  const restoreDefaults = () => {
    setForm(DEFAULT_PRINTER_SETTINGS)
    setStatus({ type: 'info', text: 'Defaults loaded. Save changes to keep them.' })
  }

  const runTest = async () => {
    setTesting(true)
    setStatus(null)
    try {
      const result = activeView === 'thermal' ? await testPrint(form) : await testPrintA4(form)
      setStatus(result.success
        ? { type: 'success', text: activeView === 'thermal' ? 'Test receipt sent to printer.' : 'A4 test page sent to printer.' }
        : { type: 'error', text: result.message || result.errorType || 'Test print failed.' })
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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100"><Printer size={17} className="text-gray-500" /></div>
          <div>
            <p className="text-sm font-bold text-gray-900">Device printing requires the Kubri Desktop app.</p>
            <p className="mt-1 text-xs text-gray-500">Web printing remains available through the browser print dialog from an invoice or receipt.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card flex items-center justify-between gap-3 p-4"><div><p className="text-[11px] text-gray-400">Thermal receipt</p><p className="mt-1 truncate text-sm font-semibold text-gray-900">{form.receiptPrinterName || 'No printer selected'}</p></div><StatusPill {...thermalStatus} /></div>
        <div className="card flex items-center justify-between gap-3 p-4"><div><p className="text-[11px] text-gray-400">A4 invoice</p><p className="mt-1 truncate text-sm font-semibold text-gray-900">{form.a4PrinterName || 'System default'}</p></div><StatusPill {...a4Status} /></div>
        <div className="card flex items-center justify-between gap-3 p-4"><div><p className="text-[11px] text-gray-400">Auto print after sale</p><p className="mt-1 text-sm font-semibold text-gray-900">{form.autoPrintReceiptAfterSale ? 'On' : 'Off'}</p></div><StatusPill label={form.autoPrintReceiptAfterSale ? 'On' : 'Off'} tone={form.autoPrintReceiptAfterSale ? 'success' : 'neutral'} /></div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex border-b border-gray-100 p-2" role="tablist" aria-label="Printer format">
          {([['thermal', 'Thermal Receipt', Printer], ['a4', 'A4 Invoice', FileText]] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" role="tab" aria-selected={activeView === value}
              onClick={() => setActiveView(value)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${activeView === value ? 'bg-[#0F2419] text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-gray-900">{activeView === 'thermal' ? 'Thermal receipt setup' : 'A4 invoice setup'}</h2>
              <p className="text-xs text-gray-400">{activeView === 'thermal' ? 'Receipt printer, roll width, calibration, and checkout behavior.' : 'A separate printer for full-page invoice output.'}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={refreshPrinters} disabled={loading} className="gap-2"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh printers</Button>
          </div>

          {status && <div className={`mb-4 rounded-xl border px-4 py-3 text-xs font-medium ${statusClasses(status.type)}`}>{status.text}</div>}
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-gray-400"><Loader2 size={18} className="mr-2 animate-spin" /> Loading printers…</div>
          ) : activeView === 'thermal' ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-5">
                <section className="space-y-3"><h3 className="text-xs font-bold uppercase tracking-wide text-gray-400">Printer</h3>
                  <label className="space-y-1.5"><span className="text-xs font-semibold text-gray-500">Selected thermal printer</span>
                    <select className="input" value={form.receiptPrinterName ?? ''} onChange={event => update('receiptPrinterName', event.target.value || null)}>
                      <option value="">Select thermal printer…</option>{printers.map(printer => <option key={printer.name} value={printer.name}>{printer.name}</option>)}
                    </select>
                    <div className="flex items-center gap-2"><StatusPill {...thermalStatus} /><span className="text-[11px] text-gray-400">{printers.length} detected</span></div>
                  </label>
                </section>

                <section className="space-y-3"><h3 className="text-xs font-bold uppercase tracking-wide text-gray-400">Receipt format</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1.5"><span className="text-xs font-semibold text-gray-500">Paper width</span><select className="input" value={form.receiptPaperPreset} onChange={event => setPreset(event.target.value as ReceiptPaperPreset)}><option value="58mm">58 mm</option><option value="80mm">80 mm</option><option value="custom">Custom</option></select></label>
                    <NumberField label="Copies" value={form.receiptCopies} min={1} max={3} onChange={value => update('receiptCopies', Math.max(1, Math.min(3, Math.floor(value) || 1)))} />
                  </div>
                </section>

                <section className="space-y-3"><h3 className="text-xs font-bold uppercase tracking-wide text-gray-400">Printing behavior</h3>
                  <SettingToggle title="Auto print after sale" help="Print once after checkout succeeds. A print failure never blocks the sale." checked={form.autoPrintReceiptAfterSale} onChange={value => update('autoPrintReceiptAfterSale', value)} />
                  <SettingToggle title="Open preview if direct print fails" help="Keeps a manual print route available when silent direct printing fails." checked={form.fallbackToPreview} onChange={value => update('fallbackToPreview', value)} />
                  <p className="rounded-xl bg-blue-50 px-3 py-2 text-[11px] leading-relaxed text-blue-700">Direct thermal printing is silent when a printer is selected. Logo, QR, customer details, and footer content come from the branch Invoice Settings and use the same receipt template.</p>
                </section>

                <details className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3"><summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-gray-800"><SlidersHorizontal size={15} /> Advanced calibration</summary>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {form.receiptPaperPreset === 'custom' && <NumberField label="Paper width (mm)" value={form.receiptPaperWidthMm} min={40} max={120} step={0.5} onChange={value => update('receiptPaperWidthMm', value)} />}
                    <NumberField label="Printable width (mm)" value={form.receiptPrintableWidthMm} min={30} max={form.receiptPaperWidthMm - 1} step={0.5} onChange={value => update('receiptPrintableWidthMm', value)} />
                    <NumberField label="Scale (%)" value={form.receiptScalePercent} min={70} max={110} onChange={value => update('receiptScalePercent', value)} />
                    <NumberField label="Left margin (mm)" value={form.receiptMarginLeftMm} min={0} max={10} step={0.5} onChange={value => update('receiptMarginLeftMm', value)} />
                    <NumberField label="Right margin (mm)" value={form.receiptMarginRightMm} min={0} max={10} step={0.5} onChange={value => update('receiptMarginRightMm', value)} />
                    <NumberField label="Top margin (mm)" value={form.receiptMarginTopMm} min={0} max={10} step={0.5} onChange={value => update('receiptMarginTopMm', value)} />
                    <NumberField label="Bottom margin (mm)" value={form.receiptMarginBottomMm} min={0} max={10} step={0.5} onChange={value => update('receiptMarginBottomMm', value)} />
                  </div>
                </details>
              </div>

              <aside className="rounded-2xl border border-gray-200 bg-gray-100 p-4"><div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-bold text-gray-800">Live receipt preview</p><p className="text-[10px] text-gray-400">Same receipt component used for printing</p></div><span className="text-[10px] font-semibold text-gray-500">{form.receiptPaperWidthMm} mm</span></div>
                <div className="mx-auto overflow-hidden rounded-lg bg-white py-3 shadow-sm" style={{ width: form.receiptPaperPreset === '58mm' ? '210px' : '280px', maxWidth: '100%', ['--receipt-content-width' as string]: `${form.receiptPrintableWidthMm}mm`, ['--receipt-font-size' as string]: form.receiptFontSize === 'small' ? '10px' : form.receiptFontSize === 'large' ? '12px' : '11px', ['--receipt-line-height' as string]: form.receiptDensity === 'compact' ? '1.25' : form.receiptDensity === 'spacious' ? '1.55' : '1.4' }}>
                  <ThermalReceipt preview id="printer-settings-preview" businessNameAr="Kubri Test Print" businessNameEn="Kubri Sample Store" branchName="Sample Branch" address="Riyadh, Saudi Arabia" vatNumber="300000000000003" invoiceNumber="TEST-001" date="01/01/2026" time="10:30" items={SAMPLE_ITEMS} subtotal={17.39} taxAmount={2.61} total={20} paymentMethod="cash" cashReceived={20} change={0} customerName="Sample customer" qrDataUrl={null} receiptFooter="Printer preview only" />
                </div>
              </aside>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-5">
                <section className="space-y-3"><h3 className="text-xs font-bold uppercase tracking-wide text-gray-400">Printer</h3>
                  <label className="space-y-1.5"><span className="text-xs font-semibold text-gray-500">Selected A4 printer</span><select className="input" value={form.a4PrinterName ?? ''} onChange={event => update('a4PrinterName', event.target.value || null)}><option value="">Use system default printer</option>{printers.map(printer => <option key={printer.name} value={printer.name}>{printer.name}</option>)}</select><StatusPill {...a4Status} /></label>
                  <NumberField label="Copies" value={form.a4Copies} min={1} max={3} onChange={value => update('a4Copies', Math.max(1, Math.min(3, Math.floor(value) || 1)))} />
                </section>
                <section className="rounded-xl border border-gray-100 bg-gray-50 p-4"><h3 className="text-sm font-semibold text-gray-900">Page setup</h3><dl className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-gray-400">Paper</dt><dd className="font-medium text-gray-800">A4</dd></div><div><dt className="text-gray-400">Orientation</dt><dd className="font-medium text-gray-800">Portrait</dd></div><div><dt className="text-gray-400">Margins</dt><dd className="font-medium text-gray-800">15 mm</dd></div><div><dt className="text-gray-400">Background</dt><dd className="font-medium text-gray-800">Printed</dd></div></dl><p className="mt-3 text-[11px] text-gray-400">A4 document content and bilingual presentation come from the existing invoice template.</p></section>
              </div>
              <aside className="rounded-2xl border border-gray-200 bg-gray-100 p-4"><div className="mb-3"><p className="text-xs font-bold text-gray-800">A4 layout guide</p><p className="text-[10px] text-gray-400">Actual invoice preview remains available from invoice details</p></div><div className="mx-auto aspect-[1/1.414] w-full max-w-[240px] rounded-sm bg-white p-5 shadow-sm"><div className="border-b-2 border-[#0F2419] pb-3"><p className="text-sm font-bold text-[#0F2419]">Kubri A4 Invoice</p><p className="text-[8px] text-gray-400">Portrait · A4 · 15 mm margins</p></div><div className="mt-5 space-y-2">{[1,2,3,4].map(line => <div key={line} className="h-2 rounded bg-gray-100" />)}</div><div className="ml-auto mt-6 h-12 w-24 rounded bg-gray-100" /></div></aside>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
            <Button onClick={save} loading={saving} disabled={!dirty || testing} className="gap-2"><Save size={14} /> Save changes</Button>
            <Button variant="secondary" onClick={() => { setForm(saved); setStatus({ type: 'info', text: 'Unsaved changes cancelled.' }) }} disabled={!dirty || saving || testing}>Cancel changes</Button>
            <Button variant="secondary" onClick={runTest} loading={testing} disabled={testing || (activeView === 'thermal' && !form.receiptPrinterName)} className="gap-2"><TestTube2 size={14} /> {activeView === 'thermal' ? 'Test receipt' : 'Test A4 page'}</Button>
            <Button variant="ghost" onClick={restoreDefaults} disabled={saving || testing} className="gap-2"><RotateCcw size={14} /> Restore defaults</Button>
            {dirty && <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600"><AlertTriangle size={13} /> Unsaved changes</span>}
          </div>
        </div>
      </section>
    </div>
  )
}
