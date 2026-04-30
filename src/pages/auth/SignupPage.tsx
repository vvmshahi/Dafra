import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, Lock, User, Phone, ArrowRight, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

function GeometricPattern() {
  return (
    <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="geo-signup" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M24 4 L56 4 L76 24 L76 56 L56 76 L24 76 L4 56 L4 24 Z"
            fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          <rect x="22" y="22" width="36" height="36" transform="rotate(45 40 40)"
            fill="none" stroke="rgba(200,169,110,0.07)" strokeWidth="1" />
          <path d="M40 28 L43 36 L52 36 L45 42 L48 50 L40 45 L32 50 L35 42 L28 36 L37 36 Z"
            fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#geo-signup)" />
    </svg>
  )
}

export default function SignupPage() {
  const { signUp } = useAuth()
  const navigate   = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [phone,    setPhone]    = useState('')
  const [agreed,   setAgreed]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

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
    if (!agreed) {
      setError('Please agree to the Terms of Service to continue.')
      return
    }

    setLoading(true)
    const { error } = await signUp(email, password, fullName)
    setLoading(false)

    if (error) {
      setError(error.message)
    } else {
      navigate('/onboarding')
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — brand ──────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[48%] relative bg-[#0F2419] flex-col justify-between p-12 overflow-hidden">
        <GeometricPattern />

        <div className="absolute inset-0 bg-gradient-to-br from-[#1B6B3A]/50 via-transparent to-[#0F2419]/80 pointer-events-none" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-gold-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold-500 flex items-center justify-center shadow-lg">
            <span className="text-[#0F2419] font-black text-xl" style={{ fontFamily: 'Cairo, sans-serif' }}>د</span>
          </div>
          <div>
            <p className="text-white font-bold text-2xl leading-none" style={{ fontFamily: 'Cairo, sans-serif' }}>دفرة</p>
            <p className="text-gold-400 text-xs tracking-widest uppercase">Dafra</p>
          </div>
        </div>

        {/* Center content */}
        <div className="relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 text-white/80 text-xs px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-gold-400 animate-pulse" />
            Free 14-day trial · لا يلزم بطاقة ائتمان
          </div>

          <div>
            <h2 className="text-4xl font-black text-white leading-tight mb-3" style={{ fontFamily: 'Cairo, sans-serif' }}>
              ابدأ رحلتك
              <br />
              <span className="text-gold-400">نحو النجاح</span>
            </h2>
            <p className="text-lg font-light text-white/70">Set up your business in minutes.</p>
          </div>

          <div className="space-y-3">
            {[
              { icon: CheckCircle2, text: 'ZATCA Phase 1 QR codes included' },
              { icon: CheckCircle2, text: 'Arabic + English interface' },
              { icon: CheckCircle2, text: 'Setup in under 10 minutes' },
              { icon: CheckCircle2, text: 'Free onboarding support' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2.5">
                <Icon size={15} className="text-gold-400 flex-shrink-0" />
                <span className="text-sm text-white/75">{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-white/30 text-xs">Trusted by Saudi SMEs · هيئة الزكاة والضريبة والجمارك</p>
        </div>
      </div>

      {/* ── Right panel — form ──────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-white p-8 overflow-y-auto">
        <div className="w-full max-w-[400px] space-y-6 py-8">

          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gold-500 flex items-center justify-center">
              <span className="text-[#0F2419] font-black text-lg" style={{ fontFamily: 'Cairo, sans-serif' }}>د</span>
            </div>
            <span className="font-bold text-xl text-gray-900" style={{ fontFamily: 'Cairo, sans-serif' }}>دفرة</span>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
            <p className="text-gray-500 text-sm mt-1">Start your free 14-day trial — no credit card needed</p>
          </div>

          {error && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3 rounded-xl">
              <span className="text-red-400 mt-0.5 flex-shrink-0">⚠</span>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Full name"
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Mohammed Al-Rashid"
              icon={User}
              required
              autoComplete="name"
            />
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Password"
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
                label="Confirm password"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                icon={Lock}
                required
                autoComplete="new-password"
              />
            </div>
            <Input
              label="Phone number (optional)"
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+966 5x xxx xxxx"
              icon={Phone}
              autoComplete="tel"
            />

            {/* Terms checkbox */}
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-600">
                I agree to the{' '}
                <Link to="/terms" className="text-primary-600 hover:underline font-medium">Terms of Service</Link>
                {' '}and{' '}
                <Link to="/privacy" className="text-primary-600 hover:underline font-medium">Privacy Policy</Link>
              </span>
            </label>

            <Button type="submit" loading={loading} className="w-full mt-2 gap-2">
              Create account — Start free trial
              {!loading && <ArrowRight size={16} />}
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-primary-600 hover:text-primary-700">
              Sign in
            </Link>
          </p>

          {/* Trust indicators */}
          <div className="pt-2 border-t border-gray-100 flex items-center justify-center gap-4">
            {['🔒 SSL Secure', '🇸🇦 Saudi Hosted', '✓ ZATCA'].map(t => (
              <span key={t} className="text-xs text-gray-400">{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
