import { supabase } from '@/lib/supabase'
import {
  DEFAULT_BARCODE_LABEL_SETTINGS,
  normalizeBarcodeLabelSettings,
  serializeBarcodeLabelSettings,
  type BarcodeLabelSettings,
} from './labelSettings'

interface BranchSettingsResponse {
  branch_id?: string
  settings?: unknown
  has_saved_default?: boolean
  version?: number
  can_edit?: boolean
}

interface PrintStatusRow {
  barcode_id: string
  print_count: number
  last_printed_at: string | null
}

export interface BarcodePrintAuditItem {
  barcodeId: string
  copies: number
}

export interface BarcodePrintAuditResult {
  total_labels?: number
  events?: {
    event_id: string
    barcode_id: string
    print_kind: 'first_print' | 'reprint'
    copies: number
  }[]
}

export async function getBranchBarcodeLabelSettings(branchId: string) {
  const { data, error } = await (supabase as any).rpc('get_branch_barcode_label_settings', {
    p_branch_id: branchId,
  })
  if (error) throw error
  const response = (data ?? {}) as BranchSettingsResponse
  return {
    settings: normalizeBarcodeLabelSettings(response.settings ?? DEFAULT_BARCODE_LABEL_SETTINGS),
    hasSavedDefault: response.has_saved_default === true,
    version: Number(response.version ?? 0),
    canEdit: response.can_edit !== false,
  }
}

export async function updateBranchBarcodeLabelSettings(
  branchId: string,
  settings: BarcodeLabelSettings,
) {
  const { data, error } = await (supabase as any).rpc('update_branch_barcode_label_settings', {
    p_payload: {
      branch_id: branchId,
      settings: serializeBarcodeLabelSettings(settings),
    },
  })
  if (error) throw error
  const response = (data ?? {}) as BranchSettingsResponse
  return {
    settings: normalizeBarcodeLabelSettings(response.settings),
    hasSavedDefault: response.has_saved_default === true,
    version: Number(response.version ?? 1),
    canEdit: response.can_edit !== false,
  }
}

export async function getProductBarcodePrintStatus(productId: string) {
  const { data, error } = await (supabase as any).rpc('get_product_barcode_print_status', {
    p_product_id: productId,
  })
  if (error) throw error
  return new Map((data ?? []).map((row: PrintStatusRow) => [
    row.barcode_id,
    {
      printCount: Number(row.print_count ?? 0),
      lastPrintedAt: row.last_printed_at,
    },
  ]))
}

export async function recordBarcodePrintBatch(
  items: BarcodePrintAuditItem[],
  template: string,
  reason: string | null,
): Promise<BarcodePrintAuditResult> {
  const { data, error } = await (supabase as any).rpc('record_product_barcode_print_batch', {
    p_payload: {
      items: items.map(item => ({ barcode_id: item.barcodeId, copies: item.copies })),
      label_template: template,
      reason: reason?.trim() || null,
    },
  })
  if (error) throw error
  return (data ?? {}) as BarcodePrintAuditResult
}
