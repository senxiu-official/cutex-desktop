// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageSettlement } from "@cutex-desktop/protocol";

const env = vi.hoisted(() => ({
  cancelable: false, cancel: vi.fn(), features: new Set<string>(), close: vi.fn(), list: vi.fn(), bootstrap: vi.fn(), refresh: vi.fn(), evidence: vi.fn(),
}));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: () => ({ closeBusMessage: env.close, stuckBusMessages: env.list, bootstrap: env.bootstrap, busMessageEvidence: env.evidence }), bridge: {} }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ refreshAdmission: env.refresh }) }),
  featuresOf: () => env.features,
}));
vi.mock("../src/renderer/src/i18n", async () => {
  const { zhCN } = await import("../src/renderer/src/modules/agent-bus/i18n");
  return { useI18n: () => ({ t: (key: string) => key === "settings.cancel" ? "取消" : (zhCN as Record<string, string>)[key] ?? key }) };
});
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn() }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({ useAgentHost: () => "host-a", useAgentNames: () => () => "Mika" }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({ useDelegation: () => null, hasDelegationViews: () => false }));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({ useConvScope: () => null, convFeaturesOf: () => env.features, useConvHost: () => "host-a" }));
vi.mock("../src/renderer/src/lib/cancelSend", () => ({ useCancelableSends: () => ({ list: env.cancelable ? [{}] : [], cancel: env.cancel }), matchCancelable: (list: unknown[]) => list[0] ?? null }));

import { NextStepRow } from "../src/renderer/src/components/AdmissionRows";
import { SentStatus } from "../src/renderer/src/components/AgentMessageParts";
import { MessageSettlementControl } from "../src/renderer/src/components/MessageSettlementControl";
import { closeMessageFollowUp, recheckSettlement, settlementWriteKey, useSettlementWrites } from "../src/renderer/src/lib/messageSettlementWrites";
import { hiddenReceiptsOf } from "../src/renderer/src/lib/legacyDelivery/busReceiptVisibility";
import { useAgentMessages } from "../src/renderer/src/lib/agentMessageStore";
import { pendingMessagesFor } from "../src/renderer/src/lib/legacyDelivery/agentMessages";
import { settlementAdmissionFixture, settlementFixture } from "../src/renderer/src/modules/agent-bus/settlementFixture";
import { MESSAGE_SETTLEMENT_EVENT, MESSAGE_SETTLEMENT_FEATURE, STALE_ACK_SETTLEMENT_FEATURE } from "../src/shared/messageSettlement";
import { noteHostAccess } from "../src/renderer/src/lib/hostAccess";

let root: Root;
let node: HTMLDivElement;
let current: MessageSettlement;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); env.cancelable = false;
  env.features = new Set([MESSAGE_SETTLEMENT_FEATURE]);
  noteHostAccess("host-a", { user: { id: "owner", isOwner: true, token: null } });
  current = settlementFixture();
  env.list.mockImplementation(async () => ({ messages: [{ messageId: "m-settlement", settlement: current }] }));
  env.bootstrap.mockImplementation(async () => ({ cutexState: { agentBusMessages: [{ messageId: "m-settlement", settlement: current }] } }));
  env.refresh.mockResolvedValue(undefined);
  env.evidence.mockImplementation(async ({ messageId }) => ({ ok: true, result: { messageId, settlement: null } }));
  env.close.mockImplementation(async (request) => ({ ok: true, result: { messageId: request.messageId, changed: true, settlement: closed(request.requestId) } }));
  useAgentMessages.getState().reset();
  useSettlementWrites.setState({ entries: {} });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
