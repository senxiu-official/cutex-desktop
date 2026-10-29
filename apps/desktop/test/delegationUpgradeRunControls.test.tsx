// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpgradeRunControls } from "../src/renderer/src/modules/delegations/UpgradeRunControls";
import { Overlays } from "../src/renderer/src/components/Overlays";
import { closeDialog } from "../src/renderer/src/lib/contextMenu";
import { zhCN } from "../src/renderer/src/modules/delegations/upgradeRunMessages";
import { en } from "../src/renderer/src/modules/delegations/upgradeRunMessages.en";
import type { UpgradeNode, UpgradeSectionProps, UpgradePanelSnapshot as UpgradeSnapshot } from "../src/renderer/src/modules/delegations/upgradeTypes";

const locale = vi.hoisted(() => ({ value: "zh-CN" }));
const catalogs: Record<string, Record<string, string>> = { "zh-CN": zhCN, en };
const t = (key: string, params: Record<string, string | number> = {}) => (catalogs[locale.value]?.[key] ?? key)
  .replace(/\{(\w+)\}/g, (placeholder, name: string) => String(params[name] ?? placeholder));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t, locale: locale.value }), translate: (key: string) => t(key) }));

function snapshot(): UpgradeSnapshot {
  return {
    projectId: "project-a", revision: "1", nodes: [], nextCursor: null,
    coverage: "complete", unresolvedEdges: [],
    parties: [], approvals: [],
    policy: { revision: 1, memberMode: "approvalRequired", allowedActions: { update: false } },
    runControl: { epoch: 7, phase: "running", pauseId: null, mode: "afterTurn", scope: "members", allowedActions: { pause: true, pauseAll: true, resume: false } },
    members: [], grants: { items: [], allowedActions: { create: false } }, interruptedDelegations: [],
    caller: { isOwner: true, canManageMembers: false, canOfflineMembers: false },
  };
}

function delegation(hostId: string, id: string, title: string): UpgradeNode {
  return {
    kind: "delegation", id, hostId, projectId: "project-a", ref: { hostId, id },
    parent: null, parentState: "none", redactedParentRef: null,
    root: { hostId, id }, rootState: "visible", redactedRootRef: null,
    followUp: null, followUpState: "none", parentId: null, rootId: id, followUpOf: null, parentAttemptId: null,
    lineageState: "verified", redactedParent: false, requester: null,
    target: { hostId, id: "member-a", name: "Member" }, title, execution: "interrupted", closed: null,
    lastActivityAt: null, resumeEvidence: { kind: "none" }, continuation: null, routingApproval: null,
    allowedActions: { readAttempts: false, stop: false, stopSelf: false, stopJobs: false, declareContinuation: false, resumeContinuation: false }, revision: 1,
  };
}

const onAction = vi.fn<UpgradeSectionProps["onAction"]>();
let props: UpgradeSectionProps;
function view() { return h("div", null, h(UpgradeRunControls, props), h(Overlays)); }
let root: Root;
let host: HTMLDivElement;
function mount() { act(() => root.render(view())); }
function button(key: keyof typeof zhCN, container: ParentNode = host): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((el) => el.textContent === t(key));
  if (!found) throw new Error("Missing button: " + key);
  return found;
}
function checkbox(): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!found) throw new Error("Missing director checkbox");
  return found;
}
function node(selector: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(selector);
  if (!found) throw new Error("Missing element: " + selector);
  return found;
}
function click(element: HTMLElement) { act(() => element.click()); }
async function settle() { await act(async () => {}); }

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  locale.value = "zh-CN";
  onAction.mockReset().mockResolvedValue(undefined);
  props = { snapshot: snapshot(), busy: false, onAction };
});
afterEach(async () => {
  await settle();
  act(() => { root.unmount(); closeDialog(); });
  host.remove();
  vi.unstubAllGlobals();
});

