export function parseImmutableFinalizationEdgeSwitch(rawValue) {
  const edgeExecutionEnabled = rawValue === 'true'
  return {
    edgeExecutionEnabled,
    edgeKillSwitchEnabled: !edgeExecutionEnabled,
  }
}

export function resolveAtomicSimplifiedCheckoutCapability(base, rollout) {
  const databaseFeatureEnabled = base?.databaseFeatureEnabled === true
    && base?.simplifiedEnabled === true
    && rollout?.atomicSimplifiedCheckoutEnabled === true
    && rollout?.branchGateEnabled === true
  const edgeExecutionEnabled = base?.edgeKillSwitchEnabled === false

  return {
    ...base,
    databaseFeatureEnabled,
    simplifiedEnabled: databaseFeatureEnabled,
    immutableFinalizationEnabled: base?.compatible === true
      && databaseFeatureEnabled
      && edgeExecutionEnabled,
  }
}
