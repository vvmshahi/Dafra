import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useSubscription } from '@/hooks/useSubscription'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { MeemLogo } from '@/components/MeemLogo'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  KeyRound,
  LogOut,
  MapPin,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import {
  normalizeBranchUsernameInput,
  validateBranchUsernameInput,
} from '@/lib/utils/branchUsername'
import { CompactLanguageSelector } from '@/components/localization/CompactLanguageSelector'
import { useTranslation } from 'react-i18next'

const VAT_RE    = /^3\d{13}3$/
const CR_RE     = /^[a-zA-Z0-9]+$/
const BLDG_RE   = /^\d{4}$/
const POSTAL_RE = /^\d{5}$/

export default function SetupBranchPage() {
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()
  const { profile, refreshBranchCount, firstBranchProvisioningState } = useAuth()
  const { isPhase2 } = useSubscription()

  const [name,     setName]     = useState('')
  const [vat,      setVat]      = useState('')
  const [cr,       setCr]       = useState('')
  const [bldg,     setBldg]     = useState('')
  const [postal,   setPostal]   = useState('')
  const [street,   setStreet]   = useState('')
  const [district, setDistrict] = useState('')
  const [city,     setCity]     = useState('')
  const [phone,    setPhone]    = useState('')

  const [loginUsername, setLoginUsername] = useState('')
  const [loginPwd,     setLoginPwd]     = useState('')
  const [loginConfirm, setLoginConfirm] = useState('')

  const [touched, setTouched] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    if (firstBranchProvisioningState === 'failed_manual_review') {
      setError(t('errors.manualReview'))
    }
  }, [firstBranchProvisioningState, t])

  const usernameValidation = validateBranchUsernameInput(loginUsername)
  const localizedUsernameValidation = !usernameValidation ? null
    : /required/i.test(usernameValidation) ? t('validation.usernameRequired')
    : /reserved/i.test(usernameValidation) ? t('validation.usernameReserved')
    : t('validation.usernameInvalid')
  const errs = {
    name:     !name.trim()     ? t('validation.branchName') : null,
    vat:      !vat.trim()      ? t('validation.vatRequired')
              : !VAT_RE.test(vat.trim()) ? t('validation.vatInvalid') : null,
    cr:       !cr.trim()       ? t('validation.crRequired')
              : !CR_RE.test(cr.trim()) ? t('validation.alphanumeric') : null,
    bldg:     !bldg.trim()     ? t('validation.buildingRequired')
              : !BLDG_RE.test(bldg.trim()) ? t('validation.buildingInvalid') : null,
    postal:   !postal.trim()   ? t('validation.postalRequired')
              : !POSTAL_RE.test(postal.trim()) ? t('validation.postalInvalid') : null,
    street:   !street.trim()   ? t('validation.street') : null,
    district: !district.trim() ? t('validation.district') : null,
    city:     !city.trim()     ? t('validation.city') : null,
    loginUsername: localizedUsernameValidation,
    loginPwd:     !loginPwd             ? t('validation.passwordRequired')
                  : loginPwd.length < 8 ? t('validation.passwordLength') : null,
    loginConfirm: !loginConfirm         ? t('validation.confirmPassword')
                  : loginConfirm !== loginPwd ? t('validation.passwordMismatch') : null,
  }
  const hasErrors = Object.values(errs).some(Boolean)
  const fieldErr = (k: keyof typeof errs) => (touched ? errs[k] : null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (hasErrors) return

    setSaving(true)
    setError('')
    try {
      const { data: fnData, error: fnErr } = await supabase.functions.invoke('provision-first-branch', {
        body: {
          name: name.trim(),
          vat_number: vat.trim(),
          cr_number: cr.trim(),
          building_number: bldg.trim(),
          postal_code: postal.trim(),
          street: street.trim(),
          district: district.trim(),
          city: city.trim(),
          phone: phone.trim() || null,
          zatca_phase: isPhase2 ? 2 : 1,
          username: normalizeBranchUsernameInput(loginUsername),
          password: loginPwd,
        },
      })
      const resultCode = (fnData as any)?.code
      if (resultCode !== 'COMPLETE') {
        if (resultCode === 'RESUMABLE_LOGIN_CONFLICT') throw new Error('BRANCH_LOGIN_USERNAME_CONFLICT')
        if (resultCode === 'MANUAL_REVIEW_REQUIRED') throw new Error('BRANCH_MANUAL_REVIEW')
        if (fnErr || resultCode === 'CORE_BRANCH_READY_ACCESS_FAILED') throw new Error('BRANCH_LOGIN_SETUP_FAILED')
        throw new Error('BRANCH_PROVISIONING_FAILED')
      }

      await refreshBranchCount()
      navigate('/dashboard', { replace: true })
    } catch (err: any) {
      console.error('Failed to create initial branch', err)
      const message = String(err?.message ?? '')
      setError(message === 'BRANCH_LOGIN_USERNAME_CONFLICT' ? t('errors.usernameTaken')
        : message === 'BRANCH_MANUAL_REVIEW' ? t('errors.manualReview')
        : message === 'BRANCH_LOGIN_SETUP_FAILED' ? t('errors.loginSetup')
        : /jwt|session|auth/i.test(message) ? t('errors.sessionExpired')
        : /permission|forbidden|42501/i.test(message) ? t('errors.permissionDenied')
        : t('errors.createBranch'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F3EA] text-gray-950">
      <div className="relative overflow-hidden bg-[#0F2419] px-4 pb-10 pt-6 text-white sm:px-6 lg:pb-12">
        <div className="absolute inset-x-0 top-0 h-1 bg-gold-500" />
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <MeemLogo size="lg" />
          <div className="flex items-center gap-2">
          <CompactLanguageSelector inverse />
          <button
            onClick={() => supabase.auth.signOut()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut size={13} />
            {t('actions.signOut')}
          </button>
          </div>
        </div>

        <div className="mx-auto mt-8 grid max-w-7xl gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-gold-300">{t('branch.eyebrow')}</p>
            <h1 className="mt-2 max-w-3xl text-3xl font-black tracking-tight text-white sm:text-4xl">
              {t('branch.title')}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-primary-100/80">
              {t('branch.subtitle')}
            </p>
            {profile?.full_name && (
              <p className="mt-3 text-sm font-medium text-white/55" dir="auto">{t('branch.welcome', { name: profile.full_name })}</p>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-card backdrop-blur">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gold-400/15 text-gold-300">
                <ShieldCheck size={17} />
              </div>
              <div>
                <p className="text-sm font-bold text-white">{t('branch.ownerTitle')}</p>
                <p className="mt-1 text-xs leading-5 text-white/60">
                  {t('branch.ownerHelp')}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              {['checkIdentity', 'checkAddress', 'checkUsername'].map(item => (
                <div key={item} className="flex items-center gap-2 text-xs font-semibold text-white/70">
                  <CheckCircle2 size={13} className="text-gold-300" />
                  {t(`branch.${item}`)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <main className="px-4 pb-10 pt-6 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <form
            onSubmit={handleSubmit}
            className="overflow-hidden rounded-[28px] border border-[#E8DFC9] bg-[#FFFDF7] shadow-card-lg"
          >
            <div className="p-5 sm:p-7 lg:p-8">
              <div className="space-y-8">
                <section>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                      <Building2 size={16} />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-gray-950">{t('branch.identity')}</h3>
                      <p className="text-xs text-gray-500">{t('branch.identityHelp')}</p>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <Input
                      label={t('branch.name')}
                      value={name}
                      onChange={e => setName(e.target.value)}
                      error={fieldErr('name') || undefined}
                      required dir="auto"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label={t('branch.vat')}
                        value={vat}
                        onChange={e => setVat(e.target.value)}
                        maxLength={15}
                        helperText={t('branch.vatHelp')}
                        error={fieldErr('vat') || undefined}
                        required dir="ltr"
                      />
                      <Input
                        label={t('branch.cr')}
                        value={cr}
                        onChange={e => setCr(e.target.value)}
                        helperText={t('branch.crHelp')}
                        error={fieldErr('cr') || undefined}
                        required dir="ltr"
                      />
                    </div>
                  </div>
                </section>

                <section>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                      <MapPin size={16} />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-gray-950">{t('branch.address')}</h3>
                      <p className="text-xs text-gray-500">{t('branch.addressHelp')}</p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label={t('branch.building')}
                      value={bldg}
                      onChange={e => setBldg(e.target.value)}
                      helperText={t('branch.buildingHelp')}
                      error={fieldErr('bldg') || undefined}
                    />
                    <Input
                      label={t('branch.street')}
                      value={street}
                      onChange={e => setStreet(e.target.value)}
                      error={fieldErr('street') || undefined} dir="auto"
                    />
                    <Input
                      label={t('branch.district')}
                      value={district}
                      onChange={e => setDistrict(e.target.value)}
                      helperText={t('branch.districtHelp')}
                      error={fieldErr('district') || undefined} dir="auto"
                    />
                    <Input
                      label={t('branch.city')}
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      error={fieldErr('city') || undefined} dir="auto"
                    />
                    <Input
                      label={t('branch.postal')}
                      value={postal}
                      onChange={e => setPostal(e.target.value)}
                      helperText={t('branch.postalHelp')}
                      error={fieldErr('postal') || undefined}
                    />
                    <Input
                      label={t('branch.phone')}
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="+966 5x xxx xxxx"
                      icon={Phone} dir="ltr"
                    />
                  </div>
                </section>

                <section>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                      <KeyRound size={16} />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-gray-950">{t('branch.login')}</h3>
                      <p className="text-xs text-gray-500">
                        {t('branch.loginHelp')}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <Input
                      label={t('branch.username')}
                      type="text"
                      value={loginUsername}
                      onChange={e => setLoginUsername(normalizeBranchUsernameInput(e.target.value))}
                      placeholder="main_counter"
                      helperText={t('branch.usernameHelp')}
                      autoComplete="username"
                      icon={UserRound}
                      error={fieldErr('loginUsername') || undefined}
                      required dir="ltr"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label={t('branch.password')}
                        type="password"
                        value={loginPwd}
                        onChange={e => setLoginPwd(e.target.value)}
                        placeholder={t('branch.passwordPlaceholder')}
                        error={fieldErr('loginPwd') || undefined}
                        required
                      />
                      <Input
                        label={t('branch.confirmPassword')}
                        type="password"
                        value={loginConfirm}
                        onChange={e => setLoginConfirm(e.target.value)}
                        placeholder={t('branch.repeatPassword')}
                        error={fieldErr('loginConfirm') || undefined}
                        required
                      />
                    </div>
                  </div>
                </section>

                {error && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-red-500" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <div className="mt-8 flex flex-col gap-3 border-t border-gray-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-gray-500">
                  {t('branch.editLater')}
                </p>
                <Button type="submit" variant="gold" loading={saving} disabled={saving} className="justify-center px-5">
                  {t('actions.createBranch')}
                  {!saving && <ArrowRight size={15} />}
                </Button>
              </div>
            </div>
          </form>

          <aside className="rounded-[28px] border border-[#E8DFC9] bg-[#F3EAD7] p-6 shadow-card lg:sticky lg:top-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0F2419] text-gold-300">
              <Building2 size={20} />
            </div>
            <h2 className="mt-5 text-lg font-black text-[#10291E]">{t('branch.details')}</h2>
            <p className="mt-2 text-sm leading-6 text-[#4D5B50]">
              {t('branch.detailsHelp')}
            </p>
            <div className="mt-6 rounded-2xl border border-[#E3D5B8] bg-white/60 p-4">
              <p className="text-xs font-bold text-[#10291E]">{t('branch.goodToKnow')}</p>
              <p className="mt-1 text-[11px] leading-5 text-[#5B6259]">
                {t('branch.goodToKnowHelp')}
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
