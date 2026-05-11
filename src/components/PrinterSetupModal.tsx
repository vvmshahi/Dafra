import { useState, useEffect } from 'react'
import { Printer, Check, X, Loader2 } from 'lucide-react'
import { getPrinters, getDefaultPrinter, savePrinter, clearPrinter } from '@/lib/electron'
import { Button } from '@/components/ui/Button'

interface Props {
  onClose: () => void
}

export function PrinterSetupModal({ onClose }: Props) {
  const [printers,  setPrinters]  = useState<any[]>([])
  const [selected,  setSelected]  = useState<string | null>(null)
  const [current,   setCurrent]   = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)

  useEffect(() => {
    Promise.all([getPrinters(), getDefaultPrinter()]).then(([list, def]) => {
      setPrinters(list)
      setSelected(def)
      setCurrent(def)
      setLoading(false)
    })
  }, [])

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    await savePrinter(selected)
    setCurrent(selected)
    setSaving(false)
    setSaved(true)
    setTimeout(onClose, 1200)
  }

  const handleClear = async () => {
    await clearPrinter()
    setSelected(null)
    setCurrent(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center">
              <Printer size={16} className="text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Select Default Printer</p>
              <p className="text-xs text-gray-400">Choose your thermal printer for automatic printing</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Printer list */}
        <div className="px-6 py-4 max-h-72 overflow-y-auto space-y-1.5">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 size={20} className="animate-spin mr-2" />
              <span className="text-sm">Loading printers…</span>
            </div>
          ) : printers.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-400">
              No printers found on this device.
            </div>
          ) : (
            printers.map((p) => {
              const isSelected = selected === p.name
              const isCurrent  = current  === p.name
              return (
                <button
                  key={p.name}
                  onClick={() => setSelected(p.name)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-400/30'
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    isSelected ? 'border-primary-500 bg-primary-500' : 'border-gray-300'
                  }`}>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.status === 0 ? 'Ready' : 'Offline'}</p>
                  </div>
                  {isCurrent && (
                    <span className="text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-0.5 rounded-full font-semibold flex-shrink-0">
                      Default
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <div>
            {current && (
              <button
                onClick={handleClear}
                className="text-xs text-red-500 hover:text-red-700 transition-colors"
              >
                Clear default
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Skip
            </Button>
            <Button
              onClick={handleSave}
              loading={saving}
              disabled={!selected || saving || saved}
              className="gap-1.5"
            >
              {saved ? (
                <><Check size={14} /> Saved</>
              ) : (
                'Set as Default'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
