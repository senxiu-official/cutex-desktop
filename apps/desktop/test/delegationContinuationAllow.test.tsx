// @vitest-environment jsdom
// delegation-18f5c3 / 1a4b39 (owner 2026-11-25, Hostb #47c47e): a delegation whose auto-continue expired offers 允许继续
// on the card / side detail, gated by cutex's resumeContinuation. Reasons name only what the desktop sees, 上线 promises
// nothing, an unknown outcome keeps its original action id until its receipt settles it.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AskSummary } from "../src/shared/ipc";
import type { ContinuationResumeRead } from "../src/shared/delegationUpgradePreview";
import { en } from "../src/renderer/src/i18n/en";

type Runtime = { status: string; activeTurnId: string | null; runtimeGeneration: number };
const fx = vi.hoisted(() => ({
  owner: true, runtime: null as Runtime | null, start: null as { phase: string; since: number } | null, archived: false,
  read: vi.fn(), action: vi.fn(), decision: vi.fn(), operation: vi.fn(), bringOnline: vi.fn(), refresh: vi.fn(), gate: null as null | (() => void),
}));
vi.mock("../src/renderer/src/store", () => {
  const state = () => ({ sidebar: {
    active: fx.runtime && !fx.archived ? [{ cutexSessionId: "kai", runtime: fx.runtime }] : [],
    retired: fx.archived ? [{ cutexSessionId: "kai" }] : [],
  } });
  return {
    useApp: Object.assign((select: (s: unknown) => unknown) => select(state()), { getState: state }),
    sidebarOf: (s: { sidebar: unknown }) => s.sidebar,
  };
});
vi.mock("../src/renderer/src/lib/menus", () => ({ runtimeItem: () => ({ label: "Start", onSelect: fx.bringOnline }) }));
vi.mock("../src/renderer/src/lib/runtimeStart", () => ({ runtimeStartView: () => fx.start }));
vi.mock("../src/renderer/src/lib/hostAccess", () => ({ useHostAccess: () => ({ isOwner: fx.owner, known: true }) }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({ useAgentNames: () => (id: string) => id === "kai" ? "Kai" : id }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({
  refreshDelegation: fx.refresh,
  delegationApi: () => ({ delegationContinuationResume: fx.read, delegationUpgradeAction: fx.action, delegationContinuationDecision: fx.decision, delegationUpgradeOperation: fx.operation }),
  onContinuationGate: (_host: string, _project: string, listener: () => void) => { fx.gate = listener; return () => { fx.gate = null; }; },
}));
vi.mock("../src/renderer/src/i18n", () => {
  const t = (key: keyof typeof en, params: Record<string, string | number> = {}) =>
    (en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
  return { useI18n: () => ({ t, locale: "en" }), translate: t };
});

let DelegationContinuationAllow: typeof import("../src/renderer/src/components/DelegationContinuationAllow").DelegationContinuationAllow;
let unresolved: typeof import("../src/renderer/src/lib/delegationOperations").unresolvedUpgradeActions;
beforeAll(async () => {
  // Warm the imports outside the per-test hook budget (full-suite runs are slow to transform).
  ({ DelegationContinuationAllow } = await import("../src/renderer/src/components/DelegationContinuationAllow"));
  ({ unresolvedUpgradeActions: unresolved } = await import("../src/renderer/src/lib/delegationOperations"));
}, 60_000);

const ask = (over: Partial<AskSummary> = {}): AskSummary => ({
  askId: "ask-1", title: "Poll CI", requester: { kind: "owner" }, target: "kai", projectId: "proj", execution: "queued",
  attempts: 3, createdAt: "2026-11-25T00:00:00Z", updatedAt: "2026-11-25T00:00:00Z", revision: 7,
  continuationWait: { state: "limited", kind: "followUp", since: "2026-11-25T00:00:00Z", nextWakeAt: null },
  ...over,
} as AskSummary);
const ok: ContinuationResumeRead = { nodeHostId: "canonical", allowed: true, expectedRevision: 4, projectPaused: false, blockedReason: null, approval: null, limit: null };
const approval = { id: "cap-1", revision: 2, digest: "b".repeat(64), authorityEpoch: 5, allowedActions: { approve: true, deny: true } };
const online = (over: Partial<Runtime> = {}): Runtime => ({ status: "online", activeTurnId: null, runtimeGeneration: 3, ...over });
const receipt = (actionId: string, effectState: "committed" | "none") => ({
  schema: "cutex.delegation-operation.v1", actionId, operation: "continuation.resume", operationId: "op-1", status: "completed",
  effectState, outcomeUnknown: false, requestDigest: "a".repeat(64), revision: 5,
});
const result = (effectState: "committed" | "none") => async (_p: string, action: { actionId: string }) => ({ effectState, receipt: receipt(action.actionId, effectState) });

let root: Root; let el: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const render = async (d: AskSummary = ask()) => { await act(async () => root.render(h(DelegationContinuationAllow, { d, host: "local" }))); await flush(); };
const q = (name: string) => el.querySelector<HTMLButtonElement>(`[data-continuation-resume=${name}]`);
const allowButton = () => q("allow");
const reasonEl = () => el.querySelector("[data-continuation-resume-reason]");
const reason = () => reasonEl()?.textContent ?? null;
const click = async (b: HTMLButtonElement) => { await act(async () => b.click()); await flush(); };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); unresolved.restore();
  fx.owner = true; fx.runtime = online(); fx.start = null; fx.gate = null; fx.archived = false;
  fx.read.mockReset().mockResolvedValue(ok);
  fx.action.mockReset().mockImplementation(result("committed"));
  fx.operation.mockReset();
  fx.decision.mockReset().mockImplementation(async (_p: string, request: { actionId: string }) => ({ effectState: "committed", receipt: receipt(request.actionId, "committed") }));
  fx.bringOnline.mockReset().mockResolvedValue(undefined);
  fx.refresh.mockReset().mockResolvedValue(undefined);
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

describe("DelegationContinuationAllow", () => {
  it("shows the expired state and an enabled 允许继续 when cutex allows it; the click carries revision and host", async () => {
    await render();
    expect(el.textContent).toContain(en["delegation.status.continuationLimited"]);
    expect(el.textContent).toContain(en["delegation.cont.hintLimited"]);
    expect(fx.read).toHaveBeenCalledWith("proj", "ask-1");
    expect(allowButton()!.disabled).toBe(false);
    expect(allowButton()!.title).toBe(en["delegation.cont.allowHint"]);
    expect(q("recheck")).toBeNull();
    await click(allowButton()!);
    expect(fx.action).toHaveBeenCalledTimes(1);
    const [projectId, action] = fx.action.mock.calls[0]!;
    expect(projectId).toBe("proj");
    expect(action).toMatchObject({ kind: "resumeContinuation", nodeId: "ask-1", nodeHostId: "canonical", expectedRevision: 4 });
    expect(el.textContent).toContain(en["delegation.cont.allowed"]);
    expect(fx.refresh).toHaveBeenCalledWith("local", "ask-1");
    expect(fx.read.mock.calls.length).toBeGreaterThanOrEqual(2); // read again after the action
    expect(unresolved.size).toBe(0);
  });

  it("offline: 「先让 Kai 上线」 with a no-promise hint, and 上线 runs the agent menu start action", async () => {
    fx.runtime = online({ status: "offline" });
    fx.read.mockResolvedValue({ ...ok, allowed: false });
    await render();
    expect(allowButton()!.disabled).toBe(true);
    expect(reason()).toBe(en["delegation.cont.needOnline"].replace("{name}", "Kai"));
    expect(reasonEl()!.getAttribute("title")).toBe(en["delegation.cont.offlineHint"]);
    await click(q("online")!);
    expect(fx.bringOnline).toHaveBeenCalledTimes(1);
    expect(fx.action).not.toHaveBeenCalled();
  });

  it("a start in progress or unconfirmed is not offline: no 上线", async () => {
    fx.read.mockResolvedValue({ ...ok, allowed: false });
    fx.runtime = online({ status: "offline" }); fx.start = { phase: "pending", since: 1 };
    await render();
    expect(q("online")).toBeNull();
    expect(reason()).toBe(en["delegation.cont.starting"].replace("{name}", "Kai"));
    fx.start = { phase: "unconfirmed", since: 1 };
    await render(ask({ revision: 8 }));
    expect(q("online")).toBeNull();
    expect(reason()).toBe(en["runtime.startUnconfirmed"]);
  });

  it("roster not loaded: no 上线 and the generic reason", async () => {
    fx.runtime = null;
    fx.read.mockResolvedValue({ ...ok, allowed: false });
    await render();
    expect(q("online")).toBeNull();
    expect(reason()).toBe(en["delegation.cont.notNow"]);
    expect(reasonEl()!.getAttribute("title")).toBe(en["delegation.cont.notNowHint"]);
  });

  it.each([
    ["handler in a turn", { activeTurnId: "turn-1" }, { ...ok, allowed: false }, () => en["delegation.cont.working"].replace("{name}", "Kai")],
    ["no reason from cutex (e.g. new runtime generation)", {}, { ...ok, allowed: false }, () => en["delegation.cont.notNow"]],
    ["no revision", {}, { ...ok, expectedRevision: null }, () => en["delegation.cont.notNow"]],
    ["project paused", {}, { ...ok, allowed: false, projectPaused: true }, () => en["delegation.cont.projectPaused"]],
  ])("disabled with a reason and 重新检查: %s", async (_name, runtime: Partial<Runtime>, read: ContinuationResumeRead, text: () => string) => {
    fx.runtime = online(runtime);
    fx.read.mockResolvedValue(read);
    await render();
    expect(allowButton()!.disabled).toBe(true);
    expect(allowButton()!.title).toBe(text());
    expect(reason()).toBe(text());
    fx.read.mockResolvedValue(ok);
    await click(q("recheck")!);
    expect(allowButton()!.disabled).toBe(false);
  });

  it("re-reads when the handler finishes its turn and on project run-control / continuation events", async () => {
    fx.runtime = online({ activeTurnId: "turn-1" });
    fx.read.mockResolvedValue({ ...ok, allowed: false });
    await render();
    const before = fx.read.mock.calls.length;
    fx.runtime = online();
    fx.read.mockResolvedValue(ok);
    await render();
    expect(fx.read.mock.calls.length).toBe(before + 1);
    expect(allowButton()!.disabled).toBe(false);
    fx.read.mockResolvedValue({ ...ok, allowed: false, projectPaused: true });
    await act(async () => fx.gate!()); await flush();
    expect(reason()).toBe(en["delegation.cont.projectPaused"]);
  });

  it("an older host (no tree read) says it cannot allow from here and shows no button", async () => {
    fx.read.mockResolvedValue(null);
    await render();
    expect(allowButton()).toBeNull();
    expect(reason()).toBe(en["delegation.cont.olderHost"]);
  });

  it("a precondition refusal reports 情况已变化 and lifts the fence", async () => {
    fx.action.mockRejectedValue(new Error("continuation_changed"));
    await render();
    await click(allowButton()!);
    expect(el.textContent).toContain(en["delegation.cont.allowChanged"]);
    expect(unresolved.size).toBe(0);
    expect(allowButton()!.disabled).toBe(false);
  });

  it("receipt none reports 没有生效", async () => {
    fx.action.mockImplementation(result("none"));
    await render();
    await click(allowButton()!);
    expect(el.textContent).toContain(en["delegation.cont.notApplied"]);
    expect(unresolved.size).toBe(0);
  });

  it("an unknown outcome keeps the original action id, disables 允许继续 and settles only from its receipt", async () => {
    fx.action.mockRejectedValue(new Error("socket hang up"));
    await render();
    await click(allowButton()!);
    const actionId = fx.action.mock.calls[0]![1].actionId as string;
    expect(el.textContent).toContain(en["delegation.cont.allowUnknown"]);
    expect(allowButton()!.disabled).toBe(true);
    expect(q("recheck")).toBeNull();
    expect([...unresolved.values()].map((a) => a.actionId)).toEqual([actionId]);
    // Still unknown: the fence stays.
    fx.operation.mockResolvedValue({ schema: "cutex.delegation-operation.v1", actionId, status: "notFound", outcomeUnknown: true, result: null });
    await click(q("check")!);
    expect(fx.operation).toHaveBeenCalledWith(actionId);
    expect(allowButton()!.disabled).toBe(true);
    // A committed receipt for the same action id lifts it; there was never a second submit.
    fx.operation.mockResolvedValue({ schema: "cutex.delegation-operation.v1", actionId, status: "found", outcomeUnknown: false, result: { receipt: receipt(actionId, "committed") } });
    await click(q("check")!);
    expect(el.textContent).toContain(en["delegation.cont.confirmed"]);
    expect(unresolved.size).toBe(0);
    expect(fx.action).toHaveBeenCalledTimes(1);
  });

  it("r296: decides with the approval's revision / digest / epoch (not the legacy resume) and shows the segment limit", async () => {
    fx.read.mockResolvedValue({ ...ok, approval, limit: { reason: "rounds", maxRounds: 32, maxElapsedSeconds: 86_400 } });
    await render();
    expect(el.querySelector("[data-continuation-limit]")!.textContent).toContain(en["delegation.cont.limitRounds"].replace("{n}", "32"));
    await click(allowButton()!);
    expect(fx.action).not.toHaveBeenCalled();
    expect(fx.decision).toHaveBeenCalledTimes(1);
    const [projectId, request] = fx.decision.mock.calls[0]!;
    expect(projectId).toBe("proj");
    expect(request).toMatchObject({ delegationId: "ask-1", approvalId: "cap-1", expectedRevision: 2, expectedDigest: "b".repeat(64), expectedEpoch: 5, decision: "approve", decisionNote: null });
    expect(el.textContent).toContain(en["delegation.cont.allowed"]);
    expect(unresolved.size).toBe(0);
  });

  it("r296 (v2): an approval is decidable while the handler is busy; approving says it continues once free", async () => {
    fx.runtime = online({ activeTurnId: "turn-1" });
    fx.read.mockResolvedValue({ ...ok, allowed: false, blockedReason: "handlerBusy", approval });
    await render();
    expect(reason()).toBe(en["delegation.cont.working"].replace("{name}", "Kai"));
    expect(allowButton()!.disabled).toBe(false);
    expect(allowButton()!.title).toBe(en["delegation.cont.allowWhenReady"].replace("{name}", "Kai"));
    expect(q("recheck")).toBeNull();
    await click(allowButton()!);
    expect(fx.decision.mock.calls[0]![1]).toMatchObject({ decision: "approve" });
    expect(el.textContent).toContain(en["delegation.cont.allowedWaiting"].replace("{name}", "Kai"));
    // The delegation leaves the limited state at once; while it still waits the card keeps saying so.
    await render(ask({ revision: 9, continuationWait: { state: "ready", kind: "followUp", since: "2026-11-25T00:00:00Z", nextWakeAt: null } }));
    expect(el.querySelector("[data-continuation-allow]")).toBeNull();
    expect(el.querySelector("[data-continuation-approved]")!.textContent).toBe(en["delegation.cont.allowedWaiting"].replace("{name}", "Kai"));
  });

  it("r296 (v2): 拒绝并停止 needs a reason and sends it with the approval's CAS", async () => {
    fx.runtime = online({ status: "offline" });
    fx.read.mockResolvedValue({ ...ok, allowed: false, blockedReason: "handlerOffline", approval });
    await render();
    expect(q("online")).not.toBeNull();
    await click(q("deny")!);
    const confirm = q("denyConfirm")!;
    expect(confirm.disabled).toBe(true);
    const area = el.querySelector("textarea")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(area, "  不再需要  ");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(q("denyConfirm")!.disabled).toBe(false);
    await click(q("denyConfirm")!);
    expect(fx.decision.mock.calls[0]![1]).toMatchObject({ decision: "deny", decisionNote: "不再需要", approvalId: "cap-1", expectedRevision: 2 });
    expect(el.textContent).toContain(en["delegation.cont.denied"]);
  });

  it("legacy host (no approval): no 拒绝并停止", async () => {
    await render();
    expect(q("deny")).toBeNull();
  });

  it("r296: approval_changed lifts the fence, says so and reads again", async () => {
    fx.read.mockResolvedValue({ ...ok, approval });
    fx.decision.mockRejectedValue(new Error("approval_changed"));
    await render();
    const reads = fx.read.mock.calls.length;
    await click(allowButton()!);
    expect(el.textContent).toContain(en["delegation.cont.allowChanged"]);
    expect(unresolved.size).toBe(0);
    expect(fx.read.mock.calls.length).toBeGreaterThan(reads);
  });

  it.each([
    ["notPending", () => en["delegation.cont.blockedNotPending"]],
    ["handlerUnavailable", () => en["delegation.cont.blockedUnavailable"].replace("{name}", "Kai")],
    ["generationMismatch", () => en["delegation.cont.blockedGeneration"].replace("{name}", "Kai")],
    ["handlerOffline", () => en["delegation.cont.needOnline"].replace("{name}", "Kai")],
    ["handlerBusy", () => en["delegation.cont.working"].replace("{name}", "Kai")],
    ["leaseHeld", () => en["delegation.cont.blockedLease"].replace("{name}", "Kai")],
    ["projectPaused", () => en["delegation.cont.projectPaused"]],
    ["admissionBlocked", () => en["delegation.cont.blockedAdmission"]],
    ["noApprovalAuthority", () => en["delegation.cont.blockedNoAuthority"]],
    ["somethingNew", () => en["delegation.cont.notNow"]],
  ])("r296 blocked reason %s (no approval): its own words; 上线 only for handlerOffline", async (code, text) => {
    fx.runtime = online({ status: code === "handlerOffline" ? "offline" : "online" });
    fx.read.mockResolvedValue({ ...ok, allowed: false, blockedReason: code });
    await render();
    expect(allowButton()!.disabled).toBe(true);
    expect(reason()).toBe(text());
    expect(!!q("online")).toBe(code === "handlerOffline");
  });

  it("a known reason other than handlerOffline never offers 上线, even when the desktop sees the handler offline", async () => {
    fx.runtime = online({ status: "offline" });
    fx.read.mockResolvedValue({ ...ok, allowed: false, blockedReason: "generationMismatch" });
    await render();
    expect(q("online")).toBeNull();
    expect(reasonEl()!.getAttribute("title")).toBeNull();
  });

  it("ddd0f067: a project-less delegation reads its owner-detail card and decides on it (project null)", async () => {
    fx.read.mockResolvedValue({ ...ok, allowed: false, expectedRevision: null, approval });
    await render(ask({ projectId: null }));
    expect(fx.read).toHaveBeenCalledWith(null, "ask-1");
    expect(allowButton()!.disabled).toBe(false);
    await click(allowButton()!);
    expect(fx.decision).toHaveBeenCalledWith(null, expect.objectContaining({ approvalId: "cap-1", expectedRevision: 2, decision: "approve" }));
    expect(fx.action).not.toHaveBeenCalled();
    expect(unresolved.size).toBe(0);
  });

  it("ddd0f067: a project-less delegation without a card (older host / nothing to decide) cannot allow", async () => {
    fx.read.mockResolvedValue(null);
    await render(ask({ projectId: null }));
    expect(allowButton()).toBeNull();
    expect(reason()).toBe(en["delegation.cont.olderHost"]);
  });

  it("ddd0f067: the approval card's own allowedActions gate 允许继续 and 拒绝并停止", async () => {
    fx.read.mockResolvedValue({ ...ok, approval: { ...approval, allowedActions: { approve: false, deny: true } } });
    await render();
    expect(allowButton()!.disabled).toBe(true);
    expect(q("deny")).not.toBeNull();
    fx.read.mockResolvedValue({ ...ok, approval: { ...approval, allowedActions: { approve: true, deny: false } } });
    await render(ask({ revision: 8 }));
    expect(allowButton()!.disabled).toBe(false);
    expect(q("deny")).toBeNull();
  });

  it("ddd0f067: after an approval the card shows the scheduler's hold next to 已允许", async () => {
    fx.read.mockResolvedValue({ ...ok, allowed: false, blockedReason: "handlerBusy", approval });
    await render();
    await click(allowButton()!);
    await render(ask({ revision: 9, continuationWait: { state: "ready", kind: "after", since: "2026-11-25T00:00:00Z", nextWakeAt: null, blockedReason: "targetBusy" } as AskSummary["continuationWait"] }));
    const note = el.querySelector("[data-continuation-approved]")!;
    expect(note.textContent).toContain(en["delegation.cont.allowedWaiting"].replace("{name}", "Kai"));
    expect(el.querySelector("[data-continuation-waiting-reason]")!.textContent).toContain(en["delegation.cont.waitingNow"].replace("{reason}", en["delegation.cont.blocked.targetBusy"]));
    // The hold clears as the handler frees up.
    await render(ask({ revision: 10, continuationWait: { state: "ready", kind: "after", since: "2026-11-25T00:00:00Z", nextWakeAt: null } }));
    expect(el.querySelector("[data-continuation-waiting-reason]")).toBeNull();
  });

  it("ddd0f067: archived after an approval: says plainly it will not continue (the host cancelled the stretch)", async () => {
    fx.read.mockResolvedValue({ ...ok, allowed: false, blockedReason: "handlerOffline", approval });
    fx.runtime = online({ status: "offline" });
    await render();
    await click(allowButton()!);
    fx.archived = true;
    await render(ask({ revision: 11, continuationWait: null }));
    expect(el.querySelector("[data-continuation-archived]")!.textContent).toBe(en["delegation.cont.archivedAfterApproval"].replace("{name}", "Kai"));
    // Not archived (e.g. the stretch simply ran): nothing.
    fx.archived = false;
    await render(ask({ revision: 12, continuationWait: null }));
    expect(el.querySelector("[data-continuation-archived]")).toBeNull();
  });

  it("ddd0f067: handlerUnavailable says it won't continue until restored, with what restoring does on hover", async () => {
    fx.read.mockResolvedValue({ ...ok, allowed: false, blockedReason: "handlerUnavailable" });
    await render();
    expect(reason()).toBe(en["delegation.cont.blockedUnavailable"].replace("{name}", "Kai"));
    expect(reasonEl()!.getAttribute("title")).toContain("Archiving cancels this stretch");
  });

  it.each(["continuation_revision_conflict", "idempotency_conflict", "unauthorized", "invalid_authority_epoch"])(
    "ddd0f067 refusal %s left nothing behind: the fence is lifted", async (code) => {
      fx.read.mockResolvedValue({ ...ok, approval });
      fx.decision.mockRejectedValue(new Error(code));
      await render();
      await click(allowButton()!);
      expect(unresolved.size).toBe(0);
      expect(el.textContent).toContain(en["delegation.cont.allowChanged"]);
    });

  it("outcome_unknown keeps the fence", async () => {
    fx.read.mockResolvedValue({ ...ok, approval });
    fx.decision.mockRejectedValue(new Error("outcome_unknown"));
    await render();
    await click(allowButton()!);
    expect(unresolved.size).toBe(1);
  });

  it.each([
    ["not the owner", () => { fx.owner = false; }, ask()],
    ["remote delegation", () => {}, ask({ remote: { peerId: "p" } as AskSummary["remote"] })],
    ["still waiting", () => {}, ask({ continuationWait: { state: "waiting", kind: "followUp", since: "2026-11-25T00:00:00Z", nextWakeAt: null } })],
    ["closed", () => {}, ask({ closed: { reason: "answered" } as unknown as AskSummary["closed"] })],
  ])("hidden: %s", async (_name, setup: () => void, d: AskSummary) => {
    setup();
    await render(d);
    expect(el.querySelector("[data-continuation-allow]")).toBeNull();
    expect(fx.read).not.toHaveBeenCalled();
  });
});

describe("attempt row word", () => {
  it("the newest ended turn of an expired delegation reads 自动继续已到期, older ones keep 等待继续", async () => {
    const { attemptRowKey } = await import("../src/renderer/src/lib/delegations");
    expect(attemptRowKey("yielded", false, true, true)).toBe("limited");
    expect(attemptRowKey("yielded", false, false, true)).toBe("yielded");
    expect(attemptRowKey("yielded", false, true, false)).toBe("yielded");
    expect(attemptRowKey("running", false, true, true)).toBe("running");
    expect(en["delegation.attempt.limited"]).toBe("Turn ended; auto-continue expired");
  });
});

describe("wording (owner 2026-11-25)", () => {
  it("no 续接 / 续跑 in the zh-CN / zh-Hant renderer catalogs", () => {
    const root = resolve(process.cwd(), "src/renderer/src"); // vitest runs from apps/desktop
    const files = [
      "i18n/zh-CN.ts", "i18n/zh-Hant-CN.ts", "lib/continuationWaitMessages.ts",
      "modules/delegations/upgradeTreeMessages.ts", "modules/delegations/upgradeRunMessages.ts", "modules/delegations/i18n.locales.ts",
    ];
    for (const f of files) expect(readFileSync(resolve(root, f), "utf8"), f).not.toMatch(/续接|续跑|續接|續跑/);
  });
});
