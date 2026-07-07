import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useSubscription } from '@/hooks/useSubscription'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { MeemLogo } from '@/components/MeemLogo'
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
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Dark header */}
      <div className="bg-[#0F2419] px-6 py-8">
        <div className="flex justify-center mb-8">
          <MeemLogo size="lg" />
        </div>

        <div className="text-center">
          <h1 className="text-2xl font-black text-white">Set Up Your First Branch</h1>
          <p className="text-white/50 text-sm mt-1.5">
            Create your first branch to start using Kubri. This takes less than 2 minutes.
          </p>
          {profile?.full_name && (
            <p className="text-white/30 text-xs mt-2">Welcome, {profile.full_name}</p>
          )}
        </div>
      </div>

      {/* Form card */}
      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
          <form onSubmit={handleSubmit}>
            <div className="p-8 space-y-6">

              {/* Info note */}
              <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                <span className="text-blue-500 flex-shrink-0 mt-0.5 text-sm">ℹ️</span>
                <p className="text-[11px] text-blue-700 leading-relaxed">
                  Each branch requires its own CR number and address. The Company Name and VAT number are shared across all your branches.
                </p>
              </div>

              {/* Branch identity */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Branch Identity</p>
                <Input
                  label="Branch Name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
                {fieldErr('name') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('name')}</p>}

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <Input
                      label="VAT Registration Number"
                      value={vat}
                      onChange={e => setVat(e.target.value)}
                      maxLength={15}
                      helperText="From your VAT Registration Certificate. Must be 15 digits starting and ending with 3."
                      required
                    />
                    {fieldErr('vat') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('vat')}</p>}
                  </div>
                  <div>
                    <Input
                      label="CR / License Number"
                      value={cr}
                      onChange={e => setCr(e.target.value)}
                      helperText="Commercial Registration number for this specific branch. Each branch has its own CR."
                      required
                    />
                    {fieldErr('cr') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('cr')}</p>}
                  </div>
                </div>
              </div>

              {/* Address */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                  Branch Address <span className="text-red-400">· Required for ZATCA invoicing</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Input
                      label="Building Number"
                      value={bldg}
                      onChange={e => setBldg(e.target.value)}
                      helperText="4-digit building number from your Saudi National Address (العنوان الوطني). Use leading zeros e.g. 0056"
                    />
                    {fieldErr('bldg') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('bldg')}</p>}
                  </div>
                  <div>
                    <Input
                      label="Street Name"
                      value={street}
                      onChange={e => setStreet(e.target.value)}
                    />
                    {fieldErr('street') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('street')}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <Input
                      label="District"
                      value={district}
                      onChange={e => setDistrict(e.target.value)}
                      helperText="Neighbourhood or district name as in your registered address."
                    />
                    {fieldErr('district') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('district')}</p>}
                  </div>
                  <div>
                    <Input
                      label="City"
                      value={city}
                      onChange={e => setCity(e.target.value)}
                    />
                    {fieldErr('city') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('city')}</p>}
                  </div>
                </div>
                <div className="mt-3">
                  <Input
                    label="Postal Code"
                    value={postal}
                    onChange={e => setPostal(e.target.value)}
                    helperText="5-digit postal code from your Saudi National Address document."
                  />
                  {fieldErr('postal') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('postal')}</p>}
                </div>
              </div>

              {/* Contact */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Contact (Optional)</p>
                <Input
                  label="Phone Number"
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+966 5x xxx xxxx"
                />
              </div>

              {/* Branch Login */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Branch Login</p>
                <p className="text-xs text-gray-400 mb-3">
                  Create the login for this branch's POS terminal. No email is sent — share these credentials directly with your staff.
                </p>
                <div className="space-y-3">
                  <div>
                    <Input
                      label="Branch username"
                      type="text"
                      value={loginUsername}
                      onChange={e => setLoginUsername(normalizeBranchUsernameInput(e.target.value))}
                      placeholder="main_counter"
                      helperText={BRANCH_USERNAME_HELPER_TEXT}
                      autoComplete="username"
                      required
                    />
                    {fieldErr('loginUsername') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('loginUsername')}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Input
                        label="Password"
                        type="password"
                        value={loginPwd}
                        onChange={e => setLoginPwd(e.target.value)}
                        placeholder="Min. 8 characters"
                        required
                      />
                      {fieldErr('loginPwd') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('loginPwd')}</p>}
                    </div>
                    <div>
                      <Input
                        label="Confirm Password"
                        type="password"
                        value={loginConfirm}
                        onChange={e => setLoginConfirm(e.target.value)}
                        placeholder="Repeat password"
                        required
                      />
                      {fieldErr('loginConfirm') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('loginConfirm')}</p>}
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3 rounded-xl">
                  <span className="text-red-400 flex-shrink-0">⚠</span> {error}
                </div>
              )}
            </div>

            <div className="px-8 py-5 border-t border-gray-100 bg-gray-50">
              <Button type="submit" loading={saving} disabled={saving} className="w-full justify-center">
                Create Branch &amp; Get Started
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* Sign out — small, at very bottom */}
      <div className="pb-6 text-center">
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
