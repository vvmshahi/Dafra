import { useState, useEffect, useCallback } from 'react'
import {
  Users, Plus, Search, Pencil, Trash2, X,
  Loader2, Building2, Phone, UserCheck, UserX, AlertTriangle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui/Badge'
import type { Employee, Branch } from '@/types/database'

const db = () => supabase as any

// ── Employee drawer ───────────────────────────────────────────────────────────

interface DrawerProps {
  employee: Employee | null
  branches: Branch[]
  tenantId: string
  onSave: () => void
  onClose: () => void
}

function EmployeeDrawer({ employee, branches, tenantId, onSave, onClose }: DrawerProps) {
  const isEdit = !!employee
  const [form, setForm] = useState({
    full_name:    employee?.full_name    ?? '',
    full_name_ar: employee?.full_name_ar ?? '',
    position:     (employee as any)?.position ?? '',
    branch_id:    employee?.branch_id    ?? '',
    phone:        employee?.phone        ?? '',
    email:        employee?.email        ?? '',
    hire_date:    employee?.hire_date    ?? '',
    is_active:    employee?.is_active    ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.full_name.trim()) { setError('Full name is required'); return }
    if (!form.branch_id)        { setError('Branch is required'); return }
    setSaving(true)
    setError(null)
    const payload = {
      tenant_id:    tenantId,
      branch_id:    form.branch_id,
      full_name:    form.full_name.trim(),
      full_name_ar: form.full_name_ar.trim() || null,
      position:     form.position.trim() || null,
      phone:        form.phone.trim()  || null,
      email:        form.email.trim()  || null,
      hire_date:    form.hire_date     || null,
      is_active:    form.is_active,
    }
    const { error: dbErr } = isEdit
      ? await db().from('employees').update(payload).eq('id', employee!.id)
      : await db().from('employees').insert(payload)
    setSaving(false)
    if (dbErr) { setError(dbErr.message); return }
    onSave()
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-full max-w-md bg-white h-full flex flex-col shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">
            {isEdit ? 'Edit Employee' : 'Add Employee'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
              <AlertTriangle size={13} className="text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">Full Name <span className="text-red-400">*</span></label>
              <input className="input" value={form.full_name}
                onChange={e => set('full_name', e.target.value)} placeholder="Ahmed Al-Rashid" />
            </div>
            <div className="col-span-2">
              <label className="label">Full Name (Arabic)</label>
              <input className="input" dir="rtl" value={form.full_name_ar}
                onChange={e => set('full_name_ar', e.target.value)} placeholder="أحمد الراشد" />
            </div>
            <div className="col-span-2">
              <label className="label">Branch <span className="text-red-400">*</span></label>
              <select className="input" value={form.branch_id}
                onChange={e => set('branch_id', e.target.value)}>
                <option value="">Select branch…</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Job Title</label>
              <input className="input" value={form.position}
                onChange={e => set('position', e.target.value)} placeholder="Cashier" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" type="tel" value={form.phone}
                onChange={e => set('phone', e.target.value)} placeholder="+966 50 000 0000" />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email}
                onChange={e => set('email', e.target.value)} placeholder="ahmed@company.com" />
            </div>
            <div>
              <label className="label">Hire Date</label>
              <input className="input" type="date" value={form.hire_date}
                onChange={e => set('hire_date', e.target.value)} />
            </div>
            <div className="col-span-2 flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => set('is_active', !form.is_active)}
                className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
                  form.is_active ? 'bg-primary-500' : 'bg-gray-200'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  form.is_active ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
              <span className="text-sm text-gray-700">Active employee</span>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3 border-t border-gray-100 pt-4">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Employee'}
          </button>
        </div>
      </aside>
    </div>
  )
}

// ── Employee row ──────────────────────────────────────────────────────────────

function EmployeeRow({
  emp, branchName, onEdit, onDelete,
}: {
  emp: Employee
  branchName: string | null
  onEdit: () => void
  onDelete: () => void
}) {
  const initials = emp.full_name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
  return (
    <tr className="hover:bg-gray-50/60 transition-colors">
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
            <span className="text-primary-700 text-xs font-bold">{initials}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{emp.full_name}</p>
            {(emp as any).position && (
              <p className="text-xs text-gray-400">{(emp as any).position}</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        {branchName ? (
          <span className="flex items-center gap-1.5 text-xs text-gray-600">
            <Building2 size={12} className="text-gray-400" /> {branchName}
          </span>
        ) : <span className="text-gray-300 text-xs">—</span>}
      </td>
      <td className="px-6 py-4 text-sm text-gray-600">
        {emp.phone ? (
          <span className="flex items-center gap-1.5"><Phone size={12} className="text-gray-400" /> {emp.phone}</span>
        ) : '—'}
      </td>
      <td className="px-6 py-4 text-sm text-gray-500">
        {emp.hire_date ?? '—'}
      </td>
      <td className="px-6 py-4">
        <Badge variant={emp.is_active ? 'success' : 'neutral'} dot>
          {emp.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-1 justify-end">
          <button onClick={onEdit}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
            <Pencil size={14} />
          </button>
          <button onClick={onDelete}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EmployeesPage() {
  const { profile } = useAuth()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [branches,  setBranches]  = useState<Branch[]>([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [branchFilter, setBranchFilter] = useState<string>('all')
  const [drawer,    setDrawer]    = useState<'add' | Employee | null>(null)

  const load = useCallback(async () => {
    const tid = profile?.tenant_id
    if (!tid) { setLoading(false); return }
    setLoading(true)
    const [empRes, brRes] = await Promise.all([
      db().from('employees').select('*').eq('tenant_id', tid).order('full_name'),
      db().from('branches').select('id, name').eq('tenant_id', tid).order('name'),
    ])
    setEmployees(empRes.data ?? [])
    setBranches(brRes.data ?? [])
    setLoading(false)
  }, [profile?.tenant_id])

  useEffect(() => { load() }, [load])

  async function deleteEmployee(id: string) {
    if (!confirm('Delete this employee? This cannot be undone.')) return
    await db().from('employees').delete().eq('id', id)
    setEmployees(prev => prev.filter(e => e.id !== id))
  }

  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]))

  const filtered = employees.filter(e => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      e.full_name.toLowerCase().includes(q) ||
      (e.full_name_ar ?? '').includes(search) ||
      ((e as any).position ?? '').toLowerCase().includes(q) ||
      (e.phone ?? '').includes(q) ||
      (e.email ?? '').toLowerCase().includes(q)
    const matchBranch = branchFilter === 'all' || e.branch_id === branchFilter
    return matchSearch && matchBranch
  })

  const activeCount   = employees.filter(e => e.is_active).length
  const inactiveCount = employees.filter(e => !e.is_active).length

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Employees</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {employees.length} total · {activeCount} active · {inactiveCount} inactive
          </p>
        </div>
        <button
          onClick={() => setDrawer('add')}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={15} /> Add Employee
        </button>
      </div>

      {/* Branch filter tabs */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        <button
          onClick={() => setBranchFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
            branchFilter === 'all'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          All Branches ({employees.length})
        </button>
        {branches.map(b => {
          const count = employees.filter(e => e.branch_id === b.id).length
          return (
            <button
              key={b.id}
              onClick={() => setBranchFilter(b.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                branchFilter === b.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {b.name} ({count})
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, title, phone…"
          className="input pl-9 w-full"
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="divide-y divide-gray-50">
            {[1,2,3,4].map(i => (
              <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                <div className="w-9 h-9 rounded-xl bg-gray-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-100 rounded w-40" />
                  <div className="h-2 bg-gray-100 rounded w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Users size={40} className="text-gray-200 mx-auto mb-3" />
            {search || branchFilter !== 'all' ? (
              <>
                <p className="text-sm font-medium text-gray-500">No employees match your search</p>
                <p className="text-xs text-gray-400 mt-1">Try adjusting your filters</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-500">No employees yet</p>
                <p className="text-xs text-gray-400 mt-1">Add your first employee to get started</p>
                <button onClick={() => setDrawer('add')}
                  className="btn-primary mt-4 flex items-center gap-2 mx-auto">
                  <Plus size={14} /> Add Employee
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Employee', 'Branch', 'Phone', 'Hire Date', 'Status', ''].map(h => (
                    <th key={h} className={`px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide ${
                      h === '' ? 'text-right' : 'text-left'
                    }`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(emp => (
                  <EmployeeRow
                    key={emp.id}
                    emp={emp}
                    branchName={emp.branch_id ? (branchMap[emp.branch_id] ?? null) : null}
                    onEdit={() => setDrawer(emp)}
                    onDelete={() => deleteEmployee(emp.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stats bar */}
      {employees.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Employees', value: employees.length, icon: Users,     color: 'text-primary-600 bg-primary-50' },
            { label: 'Active',          value: activeCount,      icon: UserCheck, color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Inactive',        value: inactiveCount,    icon: UserX,     color: 'text-gray-500 bg-gray-100' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="card p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
                <Icon size={16} />
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-400">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drawer */}
      {drawer !== null && (
        <EmployeeDrawer
          employee={typeof drawer === 'string' ? null : drawer}
          branches={branches}
          tenantId={profile!.tenant_id!}
          onSave={() => { load(); setDrawer(null) }}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  )
}
