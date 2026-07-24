const rejectedState = value =>
  /(?:rejected|blocked|reporting_failed)/i.test(String(value ?? ''))

const reconciliationState = value =>
  /reconciliation/i.test(String(value ?? ''))

const clearanceFailureState = value =>
  /(?:clearance_failed|finalization_failed|rejected|blocked)/i.test(String(value ?? ''))

export function creditNotePresentationState(input) {
  const artifactStage = String(input?.artifactStage ?? '')
  const finalizationStatus = String(input?.finalizationStatus ?? '')
  const invoiceStatus = String(input?.invoiceStatus ?? '')
  const reportingDisplayState = String(input?.reportingDisplayState ?? '')
  const documentKind = input?.documentKind === 'standard'
      || artifactStage.startsWith('standard_')
    ? 'standard'
    : 'simplified'

  if (documentKind === 'standard') {
    const cleared = input?.canPrint === true
      && invoiceStatus === 'cleared'
      && (
        artifactStage === 'standard_cleared'
        || artifactStage === 'legacy_final'
        || /cleared_final|legacy_cleared/.test(finalizationStatus)
      )
    if (cleared) {
      return {
        documentKind,
        state: 'cleared',
        tone: 'success',
        headingKey: 'creditNotes:createdAndCleared',
        messageKey: null,
        statusKey: 'creditNotes:clearedByZatca',
        printAllowed: true,
        localCreationAcknowledged: true,
        finalSuccess: true,
      }
    }

    const failed = clearanceFailureState(finalizationStatus)
      || clearanceFailureState(reportingDisplayState)
      || invoiceStatus === 'failed'
    if (failed) {
      return {
        documentKind,
        state: input?.retryAvailable === true ? 'clearance_retryable' : 'clearance_failed',
        tone: 'error',
        headingKey: 'creditNotes:clearanceFailed',
        messageKey: input?.retryAvailable === true
          ? 'creditNotes:clearanceFailedRetryable'
          : 'creditNotes:clearanceFailedReview',
        statusKey: null,
        printAllowed: false,
        localCreationAcknowledged: true,
        finalSuccess: false,
      }
    }

    return {
      documentKind,
      state: 'clearance_pending',
      tone: 'progress',
      headingKey: 'creditNotes:waitingForClearance',
      messageKey: 'creditNotes:availableAfterClearance',
      statusKey: null,
      printAllowed: false,
      localCreationAcknowledged: true,
      finalSuccess: false,
    }
  }

  const printAllowed = input?.canPrint === true
    && artifactStage !== 'standard_provisional'
  if (input?.reconciliationRequired === true
      || reconciliationState(reportingDisplayState)
      || reconciliationState(finalizationStatus)) {
    return {
      documentKind,
      state: 'reconciliation_required',
      tone: 'warning',
      headingKey: 'creditNotes:created',
      messageKey: 'creditNotes:reportingRequiresReconciliation',
      statusKey: null,
      printAllowed,
      localCreationAcknowledged: true,
      finalSuccess: true,
    }
  }
  if (rejectedState(reportingDisplayState)
      || rejectedState(finalizationStatus)
      || invoiceStatus === 'failed') {
    return {
      documentKind,
      state: 'reporting_rejected',
      tone: 'warning',
      headingKey: 'creditNotes:created',
      messageKey: 'creditNotes:reportingRejected',
      statusKey: null,
      printAllowed,
      localCreationAcknowledged: true,
      finalSuccess: true,
    }
  }
  if (invoiceStatus === 'reported'
      || reportingDisplayState === 'reported'
      || finalizationStatus === 'reported') {
    return {
      documentKind,
      state: 'reported',
      tone: 'success',
      headingKey: 'creditNotes:created',
      messageKey: null,
      statusKey: 'creditNotes:reportedToZatca',
      printAllowed,
      localCreationAcknowledged: true,
      finalSuccess: true,
    }
  }
  return {
    documentKind,
    state: 'reporting_pending',
    tone: 'success',
    headingKey: 'creditNotes:created',
    messageKey: 'creditNotes:reportingContinuesAutomatically',
    statusKey: null,
    printAllowed,
    localCreationAcknowledged: true,
    finalSuccess: true,
  }
}