function closed(requestId = "key"): MessageSettlement {
  return { ...current, state: "closed", canClose: false, closure: { actor: "owner", closedAt: "2026-10-27T01:00:00Z", reason: "Owner has finished following up", requestId } };
}
async function render(settlement: MessageSettlement | undefined = current) {
  await act(async () => root.render(h(NextStepRow, { item: { ...settlementAdmissionFixture(), settlement }, running: false, sessionId: "recipient" })));
}
function button(label: string): HTMLButtonElement {
  let b = [...document.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!b) {
    const more = node.querySelector<HTMLButtonElement>('button[aria-label="menu.more"]');
    if (more?.getAttribute("aria-expanded") === "false") act(() => more.click());
    b = [...document.querySelectorAll("button")].find(b => b.textContent === label);
  }
  if (!b) throw new Error(`Missing button ${label}: ${document.body.textContent}`);
  return b;
}
async function click(label: string) { const target = button(label); await act(async () => target.click()); }
async function reason(value = "已由主人另行核对，无需继续跟进") {
  await act(async () => {
    const input = document.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function confirm() { await click("关闭卡住消息"); await reason(); await click("确认关闭跟进"); }

describe("message settlement on the actual next-step row", () => {
  it("keeps three refusals as tooltip icons, with the full reason and row-specific reread in details", async () => {
    env.features.add(STALE_ACK_SETTLEMENT_FEATURE);
    useSettlementWrites.setState({ entries: Object.fromEntries([0, 1, 2].map(i => [
      settlementWriteKey("host-a", `refusal-${i}`), { phase: "error" as const, error: "ineligible" as const, authoritative: true },
    ])) });
    await act(async () => root.render(h("div", null, ...[0, 1, 2].map(i => h(NextStepRow, {
      key: i, item: { ...settlementAdmissionFixture(), id: `refusal-${i}`, settlement: undefined }, running: false, sessionId: "recipient",
    })))));
    const statuses = [...node.querySelectorAll('[data-testid="next-step-status"]')];
    expect(statuses).toHaveLength(3);
    expect(statuses.every(s => s.getAttribute("title") === "服务器暂不允许关闭" && s.textContent === "")).toBe(true);
    expect(document.body.textContent).not.toContain("服务器暂不允许关闭");
    expect(document.body.textContent).not.toContain("重新读取状态");
    expect(env.evidence).not.toHaveBeenCalled();
    const trigger = node.querySelector<HTMLButtonElement>('button[aria-label="menu.more"]')!;
    await act(async () => trigger.click());
    const panel = document.querySelector('[data-popover]')!;
    expect(panel.textContent).toContain("服务端当前不允许关闭此事项；可稍后重新读取。");
    expect(panel.querySelector('[aria-disabled="true"]')).not.toBeNull();
    expect(document.activeElement).toBe(panel.querySelector('[data-testid="hide-native-receipt"]'));
    const reread = [...panel.querySelectorAll("button")].find(b => b.textContent === "重新读取状态")!;
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(reread);
    await act(async () => reread.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(panel.querySelector('[data-testid="hide-native-receipt"]'));
    await act(async () => reread.click());
    expect(env.evidence).toHaveBeenCalledExactlyOnceWith({ messageId: "refusal-0" });
    expect(env.close).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[data-popover]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => node.querySelectorAll<HTMLButtonElement>('button[aria-label="menu.more"]')[1]!.click());
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="hide-native-receipt"]')!.click());
    expect(hiddenReceiptsOf("host-a").some(r => r.session === "recipient" && r.id === "refusal-1")).toBe(true);
    expect(env.close).not.toHaveBeenCalled();
  });

  it("retains cancellation confirmation and a pending submission across menu dismissal", async () => {
    env.cancelable = true;
    let finish!: (result: { ok: true }) => void;
    env.cancel.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => root.render(h(NextStepRow, { item: { ...settlementAdmissionFixture(), waitReason: undefined, settlement: undefined }, running: false, sessionId: "recipient", stuck: true })));
    const trigger = node.querySelector<HTMLButtonElement>('button[aria-label="menu.more"]')!;
    await act(async () => trigger.click());
    await click("cancelSend.action");
    await act(async () => trigger.click());
    expect(document.querySelector('[data-popover]')).toBeNull();
    await act(async () => trigger.click());
    await click("cancelSend.confirm");
    expect(env.cancel).toHaveBeenCalledTimes(1);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => trigger.click());
    expect(button("cancelSend.action").disabled).toBe(true);
    await click("cancelSend.action");
    expect(env.cancel).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true }));
  });

  it("keeps a failed state read distinct from an authoritative refusal", async () => {
    env.features.add(STALE_ACK_SETTLEMENT_FEATURE);
    useSettlementWrites.setState({ entries: { [settlementWriteKey("host-a", "m-settlement")]: { phase: "error", error: "unavailable" } } });
    await act(async () => root.render(h(NextStepRow, { item: { ...settlementAdmissionFixture(), settlement: undefined }, running: false, sessionId: "recipient" })));
    expect(node.querySelector('[data-testid="next-step-status"]')?.getAttribute("title")).toBe("状态暂不可用");
    expect(document.body.textContent).not.toContain("服务器暂不允许关闭");
    await act(async () => node.querySelector<HTMLButtonElement>('button[aria-label="menu.more"]')!.click());
    expect(document.querySelector('[data-popover]')!.textContent).toContain("服务暂不可用，请重新读取状态。");
    expect(env.close).not.toHaveBeenCalled();
  });
  it.each([
    { status: 429, code: "rate_limited" },
    { status: 403, code: "http_403" },
    { status: 409, code: "unrecognized_result" },
    { status: 408, code: "timeout" },
  ])("retains the immutable request for an unproven refusal %j, with no automatic retry", async (error) => {
    env.close.mockResolvedValueOnce({ ok: false, error });
    await render(); await confirm();
    const request = env.close.mock.calls[0]![0];
    expect(button("使用原请求重试").disabled).toBe(true);
    expect(env.close).toHaveBeenCalledTimes(1);
    expect(Object.values(JSON.parse(localStorage.getItem("cutex-desktop.messageSettlementIntents.v1")!))).toEqual([request]);
    await click("重新读取状态"); await click("使用原请求重试");
    expect(env.close.mock.calls[1]![0]).toEqual(request);
  });
  it.each([
    { id: "reader", isOwner: false },
    { id: "pending", isOwner: false, pending: true },
    { id: "owner", isOwner: true, scope: "read" },
    { id: "owner", isOwner: true, scope: "chat" },
  ])("denies a close with stale canClose evidence when caller authority is %j", async (user) => {
    noteHostAccess("host-a", { user });
    await render();
    expect(document.body.textContent).not.toContain("关闭卡住消息");
    await closeMessageFollowUp("host-a", "m-settlement", current, "reviewed", "recipient");
    expect(env.close).not.toHaveBeenCalled();
  });
  it("keeps a malformed successful response uncertain and retries only the original payload after a read", async () => {
    env.close.mockResolvedValueOnce({ ok: true, result: { messageId: "different", changed: true, settlement: closed() } });
    await render(); await confirm();
    const request = env.close.mock.calls[0]![0];
    expect(document.body.textContent).toContain("关闭操作的结果尚未确认");
    expect(document.body.textContent).not.toContain("已关闭跟进");
    expect(env.close).toHaveBeenCalledTimes(1);
    await click("重新读取状态");
    await click("使用原请求重试");
    expect(env.close.mock.calls[1]![0]).toEqual(request);
  });
  it("never hides uncertainty using a finished-turn heuristic; an explicit delivered confirmation clears it", () => {
    const store = useAgentMessages.getState();
    store.seed("recipient", [{ messageId: "m-settlement", fromCutexSessionId: "sender", body: "note", deliveryKind: "note", state: "inbox_accepted", sentAt: 100, settlement: current }], []);
    expect(pendingMessagesFor(useAgentMessages.getState().byId, "recipient", () => true, new Set(), 1000, true)).toHaveLength(1);
    store.apply({ receivedAt: new Date().toISOString(), cutex: { method: "cutex/agentBus/messageDelivered", params: { messageId: "m-settlement" } } } as never);
    expect(pendingMessagesFor(useAgentMessages.getState().byId, "recipient", () => true, new Set(), 1000, true)).toHaveLength(0);
    store.applySettlement("m-settlement", closed());
    expect(pendingMessagesFor(useAgentMessages.getState().byId, "recipient")).toEqual([]);
  });
  it("gates the action by both host feature and server canClose; never infers uncertainty from age, receipt or text", async () => {
    env.features.clear(); await render();
    expect(document.body.textContent).toContain("结果不确定"); expect(document.body.textContent).not.toContain("关闭卡住消息");
    env.features.add(MESSAGE_SETTLEMENT_FEATURE); await render({ ...current, canClose: false });
    expect(document.body.textContent).not.toContain("关闭卡住消息");
    await act(async () => root.render(h(NextStepRow, { item: { ...settlementAdmissionFixture(), settlement: undefined, preview: "Claude turn interrupted, result unknown", enqueuedAt: "2000-01-01T00:00:00Z" }, running: false })));
    expect(node.querySelector('[data-testid="timing-native-receipt"]')).not.toBeNull();
    expect(node.querySelector('[data-testid="timing-outcome-unknown"]')).toBeNull();
    expect(document.body.textContent).not.toContain("关闭卡住消息");
    expect(env.close).not.toHaveBeenCalled();
  });
  it("opens the same reason confirmation inside the row menu with exact disclaimer; cancel does not write; blank reasons stay disabled", async () => {
    await render(); await click("关闭卡住消息");
    expect(document.body.textContent).toContain("关闭跟进，不代表送达或处理成功");
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(button("确认关闭跟进").disabled).toBe(true);
    await reason("   "); expect(button("确认关闭跟进").disabled).toBe(true);
    await reason(); await click("取消");
    expect(env.close).not.toHaveBeenCalled(); expect(document.querySelector("input")).toBeNull();
  });
  it("disables controls while writing and sends one exact request, then refreshes server admission", async () => {
    let resolve!: (value: unknown) => void;
    env.close.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await render(); await click("关闭卡住消息"); await reason(); await click("确认关闭跟进");
    expect(document.querySelector("input")!.disabled).toBe(true); expect(button("取消").disabled).toBe(true);
    await click("正在确认…"); expect(env.close).toHaveBeenCalledTimes(1);
    const request = env.close.mock.calls[0]![0];
    expect(Object.keys(request).sort()).toEqual(["expectedEvidenceToken", "messageId", "reason", "requestId"]);
    expect(request).toMatchObject({ messageId: "m-settlement", expectedEvidenceToken: current.evidenceToken, reason: "已由主人另行核对，无需继续跟进" });
    await act(async () => resolve({ ok: true, result: { changed: true, messageId: request.messageId, settlement: closed(request.requestId) } }));
    expect(document.body.textContent).toContain("已关闭跟进"); expect(env.refresh).toHaveBeenCalledWith("recipient", "host-a");
  });
  it("refreshes on 409 and requires explicit confirmation against refreshed evidence", async () => {
    env.close.mockResolvedValueOnce({ ok: false, error: { status: 409, code: "settlement_evidence_changed", message: "changed" } });
    const old = current.evidenceToken; current = { ...current, evidenceToken: "fresh-evidence", evidence: { ...current.evidence, observedAt: "2099-01-01T00:00:00Z" } };
    await render({ ...current, evidenceToken: old }); await confirm();
    expect(env.close).toHaveBeenCalledTimes(1); expect(env.list).toHaveBeenCalledWith(0); expect(env.bootstrap).toHaveBeenCalledWith("recipient");
    expect(document.body.textContent).toContain("证据或状态已变化");
    await click("确认关闭跟进");
    expect(env.close.mock.calls[1]![0].expectedEvidenceToken).toBe("fresh-evidence");
    expect(env.close.mock.calls[1]![0].requestId).not.toBe(env.close.mock.calls[0]![0].requestId);
  });
  it("re-reads an uncertain write without resending, retains its key across unmount and explicitly retries the identical payload", async () => {
    env.close.mockRejectedValueOnce(new Error("IPC disconnected after write"));
    await render(); await confirm();
    expect(env.close).toHaveBeenCalledTimes(1); expect(env.list).toHaveBeenCalledTimes(1); expect(env.bootstrap).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("关闭操作的结果尚未确认"); expect(document.querySelector("input")!.disabled).toBe(true);
    const request = env.close.mock.calls[0]![0];
    expect(button("使用原请求重试").disabled).toBe(true);
    await act(async () => useAgentMessages.getState().applySettlement("m-settlement", current));
    expect(button("使用原请求重试").disabled).toBe(true);
    await closeMessageFollowUp("host-a", "m-settlement", current, "different reason", "recipient");
    expect(env.close).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null)); await render(); await click("关闭卡住消息"); await click("重新读取状态"); await click("使用原请求重试");
    expect(env.close.mock.calls[1]![0]).toEqual(request); expect(document.body.textContent).toContain("已关闭跟进");
  });
  it("recovers a committed close from a snapshot after a lost response, never retries automatically", async () => {
    env.close.mockImplementationOnce(async () => { current = closed(); throw new Error("lost response"); });
    await render(); await confirm();
    expect(document.body.textContent).toContain("已关闭跟进"); expect(env.close).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("使用原请求重试");
    expect(localStorage.getItem("cutex-desktop.messageSettlementIntents.v1")).toBe("{}");
  });
  it("keeps a 503 uncertain until a read, and never resends it automatically", async () => {
    env.close.mockResolvedValueOnce({ ok: false, error: { status: 503, code: "unavailable", message: "unavailable" } });
    await render(); await confirm();
    expect(env.close).toHaveBeenCalledTimes(1); expect(env.list).toHaveBeenCalledTimes(1);
    const request = env.close.mock.calls[0]![0];
    const persisted = JSON.parse(localStorage.getItem("cutex-desktop.messageSettlementIntents.v1")!);
    expect(Object.values(persisted)).toEqual([request]);
    await click("重新读取状态");
    await click("使用原请求重试"); expect(env.close.mock.calls[1]![0]).toEqual(request);
  });
  it.each([[403, "没有关闭此事项的权限"], [404, "未找到此事项"]])("shows a definitive %s refusal and refreshes without retrying", async (status, text) => {
    env.close.mockResolvedValueOnce({ ok: false, error: { status, code: status === 403 ? "owner_required" : "message_not_found", message: "refused" } });
    await render(); await confirm();
    expect(document.body.textContent).toContain(text); expect(env.close).toHaveBeenCalledTimes(1);
    expect(env.list).toHaveBeenCalledTimes(1); expect(env.refresh).toHaveBeenCalledTimes(1);
  });
  it("a missing row or failed reads cannot resolve an uncertain write or enable a blind retry", async () => {
    env.close.mockRejectedValueOnce(new Error("timeout")); env.list.mockResolvedValue({ messages: [] }); env.bootstrap.mockRejectedValue(new Error("offline"));
    await render(); await confirm();
    expect(button("使用原请求重试").disabled).toBe(true); expect(env.close).toHaveBeenCalledTimes(1);
    env.bootstrap.mockResolvedValue({ cutexState: { agentBusSentMessages: [{ messageId: "m-settlement", settlement: current }] } });
    await click("重新读取状态"); expect(button("使用原请求重试").disabled).toBe(false);
    expect(env.close).toHaveBeenCalledTimes(1);
  });
  it("clears stale eligibility after authoritative absence, keeps recheck UI and eventually retries the same immutable intent", async () => {
    const stale = current;
    useAgentMessages.getState().seed("recipient", [{ messageId: "m-settlement", settlement: stale }], []);
    env.close.mockRejectedValueOnce(new Error("lost write result"));
    env.list.mockResolvedValue({ messages: [{ messageId: "m-settlement" }] });
    env.bootstrap.mockResolvedValue({ cutexState: { agentBusMessages: [{ messageId: "m-settlement" }] } });
    await render(stale); await confirm();
    const request = env.close.mock.calls[0]![0];
    expect(useAgentMessages.getState().byId["m-settlement"]!.settlement).toBeUndefined();
    expect(button("使用原请求重试").disabled).toBe(true);
    expect(document.body.textContent).toContain("关闭操作的结果尚未确认");
    await act(async () => closeMessageFollowUp("host-a", "m-settlement", stale, "a new reason", "recipient"));
    expect(env.close).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    await act(async () => root.render(h(NextStepRow, { item: { ...settlementAdmissionFixture(), settlement: undefined }, running: false, sessionId: "recipient" })));
    expect(document.body.textContent).not.toContain("关闭卡住消息");
    await click("重新读取状态");
    env.bootstrap.mockResolvedValue({ cutexState: { agentBusMessages: [{ messageId: "m-settlement", settlement: current }] } });
    await click("重新读取状态");
    expect(button("使用原请求重试").disabled).toBe(false);
    await click("重新读取状态");
    await click("使用原请求重试");
    expect(env.close.mock.calls[1]![0]).toEqual(request);
  });
  it.each(["same", "older"])("honors authoritative canClose:false at a %s evidence timestamp over cached true", async (order) => {
    const stale = current;
    useAgentMessages.getState().seed("recipient", [{ messageId: "m-settlement", settlement: stale }], []);
    env.close.mockRejectedValueOnce(new Error("timeout"));
    const disabled = { ...stale, canClose: false, evidence: { ...stale.evidence, observedAt: order === "same" ? stale.evidence.observedAt : "2000-01-01T00:00:00Z" } };
    env.list.mockResolvedValue({ messages: [{ messageId: "m-settlement", settlement: disabled }] });
    env.bootstrap.mockResolvedValue({ cutexState: { agentBusMessages: [{ messageId: "m-settlement", settlement: disabled }] } });
    await render(stale); await confirm();
    expect(useAgentMessages.getState().byId["m-settlement"]!.settlement?.canClose).toBe(false);
    expect(button("使用原请求重试").disabled).toBe(true);
    await act(async () => closeMessageFollowUp("host-a", "m-settlement", stale, "new reason", "recipient"));
    expect(env.close).toHaveBeenCalledTimes(1);
  });
  it("keeps a proven closure sticky even when a later authoritative read has no sidecar", async () => {
    await render(); await confirm();
    env.list.mockResolvedValue({ messages: [] });
    env.bootstrap.mockResolvedValue({ cutexState: { agentBusMessages: [], agentBusSentMessages: [] } });
    await act(async () => {
      useAgentMessages.getState().reset();
      await recheckSettlement("host-a", "m-settlement", "recipient");
    });
    expect(document.body.textContent).toContain("已关闭跟进");
    expect(document.body.textContent).toContain("Owner has finished following up");
    expect(env.close).toHaveBeenCalledTimes(1);
  });
  it.each(["null", "delivered", "bootstrap"])("a live %s clear also disables stale row/write eligibility without discarding its unresolved key", async (kind) => {
    env.close.mockRejectedValueOnce(new Error("lost response"));
    await render(); await confirm();
    const request = env.close.mock.calls[0]![0];
    await act(async () => {
      const store = useAgentMessages.getState();
      if (kind === "bootstrap") store.seed("recipient", [{ messageId: "m-settlement" }], []);
      else store.apply({ receivedAt: new Date().toISOString(), cutex: { method: kind === "null" ? MESSAGE_SETTLEMENT_EVENT : "cutex/agentBus/messageDelivered", params: { messageId: "m-settlement", ...(kind === "null" ? { settlement: null, requestId: "clear-key" } : {}) } } } as never);
    });
    expect(button("使用原请求重试").disabled).toBe(true);
    await act(async () => closeMessageFollowUp("host-a", "m-settlement", current, "new reason", "recipient"));
    expect(env.close).toHaveBeenCalledTimes(1);
    expect(Object.values(JSON.parse(localStorage.getItem("cutex-desktop.messageSettlementIntents.v1")!))).toEqual([request]);
  });
  it("keeps closure visible on messaging status and cards after a late receipt, stale snapshot and duplicate settlement events", async () => {
    const store = useAgentMessages.getState();
    store.seed("recipient", [{ messageId: "m-settlement", settlement: current, state: "inbox_accepted" }], []);
    const event = { receivedAt: new Date().toISOString(), cutex: { method: MESSAGE_SETTLEMENT_EVENT, params: { messageId: "m-settlement", requestId: "key", settlement: closed() } } } as never;
    store.apply(event); const map = useAgentMessages.getState().byId;
    store.apply(structuredClone(event)); expect(useAgentMessages.getState().byId).toBe(map);
    store.apply({ receivedAt: new Date().toISOString(), cutex: { method: "cutex/agentBus/messageDelivered", params: { messageId: "m-settlement", turnId: "late" } } } as never);
    store.seed("sender", [], [{ messageId: "m-settlement", settlement: current, state: "pending" }]);
    await act(async () => root.render(h("div", null, h(SentStatus, { messageId: "m-settlement" }), h(MessageSettlementControl, { hostId: "host-a", messageId: "m-settlement" }))));
    expect(node.querySelector('[data-testid="sent-status"]')!.getAttribute("data-state")).toBe("closed");
    expect(document.body.textContent).toContain("Owner has finished following up"); expect(document.body.textContent).not.toContain("关闭卡住消息");
    expect(useAgentMessages.getState().byId["m-settlement"]!.turnId).toBe("late");
  });
});
