export function selectZatcaBranchCheckoutMode(input) {
  const v2Ready = input?.compatible === true
    && input?.globalMasterEnabled === true
    && input?.simplifiedEnabled === true
    && input?.edgeExecutionEnabled === true
    && input?.clientAcknowledged === true
    && input?.chainHeadExists === true
    && input?.branchReady === true
    && input?.branchBlocked !== true
    && input?.productionConnected === true

  return v2Ready ? 'v2' : 'legacy'
}

export function isZatcaBranchStructurallyReady(input) {
  return input?.chainHeadExists === true
    && input?.branchReady === true
    && input?.branchBlocked !== true
    && input?.productionConnected === true
}
