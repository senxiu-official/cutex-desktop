// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpgradeSectionProps, UpgradePanelSnapshot as UpgradeSnapshot } from "../src/renderer/src/modules/delegations/upgradeTypes";

const fx = vi.hoisted(() => ({
  state: { features: {} as Record<string, Set<string>> },
  featuresOf: vi.fn(),
  useApp: vi.fn(),
  hook: vi.fn(),
  adapter: vi.fn(),
  read: vi.fn(),
  refresh: vi.fn(),
  more: vi.fn(),
  onAction: vi.fn(),
  reviewRetirement: vi.fn(),
  readOnly: false,
  busy: false,
  notice: null as string | null,
  memberProps: null as UpgradeSectionProps | null,
  snapshot: null as UpgradeSnapshot | null,
  adapterAvailable: true,
}));
vi.mock("../src/renderer/src/store", () => ({ useApp: fx.useApp, featuresOf: fx.featuresOf, sidebarOf: vi.fn() }));
vi.mock("../src/renderer/src/modules/delegations/useUpgradeProject", () => ({ useUpgradeProject: fx.hook, upgradePreviewApiOf: fx.adapter }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => "host-a" }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: { openPage: vi.fn() } } }));
vi.mock("../src/renderer/src/components/Page", () => ({ PageBody: ({ children }: { children: ReactNode }) => createElement("main", null, children) }));
vi.mock("../src/renderer/src/components/Button", () => ({ Button: () => createElement("span", { "data-marker": "button" }) }));
vi.mock("../src/renderer/src/modules/delegations/UpgradeRunControls", () => ({ UpgradeRunControls: ({ busy }: UpgradeSectionProps) => createElement("div", { "data-marker": "run", "data-busy": busy }) }));
vi.mock("../src/renderer/src/modules/delegations/UpgradeRouting", () => ({ UpgradeRouting: ({ busy }: UpgradeSectionProps) => createElement("div", { "data-marker": "routing", "data-busy": busy }) }));
vi.mock("../src/renderer/src/modules/delegations/UpgradeMembers", () => ({ UpgradeMembers: (props: UpgradeSectionProps) => {
  fx.memberProps = props;
  return createElement("div", { "data-marker": "members", "data-busy": props.busy },
    props.activitySupported ? createElement("span", { "data-marker": "activity" }) : null);
} }));
vi.mock("../src/renderer/src/modules/delegations/TreePanel", () => ({
  TreePanel: ({ continuation, busy }: { continuation: boolean; busy: boolean }) => createElement("div", { "data-marker": "tree", "data-busy": busy },
    continuation ? createElement("span", { "data-marker": "continuation" }) : null),
}));
import { UpgradeWorkspace } from "../src/renderer/src/modules/delegations/UpgradeWorkspace";

