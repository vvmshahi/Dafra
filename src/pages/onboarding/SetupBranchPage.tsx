import { useState } from 'react'
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
  BRANCH_USERNAME_HELPER_TEXT,
  branchUsernameCreateErrorMessage,
  normalizeBranchUsernameInput,
  validateBranchUsernameInput,
} from '@/lib/utils/branchUsername'
import { branchCreationErrorMessage, branchIdFromRpcResult } from '@/lib/utils/branchCreation'

const VAT_RE    = /^3\d{13}3$/
const CR_RE     = /^[a-zA-Z0-9]+$/
const BLDG_RE   = /^\d{4}$/
const POSTAL_RE = /^\d{5}$/

export default function SetupBranchPage() {
  const navigate = useNavigate()
  const { profile, refreshBranchCount } = useAuth()
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

  const errs = {
    name:     !name.trim()     ? 'Branch name is required' : null,
    vat:      !vat.trim()      ? 'VAT number is required'
              : !VAT_RE.test(vat.trim()) ? 'Must be 15 digits, starting and ending with 3' : null,
    cr:       !cr.trim()       ? 'CR number is required'
              : !CR_RE.test(cr.trim()) ? 'Alphanumeric characters only' : null,
    bldg:     !bldg.trim()     ? 'Building number is required'
              : !BLDG_RE.test(bldg.trim()) ? 'Exactly 4 digits (use leading zeros e.g. 0056)' : null,
    postal:   !postal.trim()   ? 'Postal code is required'
              : !POSTAL_RE.test(postal.trim()) ? 'Exactly 5 digits' : null,
    street:   !street.trim()   ? 'Street name is required' : null,
    district: !district.trim() ? 'District is required' : null,
    city:     !city.trim()     ? 'City is required' : null,
    loginUsername: validateBranchUsernameInput(loginUsername),
    loginPwd:     !loginPwd             ? 'Password is required'
                  : loginPwd.length < 8 ? 'Must be at least 8 characters' : null,
    loginConfirm: !loginConfirm         ? 'Confirm your password'
                  : loginConfirm !== loginPwd ? 'Passwords do not match' : null,
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
      const { data: branchData, error: insertErr } = await (supabase as any)
        .rpc('create_branch_for_tenant', {
          p_payload: {
            name:             name.trim(),
            vat_number:       vat.trim(),
            cr_number:        cr.trim(),
            building_number:  bldg.trim(),
            postal_code:      postal.trim(),
            street:           street.trim(),
            district:         district.trim(),
            city:             city.trim(),
            phone:            phone.trim() || null,
            country:          'SA',
            is_main_branch:   true,
            is_active:        true,
            vat_mode:         'exclusive',
            invoice_prefix:   'INV',
            invoice_language: 'both',
            show_logo:        true,
            zatca_phase:      isPhase2 ? 2 : 1,
          },
        })

      if (insertErr) throw insertErr
      const branchId = branchIdFromRpcResult(branchData)

      // Create the branch user (no email sent — owner sets credentials directly)
      const { data: fnData, error: fnErr } = await supabase.functions.invoke('create-branch-user', {
        body: {
          username:  normalizeBranchUsernameInput(loginUsername),
          password:  loginPwd,
          full_name: name.trim(),
          tenant_id: profile!.tenant_id,
          branch_id: branchId,
        },
      })

      const fnErrMsg = fnErr?.message ?? (fnData as any)?.error ?? null
      if (fnErrMsg) throw new Error(`Branch created but login setup failed: ${branchUsernameCreateErrorMessage(fnErrMsg)}`)

      await refreshBranchCount()
      navigate('/dashboard', { replace: true })
    } catch (err: any) {
      setError(branchCreationErrorMessage(err?.message))
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
          <button
            onClick={() => supabase.auth.signOut()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>

        <div className="mx-auto mt-8 grid max-w-7xl gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-gold-300">First branch setup</p>
            <h1 className="mt-2 max-w-3xl text-3xl font-black tracking-tight text-white sm:text-4xl">
              Create your first branch
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-primary-100/80">
              This branch will be used for POS, invoices, and ZATCA device setup. You can add more branches later from your owner workspace.
            </p>
            {profile?.full_name && (
              <p className="mt-3 text-sm font-medium text-white/55">Welcome, {profile.full_name}</p>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-card backdrop-blur">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gold-400/15 text-gold-300">
                <ShieldCheck size={17} />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Owner-controlled setup</p>
                <p className="mt-1 text-xs leading-5 text-white/60">
                  Create the branch record and its POS login in one step. No email is sent to staff.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              {['Branch identity', 'National address', 'Branch username'].map(item => (
                <div key={item} className="flex items-center gap-2 text-xs font-semibold text-white/70">
                  <CheckCircle2 size={13} className="text-gold-300" />
                  {item}
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
                      <h3 className="text-sm font-black text-gray-950">Branch identity</h3>
                      <p className="text-xs text-gray-500">Registered branch and tax details.</p>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <Input
                      label="Branch Name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      error={fieldErr('name') || undefined}
                      required
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="VAT Registration Number"
                        value={vat}
                        onChange={e => setVat(e.target.value)}
                        maxLength={15}
                        helperText="From your VAT Registration Certificate. Must be 15 digits starting and ending with 3."
                        error={fieldErr('vat') || undefined}
                        required
                      />
                      <Input
                        label="CR / License Number"
                        value={cr}
                        onChange={e => setCr(e.target.value)}
                        helperText="Commercial Registration number for this specific branch."
                        error={fieldErr('cr') || undefined}
                        required
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
                      <h3 className="text-sm font-black text-gray-950">Branch address</h3>
                      <p className="text-xs text-gray-500">Required for ZATCA invoicing.</p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label="Building Number"
                      value={bldg}
                      onChange={e => setBldg(e.target.value)}
                      helperText="4-digit building number from your Saudi National Address. Use leading zeros e.g. 0056."
                      error={fieldErr('bldg') || undefined}
                    />
                    <Input
                      label="Street Name"
                      value={street}
                      onChange={e => setStreet(e.target.value)}
                      error={fieldErr('street') || undefined}
                    />
                    <Input
                      label="District"
                      value={district}
                      onChange={e => setDistrict(e.target.value)}
                      helperText="Neighbourhood or district name as in your registered address."
                      error={fieldErr('district') || undefined}
                    />
                    <Input
                      label="City"
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      error={fieldErr('city') || undefined}
                    />
                    <Input
                      label="Postal Code"
                      value={postal}
                      onChange={e => setPostal(e.target.value)}
                      helperText="5-digit postal code from your Saudi National Address document."
                      error={fieldErr('postal') || undefined}
                    />
                    <Input
                      label="Phone Number"
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="+966 5x xxx xxxx"
                      icon={Phone}
                    />
                  </div>
                </section>

                <section>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                      <KeyRound size={16} />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-gray-950">Branch login</h3>
                      <p className="text-xs text-gray-500">
                        Create the login for this branch&apos;s POS terminal. Share these credentials directly with your staff.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <Input
                      label="Branch username"
                      type="text"
                      value={loginUsername}
                      onChange={e => setLoginUsername(normalizeBranchUsernameInput(e.target.value))}
                      placeholder="main_counter"
                      helperText={BRANCH_USERNAME_HELPER_TEXT}
                      autoComplete="username"
                      icon={UserRound}
                      error={fieldErr('loginUsername') || undefined}
                      required
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="Password"
                        type="password"
                        value={loginPwd}
                        onChange={e => setLoginPwd(e.target.value)}
                        placeholder="Min. 8 characters"
                        error={fieldErr('loginPwd') || undefined}
                        required
                      />
                      <Input
                        label="Confirm Password"
                        type="password"
                        value={loginConfirm}
                        onChange={e => setLoginConfirm(e.target.value)}
                        placeholder="Repeat password"
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
                  You can edit branch details and add more branches later.
                </p>
                <Button type="submit" variant="gold" loading={saving} disabled={saving} className="justify-center px-5">
                  Create Branch &amp; Get Started
                  {!saving && <ArrowRight size={15} />}
                </Button>
              </div>
            </div>
          </form>

          <aside className="rounded-[28px] border border-[#E8DFC9] bg-[#F3EAD7] p-6 shadow-card lg:sticky lg:top-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0F2419] text-gold-300">
              <Building2 size={20} />
            </div>
            <h2 className="mt-5 text-lg font-black text-[#10291E]">Branch details</h2>
            <p className="mt-2 text-sm leading-6 text-[#4D5B50]">
              Use the registered branch information from your VAT certificate, commercial registration, and Saudi National Address.
            </p>
            <div className="mt-6 rounded-2xl border border-[#E3D5B8] bg-white/60 p-4">
              <p className="text-xs font-bold text-[#10291E]">Good to know</p>
              <p className="mt-1 text-[11px] leading-5 text-[#5B6259]">
                Each branch needs its own CR number and address. The branch login is for POS staff access.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
