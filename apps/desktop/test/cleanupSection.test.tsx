// @vitest-environment jsdom
// Settings → 协作 → 高级 → 待清理: three collapsed categories with counts, compact tables whose rows open
// their details, cleanups only through the host's routes (or the local hide state for hidden receipts).
import { act, createElement as h, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AskSummary, StuckBusMessage } from "../src/shared/ipc";

const env = vi.hoisted(() => ({
  features: new Set<string>(),
  api: { stuckBusMessages: vi.fn(), discardStuckBusMessage: vi.fn(), asks: vi.fn() },
  command: vi.fn(),
}));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: () => env.api, bridge: {} }));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  const useApp = create(() => ({ hosts: { active: "host" } }));
  return { useApp, featuresOf: () => env.features, viewOf: () => undefined };
});
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}${JSON.stringify(vars)}` : key) }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => "host", useTargetApi: () => env.api, useTargetFeatures: () => env.features }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostData: () => ({ daemon: { kind: "connected" }, sidebar: null }) }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({ delegationCommand: env.command }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({ useStatusWord: () => (status: { key: string }) => status.key }));
vi.mock("../src/renderer/src/lib/p2Access", () => ({ p2AccessNow: () => ({ delegations: true }) }));
vi.mock("../src/renderer/src/lib/focusRequest", () => ({ focusDelegation: vi.fn() }));
vi.mock("../src/renderer/src/components/settings/Form", () => {
  const box = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return {
    Section: ({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) => h("section", null, h("h3", null, title), actions, children),
    SettingsGroup: box, EmptyState: box, ErrorNote: box, Notice: box, Loading: () => null,
    Select: () => null, RefreshButton: () => null,
    IconButton: ({ children, onClick }: { children: ReactNode; onClick(): void }) => h("button", { onClick }, children),
    TextLink: ({ children, onClick }: { children: ReactNode; onClick(): void }) => h("button", { onClick }, children),
  };
});

import { CleanupSection } from "../src/renderer/src/modules/agent-bus/CleanupSection";
import { dismissReceipt } from "../src/renderer/src/lib/legacyDelivery/busReceiptVisibility";
import { useCleanupFocus } from "../src/renderer/src/lib/cleanupNav";
import { latestReceiptState } from "./receiptVisibilityStorage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ago = (secs: number) => new Date(Date.now() - secs * 1000).toISOString();
const message = (id: string, extra: Partial<StuckBusMessage> = {}): StuckBusMessage => ({
  messageId: id, state: "pending", durable: true, to: { id: "rei", name: "Rei" }, from: { id: "beta", name: "Beta" }, ageSecs: 7200, createdAtEpochSecs: null,
  senderKind: "cutex", protectedControl: false, nativeSubmissionPresent: false, semanticSha256: `sha-${id}`, errorCode: null, errorMessage: null, reasons: [], contentPreview: `text of ${id}`, ...extra,
});
const ask = (askId: string, extra: Partial<AskSummary>): AskSummary => ({
  askId, title: `task ${askId}`, requester: { kind: "agent", cutexSessionId: "alice", name: "Alice" }, target: "bob", targetName: "Bob",
  execution: "queued", attempts: 1, createdAt: ago(3 * 86_400), updatedAt: ago(2 * 86_400), revision: 1, ...extra,
});

let root: ReturnType<typeof createRoot>, node: HTMLDivElement;
let session: string;
let serial = 0;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cutex-desktop.stuckBusMinAge", "3600");
  session = `cleanup-${++serial}`;
  env.features = new Set(["agent-bus-stuck-messages", "agent-asks"]);
  env.api.stuckBusMessages.mockResolvedValue({ messages: [message("plain"), message("job", { protectedControl: true, senderKind: "job_service", errorCode: "runtime_down", errorMessage: "runtime is down" })], total: 2, liveQueueAvailable: true, liveQueueError: null, minAgeSecs: 3600 });
  env.api.discardStuckBusMessage.mockResolvedValue({ ok: true, discarded: { messageId: "plain", discarded: true, changed: true, liveWithdrawError: null } });
  env.api.asks.mockResolvedValue([
    ask("stalled", { execution: "interrupted", attempt: { n: 1, lastError: "usage limit" } }),
    ask("running", { execution: "running", updatedAt: ago(5 * 86_400) }),
    ask("fresh", { updatedAt: ago(60) }),
  ]);
  env.command.mockReset().mockResolvedValue({ ok: true });
  useCleanupFocus.setState({ category: null, nonce: 0 });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

const q = (id: string) => node.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string) => [...node.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const header = (category: string) => q(`cleanup-${category}`)!.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
async function mount() {
  await act(async () => root.render(h(CleanupSection)));
}
async function click(el: HTMLElement) {
  await act(async () => el.click());
}

it("every category starts collapsed and shows its count", async () => {
  dismissReceipt("host", session, { id: "hidden-1", deliveryKind: "tell", waitReason: "nativeReceipt", enqueuedAt: ago(600) });
  await mount();
  expect(q("cleanup-delegations-count")?.textContent).toBe("1");
  expect(q("cleanup-messages-count")?.textContent).toBe("2");
  expect(Number(q("cleanup-receipts-count")?.textContent)).toBeGreaterThanOrEqual(1);
  for (const c of ["delegations", "messages", "receipts"]) expect(header(c).getAttribute("aria-expanded")).toBe("false");
  expect(q("stuck-messages")).toBeNull();
  expect(q("stale-delegation")).toBeNull();
  expect(q("hidden-receipt")).toBeNull();
});

it("categories without a host route are left out", async () => {
  env.features = new Set();
  await mount();
  expect(q("cleanup-delegations")).toBeNull();
  expect(q("cleanup-messages")).toBeNull();
  expect(q("cleanup-receipts")).not.toBeNull();
  expect(env.api.asks).not.toHaveBeenCalled();
  expect(env.api.stuckBusMessages).not.toHaveBeenCalled();
});

it("stuck messages: a compact table; a row opens its details; 全部丢弃 leaves job / control messages to their own row", async () => {
  await mount();
  await click(header("messages"));
  expect(all("stuck-messages-row")).toHaveLength(2);
  expect(q("stuck-messages-details")).toBeNull();
  const jobRow = all("stuck-messages-row").find((r) => r.dataset.rowId === "job")!;
  await click(jobRow);
  const details = q("stuck-messages-details")!;
  expect(details.textContent).toContain("text of job");
  expect(details.textContent).toContain("runtime_down · runtime is down");
  expect(details.textContent).toContain("agent-bus.stuck.hint.protected");
  // 全部丢弃: armed hint names one message; the confirm discards only the plain one.
  const bulk = q("stuck-discard-all")!;
  await click(bulk);
  expect(bulk.getAttribute("aria-label")).toBe('agent-bus.stuck.discardAllArmed{"n":1}');
  await click(bulk);
  expect(env.api.discardStuckBusMessage).toHaveBeenCalledTimes(1);
  expect(env.api.discardStuckBusMessage).toHaveBeenCalledWith({ messageId: "plain", expectedSemanticSha256: "sha-plain" });
});

it("a protected message is discarded on its own row, with the warning on the armed button; the click does not open the row", async () => {
  await mount();
  await click(header("messages"));
  const jobRow = all("stuck-messages-row").find((r) => r.dataset.rowId === "job")!;
  const discard = jobRow.querySelector<HTMLButtonElement>('[data-testid="stuck-discard"]')!;
  await click(discard);
  expect(discard.getAttribute("aria-label")).toBe("agent-bus.cleanup.discardProtectedArmed");
  expect(q("stuck-messages-details")).toBeNull();
  await click(discard);
  expect(env.api.discardStuckBusMessage).toHaveBeenCalledWith({ messageId: "job", expectedSemanticSha256: "sha-job", allowProtected: true });
});

it("stalled delegations: only open, not-running ones unchanged past the filter; 放弃 goes through the owner command", async () => {
  await mount();
  await click(header("delegations"));
  expect(all("stale-delegation-row").map((r) => r.dataset.rowId)).toEqual(["stalled"]);
  await click(all("stale-delegation-row")[0]!);
  expect(q("stale-delegation-details")?.textContent).toContain("usage limit");
  const abandon = q("stale-delegation-abandon")!;
  await click(abandon);
  expect(env.command).not.toHaveBeenCalled();
  await click(abandon);
  expect(env.command).toHaveBeenCalledWith("host", expect.objectContaining({ askId: "stalled" }), "cutex/ask/close", "abandoned");
  expect(env.api.asks).toHaveBeenCalledTimes(2);
});

it("hidden receipts: 恢复显示 un-hides locally (no host call) and the count follows", async () => {
  dismissReceipt("host", session, { id: "only", deliveryKind: "bus", waitReason: "nativeReceipt", enqueuedAt: ago(600) });
  await mount();
  const before = Number(q("cleanup-receipts-count")!.textContent);
  await click(header("receipts"));
  const row = all("hidden-receipt-row").find((r) => r.dataset.rowId === JSON.stringify([session, "only"]))!;
  await click([...row.querySelectorAll("button")].find((b) => b.textContent === "queue.receipt.restore")!);
  expect(latestReceiptState("host", session, "only")).toBe("restored");
  expect(Number(q("cleanup-receipts-count")!.textContent)).toBe(before - 1);
  expect(env.command).not.toHaveBeenCalled();
});

it("a link (接下来's menu) opens its category", async () => {
  await mount();
  expect(header("receipts").getAttribute("aria-expanded")).toBe("false");
  await act(async () => useCleanupFocus.setState({ category: "receipts", nonce: 1 }));
  expect(header("receipts").getAttribute("aria-expanded")).toBe("true");
  expect(header("messages").getAttribute("aria-expanded")).toBe("false");
});
