import { useEffect, useState } from 'react'
import { Building2, CalendarDays, CheckCircle2, Eye, EyeOff, Languages, Lock, Loader2, Mail, Phone, Save, Shield, User } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { LanguageSelector } from '@/components/localization/LanguageSelector'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/localization/useLocale'
import { authErrorKey } from '@/localization/authErrors'

function SummaryRow({ icon: Icon, label, value, valueDir = 'auto' }: { icon: typeof Mail; label: string; value: string; valueDir?: 'auto' | 'ltr' }) {
  return <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#edf3ef] text-[#286142]"><Icon size={14} aria-hidden="true" /></span>
    <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">{label}</p><p className="mt-0.5 break-words text-sm font-medium text-gray-800" dir={valueDir}>{value || '—'}</p></div>
  </div>
}

function SectionTitle({ number, icon: Icon, title, description }: { number: string; icon: typeof User; title: string; description: string }) {
  return <div className="flex items-start gap-3 border-b border-[#e8ece8] px-5 py-4 sm:px-6">
    <span className="mt-0.5 rounded-md bg-[#e7efe9] px-1.5 py-0.5 text-[10px] font-extrabold tracking-[0.08em] text-[#286142]">{number}</span>
    <span className="mt-0.5 text-[#286142]"><Icon size={16} aria-hidden="true" /></span>
    <div><h2 className="text-sm font-bold text-[#173d2a]">{title}</h2><p className="mt-0.5 text-xs leading-5 text-gray-500">{description}</p></div>
  </div>
}

