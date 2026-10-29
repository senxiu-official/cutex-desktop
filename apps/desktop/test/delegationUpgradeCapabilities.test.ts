import { describe, expect, it } from "vitest";
import { delegationUpgradeCapabilities } from "../src/renderer/src/modules/delegations/upgradeCapabilities";

const disabled = { treeStop: false, routing: false, runControl: false, continuation: false, activity: false, retirement: false };

describe("delegation upgrade capabilities", () => {
  it.each([undefined, null, []])("disables every upgrade when capabilities are missing (%j)", (capabilities) => {
    expect(delegationUpgradeCapabilities(capabilities)).toEqual(disabled);
  });

  it.each([
    ["delegation-tree-stop-v1", "treeStop"],
    ["delegation-routing-v1", "routing"],
    ["project-run-control-v1", "runControl"],
    ["delegation-continuation-v1", "continuation"],
    ["agent-activity-v1", "activity"],
    ["agent-archive-kind-v1", "retirement"],
    ["agentArchiveKindV1", "retirement"],
  ] as const)("enables only its own upgrade for %s", (capability, key) => {
    expect(delegationUpgradeCapabilities([capability])).toEqual({ ...disabled, [key]: true });
  });

  it("recognizes a mixed readonly list without changing it", () => {
    const capabilities = Object.freeze(["unrelated-v1", "agent-activity-v1", "delegation-routing-v1", "agent-activity-v1"]);
    expect(delegationUpgradeCapabilities(capabilities)).toEqual({ ...disabled, routing: true, activity: true, retirement: false });
    expect(capabilities).toEqual(["unrelated-v1", "agent-activity-v1", "delegation-routing-v1", "agent-activity-v1"]);
  });

  it("enables all five upgrades when all are advertised", () => {
    expect(delegationUpgradeCapabilities([
      "delegation-tree-stop-v1", "delegation-routing-v1", "project-run-control-v1",
      "delegation-continuation-v1", "agent-activity-v1",
    ])).toEqual({ treeStop: true, routing: true, runControl: true, continuation: true, activity: true, retirement: false });
  });

  it("ignores unknown names, other versions and inexact matches", () => {
    expect(delegationUpgradeCapabilities([
      "unrelated-v1", "delegation-tree-stop-v2", "delegation-routing",
      "project-run-control-v10", "delegation-continuation-v1-extra",
      "AGENT-ACTIVITY-V1", " agent-activity-v1", "agent-activity-v1 ",
    ])).toEqual(disabled);
  });
});
