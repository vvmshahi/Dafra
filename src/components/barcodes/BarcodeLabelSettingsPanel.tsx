import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RotateCcw, Save } from 'lucide-react'
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
import { DocumentStudioActionFooter, SavedStatus } from '@/components/printing/DocumentStudioShell'

interface Props {
  branchId: string
  businessName: string | null
  printerAdjustment?: React.ReactNode
  onDirtyChange?: (dirty: boolean) => void
}

export default function BarcodeLabelSettingsPanel({ branchId, businessName, printerAdjustment, onDirtyChange }: Props) {
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
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

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

  if (loading) return <div className="grid h-full min-h-72 place-items-center text-sm text-gray-500">{t('barcodeLabels.loading')}</div>
  return <div className="h-full min-h-0">
    <fieldset disabled={!canEdit || saving} className="h-full min-h-0">
      <BarcodeLabelDesigner
        labels={[previewLabel]}
        settings={settings}
        calibration={calibration}
        onChange={setSettings}
        previewDataLabel={t('barcodeLabels.preview.sampleData')}
        studio={{
          printerAdjustment: printerAdjustment ?? <p className="text-xs text-gray-500">{t('barcodeLabels.calibration.disclosure')}</p>,
          actionFooter: <DocumentStudioActionFooter status={
            status?.kind === 'error'
              ? <span className="inline-flex items-center gap-2 text-red-700" role="alert"><AlertTriangle size={14} aria-hidden="true" />{status.text}</span>
              : status?.kind === 'success'
                ? <SavedStatus>{status.text}</SavedStatus>
                : <span className={dirty ? 'font-semibold text-amber-800' : 'text-gray-500'}>{t(dirty ? 'barcodeLabels.settings.unsaved' : 'barcodeLabels.settings.upToDate')}</span>
          }>
            <Button type="button" variant="secondary" onClick={() => setRestoreOpen(true)} disabled={!dirty || saving} className="min-h-9 rounded-lg">
              <RotateCcw size={14} aria-hidden="true" /> {t('barcodeLabels.actions.restoreBranchDefault')}
            </Button>
            <Button type="button" onClick={() => void save()} loading={saving} disabled={!canEdit || !dirty} className="min-h-9 rounded-lg"
              aria-describedby={!canEdit || !dirty ? 'branch-label-save-reason' : undefined}
              title={!canEdit ? t('barcodeLabels.settings.readOnly') : !dirty ? t('barcodeLabels.settings.noUnsavedChanges') : undefined}>
              <Save size={14} aria-hidden="true" /> {t('barcodeLabels.actions.saveBranchDefault')}
            </Button>
            {(!canEdit || !dirty) && <span id="branch-label-save-reason" className="sr-only">
              {t(!canEdit ? 'barcodeLabels.settings.readOnly' : 'barcodeLabels.settings.noUnsavedChanges')}
            </span>}
          </DocumentStudioActionFooter>,
        }}
      />
    </fieldset>
    <ConfirmDialog open={restoreOpen} kind="restoreBranchLabelDefault" onClose={() => setRestoreOpen(false)} onConfirm={() => { setSettings(saved); setStatus(null); setRestoreOpen(false) }} />
  </div>
}
