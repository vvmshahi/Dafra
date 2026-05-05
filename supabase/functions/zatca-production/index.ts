/**
 * zatca-production Edge Function
 *
 * Converts a Compliance CSID into a Production CSID.
 * Reads compliance credentials and environment from DB so they never touch the browser.
 *
 * POST /functions/v1/zatca-production
 * Body: { branchId: string, environment: 'sandbox' | 'production' }
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
    return new Response('ok', { status: 200, headers: corsHeaders })
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

    const body = await req.json()
    const { branchId, environment } = body
    if (!branchId) {
      return new Response(JSON.stringify({ error: 'Missing required field: branchId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const env = environment === 'production' ? 'production' : 'sandbox'

    const [{ data: callerProfile }, { data: branch }] = await Promise.all([
      supabase.from('user_profiles').select('tenant_id').eq('id', user.id).maybeSingle(),
      supabase.from('branches').select('tenant_id').eq('id', branchId).maybeSingle(),
    ])

    if (!branch || !callerProfile || branch.tenant_id !== callerProfile.tenant_id) {
      return new Response(JSON.stringify({ error: 'Branch not found or access denied' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Load compliance credentials filtered by branch AND environment
    const { data: cert, error: certErr } = await supabase
      .from('zatca_certificates')
      .select('id, compliance_csid, compliance_secret, compliance_request_id, environment')
      .eq('branch_id', branchId)
      .eq('environment', env)
      .maybeSingle()

    console.log('[zatca-production] branchId:', branchId, 'env:', env)
    console.log('[zatca-production] cert query error:', certErr ? JSON.stringify(certErr) : 'none')
    console.log('[zatca-production] cert found:', cert ? 'yes' : 'no')
    console.log('[zatca-production] compliance_csid present:', !!cert?.compliance_csid)
    console.log('[zatca-production] compliance_secret present:', !!cert?.compliance_secret)
    console.log('[zatca-production] compliance_request_id present:', !!cert?.compliance_request_id)

    if (certErr || !cert?.compliance_csid || !cert?.compliance_secret || !cert?.compliance_request_id) {
      const detail = certErr ? JSON.stringify(certErr) : 'compliance fields missing on cert row'
      return new Response(JSON.stringify({
        error: 'No compliance certificate found for this branch/environment. Complete Step 2 first.',
        detail,
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const baseUrl = ZATCA_URLS[env]

    // Basic Auth header = base64(compliance_csid:compliance_secret)
    const credentials = btoa(`${cert.compliance_csid}:${cert.compliance_secret}`)

    console.log('[zatca-production] calling ZATCA url:', `${baseUrl}/production/csids`)
    console.log('[zatca-production] compliance_request_id:', cert.compliance_request_id)

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
    console.log('[zatca-production] ZATCA status:', zatcaRes.status)
    console.log('[zatca-production] ZATCA response:', JSON.stringify(zatcaBody))

    if (!zatcaRes.ok) {
      console.error('[zatca-production] ZATCA error:', zatcaBody)
      return new Response(JSON.stringify({
        error: zatcaBody?.errors?.[0]?.message ?? 'ZATCA production certificate request failed',
        zatcaBody,
      }), {
        status: zatcaRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { binarySecurityToken, secret } = zatcaBody

    // Update only the matching branch+environment cert row
    const { error: updateErr } = await supabase
      .from('zatca_certificates')
      .update({
        production_csid:   binarySecurityToken,
        production_secret: secret,
        status:            'active',
        activated_at:      new Date().toISOString(),
      })
      .eq('branch_id', branchId)
      .eq('environment', env)

    if (updateErr) {
      console.error('[zatca-production] DB update error:', JSON.stringify(updateErr))
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
