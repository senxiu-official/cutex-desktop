// @vitest-environment jsdom
// Owner 2026-11-26: the 等待中 tip of a delegation looked different from the app's tips, and in the composer's 委托
// float it never showed: the whole row's tip covered it. The status word (and its wait text) now use the app
// tooltip (`data-tip`, lib/tips) like the row, and lib/tips shows the innermost anchor: on the word, its own tip.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskSummary, ContinuationWait } from "../src/shared/ipc";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({ useStatusWord: () => (s: { key: string }) => `status:${s.key}` }));

const NOW = Date.parse("2026-11-26T05:00:00.000Z");
// lib/time's shared 30 s clock (useClock) reads Date.now() once when the module loads: freeze the clock before the
// imports below load it, or the wake 5 minutes after NOW reads as overdue on the real clock.
vi.useFakeTimers({ now: NOW });

const { delegationStatus } = await import("../src/renderer/src/lib/delegations");
const { DelegationStatusMark } = await import("../src/renderer/src/components/DelegationParts");
const { installTips, TIP_DELAY } = await import("../src/renderer/src/lib/tips");
vi.useRealTimers();

const wait: ContinuationWait = { state: "waiting", kind: "after", since: "2026-11-26T04:50:00.000Z", nextWakeAt: new Date(NOW + 5 * 60_000).toISOString() };
const row: AskSummary = {
  askId: "ask-8ab2f5", title: "你接替 macos-backend", requester: { kind: "agent", cutexSessionId: "cutex.lead", name: "Example Lead" }, target: "cutex.helper", targetName: "Helper",
  execution: "running", hold: null, review: null, closed: null, queuePosition: null, attempts: 3, answerId: null, openQuestions: 0, ownerQuestions: 0,
  createdAt: "2026-11-26T04:00:00.000Z", updatedAt: "2026-11-26T04:50:00.000Z", revision: 12,
  attempt: { n: 3, state: "yielded", turnId: "t3", startedAt: "2026-11-26T04:45:00.000Z", endedAt: "2026-11-26T04:50:00.000Z" },
  continuationWait: wait,
} as AskSummary;

let host: HTMLDivElement, root: Root, detach: () => void;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  detach = installTips(window);
});
afterEach(() => {
  detach();
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const over = (el: Element) => act(() => { el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })); vi.advanceTimersByTime(TIP_DELAY + 10); });
const out = (el: Element, to: Element | null) => act(() => { el.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: to })); });
const shown = () => document.querySelector("[data-tip-shown]")?.textContent ?? null;

describe("the status word's tip inside a row with its own tip", () => {
  it("uses the app tooltip, not a native title", () => {
    act(() => root.render(h(DelegationStatusMark, { status: delegationStatus(row), name: "Helper" })));
    const word = host.querySelector("[data-delegation-status-word]")!;
    expect(word.textContent).toBe("status:continuationWait");
    expect(word.getAttribute("data-tip")).toContain("delegation.cont.hintAfter");
    expect(word.className).toContain("decoration-dotted");
    expect(host.querySelector("[title]")).toBeNull();
  });

  it("on the word: the word's tip; on the rest of the row: the row's tip", () => {
    act(() => root.render(h("button", { "data-tip": "ROW TIP", "data-row": "" }, h("span", { "data-title": "" }, row.title), h(DelegationStatusMark, { status: delegationStatus(row), name: "Helper" }))));
    const rowEl = host.querySelector("[data-row]")!;
    const title = host.querySelector("[data-title]")!;
    const word = host.querySelector("[data-delegation-status-word]")!;
    over(title);
    expect(shown()).toBe("ROW TIP");
    out(title, word);
    over(word);
    expect(shown()).toContain("delegation.cont.hintAfter");
    expect(shown()).not.toContain("ROW TIP");
    out(word, title);
    over(title);
    expect(shown()).toBe("ROW TIP");
    expect(rowEl.contains(word)).toBe(true);
  });
});
