import { useState, useEffect, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Lock, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { markOwnerSetupCompleteSilently } from '@/lib/ownerSetupCompletion'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { MeemLogo } from '@/components/MeemLogo'
import { useTranslation } from 'react-i18next'
import { DirectionalIcon } from '@/components/localization/DirectionalIcon'
import { authErrorKey } from '@/localization/authErrors'
import { CompactLanguageSelector } from '@/components/localization/CompactLanguageSelector'

function GeometricPattern() {
  return (
    <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="geo-reset" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M24 4 L56 4 L76 24 L76 56 L56 76 L24 76 L4 56 L4 24 Z"
            fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          <rect x="22" y="22" width="36" height="36" transform="rotate(45 40 40)"
            fill="none" stroke="rgba(200,169,110,0.07)" strokeWidth="1" />
          <path d="M40 28 L43 36 L52 36 L45 42 L48 50 L40 45 L32 50 L35 42 L28 36 L37 36 Z"
            fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#geo-reset)" />
    </svg>
  )
}

type PageStatus = 'loading' | 'ready' | 'invalid' | 'success'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['auth', 'common', 'validation'])

  const [status,   setStatus]   = useState<PageStatus>('loading')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    let mounted = true

    // Supabase may have already exchanged the URL hash for a session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      if (session) setStatus('ready')
    })

    // Also listen for the PASSWORD_RECOVERY event fired when Supabase processes the hash
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (event === 'PASSWORD_RECOVERY' && session) setStatus('ready')
    })

    // If no session and no event after 4 s, the link is invalid/expired
    const timer = setTimeout(() => {
      if (mounted) setStatus(prev => prev === 'loading' ? 'invalid' : prev)
    }, 4000)

    return () => {
      mounted = false
      subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError(t('validation:passwordsDoNotMatch'))
      return
    }
    if (password.length < 8) {
      setError(t('validation:passwordTooShort', { min: 8 }))
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      console.error('Kubri password update failed', error)
      setError(t(`auth:${authErrorKey(error, 'errors.passwordUpdateFailed')}`))
      return
    }

    setStatus('success')
    await markOwnerSetupCompleteSilently('password_update')
    // Sign out after password update so user must log in with new password
    await supabase.auth.signOut()
    setTimeout(() => {
      navigate('/login', {
        state: { successKey: 'auth:reset.updatedSignIn' },
        replace: true,
      })
    }, 1800)
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel ───────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[52%] relative bg-[#0F2419] flex-col justify-between p-12 overflow-hidden">
        <GeometricPattern />
        <div className="absolute inset-0 bg-gradient-to-br from-[#1B6B3A]/60 via-transparent to-[#0F2419]/80 pointer-events-none" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gold-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Logo */}
        <div className="relative z-10">
          <MeemLogo size="lg" />
        </div>

        {/* Center */}
        <div className="relative z-10 space-y-6">
          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-gold-300">{t('auth:reset.eyebrow')}</p>
            <h2 className="text-5xl font-black text-white leading-tight mb-2">{t('auth:reset.heroTitle')}</h2>
            <p className="text-xl font-light text-white/80 mt-1">
              {t('auth:reset.heroSubtitle')}
            </p>
          </div>
          <p className="text-white/50 text-sm leading-relaxed max-w-xs">
            {t('auth:reset.heroDescription')}
          </p>
        </div>

        <div className="relative z-10">
          <p className="text-white/40 text-xs">{t('auth:reset.securityNote')}</p>
        </div>
      </div>

      {/* ── Right panel ──────────────────────────────────── */}
      <div className="relative flex-1 flex items-center justify-center bg-white p-8">
        <CompactLanguageSelector className="absolute end-5 top-5 z-20 sm:end-8 sm:top-8" />
        <Link
          to="/"
          className="absolute start-5 top-5 inline-flex items-center gap-2 rounded-full border border-[#D9CBAA] bg-white/80 px-3 py-2 text-sm font-black text-[#284334] shadow-[0_10px_26px_rgba(15,36,25,0.06)] transition hover:border-[#C8A96E] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B76A]/75 focus-visible:ring-offset-2 focus-visible:ring-offset-white sm:start-8 sm:top-8"
        >
          <DirectionalIcon icon={ArrowLeft} size={15} />
          {t('common:home')}
        </Link>
        <div className="w-full max-w-[380px] space-y-8">

          {/* Mobile logo */}
          <div className="flex lg:hidden">
            <MeemLogo size="sm" />
          </div>

          {/* ── Loading ──────────────────────────────────── */}
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <Loader2 size={28} className="animate-spin text-primary-400" />
              <p className="text-sm text-gray-500">{t('auth:reset.verifying')}</p>
            </div>
          )}

          {/* ── Invalid link ─────────────────────────────── */}
          {status === 'invalid' && (
            <div className="space-y-6">
              <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
                <AlertCircle size={28} className="text-red-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{t('auth:reset.expiredTitle')}</h1>
                <p className="text-gray-500 text-sm mt-2">
                  {t('auth:reset.expiredBody')}
                </p>
              </div>
              <a
                href="/forgot-password"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0F2419] text-white text-sm font-semibold rounded-xl hover:bg-[#1a3a28] transition-colors"
              >
                {t('auth:reset.requestNewLink')}
                <DirectionalIcon icon={ArrowRight} size={14} />
              </a>
            </div>
          )}

          {/* ── Success ──────────────────────────────────── */}
          {status === 'success' && (
            <div className="space-y-6">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 size={28} className="text-emerald-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{t('auth:reset.successTitle')}</h1>
                <p className="text-gray-500 text-sm mt-2">
                  {t('auth:reset.successBody')}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 size={14} className="animate-spin" />
                {t('auth:reset.redirecting')}
              </div>
            </div>
          )}

          {/* ── Password form ─────────────────────────────── */}
          {status === 'ready' && (
            <div className="space-y-8">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{t('auth:reset.title')}</h1>
                <p className="text-gray-500 text-sm mt-1">
                  {t('auth:reset.description')}
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-3 bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3 rounded-xl">
                  <span className="mt-0.5 text-red-400 flex-shrink-0">⚠</span>
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label={t('auth:newPassword')}
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  icon={Lock}
                  required
                  autoComplete="new-password"
                  helperText={t('auth:reset.minimumHint')}
                />
                <Input
                  label={t('auth:confirmPassword')}
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  icon={Lock}
                  required
                  autoComplete="new-password"
                />
                <Button type="submit" loading={loading} className="w-full mt-2 gap-2">
                  {t('auth:reset.update')}
                  {!loading && <DirectionalIcon icon={ArrowRight} size={16} />}
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
