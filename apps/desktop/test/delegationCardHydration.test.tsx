// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AskDetail, AskSummary } from "../src/shared/ipc";

const mock = vi.hoisted(() => ({
  ask: vi.fn<() => Promise<AskDetail | null>>(), asks: vi.fn<() => Promise<AskSummary[]>>(async () => []),
  host: "", sidebar: { active: [], retired: [] },
  features: new Set<string>(),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: mock, apiFor: () => mock, bridge: { on: () => () => {} } }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (selector: (s: unknown) => unknown) => selector({ sidebar: mock.sidebar }) }));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({
  useConvHost: () => mock.host, useConvScope: () => null,
  useConvFeatures: () => mock.features,
  useConvView: (_id: string, select: (v: unknown) => unknown) => select(null),
  convSidebarOf: () => mock.sidebar,
}));
vi.mock("../src/renderer/src/lib/viewHost", () => ({ useViewRows: () => [] }));

import { ASKS_FEATURE, delegationStatus, type DelegateCall } from "../src/renderer/src/lib/delegations";
import { useCardDelegation, useResolvedAskId } from "../src/renderer/src/lib/delegationsView";
import { startDelegationSync, useDelegations } from "../src/renderer/src/lib/delegationStore";
import { focusHostId } from "../src/renderer/src/lib/hostKeys";

const id = "ask-b036befd8dec42f4972f39575e38ffca";
const call: DelegateCall = { askId: id, title: "Review", brief: null, created: true, targetId: "worker", targetName: "Worker",
  snapshot: { execution: "queued", hold: { reason: "heldByRuntime", native: "gate_closed" } },
};
let root: Root;
let container: HTMLDivElement;
let stop: () => void;
let seen: string[];
function Card({ refId }: { refId: string }) {
  const askId = useResolvedAskId(refId);
  const { d, live } = useCardDelegation(askId, call, "director");
  const text = `${live ? "live" : "transcript"}:${delegationStatus(d).key}`;
  seen.push(text);
  return h("p", null, text);
}
beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  mock.host = focusHostId();
  mock.features = new Set([ASKS_FEATURE]);
  mock.asks.mockClear();
  mock.ask.mockReset();
  seen = [];
  stop = startDelegationSync({ getState: () => ({ features: new Set([ASKS_FEATURE]), selectedId: null, selectedHost: null, byHost: {}, notify() {} }), subscribe: () => () => {} });
  useDelegations.getState().reset();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); stop(); });

it("loads a visible missing card when its host's capability arrives after mount", async () => {
  mock.features = new Set();
  const summary = { askId: id, revision: 24, execution: "answered", closed: "completed", hold: null,
    targetCutexSessionId: "worker", attempts: [] } as unknown as AskDetail;
  mock.ask.mockResolvedValue(summary);
  await act(async () => root.render(h(Card, { refId: id })));
  expect(mock.ask).not.toHaveBeenCalled();
  mock.features = new Set([ASKS_FEATURE]);
  await act(async () => root.render(h(Card, { refId: id })));
  expect(container.textContent).toBe("live:answered");
  expect(mock.ask).toHaveBeenCalledTimes(1);
});

it.each([id, "delegation-b036be", `delegation-${id.slice(4)}`])("replaces an old gate_closed tool snapshot with the directly loaded terminal record (%s)", async refId => {
  const summary = { askId: id, revision: 24, execution: "answered", closed: "completed", hold: null,
    requester: { kind: "agent", cutexSessionId: "director" }, target: "worker" } as AskSummary;
  mock.asks.mockResolvedValueOnce([summary]);
  mock.ask.mockResolvedValue({ ...summary, targetCutexSessionId: "worker", attempts: [] } as unknown as AskDetail);
  await act(async () => root.render(h(Card, { refId })));
  expect(seen).toContain("transcript:waitingResume");
  expect(container.textContent).toBe("live:answered");
  expect(mock.ask).toHaveBeenCalledWith(id);
  expect(mock.ask).toHaveBeenCalledTimes(1);
});
