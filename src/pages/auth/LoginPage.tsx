import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { UserRound, Mail, Lock, ArrowRight, CheckCircle2, MessageCircle } from 'lucide-react'
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
          <path d="M28 6h40l22 22v40L68 90H28L6 68V28Z" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
          <path d="M48 20l28 28-28 28-28-28Z" fill="none" stroke="rgba(216,183,106,0.055)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#kubri-login-pattern)" />
    </svg>
  )
}

const workspaceItems = [
  'POS and invoices',
  'Stock and reports',
  'Secure team access',
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
    <div className="min-h-screen overflow-hidden bg-[#F6F2E8]">
      <main className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
        <section className="relative hidden min-h-screen overflow-hidden bg-[#0F2419] text-white lg:flex lg:flex-col lg:justify-between lg:px-10 lg:py-10 xl:px-14">
          <GeometricPattern />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(34,121,70,0.28),transparent_34%),radial-gradient(circle_at_78%_14%,rgba(216,183,106,0.12),transparent_30%),linear-gradient(135deg,rgba(7,21,16,0.94),rgba(15,36,25,0.98))]" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#D8B76A]/35 to-transparent" />
          <div className="relative z-10">
            <MeemLogo size="lg" />
          </div>

          <div className="relative z-10 max-w-md">
            <p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-[#D8B76A]">Kubri workspace</p>
            <h2 className="text-4xl font-black leading-[1.08] tracking-tight xl:text-5xl">
              Welcome back to Kubri.
            </h2>
            <p className="mt-4 max-w-sm text-base leading-7 text-white/70">
              Sign in to manage sales, invoices, stock, sessions, and reports.
            </p>

            <div className="mt-7 space-y-3">
              {workspaceItems.map(item => (
                <div key={item} className="flex items-center gap-3 text-sm font-semibold text-white/82">
                  <CheckCircle2 size={16} className="flex-shrink-0 text-[#D8B76A]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 max-w-md border-t border-white/[0.10] pt-4">
            <p className="text-sm font-semibold text-white/58">Built for Saudi SMEs and growing businesses.</p>
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#F6F2E8] px-5 py-8 text-[#10291E] sm:px-8 lg:px-10">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute right-[-14rem] top-[-16rem] h-[32rem] w-[32rem] rounded-full bg-[#D8B76A]/25 blur-3xl" />
            <div className="absolute bottom-[-18rem] left-[-12rem] h-[36rem] w-[36rem] rounded-full bg-[#0F3A2A]/15 blur-3xl" />
            <div className="absolute inset-y-0 left-0 hidden w-px bg-gradient-to-b from-transparent via-[#C8A96E]/60 to-transparent lg:block" />
          </div>

          <div className="relative z-10 w-full max-w-[430px]">
            <div className="mb-7 flex justify-center lg:hidden">
              <MeemLogo size="md" />
            </div>

            <div className="mb-7">
              <p className="text-sm font-black uppercase tracking-[0.2em] text-[#A77F29]">Secure access</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-[#10291E]">Sign in to Kubri</h1>
              <p className="mt-2 text-sm leading-6 text-[#496154]">
                Access your POS workspace, reports, invoices, and branch operations.
              </p>
            </div>

            {successMsg && (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-600" />
                <span>{successMsg}</span>
              </div>
            )}

            {error && (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <span className="mt-0.5 flex-shrink-0 font-black text-red-500">!</span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email or username"
                type="text"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="owner@company.com or counter_user"
                icon={UserRound}
                required
                autoComplete="username"
                className="h-12 rounded-2xl border-[#D8CDAE] bg-white/85 text-[#10291E] shadow-[0_10px_26px_rgba(15,36,25,0.06)] placeholder:text-[#8CA093] focus:border-[#A77F29] focus:ring-[#D8B76A]/25"
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
                className="h-12 rounded-2xl border-[#D8CDAE] bg-white/85 text-[#10291E] shadow-[0_10px_26px_rgba(15,36,25,0.06)] placeholder:text-[#8CA093] focus:border-[#A77F29] focus:ring-[#D8B76A]/25"
              />

              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="flex cursor-pointer select-none items-center gap-2 font-semibold text-[#496154]">
                  <input type="checkbox" className="rounded border-[#CDBF9F] text-[#A77F29] focus:ring-[#D8B76A]/40" />
                  Remember me
                </label>
                <Link to="/forgot-password" className="font-black text-[#0F3A2A] hover:text-[#A77F29]">
                  Forgot password?
                </Link>
              </div>

              <Button type="submit" loading={loading} variant="gold" className="h-12 w-full gap-2 rounded-2xl bg-[#D8B76A] text-[#10291E] shadow-[0_16px_34px_rgba(216,183,106,0.26)] hover:bg-[#E6C779] focus-visible:ring-[#D8B76A]/70">
                Sign in
                {!loading && <ArrowRight size={16} />}
              </Button>
            </form>

            <div className="mt-6 border-t border-[#D9CBAA] pt-5">
              <p className="text-center text-sm text-[#496154]">
                New to Kubri?{' '}
                <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="font-black text-[#0F3A2A] hover:text-[#A77F29]">
                  Get started
                </a>
              </p>
              <div className="mt-4 flex flex-col gap-2 text-center text-sm sm:flex-row">
                <a
                  href={WA_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-[#0F3A2A]/15 bg-[#0F3A2A] px-4 py-3 font-black text-white shadow-[0_12px_28px_rgba(15,58,42,0.18)] transition hover:bg-[#173F2F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B76A]/75 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F6F2E8]"
                >
                  <MessageCircle size={15} />
                  WhatsApp
                </a>
                <a
                  href={EMAIL_LINK}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-[#D9CBAA] bg-white/70 px-4 py-3 font-black text-[#284334] transition hover:border-[#C8A96E] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B76A]/75 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F6F2E8]"
                >
                  <Mail size={15} />
                  support@kubri.shop
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