describe("project run controls", () => {
  it("defaults to afterTurn / members and confirms in place before sending an intent", async () => {
    mount();
    expect(checkbox().checked).toBe(false);
    click(button("delegations.upgrade.run.pause"));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
    click(button("delegations.upgrade.run.confirmPause"));
    await settle();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "pause", mode: "afterTurn", scope: "members", expectedEpoch: 7 });
    expect(node('[role="status"]').textContent).toBe(t("delegations.upgrade.run.phase.running"));
  });

  it("requires another confirmation when the scope changes; cancel does nothing", () => {
    mount();
    click(button("delegations.upgrade.run.pause"));
    click(checkbox());
    expect((Array.from(host.querySelectorAll("button")).find((el) => el.textContent === t("delegations.upgrade.run.confirmPause")) ?? null)).toBeNull();
    click(button("delegations.upgrade.run.pause"));
    click(button("delegations.upgrade.run.cancel"));
    expect(onAction).not.toHaveBeenCalled();
    click(button("delegations.upgrade.run.pause"));
    click(button("delegations.upgrade.run.confirmPause"));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "pause", mode: "afterTurn", scope: "all", expectedEpoch: 7 });
  });

  it.each([false, true])("uses the real project dialog for interrupt; director included: %s", async (director) => {
    mount();
    if (director) click(checkbox());
    click(button("delegations.upgrade.run.interrupt"));
    const dialog = node('[role="dialog"]');
    expect(dialog.textContent).toContain(t(director ? "delegations.upgrade.run.interruptAll" : "delegations.upgrade.run.interruptMembers"));
    expect(onAction).not.toHaveBeenCalled();
    click(button("delegations.upgrade.run.confirmInterrupt", dialog));
    await settle();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "pause", mode: "interrupt", scope: director ? "all" : "members", expectedEpoch: 7 });
  });

  it("cancels immediate interruption without an action", async () => {
    mount();
    click(button("delegations.upgrade.run.interrupt"));
    click(button("delegations.upgrade.run.cancel", node('[role="dialog"]')));
    await settle();
    expect(button("delegations.upgrade.run.interrupt").disabled).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each(["permission", "epoch", "project", "busy"])("rechecks %s after the interrupt dialog", async (change) => {
    mount();
    click(button("delegations.upgrade.run.interrupt"));
    props = { ...props, snapshot: { ...props.snapshot, runControl: { ...props.snapshot.runControl } } };
    if (change === "permission") props.snapshot.runControl.allowedActions = { pause: false, pauseAll: true, resume: false };
    if (change === "epoch") props.snapshot.runControl.epoch++;
    if (change === "project") props.snapshot.projectId = "project-b";
    if (change === "busy") props.busy = true;
    mount();
    click(button("delegations.upgrade.run.confirmInterrupt", node('[role="dialog"]')));
    await settle();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("resumes using the pause identity and epoch without continuing interrupted delegations", async () => {
    props.snapshot.runControl = { ...props.snapshot.runControl, phase: "paused", pauseId: "pause-42", allowedActions: { pause: false, pauseAll: false, resume: true } };
    props.snapshot.interruptedDelegations = [{ hostId: "local", id: "delegation-one" }, { hostId: "remote", id: "delegation-two" }];
    mount();
    expect(node('ul').textContent).toContain("delegation-one");
    expect(node('ul').textContent).toContain("delegation-two");
    click(button("delegations.upgrade.run.resume"));
    await settle();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "resume", pauseId: "pause-42", expectedEpoch: 7 });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(node('[role="status"]').textContent).toBe(t("delegations.upgrade.run.phase.paused"));
  });

  it.each(["permission", "pauseId", "busy"])("blocks resume without %s eligibility", (condition) => {
    props.snapshot.runControl.pauseId = condition === "pauseId" ? null : "pause-42";
    props.snapshot.runControl.allowedActions.resume = condition !== "permission";
    props.busy = condition === "busy";
    mount();
    expect(button("delegations.upgrade.run.resume").disabled).toBe(true);
    click(button("delegations.upgrade.run.resume"));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("disables pause controls without permission", () => {
    props.snapshot.runControl.allowedActions = { pause: false, pauseAll: false, resume: false };
    mount();
    expect(button("delegations.upgrade.run.pause").disabled).toBe(true);
    expect(button("delegations.upgrade.run.interrupt").disabled).toBe(true);
    expect(checkbox().disabled).toBe(true);
    click(button("delegations.upgrade.run.pause"));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("resets the director default and inline confirmation when switching projects", () => {
    mount();
    click(checkbox());
    click(button("delegations.upgrade.run.pause"));
    props = { ...props, snapshot: { ...props.snapshot, projectId: "project-b" } };
    mount();
    expect(checkbox().checked).toBe(false);
    expect(button("delegations.upgrade.run.pause").disabled).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("disarms inline confirmation when pause permission is revoked", () => {
    mount();
    click(button("delegations.upgrade.run.pause"));
    props = { ...props, snapshot: { ...props.snapshot, runControl: { ...props.snapshot.runControl, allowedActions: { pause: false, pauseAll: true, resume: false } } } };
    mount();
    expect(button("delegations.upgrade.run.pause").disabled).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each(["afterTurn", "interrupt"] as const)("uses pause alone for members in %s mode", async (mode) => {
    props.snapshot.runControl.allowedActions = { pause: true, pauseAll: false, resume: false };
    mount();
    expect(checkbox().disabled).toBe(true);
    click(checkbox());
    expect(checkbox().checked).toBe(false);
    expect(button("delegations.upgrade.run.pause").disabled).toBe(false);
    expect(button("delegations.upgrade.run.interrupt").disabled).toBe(false);
    if (mode === "afterTurn") {
      click(button("delegations.upgrade.run.pause"));
      click(button("delegations.upgrade.run.confirmPause"));
    } else {
      click(button("delegations.upgrade.run.interrupt"));
      click(button("delegations.upgrade.run.confirmInterrupt", node('[role="dialog"]')));
    }
    await settle();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "pause", mode, scope: "members", expectedEpoch: 7 });
  });

  it.each(["afterTurn", "interrupt"] as const)("uses pauseAll alone for all in %s mode", async (mode) => {
    props.snapshot.runControl.allowedActions = { pause: false, pauseAll: true, resume: false };
    mount();
    expect(checkbox().disabled).toBe(false);
    expect(checkbox().checked).toBe(false);
    expect(button("delegations.upgrade.run.pause").disabled).toBe(true);
    expect(button("delegations.upgrade.run.interrupt").disabled).toBe(true);
    click(checkbox());
    expect(checkbox().checked).toBe(true);
    expect(button("delegations.upgrade.run.pause").disabled).toBe(false);
    expect(button("delegations.upgrade.run.interrupt").disabled).toBe(false);
    if (mode === "afterTurn") {
      click(button("delegations.upgrade.run.pause"));
      click(button("delegations.upgrade.run.confirmPause"));
    } else {
      click(button("delegations.upgrade.run.interrupt"));
      click(button("delegations.upgrade.run.confirmInterrupt", node('[role="dialog"]')));
    }
    await settle();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "pause", mode, scope: "all", expectedEpoch: 7 });
  });

  it("disarms all-scope inline confirmation on pauseAll revocation even while pause remains true", () => {
    mount();
    click(checkbox());
    click(button("delegations.upgrade.run.pause"));
    expect(button("delegations.upgrade.run.confirmPause").disabled).toBe(false);
    props = { ...props, snapshot: { ...props.snapshot, runControl: { ...props.snapshot.runControl, allowedActions: { pause: true, pauseAll: false, resume: false } } } };
    mount();
    expect(checkbox().checked).toBe(true);
    expect(checkbox().disabled).toBe(false);
    expect(button("delegations.upgrade.run.pause").disabled).toBe(true);
    expect(button("delegations.upgrade.run.interrupt").disabled).toBe(true);
    click(button("delegations.upgrade.run.pause"));
    expect(onAction).not.toHaveBeenCalled();
    props = { ...props, snapshot: { ...props.snapshot, runControl: { ...props.snapshot.runControl, allowedActions: { pause: true, pauseAll: true, resume: false } } } };
    mount();
    click(button("delegations.upgrade.run.pause"));
    expect(button("delegations.upgrade.run.confirmPause").disabled).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each(["afterTurn", "interrupt"] as const)("can leave stale all scope after revocation and freshly confirm members in %s mode", async (mode) => {
    mount();
    click(checkbox());
    if (mode === "afterTurn") click(button("delegations.upgrade.run.pause"));
    else click(button("delegations.upgrade.run.interrupt"));
    props = { ...props, snapshot: { ...props.snapshot, runControl: { ...props.snapshot.runControl, allowedActions: { pause: true, pauseAll: false, resume: false } } } };
    mount();
    if (mode === "interrupt") {
      click(button("delegations.upgrade.run.confirmInterrupt", node('[role="dialog"]')));
      await settle();
    } else {
      expect(button("delegations.upgrade.run.pause").disabled).toBe(true);
      click(button("delegations.upgrade.run.pause"));
    }
    expect(onAction).not.toHaveBeenCalled();
    expect(checkbox().checked).toBe(true);
    expect(checkbox().disabled).toBe(false);
    click(checkbox());
    expect(checkbox().checked).toBe(false);
    expect(checkbox().disabled).toBe(true);
    click(checkbox());
    expect(checkbox().checked).toBe(false);
    expect(button("delegations.upgrade.run.pause").disabled).toBe(false);
    expect(button("delegations.upgrade.run.interrupt").disabled).toBe(false);
    if (mode === "afterTurn") {
      click(button("delegations.upgrade.run.pause"));
      expect(onAction).not.toHaveBeenCalled();
      click(button("delegations.upgrade.run.confirmPause"));
    } else {
      click(button("delegations.upgrade.run.interrupt"));
      expect(onAction).not.toHaveBeenCalled();
      expect(node('[role="dialog"]').textContent).toContain(t("delegations.upgrade.run.interruptMembers"));
      click(button("delegations.upgrade.run.confirmInterrupt", node('[role="dialog"]')));
    }
    await settle();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "pause", mode, scope: "members", expectedEpoch: 7 });
  });

  it.each(["pauseAll", "epoch"])("rechecks %s for the original all-scope interrupt confirmation", async (change) => {
    mount();
    click(checkbox());
    click(button("delegations.upgrade.run.interrupt"));
    props = { ...props, snapshot: { ...props.snapshot, runControl: { ...props.snapshot.runControl, allowedActions: { pause: true, pauseAll: change !== "pauseAll", resume: false } } } };
    if (change === "epoch") props.snapshot.runControl.epoch++;
    mount();
    click(button("delegations.upgrade.run.confirmInterrupt", node('[role="dialog"]')));
    await settle();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not require members permission for a confirmed all-scope interrupt", async () => {
    mount();
    click(checkbox());
    click(button("delegations.upgrade.run.interrupt"));
    props = { ...props, snapshot: { ...props.snapshot, runControl: { ...props.snapshot.runControl, allowedActions: { pause: false, pauseAll: true, resume: false } } } };
    mount();
    click(button("delegations.upgrade.run.confirmInterrupt", node('[role="dialog"]')));
    await settle();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "pause", mode: "interrupt", scope: "all", expectedEpoch: 7 });
  });

  it("keeps interrupted references with the same id on different hosts distinct and skips redacted nodes", () => {
    props.snapshot.nodes = [
      { kind: "redactedAncestor", placeholderId: "hidden-parent", labelKey: "delegation.ancestorRestricted", reason: "notVisible", expandable: false, allowedActions: {} },
      delegation("local", "shared-id", "EVA review"),
      delegation("remote", "shared-id", "remote review"),
      delegation("local", "eva-only", "Visible only on EVA"),
    ];
    props.snapshot.interruptedDelegations = [
      { hostId: "local", id: "shared-id" },
      { hostId: "remote", id: "shared-id" },
      { hostId: "remote", id: "eva-only" },
    ];
    mount();
    const rows = () => Array.from(node("ul").querySelectorAll("li"));
    expect(rows().map((row) => row.textContent)).toEqual(["EVA review", "remote review", "remote/eva-only"]);
    expect(rows().map((row) => row.title)).toEqual(["local/shared-id", "remote/shared-id", "remote/eva-only"]);
    props = { ...props, snapshot: { ...props.snapshot, interruptedDelegations: [...props.snapshot.interruptedDelegations].reverse() } };
    mount();
    expect(rows().map((row) => row.textContent)).toEqual(["remote/eva-only", "remote review", "EVA review"]);
    expect(node("ul").textContent).not.toContain("Visible only on EVA");
  });

  it("falls back to the explicit host/id when the matched delegation has no title", () => {
    props.snapshot.nodes = [delegation("local", "untitled", "")];
    props.snapshot.interruptedDelegations = [{ hostId: "local", id: "untitled" }];
    mount();
    expect(node("ul").textContent).toBe("local/untitled");
  });

  it.each(["pausing", "partial"] as const)("reports %s without claiming paused success", (phase) => {
    props.snapshot.runControl.phase = phase;
    mount();
    expect(node('[role="status"]').textContent).toBe(t(`delegations.upgrade.run.phase.${phase}`));
    expect(node('[role="status"]').textContent).not.toBe(t("delegations.upgrade.run.phase.paused"));
  });

  it("prevents duplicate submissions and shows a translated rejection", async () => {
    let rejectAction: (reason: Error) => void = () => {};
    onAction.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectAction = reject; }));
    mount();
    click(button("delegations.upgrade.run.pause"));
    click(button("delegations.upgrade.run.confirmPause"));
    expect(button("delegations.upgrade.run.pause").disabled).toBe(true);
    click(button("delegations.upgrade.run.interrupt"));
    expect(onAction).toHaveBeenCalledTimes(1);
    rejectAction(new Error("callback failed"));
    await settle();
    expect(node('[role="alert"]').textContent).toBe(t("delegations.upgrade.run.failed"));
  });

  it("keeps both catalogs complete and renders English", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
    locale.value = "en";
    mount();
    expect(button("delegations.upgrade.run.pause").textContent).toBe("Pause after current turns");
  });
});


it("keeps all scope owner-only even if stale server flags still contain pauseAll", () => {
  props.snapshot.caller.isOwner = false;
  props.snapshot.runControl.allowedActions.pauseAll = true;
  mount();
  expect(checkbox().disabled).toBe(true);
  click(checkbox());
  expect(checkbox().checked).toBe(false);
  expect(onAction).not.toHaveBeenCalled();
});