const TREE = "delegation-tree-stop-v1";
const optional = [
  ["project-run-control-v1", "run"],
  ["delegation-routing-v1", "routing"],
  ["agent-activity-v1", "activity"],
  ["delegation-continuation-v1", "continuation"],
] as const;
const unavailable = "delegations.upgrade.tree.unavailable";
const loading = "delegations.loading";
const snapshot = (): UpgradeSnapshot => ({
  projectId: "project-a", revision: "1", nodes: [], nextCursor: null, coverage: "complete", unresolvedEdges: [],
  parties: [], approvals: [],
  policy: { revision: 1, memberMode: "approvalRequired", allowedActions: { update: true } },
  runControl: { epoch: 1, phase: "running", pauseId: null, mode: "afterTurn", scope: "members", allowedActions: { pause: true, pauseAll: false, resume: false } },
  members: [], grants: { items: [], allowedActions: { create: false } }, interruptedDelegations: [],
  caller: { isOwner: true, canManageMembers: true, canOfflineMembers: true },
});
let container: HTMLDivElement;
let root: Root;
const render = (hostId = "host-a", projectId = "project-a") => {
  act(() => root.render(createElement(UpgradeWorkspace, { hostId, projectId })));
};
const marker = (name: string) => container.querySelector(`[data-marker="${name}"]`);
function expectUnavailable() {
  expect(container.textContent).toContain(unavailable);
  expect(container.textContent).not.toContain(loading);
  expect(container.querySelector('[data-testid="delegation-upgrade-workspace"]')).toBeNull();
  expect(marker("tree")).toBeNull();
  expect(marker("members")).toBeNull();
  for (const [, name] of optional) expect(marker(name)).toBeNull();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fx.state.features = { "host-a": new Set([TREE]) };
  fx.snapshot = snapshot();
  fx.adapterAvailable = true;
  fx.readOnly = false;
  fx.busy = false;
  fx.notice = null;
  fx.memberProps = null;
  fx.featuresOf.mockReset().mockImplementation((state: typeof fx.state, hostId: string) => state.features[hostId] ?? new Set());
  fx.useApp.mockReset().mockImplementation((selector: (state: typeof fx.state) => unknown) => selector(fx.state));
  fx.hook.mockReset().mockImplementation(() => ({ snapshot: fx.snapshot, busy: fx.busy, notice: fx.notice, readOnly: fx.readOnly, refresh: fx.refresh, more: fx.more, onAction: fx.onAction, reviewRetirement: fx.reviewRetirement }));
  fx.adapter.mockReset().mockImplementation(() => fx.adapterAvailable ? { delegationUpgradeSnapshot: fx.read } : {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("UpgradeWorkspace capability gating", () => {
  it.each(["agent-archive-kind-v1", "agentArchiveKindV1"])("renders member controls for archive alone (%s) without activity or unrelated controls", capability => {
    fx.state.features["host-a"] = new Set([TREE, capability]);
    render();
    expect(marker("members")).not.toBeNull();
    expect(marker("activity")).toBeNull();
    expect(marker("run")).toBeNull();
    expect(marker("routing")).toBeNull();
    expect(marker("continuation")).toBeNull();
    expect(fx.memberProps).toMatchObject({ archiveSupported: true, activitySupported: false, reviewRetirement: fx.reviewRetirement });
  });

  it("keeps activity support separate from archive authorization and review access", () => {
    fx.state.features["host-a"] = new Set([TREE, "agent-activity-v1"]);
    render();
    expect(marker("activity")).not.toBeNull();
    expect(fx.memberProps).toMatchObject({ archiveSupported: false, activitySupported: true });
    expect(fx.memberProps?.reviewRetirement).toBeUndefined();
    fx.state.features["host-a"]!.add("agent-archive-kind-v1");
    render();
    expect(fx.memberProps).toMatchObject({ archiveSupported: true, activitySupported: true, reviewRetirement: fx.reviewRetirement });
  });

  it.each([
    { readOnly: false, busy: false, disabled: "false" },
    { readOnly: true, busy: false, disabled: "true" },
    { readOnly: false, busy: true, disabled: "true" },
    { readOnly: true, busy: true, disabled: "true" },
  ])("passes the combined busy/read-only gate to every control (%j)", ({ readOnly, busy, disabled }) => {
    fx.state.features["host-a"] = new Set([TREE, "agent-archive-kind-v1", ...optional.map(([cap]) => cap)]);
    fx.readOnly = readOnly; fx.busy = busy;
    render();
    for (const name of ["run", "routing", "tree", "members"]) expect(marker(name)?.getAttribute("data-busy")).toBe(disabled);
    expect(fx.memberProps?.onAction).toBe(fx.onAction);
  });

  it("shows the incomplete contract notice without a spinner or any unchecked content", () => {
    fx.state.features["host-a"] = new Set([TREE, "agent-archive-kind-v1", ...optional.map(([cap]) => cap)]);
    fx.snapshot = null; fx.readOnly = true; fx.notice = "incomplete";
    render();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("delegations.upgrade.tree.incomplete");
    expect(container.textContent).not.toContain(loading);
    for (const name of ["run", "routing", "tree", "members", "continuation"]) expect(marker(name)).toBeNull();
  });

  // Every subset catches accidental coupling between unrelated optional capabilities.
  it.each(Array.from({ length: 16 }, (_, mask) => mask))("renders only advertised controls (capability mask %i)", mask => {
    fx.state.features["host-a"] = new Set([TREE, ...optional.filter((_, index) => mask & (1 << index)).map(([cap]) => cap)]);
    render();
    expect(marker("tree")).not.toBeNull();
    for (const [index, [, name]] of optional.entries()) {
      expect(Boolean(marker(name)), name).toBe(Boolean(mask & (1 << index)));
    }
    expect(container.textContent).not.toContain(unavailable);
    expect(container.textContent).not.toContain(loading);
    expect(fx.hook).toHaveBeenLastCalledWith("host-a", "project-a", true, expect.any(Object));
  });

  it("shows unavailable without tree capability even when every optional capability and a snapshot exist", () => {
    fx.state.features["host-a"] = new Set(optional.map(([cap]) => cap));
    render();
    expectUnavailable();
    expect(fx.hook).toHaveBeenLastCalledWith("host-a", "project-a", false, expect.any(Object));
  });

  it.each([false, true])("shows unavailable without the optional snapshot adapter (has snapshot: %s)", hasSnapshot => {
    fx.state.features["host-a"] = new Set([TREE, ...optional.map(([cap]) => cap)]);
    fx.adapterAvailable = false;
    fx.snapshot = hasSnapshot ? snapshot() : null;
    render();
    expectUnavailable();
    expect(fx.adapter).toHaveBeenLastCalledWith("host-a");
  });

  it("shows loading only when tree and its adapter exist but the snapshot has not arrived", () => {
    fx.state.features["host-a"] = new Set([TREE, ...optional.map(([cap]) => cap)]);
    fx.snapshot = null;
    render();
    expect(container.textContent).toContain(loading);
    expect(container.textContent).not.toContain(unavailable);
    expect(marker("tree")).toBeNull();
    for (const [, name] of optional) expect(marker(name)).toBeNull();
  });

  it("passes host/project changes to the hook and reads capabilities from the selected host", () => {
    fx.state.features["host-a"] = new Set([TREE, "project-run-control-v1"]);
    fx.state.features["host-b"] = new Set([TREE, "delegation-routing-v1"]);
    render();
    expect(marker("run")).not.toBeNull();
    expect(marker("routing")).toBeNull();
    fx.snapshot = { ...snapshot(), projectId: "project-b" };
    render("host-b", "project-b");
    expect(fx.featuresOf).toHaveBeenLastCalledWith(fx.state, "host-b");
    expect(fx.hook).toHaveBeenLastCalledWith("host-b", "project-b", true, expect.any(Object));
    expect(fx.adapter).toHaveBeenLastCalledWith("host-b");
    expect(marker("run")).toBeNull();
    expect(marker("routing")).not.toBeNull();
    render("host-b", "project-c");
    expect(fx.hook).toHaveBeenLastCalledWith("host-b", "project-c", true, expect.any(Object));
  });

  it.each([{ capabilities: [] }, { capabilities: ["delegations-v1", "approvals-v1", "delegation-tree-stop-v2"] }])("never renders new controls for a legacy host (%j)", ({ capabilities }) => {
    fx.state.features["host-a"] = new Set(capabilities);
    // A populated hook result must not bypass the capability gate.
    render();
    expectUnavailable();
    expect(fx.hook).toHaveBeenLastCalledWith("host-a", "project-a", false, expect.any(Object));
  });
});


it.each([
  { feature: "delegation-routing-v1", section: "routing", absent: ["members", "run", "activity"] },
  { feature: "agent-activity-v1", section: "activity", absent: ["routing", "run"] },
  { feature: "agent-archive-kind-v1", section: "members", absent: ["activity", "routing", "run"] },
])("renders tree plus independent $feature with unrelated fields absent", ({ feature, section, absent }) => {
  fx.state.features["host-a"] = new Set([TREE, feature]);
  const value = snapshot();
  if (feature !== "delegation-routing-v1") { Reflect.deleteProperty(value, "policy"); Reflect.deleteProperty(value, "grants"); Reflect.deleteProperty(value, "approvals"); Reflect.deleteProperty(value, "parties"); }
  if (feature === "delegation-routing-v1") Reflect.deleteProperty(value, "members");
  else value.members = feature === "agent-activity-v1"
    ? [{ id: "worker", hostId: "host-a", name: "Worker", director: false, lastActivityAt: null, observedAt: "2026-10-27T00:00:00Z", activityStatus: "unknown" }]
    : [{ id: "worker", hostId: "host-a", name: "Worker", director: false, archiveKind: "active", restorable: false, allowedActions: ["archive"], restoreBlockers: [] }];
  Reflect.deleteProperty(value, "runControl");
  fx.snapshot = value;
  render();
  expect(marker(section)).not.toBeNull();
  for (const name of absent) expect(marker(name)).toBeNull();
});
