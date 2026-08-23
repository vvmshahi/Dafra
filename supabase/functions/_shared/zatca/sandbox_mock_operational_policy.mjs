// The Developer Portal Integration Sandbox 2.1.0 currently returns this
// documented mock Production-CSID certificate for the Sandbox VAT fixture.
// It is an operational HTTP-auth credential, not the branch signing identity.
export const SANDBOX_210_OFFICIAL_MOCK_OPERATIONAL_CERTIFICATE = Object.freeze({
  release: 'integration_sandbox_2_1_0',
  spkiSha256: '54f60513569c656c93d0818103368442b6ff9b95d5d7078c0bceef3a45dd8682',
})

/**
 * Keeps the bounded Sandbox exception separate from all certificate parsing
 * and from Production credential rules. A mismatched operational certificate
 * is accepted only when Sandbox identity/VAT checks pass and it is the known
 * 2.1.0 mock. A future unknown mismatch fails closed.
 */
export function classifySandboxOperationalCertificatePolicy(input) {
  const environment = input?.environment
  const signingKeyMatchesCsr = input?.privateKeyEqualsCsr === true
  const operationalKeyMatchesCsr = input?.privateKeyEqualsProductionCertificate === true &&
    input?.csrEqualsProductionCertificate === true
  const vatParity = input?.csrVatEqualsBranch === true &&
    input?.productionCertificateVatEqualsCsr === true &&
    input?.productionCertificateVatEqualsBranch === true
  const knownMock = environment === 'sandbox' &&
    signingKeyMatchesCsr &&
    vatParity &&
    !operationalKeyMatchesCsr &&
    input?.productionCertificateSpkiFingerprint === SANDBOX_210_OFFICIAL_MOCK_OPERATIONAL_CERTIFICATE.spkiSha256

  const classification = environment !== 'sandbox'
    ? 'sandbox_operational_certificate_environment_invalid'
    : !signingKeyMatchesCsr || !vatParity
      ? 'sandbox_operational_certificate_identity_invalid'
      : operationalKeyMatchesCsr
        ? 'sandbox_csr_bound_operational_certificate'
        : knownMock
          ? 'sandbox_mock_operational_certificate'
          : 'sandbox_operational_certificate_unrecognized'

  return {
    classification,
    productionCertificateSpkiFingerprint: input?.productionCertificateSpkiFingerprint ?? null,
    knownMock,
    knownMockRelease: knownMock ? SANDBOX_210_OFFICIAL_MOCK_OPERATIONAL_CERTIFICATE.release : null,
    signingKeyMatchesCsr,
    operationalKeyMatchesCsr,
    vatParity,
    acceptsSandboxOperationalCredential: environment === 'sandbox' &&
      signingKeyMatchesCsr &&
      vatParity &&
      (operationalKeyMatchesCsr || knownMock),
  }
}
