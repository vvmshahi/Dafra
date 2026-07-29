import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, RotateCcw, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import BarcodeLabelDesigner from './BarcodeLabelDesigner'
import {
  getBranchBarcodeLabelSettings,
  updateBranchBarcodeLabelSettings,
} from '@/lib/barcodes/labelApi'
import type { BarcodeLabel } from '@/lib/barcodes/labelPrint'
import {
  DEFAULT_BARCODE_LABEL_SETTINGS,
  loadBarcodeDeviceCalibration,
  type BarcodeLabelSettings,
} from '@/lib/barcodes/labelSettings'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface Props {
  branchId: string
  businessName: string | null
}

export default function BarcodeLabelSettingsPanel({ branchId, businessName }: Props) {
  const { t } = useTranslation('printing')
  const [settings, setSettings] = useState<BarcodeLabelSettings>(DEFAULT_BARCODE_LABEL_SETTINGS)
  const [saved, setSaved] = useState<BarcodeLabelSettings>(DEFAULT_BARCODE_LABEL_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [canEdit, setCanEdit] = useState(true)
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const calibration = useMemo(() => loadBarcodeDeviceCalibration(), [])
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved)
  const previewLabel = useMemo<BarcodeLabel>(() => ({
    barcode: '4006381333931',
    barcodeType: 'ean13',
    businessName,
    productName: t('barcodeLabels.preview.sampleProductEn'),
    productNameEn: t('barcodeLabels.preview.sampleProductEn'),
    productNameAr: t('barcodeLabels.preview.sampleProductAr'),
    unitName: t('barcodeLabels.preview.sampleUnit'),
    price: t('barcodeLabels.preview.samplePrice'),
    sku: 'SKU-1048',
    copies: 1,
  }), [businessName, t])

  useEffect(() => {
    setLoading(true)
    setStatus(null)
    void getBranchBarcodeLabelSettings(branchId)
      .then(result => {
        setSettings(result.settings)
        setSaved(result.settings)
        setCanEdit(result.canEdit)
      })
      .catch(() => setStatus({ kind: 'error', text: t('barcodeLabels.errors.loadSettings') }))
      .finally(() => setLoading(false))
  }, [branchId, t])

  const save = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const result = await updateBranchBarcodeLabelSettings(branchId, settings)
      setSettings(result.settings)
      setSaved(result.settings)
      setStatus({ kind: 'success', text: t('barcodeLabels.settings.saved') })
    } catch {
      setStatus({ kind: 'error', text: t('barcodeLabels.errors.saveSettings') })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="grid min-h-72 place-items-center text-sm text-gray-500">{t('barcodeLabels.loading')}</div>
  return <div className="space-y-5">
    <header>
      <p className="text-[10px] font-bold uppercase tracking-wide text-primary-700">{t('barcodeLabels.settings.scopeLabel')}</p>
      <h2 className="mt-1 text-base font-bold text-gray-950">{t('barcodeLabels.settings.title')}</h2>
    </header>

    {!canEdit && <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">{t('barcodeLabels.settings.readOnly')}</p>}
    {status && <p className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${status.kind === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`} role={status.kind === 'error' ? 'alert' : 'status'}>
      {status.kind === 'success' ? <Check size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
      {status.text}
    </p>}

    <fieldset disabled={!canEdit || saving}>
      <BarcodeLabelDesigner
        labels={[previewLabel]}
        settings={settings}
        calibration={calibration}
        onChange={setSettings}
        previewDataLabel={t('barcodeLabels.preview.sampleData')}
      />
    </fieldset>

    <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm">
      <Button type="button" onClick={() => void save()} loading={saving} disabled={!canEdit || !dirty}
        aria-describedby={!canEdit || !dirty ? 'branch-label-save-reason' : undefined}
        title={!canEdit ? t('barcodeLabels.settings.readOnly') : !dirty ? t('barcodeLabels.settings.noUnsavedChanges') : undefined}>
        <Save size={14} aria-hidden="true" /> {t('barcodeLabels.actions.saveBranchDefault')}
      </Button>
      <Button type="button" variant="secondary" onClick={() => setRestoreOpen(true)} disabled={!dirty || saving}>
        <RotateCcw size={14} aria-hidden="true" /> {t('barcodeLabels.actions.restoreBranchDefault')}
      </Button>
      <span className="ms-auto text-[10px] text-gray-500">
        {dirty ? t('barcodeLabels.settings.unsaved') : t('barcodeLabels.settings.upToDate')}
      </span>
      {(!canEdit || !dirty) && <span id="branch-label-save-reason" className="sr-only">
        {t(!canEdit ? 'barcodeLabels.settings.readOnly' : 'barcodeLabels.settings.noUnsavedChanges')}
      </span>}
    </div>
    <ConfirmDialog open={restoreOpen} kind="restoreBranchLabelDefault" onClose={() => setRestoreOpen(false)} onConfirm={() => { setSettings(saved); setStatus(null); setRestoreOpen(false) }} />
  </div>
}
