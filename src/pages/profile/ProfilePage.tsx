import { useState } from 'react'
import {
  User, Mail, Phone, Shield, Lock, Save,
  Loader2, CheckCircle2, AlertTriangle, Eye, EyeOff,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-gray-50 last:border-0">
      <span className="text-xs font-medium text-gray-400 w-32 flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-800 text-right">{value || '—'}</span>
    </div>
  )
}

export default function ProfilePage() {
  const { profile, user, refreshProfile } = useAuth()
  const db = supabase as any

  // Profile update form
  const [fullName, setFullName]   = useState(profile?.full_name ?? '')
  const [phone,    setPhone]      = useState(profile?.phone ?? '')
  const [saving,   setSaving]     = useState(false)
  const [saveMsg,  setSaveMsg]    = useState<string | null>(null)
  const [saveErr,  setSaveErr]    = useState<string | null>(null)

  // Password change form
  const [oldPass,    setOldPass]    = useState('')
  const [newPass,    setNewPass]    = useState('')
  const [confirmPass,setConfirmPass]= useState('')
  const [showOld,    setShowOld]    = useState(false)
  const [showNew,    setShowNew]    = useState(false)
  const [pwSaving,   setPwSaving]   = useState(false)
  const [pwMsg,      setPwMsg]      = useState<string | null>(null)
  const [pwErr,      setPwErr]      = useState<string | null>(null)

  async function saveProfile() {
    if (!fullName.trim()) { setSaveErr('Full name is required'); return }
    setSaving(true)
    setSaveMsg(null)
    setSaveErr(null)
    const { error } = await db
      .from('user_profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null })
      .eq('id', user!.id)
    setSaving(false)
    if (error) { setSaveErr(error.message); return }
    await refreshProfile()
    setSaveMsg('Profile updated successfully')
    setTimeout(() => setSaveMsg(null), 3000)
  }

  async function changePassword() {
    setPwErr(null)
    setPwMsg(null)
    if (!newPass || !confirmPass) { setPwErr('Please fill in all password fields'); return }
    if (newPass.length < 8) { setPwErr('Password must be at least 8 characters'); return }
    if (newPass !== confirmPass) { setPwErr('Passwords do not match'); return }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPass })
    setPwSaving(false)
    if (error) { setPwErr(error.message); return }
    setPwMsg('Password changed successfully')
    setOldPass('')
    setNewPass('')
    setConfirmPass('')
    setTimeout(() => setPwMsg(null), 3000)
  }

  const displayName = profile?.full_name ?? user?.email?.split('@')[0] ?? 'User'
  const initials    = displayName.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase()
  const roleLabel   = profile?.role?.replace(/_/g, ' ') ?? ''

  return (
    <div className="max-w-2xl space-y-5">

      {/* Profile header card */}
      <div className="card p-6 flex items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-primary-500 flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xl font-bold">{initials}</span>
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">{displayName}</h2>
          <p className="text-sm text-gray-400 capitalize">{roleLabel}</p>
          <p className="text-xs text-gray-400 mt-0.5">{user?.email}</p>
        </div>
      </div>

      {/* Account info */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <User size={15} className="text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900">Account Info</h3>
        </div>
        <InfoRow label="Email"        value={user?.email ?? ''} />
        <InfoRow label="Role"         value={roleLabel} />
        <InfoRow label="Member Since" value={profile?.created_at
          ? new Date(profile.created_at).toLocaleDateString('en-SA', { year: 'numeric', month: 'long', day: 'numeric' })
          : ''} />
      </div>

      {/* Edit profile */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Pencil size={15} className="text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900">Edit Profile</h3>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Full Name</label>
            <div className="relative">
              <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Your full name"
              />
            </div>
          </div>
          <div>
            <label className="label">Phone (optional)</label>
            <div className="relative">
              <Phone size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+966 50 000 0000"
              />
            </div>
          </div>

          {saveErr && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
              <AlertTriangle size={13} className="text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-700">{saveErr}</p>
            </div>
          )}
          {saveMsg && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
              <CheckCircle2 size={13} className="text-emerald-600 flex-shrink-0" />
              <p className="text-xs text-emerald-700">{saveMsg}</p>
            </div>
          )}

          <button
            onClick={saveProfile}
            disabled={saving}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>

      {/* Change password */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Lock size={15} className="text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900">Change Password</h3>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">New Password</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9 pr-10"
                type={showNew ? 'text' : 'password'}
                value={newPass}
                onChange={e => setNewPass(e.target.value)}
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                onClick={() => setShowNew(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Confirm New Password</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9"
                type={showOld ? 'text' : 'password'}
                value={confirmPass}
                onChange={e => setConfirmPass(e.target.value)}
                placeholder="Repeat new password"
              />
            </div>
          </div>

          {pwErr && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
              <AlertTriangle size={13} className="text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-700">{pwErr}</p>
            </div>
          )}
          {pwMsg && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
              <CheckCircle2 size={13} className="text-emerald-600 flex-shrink-0" />
              <p className="text-xs text-emerald-700">{pwMsg}</p>
            </div>
          )}

          <button
            onClick={changePassword}
            disabled={pwSaving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {pwSaving ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
            {pwSaving ? 'Changing…' : 'Change Password'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Missing import — added inline to avoid separate import
function Pencil({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}
