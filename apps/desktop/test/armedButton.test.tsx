// @vitest-environment jsdom
// Click-twice in place (owner 2026-10-28: the delegation's 放弃 confirm jumped — the whole action row was
// replaced by 「再左键点击一次确认 [放弃]」). components/ArmedButton: the first click arms the same button
// (same label, same row, danger face + countdown) with a floating ArmedHint; the second runs the action;
// Esc / a reset key disarm. DelegationDetailBody's 停止 / 放弃 and the workflow run's 停止 / 删除 use it.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskSummary } from "../src/shared/ipc";

const run = vi.hoisted(() => vi.fn());
const t = (key: string) => key;
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({ ...(await importOriginal<object>()), useI18n: () => ({ locale: "en", t }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign((select: (value: unknown) => unknown) => select({ features: new Set(), activity: {}, sessions: {} }), { getState: () => ({ select: vi.fn() }) }), featuresOf: (s: { features: ReadonlySet<string> }) => s.features }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({
  useDelegationContext: () => () => ({}),
  useAgentNames: () => (id: string) => id,
  useCardDelegation: () => ({ d: null, live: true }),
  useResolvedAskId: (id: string) => id,
  useAgentProfile: () => null,
  useOwnerSteered: () => false,
}));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({
  hasDelegationViews: () => true,
  loadDelegationDetail: vi.fn(async () => null),
  delegationApi: () => ({}),
  useDelegations: (select: (s: unknown) => unknown) => select({ progress: {}, questions: {}, details: {} }),
}));
vi.mock("../src/renderer/src/lib/p2Access", () => ({ useP2Access: () => ({ files: true, attachments: true, delegations: true, owner: true }) }));
vi.mock("../src/renderer/src/lib/delegationMenu", () => ({ delegationMenu: vi.fn(() => []), runDelegationCommand: run }));
vi.mock("../src/renderer/src/lib/focusRequest", () => ({ focusDelegation: vi.fn(), focusTurn: vi.fn() }));
vi.mock("../src/renderer/src/lib/modelDisplay", () => ({ useModelName: () => (id: string) => id, rawIdTitle: () => "" }));
vi.mock("../src/renderer/src/components/Markdown", () => ({ Markdown: () => null }));
vi.mock("../src/renderer/src/components/Parties", () => ({ Who: () => null }));
vi.mock("../src/renderer/src/components/PeerParty", () => ({ PeerParty: () => null }));
vi.mock("../src/renderer/src/components/DelegationComposer", () => ({ OwnerSteeredBadge: () => null }));
vi.mock("../src/renderer/src/components/DelegationPeer", () => ({ DelegationPeerSection: () => null }));
vi.mock("../src/renderer/src/components/DelegationReview", () => ({ DelegationReviewActions: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ArmedButton } = await import("../src/renderer/src/components/ArmedButton");
const { DelegationDetailBody } = await import("../src/renderer/src/components/DelegationCard");

const ask = (over: Partial<AskSummary> = {}): AskSummary =>
  ({
    askId: "ask-1", title: "复核 sidebar 的虚拟列表", requester: { kind: "agent", cutexSessionId: "director" }, target: "worker", targetName: "Worker",
    execution: "answered", review: "awaitingAcceptance", closed: null, attempts: 1, revision: 4, attempt: null, createdAt: "2026-10-28T00:00:00Z", updatedAt: "2026-10-28T00:00:00Z", ...over,
  }) as AskSummary;

let root: Root;
let host: HTMLDivElement;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const byTestId = (id: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent);
const hint = () => [...document.body.querySelectorAll<HTMLElement>("[role=status]")].map((e) => e.textContent).join("|");

beforeEach(() => {
  run.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ArmedButton", () => {
  it("arms in place with a floating hint; the second click confirms; Esc disarms", async () => {
    const confirm = vi.fn();
    const armedLog: boolean[] = [];
    act(() => root.render(h(ArmedButton, { shape: "px-2", idle: "text-muted", hint: "Click again to stop", onConfirm: confirm, onArmedChange: (a: boolean) => armedLog.push(a), testId: "b", children: "Stop" })));
    const button = byTestId("b")!;
    act(() => button.click());
    expect(byTestId("b")).toBe(button);
    expect(button.textContent).toBe("Stop");
    expect(button.dataset.armed).toBe("true");
    expect(button.className).toContain("armed-countdown");
    expect(button.className).toContain("px-2");
    expect(hint()).toContain("Click again to stop");
    expect(host.contains(document.body.querySelector("[role=status]"))).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(button.dataset.armed).toBeUndefined();
    expect(hint()).not.toContain("Click again to stop");
    act(() => button.click());
    act(() => button.click());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(button.dataset.armed).toBeUndefined();
    expect(armedLog).toEqual([false, true, false, true, false]);
  });

  it("a changed reset key or disabled drops the armed state", () => {
    const confirm = vi.fn();
    const render = (key: number, disabled = false) => act(() => root.render(h(ArmedButton, { shape: "", idle: "", hint: "again", onConfirm: confirm, resetKey: key, disabled, testId: "b", children: "Delete" })));
    render(1);
    act(() => byTestId("b")!.click());
    expect(byTestId("b")!.dataset.armed).toBe("true");
    render(2);
    expect(byTestId("b")!.dataset.armed).toBeUndefined();
    act(() => byTestId("b")!.click());
    render(2, true);
    expect(byTestId("b")!.dataset.armed).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("delegation 放弃 confirms in place (DelegationDetailBody)", () => {
  it("the row keeps its buttons; 放弃 arms itself, the hint floats; the second click abandons", async () => {
    act(() => root.render(h(DelegationDetailBody, { d: ask(), brief: null, here: null, host: "remote", layout: "side" })));
    await flush();
    const before = buttons();
    expect(before).toContain("delegation.abandon");
    const abandon = byTestId("delegation-abandon")!;
    act(() => abandon.click());
    // Same element, same label, same row: nothing replaced, nothing moved.
    expect(byTestId("delegation-abandon")).toBe(abandon);
    expect(buttons()).toEqual(before);
    expect(abandon.dataset.armed).toBe("true");
    expect(host.textContent).not.toContain("delegation.again");
    expect(hint()).toContain("delegation.abandonConfirm delegation.again");
    // The card frame says so too.
    expect(host.querySelector(".border-danger\\/70")).not.toBeNull();
    expect(run).not.toHaveBeenCalled();
    act(() => abandon.click());
    expect(run).toHaveBeenCalledWith("remote", expect.objectContaining({ askId: "ask-1" }), "cutex/ask/close", t, "abandoned");
  });

  it("停止 on a running delegation arms in place too", async () => {
    act(() => root.render(h(DelegationDetailBody, { d: ask({ execution: "running", review: null, attempt: { n: 1, state: "running", turnId: "t1", startedAt: "2026-10-28T00:00:00Z" } as AskSummary["attempt"] }), brief: null, here: null, host: "local", layout: "side" })));
    await flush();
    const before = buttons();
    const stop = byTestId("delegation-stop")!;
    act(() => stop.click());
    expect(buttons()).toEqual(before);
    expect(hint()).toContain("delegation.stopConfirm delegation.again");
    act(() => stop.click());
    expect(run).toHaveBeenCalledWith("local", expect.objectContaining({ askId: "ask-1" }), "cutex/ask/stop", t);
  });
});
