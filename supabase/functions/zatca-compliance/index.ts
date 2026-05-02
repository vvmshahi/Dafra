/**
 * zatca-compliance Edge Function
 *
 * Proxies the ZATCA Compliance CSID registration call.
 * Keeps ZATCA sandbox/production credentials server-side.
 *
 * POST /functions/v1/zatca-compliance
 * Body: { csr: string, otp: string, branchId: string, environment?: 'sandbox' | 'production' }
 * Returns: { binarySecurityToken, secret, requestID }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ZATCA_URLS: Record<string, string> = {
  sandbox:    'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
}

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Auth — require valid Supabase JWT
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { csr, otp, branchId, environment } = await req.json()
    if (!csr || !otp || !branchId) {
      return new Response(JSON.stringify({ error: 'Missing required fields: csr, otp, branchId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const env     = environment === 'production' ? 'production' : 'sandbox'
    const baseUrl = ZATCA_URLS[env]
    const url     = `${baseUrl}/compliance`

    // ZATCA expects the full PEM (with headers) base64-encoded as the csr field value
    // e.g. btoa("-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----")
    const csrBase64 = btoa(csr)

    const requestBody = JSON.stringify({ csr: csrBase64 })
    const requestHeaders = {
      'accept':           'application/json',
      'accept-version':   'V2',
      'accept-language':  'en',
      'Content-Type':     'application/json',
      'OTP':              otp,
    }

    console.log('[zatca-compliance] env:', env)
    console.log('[zatca-compliance] url:', url)
    console.log('[zatca-compliance] otp:', otp)
    console.log('[zatca-compliance] headers:', JSON.stringify(requestHeaders))
    console.log('[zatca-compliance] csr length (raw):', csr.length)
    console.log('[zatca-compliance] csr base64 length (btoa):', csrBase64.length)
    console.log('[zatca-compliance] csr base64 preview:', csrBase64.substring(0, 80) + '…')
    console.log('[zatca-compliance] request body length:', requestBody.length)

    // Call ZATCA Compliance API
    const zatcaRes = await fetch(url, {
      method:  'POST',
      headers: requestHeaders,
      body:    requestBody,
    })

    const responseText = await zatcaRes.text()
    console.log('[zatca-compliance] ZATCA response status:', zatcaRes.status)
    console.log('[zatca-compliance] ZATCA response headers:', JSON.stringify(Object.fromEntries(zatcaRes.headers.entries())))
    console.log('[zatca-compliance] ZATCA response body:', responseText)

    let zatcaBody: any
    try {
      zatcaBody = JSON.parse(responseText)
    } catch {
      return new Response(JSON.stringify({ error: `ZATCA returned non-JSON (${zatcaRes.status}): ${responseText}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!zatcaRes.ok) {
      const msg = zatcaBody?.errors?.[0]?.message
             ?? zatcaBody?.message
             ?? zatcaBody?.error
             ?? `ZATCA compliance request failed (${zatcaRes.status})`
      return new Response(JSON.stringify({ error: msg, zatcaBody }), {
        status: zatcaRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Store compliance credentials in zatca_certificates
    const { binarySecurityToken, secret, requestID } = zatcaBody

    // Fetch tenant_id from branches — required NOT NULL column on zatca_certificates
    const { data: branch } = await supabase
      .from('branches')
      .select('tenant_id')
      .eq('id', branchId)
      .single()

    const { error: upsertErr } = await supabase
      .from('zatca_certificates')
      .upsert({
        branch_id:               branchId,
        tenant_id:               branch?.tenant_id,
        compliance_csid:         binarySecurityToken,
        compliance_secret:       secret,
        compliance_request_id:   requestID,
        status:                  'compliance',
        environment:             env,
        created_at:              new Date().toISOString(),
      }, { onConflict: 'branch_id,environment' })

    if (upsertErr) {
      console.error('[zatca-compliance] DB upsert error:', upsertErr)
    }

    return new Response(JSON.stringify({ binarySecurityToken, secret, requestID }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    console.error('[zatca-compliance] unexpected error:', err)
    return new Response(JSON.stringify({ error: err.message ?? 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
