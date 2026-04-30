/**
 * zatca-submit Edge Function
 *
 * Submits a signed invoice to ZATCA:
 *   - Simplified invoices → POST /invoices/reporting/single
 *   - Standard invoices   → POST /invoices/clearance/single
 *
 * Reads production CSID + secret from DB (never from browser).
 *
 * POST /functions/v1/zatca-submit
 * Body: { invoiceId, signedXml, invoiceHash, uuid, invoiceType, branchId }
 * Returns: ZatcaSubmitResponse
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ZATCA_BASE = Deno.env.get('ZATCA_API_BASE')
  ?? 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ZatcaSubmitResponse {
  status:           'REPORTED' | 'CLEARED' | 'NOT_REPORTED' | 'ERROR'
  submissionId?:    string
  warnings?:        string[]
  errors?:          string[]
  clearanceStatus?: string
  reportingStatus?: string
  zatcaResponse?:   Record<string, unknown>
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

    const { invoiceId, signedXml, invoiceHash, uuid, invoiceType, branchId } = await req.json()
    if (!invoiceId || !signedXml || !invoiceHash || !uuid || !invoiceType || !branchId) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Load production credentials from DB
    const { data: cert, error: certErr } = await supabase
      .from('zatca_certificates')
      .select('production_csid, production_secret')
      .eq('branch_id', branchId)
      .eq('status', 'active')
      .single()

    if (certErr || !cert?.production_csid || !cert?.production_secret) {
      return new Response(JSON.stringify({ error: 'No active production certificate found for this branch.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const credentials = btoa(`${cert.production_csid}:${cert.production_secret}`)
    const isSimplified = invoiceType === 'simplified'

    // Encode XML to base64 for ZATCA API
    const xmlB64 = btoa(unescape(encodeURIComponent(signedXml)))

    // Choose endpoint: reporting (simplified) or clearance (standard)
    const endpoint = isSimplified
      ? `${ZATCA_BASE}/invoices/reporting/single`
      : `${ZATCA_BASE}/invoices/clearance/single`

    const zatcaRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'accept':                    'application/json',
        'accept-version':            'V2',
        'Content-Type':              'application/json',
        'Authorization':             `Basic ${credentials}`,
        'Clearance-Status':          isSimplified ? undefined! : '1',
      },
      body: JSON.stringify({
        invoiceHash,
        uuid,
        invoice: xmlB64,
      }),
    })

    const zatcaBody = await zatcaRes.json().catch(() => ({}))

    if (!zatcaRes.ok && zatcaRes.status !== 400) {
      console.error('[zatca-submit] ZATCA HTTP error:', zatcaRes.status, zatcaBody)
      const response: ZatcaSubmitResponse = {
        status:        'ERROR',
        errors:        [zatcaBody?.errors?.[0]?.message ?? `ZATCA returned ${zatcaRes.status}`],
        zatcaResponse: zatcaBody,
      }
      return new Response(JSON.stringify(response), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Map ZATCA response to our internal format
    const reportingStatus  = zatcaBody?.reportingStatus  as string | undefined
    const clearanceStatus  = zatcaBody?.clearanceStatus  as string | undefined
    const submissionId     = zatcaBody?.submissionId     as string | undefined
    const warnings         = (zatcaBody?.warnings  ?? []) as string[]
    const errors           = (zatcaBody?.errors    ?? []) as string[]

    let status: ZatcaSubmitResponse['status']
    if (isSimplified) {
      status = reportingStatus === 'REPORTED' ? 'REPORTED' : 'NOT_REPORTED'
    } else {
      status = clearanceStatus === 'CLEARED' ? 'CLEARED' : 'NOT_REPORTED'
    }
    if (errors.length > 0) status = 'ERROR'

    const response: ZatcaSubmitResponse = {
      status,
      submissionId,
      warnings:        warnings.length > 0 ? warnings : undefined,
      errors:          errors.length   > 0 ? errors   : undefined,
      clearanceStatus,
      reportingStatus,
      zatcaResponse:   zatcaBody,
    }

    return new Response(JSON.stringify(response), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    console.error('[zatca-submit] unexpected error:', err)
    return new Response(JSON.stringify({ error: err.message ?? 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
