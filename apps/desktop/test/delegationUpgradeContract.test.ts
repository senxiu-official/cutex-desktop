import { describe, expect, it } from "vitest";
import { createUpgradeMock } from "../src/renderer/src/modules/delegations/mock";
import { isUpgradeSnapshotComplete, panelSnapshotOf } from "../src/renderer/src/modules/delegations/upgradeContract";

const seed = async () => panelSnapshotOf(await createUpgradeMock("host").delegationUpgradeSnapshot("project"));
describe("draft v2 preview contract gate", () => {
  it("accepts the complete mock shape without inferring permissions", async () => {
    expect(isUpgradeSnapshotComplete(await seed())).toBe(true);
  });
  it("rejects a missing node action even if stop is true", async () => {
    const snapshot = await seed();
    const normal = snapshot.nodes.find(node => node.kind === "delegation")!;
    Reflect.deleteProperty(normal.allowedActions, "stopSelf");
    expect(isUpgradeSnapshotComplete(snapshot)).toBe(false);
  });
  it("rejects incomplete grant actions rather than borrowing policy.update", async () => {
    const snapshot = await seed();
    Reflect.deleteProperty(snapshot.grants.allowedActions, "create");
    expect(isUpgradeSnapshotComplete(snapshot)).toBe(false);
  });
  it("distinguishes Session lifecycle arrays from caller-aware boolean maps", async () => {
    const snapshot = await seed();
    expect(isUpgradeSnapshotComplete({ ...snapshot, members: [{ ...snapshot.members[0], allowedActions: { restore: true } }] })).toBe(false);
  });
  it("accepts only the six-field restricted-ancestor shape", async () => {
    const snapshot = await seed();
    const placeholder = { kind: "redactedAncestor", placeholderId: "edge-only", labelKey: "delegation.ancestorRestricted", reason: "notVisible", expandable: false, allowedActions: {} };
    expect(isUpgradeSnapshotComplete({ ...snapshot, nodes: [placeholder] })).toBe(true);
    for (const extra of [{ hostId: "hidden" }, { title: "secret" }, { depth: 3 }, { hiddenCount: 9 }]) {
      expect(isUpgradeSnapshotComplete({ ...snapshot, nodes: [{ ...placeholder, ...extra }] })).toBe(false);
    }
  });
  it("does not permit a redacted relation to expose its parent identity", async () => {
    const snapshot = await seed();
    const normal = snapshot.nodes.find(node => node.kind === "delegation")!;
    expect(isUpgradeSnapshotComplete({ ...snapshot, nodes: [{ ...normal, parentState: "redacted", redactedParent: true, parent: { hostId: "hidden", id: "hidden" }, redactedParentRef: { placeholderId: "edge" } }] })).toBe(false);
  });
  it("requires legacy fields to stay null for visible cross-host references", async () => {
    const snapshot = await seed();
    const normal = snapshot.nodes.find(node => node.kind === "delegation")!;
    const cross = { ...normal, parentState: "visible", parent: { hostId: "remote", id: "same-id" }, parentId: null, redactedParentRef: null, redactedParent: false };
    expect(isUpgradeSnapshotComplete({ ...snapshot, nodes: [cross] })).toBe(true);
    expect(isUpgradeSnapshotComplete({ ...snapshot, nodes: [{ ...cross, parentId: "same-id" }] })).toBe(false);
  });
  it("rejects missing pauseAll and supports no caller permission inference", async () => {
    const snapshot = await seed();
    Reflect.deleteProperty(snapshot.runControl.allowedActions, "pauseAll");
    expect(isUpgradeSnapshotComplete(snapshot)).toBe(false);
    expect(isUpgradeSnapshotComplete({ ...await seed(), caller: undefined })).toBe(false);
  });
});
