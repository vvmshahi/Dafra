import { useEffect, useRef, useState } from 'react'
import {
  User, Phone, Lock, Save, Loader2, CheckCircle2, AlertTriangle,
  Eye, EyeOff, Pencil, Shield,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useTranslation } from 'react-i18next'

function InfoRow({ label, value, valueDir }: { label: string; value: string; valueDir?: 'ltr' | 'rtl' | 'auto' }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-gray-50 last:border-0">
      <span className="text-xs font-medium text-gray-400 w-36 flex-shrink-0">{label}</span>
      <span className="text-end text-sm text-gray-800" dir={valueDir}>{value || '—'}</span>
    </div>
  )
}

export default function AccountTab() {
  const { profile, user, loading, refreshProfile } = useAuth()
  const { t, i18n } = useTranslation(['settings', 'common', 'validation'])
  const db = supabase as any

  const [fullName, setFullName]    = useState(profile?.full_name ?? '')
  const [phone,    setPhone]       = useState(profile?.phone ?? '')
  const [saving,   setSaving]      = useState(false)
  const [saveMsg,  setSaveMsg]     = useState<string | null>(null)
  const [saveErr,  setSaveErr]     = useState<string | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const editTriggerRef = useRef<HTMLButtonElement>(null)
  const fullNameInputRef = useRef<HTMLInputElement>(null)

  const [newPass,     setNewPass]     = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [showNew,     setShowNew]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [pwSaving,    setPwSaving]    = useState(false)
  const [pwMsg,       setPwMsg]       = useState<string | null>(null)
  const [pwErr,       setPwErr]       = useState<string | null>(null)
  const [editingPassword, setEditingPassword] = useState(false)

  useEffect(() => {
    if (editingProfile) return
    setFullName(profile?.full_name ?? '')
    setPhone(profile?.phone ?? '')
  }, [profile?.full_name, profile?.phone, editingProfile])

  useEffect(() => {
    setEditingProfile(false)
    setFullName('')
    setPhone('')
    setSaveErr(null)
    setSaveMsg(null)
  }, [user?.id])

  useEffect(() => {
    if (editingProfile) fullNameInputRef.current?.focus()
  }, [editingProfile])

  function beginProfileEdit() {
    if (!profile || loading) return
    setFullName(profile.full_name ?? '')
    setPhone(profile.phone ?? '')
    setSaveErr(null)
    setSaveMsg(null)
    setEditingProfile(true)
  }

  function cancelProfileEdit() {
    setEditingProfile(false)
    setFullName(profile?.full_name ?? '')
    setPhone(profile?.phone ?? '')
    setSaveErr(null)
    window.requestAnimationFrame(() => editTriggerRef.current?.focus())
  }

  async function saveProfile() {
    if (!fullName.trim()) { setSaveErr(t('validation:required')); return }
    setSaving(true); setSaveMsg(null); setSaveErr(null)
    const { error } = await db
      .from('user_profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null })
      .eq('id', user!.id)
    if (error) {
      console.error('Profile update failed', error)
      setSaving(false)
      setSaveErr(t('validation:saveFailed'))
      return
    }
    const refreshed = await refreshProfile()
    if (!refreshed.ok) {
      setSaving(false)
      setSaveErr(t('validation:saveFailed'))
      return
    }
    setFullName(refreshed.profile?.full_name ?? '')
    setPhone(refreshed.profile?.phone ?? '')
    setSaving(false)
    setEditingProfile(false)
    setSaveMsg(t('settings:profile.updated'))
    window.requestAnimationFrame(() => editTriggerRef.current?.focus())
    setTimeout(() => setSaveMsg(null), 3000)
  }

  async function changePassword() {
    setPwErr(null); setPwMsg(null)
    if (!newPass || !confirmPass) { setPwErr(t('validation:allPasswordFields')); return }
    if (newPass.length < 8) { setPwErr(t('validation:passwordTooShort')); return }
    if (newPass !== confirmPass) { setPwErr(t('validation:passwordsDoNotMatch')); return }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPass })
    setPwSaving(false)
    if (error) { console.error('Password update failed', error); setPwErr(t('validation:saveFailed')); return }
    setPwMsg(t('settings:profile.passwordChanged'))
    setNewPass(''); setConfirmPass('')
    setEditingPassword(false)
    setTimeout(() => setPwMsg(null), 3000)
  }

  const displayName = profile?.full_name ?? user?.email?.split('@')[0] ?? 'User'
  const initials    = displayName.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase()
  const roleLabel   = profile?.role?.replace(/_/g, ' ') ?? ''
  const desktopBuild = typeof window !== 'undefined' && window.electronAPI?.isElectron === true

  return (
    <div className="space-y-5">

      {/* Profile header */}
      <div className="overflow-hidden rounded-2xl bg-sidebar p-5 shadow-card flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="w-14 h-14 rounded-2xl bg-primary-500 flex items-center justify-center flex-shrink-0">
          <span className="text-white text-lg font-bold">{initials}</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">{displayName}</h3>
          <p className="text-xs text-gold-200 capitalize">{roleLabel}</p>
          <p className="text-xs text-white/60 mt-0.5">{user?.email}</p>
        </div>
        <button ref={editTriggerRef} type="button" onClick={beginProfileEdit} disabled={loading || !profile}
          className="ms-auto inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-gold-300/40 px-3 py-2 text-xs font-bold text-gold-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 disabled:cursor-not-allowed disabled:opacity-50">
          <Pencil size={14} /> {t('settings:profile.edit')}
        </button>
      </div>

      {/* Account info (read-only) */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <User size={15} className="text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900">{t('settings:profile.accountInfo')}</h3>
        </div>
        <InfoRow label={t('settings:profile.email')} value={user?.email ?? ''} valueDir="ltr" />
        <InfoRow label={t('settings:profile.role')} value={roleLabel} />
        <InfoRow label={t('settings:profile.memberSince')} value={
          profile?.created_at
            ? new Date(profile.created_at).toLocaleDateString(i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA', { year: 'numeric', month: 'long', day: 'numeric' })
            : ''
        } />
        {desktopBuild && <InfoRow label={t('settings:profile.application')} value={`Kubri Desktop ${__APP_VERSION__}`} />}
        {desktopBuild && <InfoRow label={t('settings:profile.build')} value={__BUILD_COMMIT__} />}
      </div>

      {/* Profile view/edit */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Pencil size={15} className="text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900">{t('settings:profile.edit')}</h3>
        </div>
        {loading ? (
          <div className="h-20 animate-pulse rounded-xl bg-gray-50" aria-label={t('settings:profile.loading')} />
        ) : !editingProfile ? (
          <div className="grid gap-x-6 sm:grid-cols-2">
            <InfoRow label={t('settings:profile.fullName')} value={profile?.full_name ?? ''} />
            <InfoRow label={t('settings:profile.phoneOptional')} value={profile?.phone ?? t('settings:profile.notProvided')} valueDir="ltr" />
          </div>
        ) : <div className="space-y-3">
          <div>
            <label className="label">{t('settings:profile.fullName')} <span className="text-red-400">*</span></label>
            <div className="relative">
              <User size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input ref={fullNameInputRef} className="input ps-9" value={fullName}
                onChange={e => setFullName(e.target.value)} placeholder={t('settings:profile.fullNamePlaceholder')} dir="auto" />
            </div>
          </div>
          <div>
            <label className="label">{t('settings:profile.phoneOptional')}</label>
            <div className="relative">
              <Phone size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input ps-9" type="tel" value={phone}
                onChange={e => setPhone(e.target.value)} placeholder="+966 50 000 0000" />
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
          <div className="flex flex-wrap gap-2">
            <button onClick={saveProfile} disabled={saving || (!fullName.trim()) || (fullName.trim() === (profile?.full_name ?? '') && phone.trim() === (profile?.phone ?? ''))}
              className="btn-primary flex items-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? t('common:saving') : t('settings:profile.save')}
            </button>
            <button type="button" onClick={cancelProfileEdit}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              {t('common:cancel')}
            </button>
          </div>
        </div>}
      </div>

      {/* Change password */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Lock size={15} className="text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900">{t('settings:profile.changePassword')}</h3>
        </div>
        {!editingPassword ? (
          <button type="button" onClick={() => setEditingPassword(true)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-bold text-white transition-[background-color,transform] duration-150 hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 active:scale-[0.98]">
            <Shield size={14} /> {t('settings:profile.changePassword')}
          </button>
        ) : <div className="space-y-3">
          <div>
            <label className="label">{t('settings:profile.newPassword')}</label>
            <div className="relative">
              <Lock size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pe-10 ps-9" type={showNew ? 'text' : 'password'}
                value={newPass} onChange={e => setNewPass(e.target.value)}
                placeholder={t('validation:passwordTooShort')} autoComplete="new-password" />
              <button type="button" onClick={() => setShowNew(s => !s)}
                aria-label={showNew ? t('common:hide') : t('common:show')}
                className="absolute end-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">{t('settings:profile.confirmPassword')}</label>
            <div className="relative">
              <Lock size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pe-10 ps-9" type={showConfirm ? 'text' : 'password'}
                value={confirmPass} onChange={e => setConfirmPass(e.target.value)}
                placeholder={t('settings:profile.repeatPassword')} autoComplete="new-password" />
              <button type="button" onClick={() => setShowConfirm(s => !s)}
                aria-label={showConfirm ? t('common:hide') : t('common:show')}
                className="absolute end-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
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
          <button onClick={changePassword} disabled={pwSaving || newPass.length < 8 || newPass !== confirmPass}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors disabled:opacity-50">
            {pwSaving ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
            {pwSaving ? t('settings:profile.changingPassword') : t('settings:profile.changePassword')}
          </button>
          <button type="button" onClick={() => { setEditingPassword(false); setNewPass(''); setConfirmPass(''); setPwErr(null) }}
            className="ms-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            {t('common:cancel')}
          </button>
        </div>}
      </div>
    </div>
  )
}
