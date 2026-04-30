import { useState, useEffect } from 'react'
import {
  Plus, X, UserCircle, Mail, Phone as PhoneIcon,
  ShieldCheck, Building2, Trash2, Send,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import type { Branch, UserProfile, UserRole } from '@/types'

/* ── Helpers ─────────────────────────────────────────────────── */

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  owner:       'Owner',
  manager:     'Manager',
  cashier:     'Cashier',
  accountant:  'Accountant',
}

const ROLE_VARIANTS: Record<UserRole, 'danger' | 'warning' | 'info' | 'neutral' | 'success' | 'gold'> = {
  super_admin: 'danger',
  owner:       'gold',
  manager:     'info',
  cashier:     'neutral',
  accountant:  'success',
}

const ASSIGNABLE_ROLES: UserRole[] = ['owner', 'manager', 'cashier', 'accountant']

function initials(name: string | null) {
  if (!name) return 'U'
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

/* ── Invite drawer ───────────────────────────────────────────── */

function InviteDrawer({
  branches, tenantId, onClose, onSaved,
}: {
  branches: Branch[]
  tenantId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    email: '', full_name: '',
    role: 'cashier' as UserRole,
    branch_id: branches[0]?.id ?? '',
    phone: '',
  })
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState(false)

  const set = (k: keyof typeof form) => (v: string) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      // Create the auth user — the handle_new_user trigger will insert the profile
      // with tenant_id, branch_id, and role from raw_user_meta_data.
      const tempPassword = `Dafra@${Math.random().toString(36).slice(2, 10)}`
      const { error } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: tempPassword,
        options: {
          data: {
            full_name: form.full_name.trim(),
            phone:     form.phone.trim() || undefined,
            tenant_id: tenantId,
            branch_id: form.branch_id || undefined,
            role:      form.role,
          },
        },
      })
      if (error) throw error
      setSuccess(true)
      setTimeout(() => { onSaved() }, 1500)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create user')
    } finally {
      setSaving(false)
    }
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex">
        <div className="flex-1 bg-black/40" onClick={onClose} />
        <div className="w-full max-w-md bg-white h-full flex flex-col items-center justify-center gap-4 shadow-2xl px-8">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
            <Send size={28} className="text-emerald-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">User Created!</h2>
          <p className="text-sm text-gray-500 text-center">
            <strong>{form.email}</strong> has been added. They can set their password via the login page.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="w-full max-w-md bg-white h-full flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Add User</h2>
            <p className="text-xs text-gray-400 mt-0.5">Create a new team member account</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <Input label="Full Name" value={form.full_name} onChange={e => set('full_name')(e.target.value)} placeholder="Mohammed Al-Rashid" required />
          <Input label="Email Address" icon={Mail} type="email" value={form.email} onChange={e => set('email')(e.target.value)} placeholder="user@company.com" required />
          <Input label="Phone (optional)" icon={PhoneIcon} type="tel" value={form.phone} onChange={e => set('phone')(e.target.value)} placeholder="+966 5x xxx xxxx" />

          <div>
            <label className="label">Role</label>
            <select value={form.role} onChange={e => set('role')(e.target.value as UserRole)} className="input">
              {ASSIGNABLE_ROLES.map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Assign to Branch</label>
            <select value={form.branch_id} onChange={e => set('branch_id')(e.target.value)} className="input">
              <option value="">— No specific branch —</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Role info */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-xs text-gray-500 leading-relaxed space-y-1">
            <p><strong>Owner</strong> — full access to all features</p>
            <p><strong>Manager</strong> — all except billing and user management</p>
            <p><strong>Cashier</strong> — POS and invoicing only</p>
            <p><strong>Accountant</strong> — view all, create expense entries</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3 rounded-xl">
              <span className="text-red-400">⚠</span> {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 flex-shrink-0">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} onClick={handleSubmit as any}>
            <Plus size={14} /> Create User
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── User row ────────────────────────────────────────────────── */

function UserRow({
  user, branches, onDelete,
}: {
  user: UserProfile; branches: Branch[]; onDelete: () => void
}) {
  const branchName = branches.find(b => b.id === user.branch_id)?.name
  const role = user.role as UserRole

  return (
    <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors group">
      {/* Avatar */}
      <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-primary-600">{initials(user.full_name)}</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800 truncate">{user.full_name ?? '—'}</span>
          <Badge variant={ROLE_VARIANTS[role]}>{ROLE_LABELS[role]}</Badge>
          {!user.is_active && <Badge variant="neutral">Inactive</Badge>}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-400">
          {user.phone && <span className="flex items-center gap-1"><PhoneIcon size={10} /> {user.phone}</span>}
          {branchName && <span className="flex items-center gap-1"><Building2 size={10} /> {branchName}</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button onClick={onDelete}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

/* ── Main tab ─────────────────────────────────────────────────── */

export default function UsersTab() {
  const { profile } = useAuth()
  const [users, setUsers]       = useState<UserProfile[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading]   = useState(true)
  const [showDrawer, setDrawer] = useState(false)

  const load = async () => {
    if (!profile?.tenant_id) return
    setLoading(true)
    const [usersRes, branchesRes] = await Promise.all([
      supabase.from('user_profiles').select('*').eq('tenant_id', profile.tenant_id).order('created_at'),
      supabase.from('branches').select('id, name').eq('tenant_id', profile.tenant_id),
    ])
    setUsers((usersRes.data as UserProfile[]) ?? [])
    setBranches((branchesRes.data as Branch[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [profile?.tenant_id])

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this user from the tenant? Their auth account will remain but they will lose access.')) return
    const q = supabase as unknown as { from: (t: string) => any }
    await q.from('user_profiles').update({ is_active: false }).eq('id', id)
    await load()
  }

  const byRole = (role: UserRole) => users.filter(u => u.role === role)

  return (
    <div className="space-y-4">

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Team Members</h3>
          <p className="text-xs text-gray-400 mt-0.5">{users.length} user{users.length !== 1 ? 's' : ''} in your account</p>
        </div>
        <Button size="sm" onClick={() => setDrawer(true)}>
          <Plus size={14} /> Add User
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="card divide-y divide-gray-50">
          {[1, 2, 3].map(i => (
            <div key={i} className="px-5 py-4 h-14 animate-pulse bg-gray-50" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="card p-12 text-center">
          <UserCircle size={36} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No team members yet</p>
          <p className="text-xs text-gray-400 mt-1 mb-4">Add users to give them access to your Dafra account</p>
          <Button size="sm" onClick={() => setDrawer(true)}><Plus size={13} /> Add first user</Button>
        </div>
      ) : (
        <div className="card divide-y divide-gray-50 overflow-hidden">
          {(['owner', 'manager', 'cashier', 'accountant', 'super_admin'] as UserRole[])
            .flatMap(role => byRole(role))
            .map(u => (
              <UserRow
                key={u.id}
                user={u}
                branches={branches}
                onDelete={() => handleDelete(u.id)}
              />
            ))
          }
        </div>
      )}

      {/* Permission matrix hint */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-2">
            <ShieldCheck size={13} className="text-primary-500" /> Role Permissions
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-50">
                <th className="px-5 py-2.5 text-left text-gray-400 font-medium">Permission</th>
                {(['owner', 'manager', 'cashier', 'accountant'] as UserRole[]).map(r => (
                  <th key={r} className="px-3 py-2.5 text-center text-gray-400 font-medium">{ROLE_LABELS[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                { label: 'Create Invoice / POS',    owner: true, manager: true,  cashier: true,  accountant: false },
                { label: 'View Reports',            owner: true, manager: true,  cashier: false, accountant: true  },
                { label: 'Manage Products',         owner: true, manager: true,  cashier: false, accountant: false },
                { label: 'Manage Customers',        owner: true, manager: true,  cashier: true,  accountant: false },
                { label: 'Manage Expenses',         owner: true, manager: true,  cashier: false, accountant: true  },
                { label: 'Manage Users',            owner: true, manager: false, cashier: false, accountant: false },
                { label: 'Settings & Branches',     owner: true, manager: false, cashier: false, accountant: false },
              ].map(row => (
                <tr key={row.label} className="hover:bg-gray-50/60">
                  <td className="px-5 py-2 text-gray-600 font-medium">{row.label}</td>
                  {(['owner', 'manager', 'cashier', 'accountant'] as const).map(r => (
                    <td key={r} className="px-3 py-2 text-center">
                      {row[r]
                        ? <span className="text-emerald-500">✓</span>
                        : <span className="text-gray-200">—</span>
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showDrawer && (
        <InviteDrawer
          branches={branches}
          tenantId={profile?.tenant_id ?? ''}
          onClose={() => setDrawer(false)}
          onSaved={() => { setDrawer(false); load() }}
        />
      )}
    </div>
  )
}
