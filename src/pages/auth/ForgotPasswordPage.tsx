import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { MeemLogo } from '@/components/MeemLogo'

function GeometricPattern() {
  return (
    <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="geo-forgot" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M24 4 L56 4 L76 24 L76 56 L56 76 L24 76 L4 56 L4 24 Z"
            fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          <rect x="22" y="22" width="36" height="36" transform="rotate(45 40 40)"
            fill="none" stroke="rgba(200,169,110,0.07)" strokeWidth="1" />
          <path d="M40 28 L43 36 L52 36 L45 42 L48 50 L40 45 L32 50 L35 42 L28 36 L37 36 Z"
            fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#geo-forgot)" />
    </svg>
  )
}

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent,    setSent]    = useState(false)
  const [error,   setError]   = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const redirectTo = `${window.location.origin}/reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
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
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-gold-300">Kubri account recovery</p>
            <h2 className="text-5xl font-black text-white leading-tight mb-2" style={{ fontFamily: 'Cairo, sans-serif' }}>
              نسيت كلمة
              <br />
              <span className="text-gold-400">المرور؟</span>
            </h2>
            <p className="text-xl font-light text-white/80 mt-1">
              No worries — we'll send you<br />a secure reset link.
            </p>
          </div>
          <p className="text-white/50 text-sm leading-relaxed max-w-xs">
            Enter your account email and we'll send a password reset link within seconds.
          </p>
        </div>

        <div className="relative z-10">
          <p className="text-white/40 text-xs">Secure account recovery for Kubri users</p>
        </div>
      </div>

      {/* ── Right panel ──────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-[380px] space-y-8">

          {/* Mobile logo */}
          <div className="flex lg:hidden">
            <MeemLogo size="sm" />
          </div>

          {sent ? (
            /* ── Success state ─────────────────────────────── */
            <div className="space-y-6">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 size={28} className="text-emerald-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Check your email</h1>
                <p className="text-gray-500 text-sm mt-2">
                  We sent a password reset link to{' '}
                  <span className="font-semibold text-gray-700">{email}</span>.
                  It expires in 1 hour.
                </p>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700">
                Didn't receive it? Check your spam folder, or{' '}
                <button onClick={() => setSent(false)} className="font-semibold underline">
                  try again
                </button>.
              </div>
              <Link
                to="/login"
                className="flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                <ArrowLeft size={16} />
                Back to sign in
              </Link>
            </div>
          ) : (
            /* ── Request form ──────────────────────────────── */
            <div className="space-y-8">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Reset your password</h1>
                <p className="text-gray-500 text-sm mt-1">
                  Enter your email and we'll send a reset link
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
                  label="Email address"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  icon={Mail}
                  required
                  autoComplete="email"
                />
                <Button type="submit" loading={loading} className="w-full mt-2">
                  Send reset link
                </Button>
              </form>

              <Link
                to="/login"
                className="flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                <ArrowLeft size={16} />
                Back to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