export default function ProfilePage() {
  const { profile, user, branch, tenant, refreshProfile } = useAuth()
  const { t } = useTranslation(['settings', 'auth', 'navigation', 'common', 'validation'])
  const { locale } = useLocale()
  const db = supabase as any
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<string | null>(null)
  const [pwErr, setPwErr] = useState<string | null>(null)

  // user_profiles is loaded after route mount; this fixes stale blank fields while preserving its authority.
  useEffect(() => {
    setFullName(profile?.full_name ?? '')
    setPhone(profile?.phone ?? '')
  }, [profile?.full_name, profile?.phone])

  async function saveProfile() {
    if (!fullName.trim()) { setSaveErr(t('validation:requiredNamed', { field: t('settings:profile.fullName') })); return }
    setSaving(true); setSaveMsg(null); setSaveErr(null)
    const { error } = await db.from('user_profiles').update({ full_name: fullName.trim(), phone: phone.trim() || null }).eq('id', user!.id)
    setSaving(false)
    if (error) { console.error('Kubri profile update failed', error); setSaveErr(t('validation:saveFailed')); return }
    await refreshProfile(); setSaveMsg(t('settings:profile.updated')); window.setTimeout(() => setSaveMsg(null), 3000)
  }

  async function changePassword() {
    setPwErr(null); setPwMsg(null)
    if (!newPass || !confirmPass) { setPwErr(t('validation:allPasswordFields')); return }
    if (newPass.length < 8) { setPwErr(t('validation:passwordTooShort', { min: 8 })); return }
    if (newPass !== confirmPass) { setPwErr(t('validation:passwordsDoNotMatch')); return }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPass })
    setPwSaving(false)
    if (error) { console.error('Kubri profile password update failed', error); setPwErr(t(`auth:${authErrorKey(error, 'errors.passwordUpdateFailed')}`)); return }
    setPwMsg(t('settings:profile.passwordChanged')); setNewPass(''); setConfirmPass(''); window.setTimeout(() => setPwMsg(null), 3000)
  }

  const displayName = profile?.full_name ?? user?.email?.split('@')[0] ?? t('navigation:roles.user')
  const initials = displayName.split(' ').map((word: string) => word[0]).join('').substring(0, 2).toUpperCase()
  const roleKey = profile?.role === 'super_admin' ? 'superAdmin' : String(profile?.role ?? 'user')
  const roleLabel = t(`navigation:roles.${roleKey}`)
  const dateLocale = locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA'
  const memberSince = profile?.created_at ? new Date(profile.created_at).toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric' }) : ''
  const branchName = branch?.name_ar || branch?.name || tenant?.name_ar || tenant?.name || t('settings:profile.noBranchAssigned')

  return <div className="mx-auto w-full max-w-[1240px] space-y-5 pb-8">
    <header className="overflow-hidden rounded-2xl border border-[#173d2a] bg-[#173d2a] shadow-[0_12px_28px_rgba(23,61,42,0.12)]"><div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
      <div className="flex items-center gap-3.5"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-[#e8d9ae]"><User size={20} aria-hidden="true" /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#d8c58d]">{t('settings:profile.eyebrow')}</p><h1 className="mt-0.5 text-xl font-bold tracking-tight text-white">{t('settings:profile.title')}</h1><p className="mt-1 text-sm text-white/70">{t('settings:profile.subtitle')}</p></div></div>
      <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white/85"><Building2 size={13} aria-hidden="true" /><span dir="auto">{branchName}</span></div>
    </div></header>

    <section className="overflow-hidden rounded-2xl border border-[#d9e2db] bg-[#fbfaf6] shadow-sm"><div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#286142] text-lg font-extrabold text-white shadow-sm">{initials}</span>
      <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-bold text-[#173d2a]" dir="auto">{displayName}</h2><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500"><span className="font-medium capitalize text-[#286142]">{roleLabel}</span><span className="hidden text-gray-300 sm:inline">•</span><span className="truncate" dir="ltr">{user?.email}</span></div></div>
      <div className="border-t border-[#e2e8e3] pt-3 text-sm sm:border-s sm:border-t-0 sm:ps-5 sm:pt-0"><p className="text-[10px] font-bold uppercase tracking-[0.09em] text-gray-400">{t('settings:profile.branchMembership')}</p><p className="mt-1 font-semibold text-gray-700" dir="auto">{branchName}</p></div>
    </div></section>

    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-[#dfe6e0] bg-white shadow-sm"><SectionTitle number="01" icon={User} title={t('settings:profile.personalInformation')} description={t('settings:profile.personalInformationHint')} /><div className="p-5 sm:p-6"><div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-1.5 block text-xs font-bold text-gray-700">{t('settings:profile.fullName')}</span><span className="relative block"><User size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" /><input className="input h-10 ps-9" value={fullName} onChange={event => setFullName(event.target.value)} placeholder={t('settings:profile.fullNamePlaceholder')} dir="auto" /></span></label>
        <label className="block"><span className="mb-1.5 block text-xs font-bold text-gray-700">{t('settings:profile.phoneOptional')}</span><span className="relative block"><Phone size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" /><input className="input h-10 ps-9" type="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+966 50 000 0000" dir="ltr" /></span><span className="mt-1.5 block text-[11px] leading-4 text-gray-400">{t('settings:profile.phonePersonalHint')}</span></label>
      </div>{(saveErr || saveMsg) && <div className={`mt-4 flex items-center gap-2 rounded-xl border p-3 ${saveErr ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`} role="status">{saveErr ? <Shield size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}<p className="text-xs font-medium">{saveErr || saveMsg}</p></div>}<div className="mt-5 flex justify-end border-t border-gray-100 pt-4"><button type="button" onClick={saveProfile} disabled={saving} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{saving ? t('common:saving') : t('settings:profile.save')}</button></div></div></section>

      <section className="overflow-hidden rounded-2xl border border-[#dfe6e0] bg-white shadow-sm"><SectionTitle number="02" icon={Languages} title={t('settings:profile.languagePreferences')} description={t('settings:profile.languagePreferencesHint')} /><div className="p-5 sm:p-6"><LanguageSelector /></div></section>

      <section className="overflow-hidden rounded-2xl border border-[#dfe6e0] bg-white shadow-sm"><SectionTitle number="03" icon={Lock} title={t('settings:profile.security')} description={t('settings:profile.securityHint')} /><div className="space-y-4 p-5 sm:p-6"><div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-1.5 block text-xs font-bold text-gray-700">{t('settings:profile.newPassword')}</span><span className="relative block"><Lock size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" /><input className="input h-10 ps-9 pe-10" type={showNew ? 'text' : 'password'} value={newPass} onChange={event => setNewPass(event.target.value)} placeholder={t('auth:reset.minimumHint')} /><button type="button" onClick={() => setShowNew(value => !value)} aria-label={t(`settings:profile.${showNew ? 'hidePassword' : 'showPassword'}`)} className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">{showNew ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
        <label className="block"><span className="mb-1.5 block text-xs font-bold text-gray-700">{t('settings:profile.confirmPassword')}</span><span className="relative block"><Lock size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" /><input className="input h-10 ps-9 pe-10" type={showConfirm ? 'text' : 'password'} value={confirmPass} onChange={event => setConfirmPass(event.target.value)} placeholder={t('settings:profile.repeatPassword')} /><button type="button" onClick={() => setShowConfirm(value => !value)} aria-label={t(`settings:profile.${showConfirm ? 'hidePassword' : 'showPassword'}`)} className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">{showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
      </div>{(pwErr || pwMsg) && <div className={`flex items-center gap-2 rounded-xl border p-3 ${pwErr ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`} role="status">{pwErr ? <Shield size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}<p className="text-xs font-medium">{pwErr || pwMsg}</p></div>}<div className="flex justify-end border-t border-gray-100 pt-4"><button type="button" onClick={changePassword} disabled={pwSaving} className="inline-flex items-center gap-2 rounded-xl bg-[#173d2a] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#286142] disabled:opacity-50">{pwSaving ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}{pwSaving ? t('settings:profile.changingPassword') : t('settings:profile.changePassword')}</button></div></div></section>
    </div>

    <aside className="overflow-hidden rounded-2xl border border-[#dfe6e0] bg-white shadow-sm"><div className="border-b border-[#e8ece8] bg-[#f7f8f5] px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#286142]">{t('settings:profile.account')}</p><h2 className="mt-1 text-sm font-bold text-[#173d2a]">{t('settings:profile.accountInfo')}</h2></div><div className="divide-y divide-[#eef1ee] px-5 py-1"><SummaryRow icon={Mail} label={t('settings:profile.email')} value={user?.email ?? ''} valueDir="ltr" /><SummaryRow icon={Shield} label={t('settings:profile.role')} value={roleLabel} /><SummaryRow icon={CalendarDays} label={t('settings:profile.memberSince')} value={memberSince} /><SummaryRow icon={Building2} label={t('settings:profile.branchMembership')} value={branchName} /></div><div className="border-t border-[#e8ece8] bg-[#fbfaf6] px-5 py-3"><p className="text-[11px] leading-4 text-gray-500">{t('settings:profile.accountReadonlyHint')}</p></div></aside>
    </div>
  </div>
}
