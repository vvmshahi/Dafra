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

    // Call ZATCA Compliance API
    const zatcaRes = await fetch(`${baseUrl}/compliance`, {
      method: 'POST',
      headers: {
        'accept':           'application/json',
        'accept-version':   'V2',
        'Content-Type':     'application/json',
        'OTP':              otp,
      },
      body: JSON.stringify({
        csr: csr
          .replace('-----BEGIN CERTIFICATE REQUEST-----', '')
          .replace('-----END CERTIFICATE REQUEST-----', '')
          .replace(/\s/g, ''),
      }),
    })

    const zatcaBody = await zatcaRes.json()

    if (!zatcaRes.ok) {
      console.error('[zatca-compliance] ZATCA error:', zatcaBody)
      return new Response(JSON.stringify({ error: zatcaBody?.errors?.[0]?.message ?? 'ZATCA compliance request failed' }), {
        status: zatcaRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Store compliance credentials in zatca_certificates
    const { binarySecurityToken, secret, requestID } = zatcaBody

    const { error: upsertErr } = await supabase
      .from('zatca_certificates')
      .upsert({
        branch_id:               branchId,
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
