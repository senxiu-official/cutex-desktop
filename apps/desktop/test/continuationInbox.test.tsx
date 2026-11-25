// @vitest-environment jsdom
// delegation-81305d (r296): the approvals page lists continuation approvals (per project and project-less), decides them
// with the approval's CAS (deny needs a reason), re-reads on approval_changed and keeps an unknown outcome fenced.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContinuationApprovalRead } from "../src/shared/delegationUpgradePreview";
import type { HostData } from "../src/renderer/src/lib/hostScope";
import { en } from "../src/renderer/src/i18n/en";

const fx = vi.hoisted(() => ({ list: vi.fn(), decide: vi.fn(), operation: vi.fn(), ask: vi.fn(), refresh: vi.fn() }));
const api = () => ({ delegationContinuationApprovals: fx.list, delegationContinuationDecision: fx.decide, delegationUpgradeOperation: fx.operation, ask: fx.ask });
vi.mock("../src/renderer/src/lib/hostLists", () => ({ hostApi: api }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({ delegationApi: api, refreshDelegation: fx.refresh }));
vi.mock("../src/renderer/src/lib/hostSwitch", async (original) => ({ ...(await original<object>()), captureHostAction: () => () => true }));
vi.mock("../src/renderer/src/lib/routingReviews", () => ({ useRoutingRevision: () => 0 }));
vi.mock("../src/renderer/src/components/Parties", () => ({
  ProjectRef: ({ name }: { name: string | null }) => h("span", { "data-project": "" }, name),
  Who: ({ name }: { name: string | null }) => h("span", null, name),
}));
vi.mock("../src/renderer/src/i18n", () => {
  const t = (key: keyof typeof en, params: Record<string, string | number> = {}) =>
    (en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
  return { useI18n: () => ({ t, locale: "en" }), translate: t };
});

let ContinuationInbox: typeof import("../src/renderer/src/modules/approvals/ContinuationInbox").ContinuationInbox;
let unresolved: typeof import("../src/renderer/src/lib/delegationOperations").unresolvedUpgradeActions;
beforeAll(async () => {
  ({ ContinuationInbox } = await import("../src/renderer/src/modules/approvals/ContinuationInbox"));
  ({ unresolvedUpgradeActions: unresolved } = await import("../src/renderer/src/lib/delegationOperations"));
}, 60_000);

const approval = (over: Partial<ContinuationApprovalRead> = {}): ContinuationApprovalRead => ({
  id: "cap-1", delegationId: "ask-1", projectId: "proj", revision: 2, digest: "c".repeat(64), authorityEpoch: 5, reason: "rounds",
  requestedAt: "2026-11-25T00:00:00Z", briefPreview: "Poll CI until green", progressPreview: "round 32: two jobs queued",
  allowedActions: { approve: true, deny: true }, ...over,
});
const host = (features: string[] = ["delegation-continuation-approval-v1"]): HostData => ({
  hostId: "local", focus: true, daemon: "connected" as unknown as HostData["daemon"], features: new Set(features), featuresKnown: true, approvals: [], services: null,
  sidebar: { active: [], retired: [], projects: { projects: [{ project_id: "proj", presentation: { display_name: "Desktop" } }] } } as unknown as HostData["sidebar"],
});
const receipt = (actionId: string) => ({ schema: "cutex.delegation-operation.v1", actionId, operation: "continuation.resume", operationId: "op-1", status: "completed",
  effectState: "committed", outcomeUnknown: false, requestDigest: "a".repeat(64), revision: 3 });

let root: Root; let el: HTMLDivElement; let count = -1;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const render = async (hosts = [host()]) => { await act(async () => root.render(h(ContinuationInbox, { hosts, onCount: (n: number) => { count = n; } }))); await flush(); };
const btn = (name: string) => el.querySelector<HTMLButtonElement>(`[data-continuation-decision=${name}]`);
const click = async (b: HTMLButtonElement) => { await act(async () => b.click()); await flush(); };
const type = async (text: string) => {
  const area = el.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); unresolved.restore(); count = -1;
  fx.list.mockReset().mockImplementation(async (projectId: string | null) => projectId === "proj" ? [approval()] : [approval({ id: "cap-9", delegationId: "ask-9", projectId: null })]);
  fx.ask.mockReset().mockImplementation(async (id: string) => ({ askId: id, title: id === "ask-1" ? "Poll upstream CI" : "Weekly notes", targetCutexSessionId: "kai", targetName: "Kai" }));
  fx.decide.mockReset().mockImplementation(async (_p: string | null, request: { actionId: string }) => ({ effectState: "committed", receipt: receipt(request.actionId) }));
  fx.operation.mockReset();
  fx.refresh.mockReset().mockResolvedValue(undefined);
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

describe("ContinuationInbox", () => {
  it("lists each project's approvals and the project-less ones with brief, progress and the limit reason", async () => {
    await render();
    expect(fx.list.mock.calls.map((c) => c[0])).toEqual(["proj", null]);
    expect(count).toBe(2);
    const cards = el.querySelectorAll("[data-continuation-approval]");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain("Poll upstream CI");
    expect(cards[0]!.textContent).toContain("Poll CI until green");
    expect(cards[0]!.textContent).toContain("round 32: two jobs queued");
    expect(cards[0]!.textContent).toContain(en["delegation.cont.reasonRounds"]);
    expect(cards[1]!.textContent).toContain(en["delegation.cont.noProject"]);
  });

  it("renders nothing for hosts without delegation-continuation-approval-v1", async () => {
    await render([host([])]);
    expect(fx.list).not.toHaveBeenCalled();
    expect(el.querySelector("[data-testid=continuation-approvals-inbox]")).toBeNull();
  });

  it("approve sends the approval's revision / digest / epoch and re-reads the list", async () => {
    await render();
    const reads = fx.list.mock.calls.length;
    await click(btn("approve")!);
    expect(fx.decide).toHaveBeenCalledTimes(1);
    const [projectId, request] = fx.decide.mock.calls[0]!;
    expect(projectId).toBe("proj");
    expect(request).toMatchObject({ delegationId: "ask-1", approvalId: "cap-1", expectedRevision: 2, expectedDigest: "c".repeat(64), expectedEpoch: 5, decision: "approve", decisionNote: null });
    expect(fx.list.mock.calls.length).toBeGreaterThan(reads);
    expect(fx.refresh).toHaveBeenCalledWith("local", "ask-1");
  });

  it("deny needs a reason (trimmed) and closes with it", async () => {
    await render();
    await click(btn("deny")!);
    expect(btn("denyConfirm")!.disabled).toBe(true);
    await type("   ");
    expect(btn("denyConfirm")!.disabled).toBe(true);
    await type("  superseded by #48  ");
    await click(btn("denyConfirm")!);
    expect(fx.decide.mock.calls[0]![1]).toMatchObject({ decision: "deny", decisionNote: "superseded by #48" });
  });

  it("approval_changed re-reads the list and asks to decide again", async () => {
    fx.decide.mockRejectedValue(new Error("approval_changed"));
    await render();
    const reads = fx.list.mock.calls.length;
    fx.list.mockImplementation(async (projectId: string | null) => projectId === "proj" ? [approval({ revision: 3 })] : []);
    await click(btn("approve")!);
    expect(fx.list.mock.calls.length).toBeGreaterThan(reads);
    expect(unresolved.size).toBe(0);
    // The re-read record (revision 3) replaces the card; the next decision uses it.
    fx.decide.mockReset().mockImplementation(async (_p: string | null, request: { actionId: string }) => ({ effectState: "committed", receipt: receipt(request.actionId) }));
    await click(btn("approve")!);
    expect(fx.decide.mock.calls[0]![1]).toMatchObject({ expectedRevision: 3 });
  });

  it("an unknown outcome keeps the fence (buttons off) until 核对结果 finds the receipt; no second submit", async () => {
    fx.decide.mockRejectedValue(new Error("socket hang up"));
    await render();
    await click(btn("approve")!);
    expect(el.textContent).toContain(en["delegation.cont.allowUnknown"]);
    expect(btn("approve")!.disabled).toBe(true);
    const actionId = fx.decide.mock.calls[0]![1].actionId as string;
    fx.operation.mockResolvedValue({ schema: "cutex.delegation-operation.v1", actionId, status: "found", outcomeUnknown: false, result: { receipt: receipt(actionId) } });
    await click(btn("check")!);
    expect(fx.operation).toHaveBeenCalledWith(actionId);
    expect(unresolved.size).toBe(0);
    expect(fx.decide).toHaveBeenCalledTimes(1);
  });

  it("shows only the actions the record allows", async () => {
    fx.list.mockImplementation(async (projectId: string | null) => projectId === "proj" ? [approval({ allowedActions: { approve: false, deny: true } })] : []);
    await render();
    expect(btn("approve")).toBeNull();
    expect(btn("deny")).not.toBeNull();
  });
});
