export interface DelegationUpgradeCapabilities {
  treeStop: boolean;
  routing: boolean;
  runControl: boolean;
  continuation: boolean;
  activity: boolean;
  retirement: boolean;
}

/** Recognize only explicitly advertised capabilities; each upgrade is independent. */
export function delegationUpgradeCapabilities(capabilities: readonly string[] | null | undefined): DelegationUpgradeCapabilities {
  return {
    treeStop: capabilities?.includes("delegation-tree-stop-v1") ?? false,
    routing: capabilities?.includes("delegation-routing-v1") ?? false,
    runControl: capabilities?.includes("project-run-control-v1") ?? false,
    continuation: capabilities?.includes("delegation-continuation-v1") ?? false,
    activity: capabilities?.includes("agent-activity-v1") ?? false,
    retirement: capabilities?.some(value => value === "agent-archive-kind-v1" || value === "agentArchiveKindV1") ?? false,
  };
}
