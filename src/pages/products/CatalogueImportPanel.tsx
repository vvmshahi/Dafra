import { useMemo, useRef, useState } from 'react'
import { FileUp, Loader2, Table2, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { IMPORT_FIELDS, readImportFile, suggestMapping, toImportPayload, type ImportField } from '@/lib/products/catalogueImport'

type ImportRpcResult = { source_row: number; status: 'created' | 'duplicate' | 'failed'; reason?: string | null }
type DuplicateRow = { sourceRow: number; reason: string }
type AccessibleProduct = { sku: string | null; branch_id: string; branches: { name: string; name_ar: string | null } | null }

const normaliseSku = (value: string | null | undefined) => value?.trim().toUpperCase() ?? ''

function ImportBranchContext({ branchName }: { branchName: string }) {
  return <aside className="rounded-2xl border border-[#cfe1d1] bg-[#f2f9f2] px-3.5 py-3" aria-live="polite"><p className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[#53715d]">Importing into</p><p className="mt-0.5 text-sm font-extrabold text-[#173f2a]">{branchName}</p><p className="mt-1 text-xs leading-5 text-slate-600">SKUs are unique across your business. Active barcodes are unique in this branch.</p></aside>
}

export default function CatalogueImportPanel({ branchId, branchName, disabled, onImportComplete }: { branchId: string; branchName: string; disabled: boolean; onImportComplete?: () => Promise<void> | void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [sheets, setSheets] = useState<Array<{ name: string; rows: string[][] }>>([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({})
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; duplicate: number; failed: number; duplicateRows: DuplicateRow[] } | null>(null)
  const sheet = sheets[sheetIndex]
  const parsed = useMemo(() => sheet ? toImportPayload(sheet.rows, mapping) : null, [mapping, sheet])
  const headers = sheet?.rows[0] ?? []
  const downloadTemplate = () => { const content = `\uFEFF${IMPORT_FIELDS.map(field => field.label).join(',')}\r\nExample product,,Beverages,12.50,ITEM-001,123456789,Product,Yes,10,Branch default`; const href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = href; link.download = 'kubri-catalogue-import-template.csv'; link.click(); window.setTimeout(() => URL.revokeObjectURL(href), 0) }
  const pick = async (file?: File) => { if (!file) return; try { const next = await readImportFile(file); if (!next.length || !next.some(entry => entry.rows.length > 1)) throw new Error('No rows found'); setSheets(next); setSheetIndex(0); setMapping(suggestMapping(next[0].rows[0] ?? [])); setResult(null); setMessage(null) } catch { setMessage('This file could not be read. Use a CSV or Excel workbook with a header row.') } }
  const describeDuplicates = async (entries: ImportRpcResult[]) => {
    if (!parsed) return []
    const payloadBySourceRow = new Map(parsed.payload.map(row => [row.source_row, row]))
    const duplicateSkus = [...new Set(entries.filter(entry => /^SKU already exists$/i.test(entry.reason ?? '')).map(entry => normaliseSku(payloadBySourceRow.get(entry.source_row)?.sku)).filter(Boolean))]
    const productBySku = new Map<string, AccessibleProduct>()
    if (duplicateSkus.length) {
      const { data, error } = await supabase.from('products').select('sku,branch_id,branches(name,name_ar)').in('sku', duplicateSkus)
      if (!error) for (const product of (data ?? []) as unknown as AccessibleProduct[]) productBySku.set(normaliseSku(product.sku), product)
    }
    return entries.map(entry => {
      const source = payloadBySourceRow.get(entry.source_row)
      if (/^Barcode already exists$/i.test(entry.reason ?? '')) return { sourceRow: entry.source_row, reason: 'Duplicate barcode — already exists in this branch.' }
      if (/^SKU already exists$/i.test(entry.reason ?? '')) {
        const product = productBySku.get(normaliseSku(source?.sku))
        if (product?.branch_id === branchId) return { sourceRow: entry.source_row, reason: 'Duplicate SKU — already exists in this branch.' }
        const branch = product?.branches
        const accessibleBranchName = branch?.name_ar || branch?.name
        return { sourceRow: entry.source_row, reason: accessibleBranchName ? `Duplicate SKU — already exists in ${accessibleBranchName}.` : 'Duplicate SKU — already exists in another branch.' }
      }
      return { sourceRow: entry.source_row, reason: entry.reason ?? 'Duplicate catalogue value.' }
    })
  }
  const submit = async () => { if (!parsed || parsed.issues.length || !parsed.payload.length || disabled) return; setLoading(true); setMessage(null); try { const summary = { created: 0, duplicate: 0, failed: 0 }; const duplicateEntries: ImportRpcResult[] = []; for (let index = 0; index < parsed.payload.length; index += 250) { const { data, error } = await supabase.rpc('import_catalogue_rows_v1', { p_branch_id: branchId, p_rows: parsed.payload.slice(index, index + 250), p_create_missing_categories: true }); if (error) throw error; for (const entry of ((data?.results ?? []) as ImportRpcResult[])) { if (entry.status === 'created') summary.created += 1; else if (entry.status === 'duplicate') { summary.duplicate += 1; duplicateEntries.push(entry) } else summary.failed += 1 } } setResult({ ...summary, duplicateRows: await describeDuplicates(duplicateEntries) }); if (summary.created > 0) await onImportComplete?.() } catch { setMessage('Import could not be completed. No unreported rows were created; review the file and try again.') } finally { setLoading(false) } }
  if (!sheet) return <section className="space-y-4"><ImportBranchContext branchName={branchName} /><div className="rounded-2xl border border-dashed border-[#9eb9a5] bg-[#f5faf4] p-5 text-center"><FileUp className="mx-auto text-[#173f2a]" size={24}/><p className="mt-2 text-sm font-extrabold text-[#173f2a]">Upload catalogue file</p><p className="mt-1 text-xs text-slate-600">CSV or Excel (.xlsx), up to 5,000 rows. Start from the template for the smoothest mapping.</p><input ref={inputRef} className="hidden" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => void pick(event.target.files?.[0])}/><div className="mt-4 flex justify-center gap-2"><Button onClick={() => inputRef.current?.click()}><Upload size={15}/>Choose file</Button><Button variant="secondary" onClick={downloadTemplate}>Download template</Button></div></div>{message && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">{message}</p>}</section>
  return <section className="space-y-4"><ImportBranchContext branchName={branchName} /><div className="flex items-center gap-2 text-xs font-bold text-[#53715d]"><Table2 size={15}/><select className="input h-9 bg-white" value={sheetIndex} onChange={event => { const index = Number(event.target.value); setSheetIndex(index); setMapping(suggestMapping(sheets[index]?.rows[0] ?? [])) }}>{sheets.map((entry, index) => <option key={entry.name} value={index}>{entry.name} ({Math.max(entry.rows.length - 1, 0)} rows)</option>)}</select><button className="underline" onClick={() => inputRef.current?.click()}>Replace file</button><input ref={inputRef} className="hidden" type="file" accept=".csv,.xlsx" onChange={event => void pick(event.target.files?.[0])}/></div><div className="rounded-2xl border border-[#e3ece3] bg-[#f8fbf7] p-3"><p className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[#53715d]">Match your columns</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{IMPORT_FIELDS.map(field => <label key={field.key} className="text-xs font-bold text-slate-700">{field.label}{field.required ? ' *' : ''}<select className="input mt-1 h-9 w-full bg-white text-xs" value={mapping[field.key] ?? ''} onChange={event => setMapping(current => ({ ...current, [field.key]: event.target.value === '' ? undefined : Number(event.target.value) }))}><option value="">Do not import</option>{headers.map((header, index) => <option key={`${index}-${header}`} value={index}>{header || `Column ${index + 1}`}</option>)}</select></label>)}</div></div><div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700"><strong>{parsed?.payload.length ?? 0} ready</strong> · {parsed?.issues.length ?? 0} needs attention{parsed?.limited ? ' · only the first 5,000 rows will be imported' : ''}{parsed?.issues.slice(0, 3).map(issue => <div key={`${issue.row}-${issue.reason}`} className="mt-1 text-red-700">Row {issue.row}: {issue.reason}</div>)}</div>{result && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900">Import complete: {result.created} created, {result.duplicate} duplicates skipped, {result.failed} failed.{result.duplicateRows.slice(0, 5).map(row => <p key={`${row.sourceRow}-${row.reason}`} className="mt-1 font-medium text-emerald-900">Row {row.sourceRow}: {row.reason}</p>)}{result.duplicateRows.length > 5 && <p className="mt-1 font-medium text-emerald-900">{result.duplicateRows.length - 5} more duplicate rows skipped.</p>}</div>}{message && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">{message}</p>}<Button onClick={() => void submit()} disabled={disabled || loading || !parsed?.payload.length || Boolean(parsed?.issues.length)} loading={loading}><Loader2 size={15} className={loading ? 'animate-spin' : 'hidden'}/>{loading ? 'Importing…' : 'Import valid rows'}</Button></section>
}
