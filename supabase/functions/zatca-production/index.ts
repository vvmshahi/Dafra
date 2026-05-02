/**
 * zatca-production Edge Function
 *
 * Converts a Compliance CSID into a Production CSID.
 * Reads compliance credentials and environment from DB so they never touch the browser.
 *
 * POST /functions/v1/zatca-production
 * Body: { branchId: string }
 * Returns: { binarySecurityToken, secret }
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

    const { branchId } = await req.json()
    if (!branchId) {
      return new Response(JSON.stringify({ error: 'Missing required field: branchId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Load compliance credentials and environment from DB
    const { data: cert, error: certErr } = await supabase
      .from('zatca_certificates')
      .select('compliance_csid, compliance_secret, compliance_request_id, environment')
      .eq('branch_id', branchId)
      .single()

    if (certErr || !cert?.compliance_csid || !cert?.compliance_secret || !cert?.compliance_request_id) {
      return new Response(JSON.stringify({ error: 'No compliance CSID found for this branch. Complete Step 2 first.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const env     = cert.environment === 'production' ? 'production' : 'sandbox'
    const baseUrl = ZATCA_URLS[env]

    // Basic Auth header = base64(compliance_csid:compliance_secret)
    const credentials = btoa(`${cert.compliance_csid}:${cert.compliance_secret}`)

    // Call ZATCA Production CSID API
    const zatcaRes = await fetch(`${baseUrl}/production/csids`, {
      method: 'POST',
      headers: {
        'accept':           'application/json',
        'accept-version':   'V2',
        'Content-Type':     'application/json',
        'Authorization':    `Basic ${credentials}`,
      },
      body: JSON.stringify({ compliance_request_id: cert.compliance_request_id }),
    })

    const zatcaBody = await zatcaRes.json()

    if (!zatcaRes.ok) {
      console.error('[zatca-production] ZATCA error:', zatcaBody)
      return new Response(JSON.stringify({ error: zatcaBody?.errors?.[0]?.message ?? 'ZATCA production CSID request failed' }), {
        status: zatcaRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { binarySecurityToken, secret } = zatcaBody

    // Update certificate record to active production status
    const { error: updateErr } = await supabase
      .from('zatca_certificates')
      .update({
        production_csid:   binarySecurityToken,
        production_secret: secret,
        status:            'active',
        activated_at:      new Date().toISOString(),
      })
      .eq('branch_id', branchId)

    if (updateErr) {
      console.error('[zatca-production] DB update error:', updateErr)
    }

    return new Response(JSON.stringify({ binarySecurityToken, secret }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    console.error('[zatca-production] unexpected error:', err)
    return new Response(JSON.stringify({ error: err.message ?? 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
