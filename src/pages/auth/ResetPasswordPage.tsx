import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, ArrowRight, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { MeemLogo } from '@/components/MeemLogo'

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
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setStatus('success')
    // Sign out after password update so user must log in with new password
    await supabase.auth.signOut()
    setTimeout(() => {
      navigate('/login', {
        state: { successMsg: 'Password updated successfully. Please sign in.' },
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
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-gold-300">Kubri password setup</p>
            <h2 className="text-5xl font-black text-white leading-tight mb-2" style={{ fontFamily: 'Cairo, sans-serif' }}>
              كلمة مرور
              <br />
              <span className="text-gold-400">جديدة</span>
            </h2>
            <p className="text-xl font-light text-white/80 mt-1">
              Choose a strong password<br />to protect your account.
            </p>
          </div>
          <p className="text-white/50 text-sm leading-relaxed max-w-xs">
            Use at least 8 characters with a mix of letters, numbers, and symbols for the best security.
          </p>
        </div>

        <div className="relative z-10">
          <p className="text-white/40 text-xs">Secure password setup for Kubri users</p>
        </div>
      </div>

      {/* ── Right panel ──────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-[380px] space-y-8">

          {/* Mobile logo */}
          <div className="flex lg:hidden">
            <MeemLogo size="sm" />
          </div>

          {/* ── Loading ──────────────────────────────────── */}
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <Loader2 size={28} className="animate-spin text-primary-400" />
              <p className="text-sm text-gray-500">Verifying your reset link…</p>
            </div>
          )}

          {/* ── Invalid link ─────────────────────────────── */}
          {status === 'invalid' && (
            <div className="space-y-6">
              <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
                <AlertCircle size={28} className="text-red-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Link expired</h1>
                <p className="text-gray-500 text-sm mt-2">
                  This password reset link has expired or is invalid. Reset links are only valid for 1 hour.
                </p>
              </div>
              <a
                href="/forgot-password"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0F2419] text-white text-sm font-semibold rounded-xl hover:bg-[#1a3a28] transition-colors"
              >
                Request a new link
                <ArrowRight size={14} />
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
                <h1 className="text-2xl font-bold text-gray-900">Password updated!</h1>
                <p className="text-gray-500 text-sm mt-2">
                  Your password has been updated. Redirecting you to sign in…
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 size={14} className="animate-spin" />
                Redirecting…
              </div>
            </div>
          )}

          {/* ── Password form ─────────────────────────────── */}
          {status === 'ready' && (
            <div className="space-y-8">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Set new password</h1>
                <p className="text-gray-500 text-sm mt-1">
                  Choose a strong password for your account
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
                  label="New password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  icon={Lock}
                  required
                  autoComplete="new-password"
                  helperText="Min. 8 characters"
                />
                <Input
                  label="Confirm new password"
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  icon={Lock}
                  required
                  autoComplete="new-password"
                />
                <Button type="submit" loading={loading} className="w-full mt-2 gap-2">
                  Update password
                  {!loading && <ArrowRight size={16} />}
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
