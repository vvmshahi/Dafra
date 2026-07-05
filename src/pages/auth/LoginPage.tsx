import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { UserRound, Mail, Lock, ArrowRight, CheckCircle2, MessageCircle, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { MeemLogo } from '@/components/MeemLogo'
import { supportConfig } from '@/config/support'

const WA_LINK = supportConfig.whatsappLink
const EMAIL_LINK = supportConfig.emailLink

function GeometricPattern() {
  return (
    <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <pattern id="kubri-login-pattern" x="0" y="0" width="96" height="96" patternUnits="userSpaceOnUse">
          <path d="M28 6h40l22 22v40L68 90H28L6 68V28Z" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          <path d="M48 20l28 28-28 28-28-28Z" fill="none" stroke="rgba(200,169,110,0.075)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#kubri-login-pattern)" />
    </svg>
  )
}

const workspaceItems = [
  'POS sales, cash, card, and split payments',
  'Invoices, stock, and register sessions',
  'ZATCA Phase 2 workflows for Saudi branches',
]

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate   = useNavigate()
  const location   = useLocation()
  const from       = (location.state as { from?: string })?.from ?? '/'
  const successMsg = (location.state as { successMsg?: string })?.successMsg ?? null

  const [identifier, setIdentifier] = useState('')
  const [password,   setPassword]   = useState('')
  const [error,      setError]      = useState('')
  const [loading,    setLoading]    = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(identifier, password)
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      navigate(from, { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-[#071510] text-white">
      <GeometricPattern />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(27,107,58,0.40),transparent_34%),radial-gradient(circle_at_82%_16%,rgba(200,169,110,0.18),transparent_28%),linear-gradient(135deg,rgba(7,21,16,0.94),rgba(15,36,25,0.98))]" />

      <main className="relative z-10 grid min-h-screen grid-cols-1 lg:grid-cols-[1.03fr_0.97fr]">
        <section className="hidden flex-col justify-between px-10 py-10 lg:flex xl:px-14">
          <MeemLogo size="lg" />

          <div className="max-w-xl">
            <p className="mb-5 text-sm font-bold uppercase tracking-[0.22em] text-gold-300">Kubri POS workspace</p>
            <h2 className="text-5xl font-black leading-[1.03] tracking-tight xl:text-6xl">
              Your simple bridge to ZATCA Phase 2 invoicing.
            </h2>
            <p className="mt-6 max-w-lg text-base leading-8 text-white/75">
              Manage POS, invoices, register sessions, and ZATCA Phase 2 workflows from one secure workspace.
            </p>

            <div className="mt-8 space-y-3">
              {workspaceItems.map(item => (
                <div key={item} className="flex items-start gap-3 border-l-2 border-gold-400/50 bg-white/[0.045] px-4 py-3">
                  <CheckCircle2 size={17} className="mt-0.5 flex-shrink-0 text-gold-300" />
                  <span className="text-sm font-semibold text-white/85">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid max-w-xl grid-cols-2 gap-3">
            <div className="border border-white/10 bg-white/[0.045] p-4">
              <p className="text-xs font-bold text-white">Built for Saudi businesses</p>
              <p className="mt-1 text-xs leading-5 text-white/55">Branch teams, owners, and counters in one workspace.</p>
            </div>
            <div className="border border-white/10 bg-white/[0.045] p-4">
              <p className="text-xs font-bold text-white">Secure access</p>
              <p className="mt-1 text-xs leading-5 text-white/55">Role-based access keeps each team focused.</p>
            </div>
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-center px-5 py-8 sm:px-8">
          <div className="w-full max-w-[440px]">
            <div className="mb-8 flex justify-center lg:hidden">
              <MeemLogo size="md" />
            </div>

            <div className="border border-white/10 bg-white px-6 py-7 text-gray-900 shadow-[0_32px_120px_rgba(0,0,0,0.34)] sm:px-8">
              <div className="mb-7">
                <div className="mb-5 flex h-12 w-12 items-center justify-center bg-[#0F2419]">
                  <ShieldCheck size={22} className="text-gold-300" />
                </div>
                <h1 className="text-2xl font-black tracking-tight text-gray-950">Sign in to Kubri</h1>
                <p className="mt-2 text-sm leading-6 text-gray-500">
                  Manage POS, invoices, register sessions, and ZATCA Phase 2 workflows from one secure workspace.
                </p>
              </div>

              {successMsg && (
                <div className="mb-4 flex items-start gap-3 border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                  <span>{successMsg}</span>
                </div>
              )}

              {error && (
                <div className="mb-4 flex items-start gap-3 border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <span className="mt-0.5 flex-shrink-0 text-red-400">!</span>
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label="Email or branch username"
                  type="text"
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  placeholder="owner@company.com or branch_counter"
                  icon={UserRound}
                  required
                  autoComplete="username"
                />
                <Input
                  label="Password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Password"
                  icon={Lock}
                  required
                  autoComplete="current-password"
                />

                <div className="flex items-center justify-between gap-3 text-sm">
                  <label className="flex items-center gap-2 text-gray-600 cursor-pointer select-none">
                    <input type="checkbox" className="rounded border-gray-300 text-primary-500 focus:ring-primary-500" />
                    Remember me
                  </label>
                  <Link to="/forgot-password" className="font-semibold text-primary-700 hover:text-primary-800">
                    Forgot password?
                  </Link>
                </div>

                <Button type="submit" loading={loading} variant="gold" className="w-full gap-2 bg-gold-500 text-[#0F2419] hover:bg-gold-400">
                  Sign in
                  {!loading && <ArrowRight size={16} />}
                </Button>
              </form>

              <div className="mt-6 border-t border-gray-100 pt-5">
                <p className="text-center text-sm text-gray-500">
                  Need an account?{' '}
                  <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="font-bold text-primary-700 hover:text-primary-800">
                    Talk to us
                  </a>
                </p>
                <div className="mt-4 flex flex-col gap-2 text-center text-sm sm:flex-row">
                  <a
                    href={WA_LINK}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex flex-1 items-center justify-center gap-2 bg-emerald-500 px-4 py-2.5 font-semibold text-white hover:bg-emerald-600"
                  >
                    <MessageCircle size={15} />
                    WhatsApp
                  </a>
                  <a
                    href={EMAIL_LINK}
                    className="inline-flex flex-1 items-center justify-center gap-2 border border-gray-200 px-4 py-2.5 font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    <Mail size={15} />
                    support@kubri.shop
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
