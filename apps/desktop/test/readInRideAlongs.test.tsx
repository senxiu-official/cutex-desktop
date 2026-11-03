// @vitest-environment jsdom
// 接下来 rows read in already (owner 2026-10-24): a Claude agent's wake / tell showed in the timeline at its
// turn's start but its 接下来 row stayed until the turn ended — the Claude adapter acknowledges a turn's inputs
// (cutex then drops them from admission.nextStep) only with the terminal result. Replays that event order
// through the real timeline reducer: the row leaves with the item, comes back if cutex still lists it a grace
// after the turn ended (handed back), and never hides by text.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdmissionNextStep } from "@cutex-desktop/protocol";
import { applyEvent, emptyTimeline, type TimelineState } from "../src/renderer/src/lib/timeline";
import { READ_IN_GRACE_S, unreadNextStep, useUnreadNextStep } from "../src/renderer/src/lib/legacyDelivery/readInRideAlongs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = 1_792_800_000; // unix s
const ride = (id: string, deliveryKind = "tell"): AdmissionNextStep => ({ id, deliveryKind, label: null, enqueuedAt: new Date(T0 * 1000).toISOString(), preview: "hello" });
const native = (method: string, params: Record<string, unknown>) => ({ native: { kind: "notification", message: { method, params: { threadId: "t", ...params } } } }) as never;
const turnStarted = (s: TimelineState, id: string, at = T0) => applyEvent(s, native("turn/started", { turn: { id, status: "inProgress", items: [], startedAt: at } }));
const turnCompleted = (s: TimelineState, id: string, status: string, at: number) => applyEvent(s, native("turn/completed", { turn: { id, status, items: [], completedAt: at } }));
/** The Claude adapter's item of an external input (cute_claude/store.py external_item): id = the bus message id. */
const externalItem = (s: TimelineState, turnId: string, messageId: string) => {
  const item = { type: "functionCallOutput", id: messageId, name: "external_event", namespace: "external", output: JSON.stringify({ source: { kind: "agent", id: "cutex.sender" }, type: "agent_message", text: "hello" }), externalInputView: null };
  applyEvent(s, native("item/started", { turnId, item }));
  applyEvent(s, native("item/completed", { turnId, item }));
};
const ids = (rows: AdmissionNextStep[]) => rows.map((r) => r.id);

describe("unreadNextStep", () => {
  it("Claude order: turn/started → item shown → (cutex still lists it until the turn ends) — the row leaves with the item", () => {
    const s = emptyTimeline();
    const listed = [ride("msg-1"), ride("msg-2")];
    expect(ids(unreadNextStep(listed, s, T0).rows)).toEqual(["msg-1", "msg-2"]);
    turnStarted(s, "turn-1");
    expect(ids(unreadNextStep(listed, s, T0).rows)).toEqual(["msg-1", "msg-2"]);
    externalItem(s, "turn-1", "msg-1");
    const { rows, recheckAt } = unreadNextStep(listed, s, T0 + 30);
    expect(ids(rows)).toEqual(["msg-2"]);
    expect(recheckAt).toBeNull();
  });

  it("after the turn ends: hidden for READ_IN_GRACE_S (cutex's receipt / queue/list in flight), then cutex's list decides again", () => {
    const s = emptyTimeline();
    turnStarted(s, "turn-1");
    externalItem(s, "turn-1", "msg-1");
    turnCompleted(s, "turn-1", "interrupted", T0 + 100);
    const listed = [ride("msg-1")];
    const during = unreadNextStep(listed, s, T0 + 101);
    expect(during.rows).toEqual([]);
    expect(during.recheckAt).toBe(T0 + 100 + READ_IN_GRACE_S);
    expect(ids(unreadNextStep(listed, s, T0 + 100 + READ_IN_GRACE_S).rows)).toEqual(["msg-1"]);
  });

  it("matches by id only: the same text under another id stays; nothing hidden = the same array", () => {
    const s = emptyTimeline();
    turnStarted(s, "turn-1");
    externalItem(s, "turn-1", "other-id");
    const listed = [ride("msg-1")];
    expect(unreadNextStep(listed, s, T0).rows).toBe(listed);
    expect(unreadNextStep(listed, null, T0).rows).toBe(listed);
  });
});

describe("useUnreadNextStep", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement;
  function Probe({ nextStep, timeline, rev }: { nextStep: AdmissionNextStep[]; timeline: TimelineState; rev: number }) {
    return h("span", null, useUnreadNextStep(nextStep, timeline, rev).map((r) => r.id).join(","));
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 * 1000);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root?.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("re-renders when the timeline (mutated in place) moves, and shows a still-listed row again once the grace ends", () => {
    const s = emptyTimeline();
    const listed = [ride("msg-1")];
    const render = (rev: number) => act(() => root!.render(h(Probe, { nextStep: listed, timeline: s, rev })));
    turnStarted(s, "turn-1", T0);
    render(1);
    expect(host.textContent).toBe("msg-1");
    externalItem(s, "turn-1", "msg-1");
    render(2);
    expect(host.textContent).toBe("");
    turnCompleted(s, "turn-1", "failed", T0);
    render(3);
    expect(host.textContent).toBe("");
    act(() => void vi.advanceTimersByTime(READ_IN_GRACE_S * 1000 + 100));
    expect(host.textContent).toBe("msg-1");
  });
});
