// @vitest-environment jsdom
// Design 040 step 10: the turn footer's actions are one small floating bar (role=toolbar, shadow-e2) that shows on
// hover / keyboard focus and stays in the Tab order (opacity only); 复制 · 分叉 · active ref.action items · ⋯, where ⋯
// holds 引用 / 回退 and every ref.action item (lib/refActions refActionEntries). The 已回复 line sits at the row's start.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ menus: [] as unknown[][], refButtons: [] as { hoverBar?: boolean }[], skipInline: [] as boolean[] }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ openMenuFrom: (_a: unknown, entries: unknown[]) => fx.menus.push(entries) }));
vi.mock("../src/renderer/src/lib/refActions", () => ({ refActionEntries: (_ref: unknown, lead: boolean, skipInline: boolean) => (fx.skipInline.push(skipInline), [...(lead ? ["separator"] : []), { label: "notes.addToTurn", onSelect() {} }, { label: "side-chat.open", onSelect() {} }]) }));
vi.mock("../src/renderer/src/components/RefActions", () => ({
  RefActionButtons: (p: { hoverBar?: boolean }) => {
    fx.refButtons.push(p);
    return null;
  },
}));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ forkSession: vi.fn(() => Promise.resolve()), revertTo: vi.fn(() => Promise.resolve()), insertIntoComposer: vi.fn() }) }),
}));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({ convFeaturesOf: () => new Set(["fork", "revert", "cutex/session/fork", "cutex/session/revert"]), convNotify: vi.fn(), useConvScope: () => null, useConvViewHost: () => "local" }));
vi.mock("../src/renderer/src/lib/menus", () => ({ quoteText: (t: string) => `> ${t}`, SESSION_FEATURES: { fork: "fork", revert: "revert" } }));
vi.mock("../src/renderer/src/lib/agentFeatures", () => ({ canRewindFiles: () => false, lacks: () => false }));
vi.mock("../src/renderer/src/lib/agentFeaturesView", () => ({ useAgentFeatures: () => null }));
vi.mock("../src/renderer/src/lib/structuralGateView", () => ({ structuralBlockText: () => "", structuralErrorText: () => ({ text: "", refused: false }), useStructuralBlock: () => null }));
vi.mock("../src/renderer/src/lib/refServices", () => ({ turnRefNow: () => ({ hostId: "local", kind: "turn", key: "s:t", title: "t", params: {} }) }));
vi.mock("../src/renderer/src/lib/copyFeedback", () => ({ copyQuietly: () => Promise.resolve() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ReplyActions, UserActions } = await import("../src/renderer/src/components/MessageActions");

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
const bar = { turnId: "t1", text: "done", latest: true, nextTurnId: "t2", laterTurns: 1 } as never;
const q = (sel: string) => host.querySelector<HTMLElement>(sel)!;

beforeEach(() => {
  fx.menus = [];
  fx.refButtons = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

describe("the reply's floating action bar", () => {
  it("is a toolbar shown on hover / focus only (also for the latest reply), its buttons still in the Tab order", () => {
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false })));
    const tb = q('[data-reply-bar][role="toolbar"]');
    expect(tb.className).toContain("opacity-0");
    expect(tb.className).toContain("focus-within:opacity-100");
    expect(tb.className).toContain("shadow-e2");
    const buttons = [...tb.querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["reply.copy", "reply.fork", "gutter.more"]);
    for (const b of buttons) expect(b.tabIndex).toBe(0);
    // Inline ref.action items: only the ones whose state is on.
    expect(fx.refButtons.at(-1)?.hoverBar).toBe(true);
  });

  it("⋯ holds 引用 / 回退 and then every ref.action item", () => {
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false })));
    const more = q('[aria-label="gutter.more"]');
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    act(() => more.click());
    const labels = fx.menus.at(-1)!.map((e) => (e === "separator" ? "—" : (e as { label: string }).label));
    expect(labels).toEqual(["reply.quote", "reply.revert", "—", "notes.addToTurn", "side-chat.open"]);
    // The inline items (书签) are icons on the bar already: not repeated in ⋯.
    expect(fx.skipInline.at(-1)).toBe(true);
  });

  it("回退 from ⋯ arms in the bar and keeps it shown until confirmed", () => {
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false })));
    act(() => q('[aria-label="gutter.more"]').click());
    const revert = fx.menus.at(-1)!.find((e) => (e as { label?: string }).label === "reply.revert") as { onSelect(): void };
    act(() => revert.onSelect());
    expect(q("[data-reply-bar]").className).toContain("opacity-100");
    expect(q("[data-reply-bar]").textContent).toContain("reply.revertArmed");
  });

  it("the status line (已回复 …) sits at the row's start, the bar at its end", () => {
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false, status: h("span", { "data-status": "" }, "replied") })));
    const row = q("[data-reply-row]");
    expect(row.firstElementChild?.hasAttribute("data-status")).toBe(true);
    expect(row.lastElementChild?.hasAttribute("data-reply-bar")).toBe(true);
  });

  it("read-only history: copy only (nothing for ⋯, no ref.action items)", () => {
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: true })));
    expect([...q("[data-reply-bar]").querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["reply.copy"]);
  });
});

describe("the user bubble's bar", () => {
  it("the same pill, right-aligned; ⋯ lists the ref.action items", () => {
    act(() => root!.render(h(UserActions, { sessionId: "s", text: "hi", turnId: "t1", dropped: 0, canRevert: false })));
    const tb = q('[data-user-bar][role="toolbar"]');
    expect(tb.className).toContain("shadow-e2");
    expect(tb.parentElement?.className).toContain("justify-end");
    act(() => q('[aria-label="gutter.more"]').click());
    expect(fx.menus.at(-1)!.map((e) => (e as { label: string }).label)).toEqual(["notes.addToTurn", "side-chat.open"]);
  });
});
