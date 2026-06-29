interface ComplianceResponse {
  binarySecurityToken: string
  secret: string
  requestID: string
}

interface ProductionResponse {
  binarySecurityToken: string
  secret: string
}

interface ZatcaResponseTrace {
  httpStatus: number
}

function safeZatcaMessage(body: any, fallback: string): string {
  const msg = body?.errors?.[0]?.message ?? body?.message ?? body?.error
  return typeof msg === 'string' && msg.length <= 240 ? msg : fallback
}

async function parseZatcaResponse(res: Response, fallback: string): Promise<any> {
  const text = await res.text()
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`${fallback} (${res.status})`)
  }
  if (!res.ok) throw new Error(safeZatcaMessage(body, `${fallback} (${res.status})`))
  return body
}

export async function requestComplianceCsid(params: {
  baseUrl: string
  csrPem: string
  otp: string
  onResponse?: (trace: ZatcaResponseTrace) => void
}): Promise<ComplianceResponse> {
  const res = await fetch(`${params.baseUrl}/compliance`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'accept-version': 'V2',
      'accept-language': 'en',
      'Content-Type': 'application/json',
      OTP: params.otp,
    },
    body: JSON.stringify({ csr: btoa(params.csrPem) }),
  })

  params.onResponse?.({ httpStatus: res.status })
  const body = await parseZatcaResponse(res, 'ZATCA compliance request failed')
  if (!body?.binarySecurityToken || !body?.secret || !body?.requestID) {
    throw new Error('ZATCA compliance response was missing required fields')
  }
  return body as ComplianceResponse
}

export async function requestProductionCsid(params: {
  baseUrl: string
  complianceCsid: string
  complianceSecret: string
  complianceRequestId: string
  onResponse?: (trace: ZatcaResponseTrace) => void
}): Promise<ProductionResponse> {
  const credentials = btoa(`${params.complianceCsid}:${params.complianceSecret}`)
  const res = await fetch(`${params.baseUrl}/production/csids`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'accept-version': 'V2',
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({ compliance_request_id: params.complianceRequestId }),
  })

  params.onResponse?.({ httpStatus: res.status })
  const body = await parseZatcaResponse(res, 'ZATCA production CSID request failed')
  if (!body?.binarySecurityToken || !body?.secret) {
    throw new Error('ZATCA production response was missing required fields')
  }
  return body as ProductionResponse
}
