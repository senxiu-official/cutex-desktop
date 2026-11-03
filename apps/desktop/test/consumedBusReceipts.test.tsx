// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdmissionNextStep } from "@cutex-desktop/protocol";
import { emptyTimeline, type TimelineEntry, type TimelineState, type TurnStatus } from "../src/renderer/src/lib/timeline";

const mock = vi.hoisted(() => ({ sessions: {} as Record<string, { timeline: unknown; version?: number }> }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: (selector: (s: unknown) => unknown) => selector({ sessions: mock.sessions }),
  viewOf: (_s: unknown, host: string, session: string) => mock.sessions[`${host}/${session}`],
}));
import { consumedBusReceiptIds, useUnsettledBusReceipts } from "../src/renderer/src/lib/legacyDelivery/consumedBusReceipts";
import { dismissReceipt } from "../src/renderer/src/lib/legacyDelivery/busReceiptVisibility";

const receipt = (id: string, over: Partial<AdmissionNextStep> = {}): AdmissionNextStep => ({ id, deliveryKind: "tell", from: "Claude Task", enqueuedAt: "2026-10-28T06:41:15Z", waitReason: "nativeReceipt", ...over });
const received = (id: string, turnId: string): TimelineEntry => ({ kind: "received", id, turnId, message: { senderId: "Claude Task", senderName: "Claude Task", deliveryMode: "soon", text: "Task ended", schema: "cutex.claude-task.v1", data: {}, eventType: "claude_task", sourceKind: "service" } });
function history(status: TurnStatus = "completed", id = "ctask-exact"): TimelineState {
  const timeline = emptyTimeline();
  timeline.threadId = "native-thread";
  timeline.turns.push({ id: "input-turn", status, startedAt: 1, completedAt: status === "inProgress" ? null : 2, entryIds: [id] });
  timeline.entries.set(id, received(id, "input-turn"));
  return timeline;
}

describe("positive consumption evidence", () => {
  it("settles only an exact accepted message in its completed input turn", () => {
    const items = [receipt("ctask-exact"), receipt("ctask-other"), receipt("ctask-exac")];
    expect([...consumedBusReceiptIds(items, history())]).toEqual(["ctask-exact"]);
  });
  it.each(["failed", "interrupted", "inProgress"] as const)("does not mistake a presented input in a %s turn for consumption", status => {
    const timeline = history(status);
    timeline.turns.push({ id: "later-turn", status: "completed", startedAt: 3, completedAt: 4, entryIds: [] });
    expect([...consumedBusReceiptIds([receipt("ctask-exact")], timeline)]).toEqual([]);
  });
  it("does not match a tool/assistant row, missing history, or a received item without its completed turn", () => {
    const timeline = history();
    timeline.entries.set("ctask-exact", { kind: "agent", id: "ctask-exact", text: "done", turnId: "input-turn", streaming: false });
    expect(consumedBusReceiptIds([receipt("ctask-exact")], timeline).size).toBe(0);
    expect(consumedBusReceiptIds([receipt("ctask-exact")], null).size).toBe(0);
    timeline.entries.set("ctask-exact", received("ctask-exact", "missing-turn"));
    expect(consumedBusReceiptIds([receipt("ctask-exact")], timeline).size).toBe(0);
    timeline.entries.set("ctask-exact", received("ctask-exact", "input-turn"));
    timeline.turns[0]!.entryIds = [];
    expect(consumedBusReceiptIds([receipt("ctask-exact")], timeline).size).toBe(0);
  });
  it("does not hide delegations or inputs that the daemon has not accepted", () => {
    expect(consumedBusReceiptIds([receipt("ctask-exact", { askId: "ask-related" })], history()).size).toBe(0);
    expect(consumedBusReceiptIds([receipt("ctask-exact", { waitReason: undefined })], history()).size).toBe(0);
  });
});

let root: Root;
let container: HTMLDivElement;
let scope: { host: string; session: string };
const items = [receipt("ctask-exact"), receipt("ctask-uncertain")];
function Probe() {
  const shown = useUnsettledBusReceipts(scope.host, scope.session, items);
  return h("p", null, shown.map(item => item.id).join(","));
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  scope = { host: `host-${crypto.randomUUID()}`, session: "worker" };
  mock.sessions = {};
  container = document.createElement("div"); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); });

it("updates the one queue projection on consumption and retains the exact observation after history paging", async () => {
  const timeline = history("failed");
  mock.sessions[`${scope.host}/${scope.session}`] = { timeline, version: 1 };
  await act(async () => root.render(h(Probe)));
  expect(container.textContent).toBe("ctask-exact,ctask-uncertain");
  // The actual timeline reducer mutates this object and publishes a new view version.
  timeline.turns[0]!.status = "completed";
  mock.sessions[`${scope.host}/${scope.session}`] = { timeline, version: 2 };
  await act(async () => root.render(h(Probe)));
  expect(container.textContent).toBe("ctask-uncertain");
  mock.sessions = {};
  await act(async () => root.render(h(Probe)));
  expect(container.textContent).toBe("ctask-uncertain");
});

it("reacts to local dismissal and does not share hidden/evidence IDs with another host or agent", async () => {
  await act(async () => root.render(h(Probe)));
  await act(async () => dismissReceipt(scope.host, scope.session, items[0]!));
  expect(container.textContent).toBe("ctask-uncertain");
  scope = { ...scope, host: "other-host" };
  await act(async () => root.render(h(Probe)));
  expect(container.textContent).toBe("ctask-exact,ctask-uncertain");
  scope = { ...scope, session: "other-agent" };
  await act(async () => root.render(h(Probe)));
  expect(container.textContent).toBe("ctask-exact,ctask-uncertain");
});
