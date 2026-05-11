import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Mail, Lock, ArrowRight, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { MeemLogo } from '@/components/MeemLogo'

/* ── Islamic geometric SVG pattern ─────────────────────────── */
function GeometricPattern() {
  return (
    <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="geo" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
          {/* Octagon outline */}
          <path
            d="M24 4 L56 4 L76 24 L76 56 L56 76 L24 76 L4 56 L4 24 Z"
            fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1"
          />
          {/* Inner rotated square */}
          <rect
            x="22" y="22" width="36" height="36"
            transform="rotate(45 40 40)"
            fill="none" stroke="rgba(200,169,110,0.07)" strokeWidth="1"
          />
          {/* Center star */}
          <path
            d="M40 28 L43 36 L52 36 L45 42 L48 50 L40 45 L32 50 L35 42 L28 36 L37 36 Z"
            fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.8"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#geo)" />
    </svg>
  )
}

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate   = useNavigate()
  const location   = useLocation()
  const from       = (location.state as { from?: string })?.from ?? '/'
  const successMsg = (location.state as { successMsg?: string })?.successMsg ?? null

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      navigate(from, { replace: true })
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — brand ─────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[52%] relative bg-[#0F2419] flex-col justify-between p-12 overflow-hidden">

        <GeometricPattern />

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#1B6B3A]/60 via-transparent to-[#0F2419]/80 pointer-events-none" />

        {/* Gold glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gold-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Logo */}
        <div className="relative z-10">
          <MeemLogo size="lg" />
        </div>

        {/* Center content */}
        <div className="relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 text-white/80 text-xs px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            ZATCA Phase 2 Certified
          </div>

          <div>
            <h2
              className="text-5xl font-black text-white leading-tight mb-2"
              style={{ fontFamily: 'Cairo, sans-serif' }}
            >
              إدارة أعمالك
              <br />
              <span className="text-gold-400">بذكاء</span>
            </h2>
            <p className="text-xl font-light text-white mt-1">Manage your business smarter.</p>
          </div>

          <p className="text-white/60 text-sm leading-relaxed max-w-sm">
            POS, invoicing, inventory, and ZATCA compliance — all in one platform built for Saudi SMEs.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2">
            {['ZATCA Compliant', 'Multi-Branch', 'Real-time Reports', 'Arabic + English'].map(f => (
              <span key={f} className="text-xs bg-white/10 text-white/80 border border-white/10 rounded-full px-3 py-1">
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Bottom tagline */}
        <div className="relative z-10">
          <p className="text-white/40 text-xs">
            Trusted by Saudi SMEs · هيئة الزكاة والضريبة والجمارك
          </p>
        </div>
      </div>

      {/* ── Right panel — form ─────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-[380px] space-y-8">

          {/* Mobile logo */}
          <div className="flex lg:hidden mb-6">
            <MeemLogo size="sm" />
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
            <p className="text-gray-500 text-sm mt-1">Sign in to your Meem account</p>
          </div>

          {successMsg && (
            <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm px-4 py-3 rounded-xl">
              <CheckCircle2 size={16} className="mt-0.5 text-emerald-500 flex-shrink-0" />
              {successMsg}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3 rounded-xl">
              <span className="mt-0.5 text-red-400">⚠</span>
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
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              icon={Lock}
              required
              autoComplete="current-password"
            />

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-gray-600 cursor-pointer select-none">
                <input type="checkbox" className="rounded border-gray-300 text-primary-500 focus:ring-primary-500" />
                Remember me
              </label>
              <Link to="/forgot-password" className="text-primary-600 font-medium hover:text-primary-700">
                Forgot password?
              </Link>
            </div>

            <Button type="submit" loading={loading} className="w-full mt-2 gap-2">
              Sign in
              {!loading && <ArrowRight size={16} />}
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500">
            New to Meem?{' '}
            <Link to="/signup" className="font-semibold text-primary-600 hover:text-primary-700">
              Start free trial
            </Link>
          </p>

          {/* Trust indicators */}
          <div className="pt-4 border-t border-gray-100 flex items-center justify-center gap-4">
            {['🔒 SSL Secure', '🇸🇦 Saudi Hosted', '✓ ZATCA'].map(t => (
              <span key={t} className="text-xs text-gray-400">{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
