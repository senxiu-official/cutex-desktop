// @vitest-environment jsdom
// Design 040 step 10: the turn footer's actions are one small floating bar (role=toolbar, shadow-e2) that shows on
// hover / keyboard focus and stays in the Tab order (opacity only). 操作栏 pins (owner 2026-11-28, lib/turnBarPins):
// the bar shows the pinned actions in pin order (by default today's 复制 · 分叉 / 复制 · 回退并编辑 and the inline
// ref.action items such as 书签), then any module action whose state is on, then ⋯ — every action with a pin
// toggle, pinned first. Right-clicking a pinned icon unpins it. The 已回复 line sits at the row's start.
import { act, createElement as h, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Action = { label: string; onSelect(): void; toggle?: { on: boolean; onToggle(next: boolean): void } };
const fx = vi.hoisted(() => ({ menus: [] as unknown[][], ctx: [] as unknown[][], prefs: { turnBarPins: {} as Record<string, string[] | null> }, listeners: new Set<() => void>(), notesActive: false }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({
  openMenuFrom: (_a: unknown, entries: unknown[]) => fx.menus.push(entries.filter(Boolean)),
  contextMenu: (build: () => unknown[]) => (e: { preventDefault(): void }) => (e.preventDefault(), fx.ctx.push(build())),
}));
vi.mock("../src/renderer/src/lib/refActions", () => ({ refActionRow: (e: { item: { titleKey: string } }) => ({ label: e.item.titleKey, onSelect() {} }) }));
vi.mock("../src/renderer/src/modules/react", () => {
  const icon = () => null;
  const slot = [
    { item: { id: "notes.turn", titleKey: "notes.addToTurn", icon, useState: () => (fx.notesActive ? { active: true } : null), run() {} } },
    { item: { id: "side-chat.turn", titleKey: "side-chat.open", icon, run() {} } },
    { item: { id: "bookmarks.turn", titleKey: "bookmarks.add", icon, inline: true, run() {} } },
  ];
  return { useSlot: () => slot };
});
vi.mock("../src/renderer/src/lib/hostGatingView", () => ({ useHostEntryGate: () => () => true }));
vi.mock("../src/renderer/src/lib/refActionApplies", () => ({ refActionApplies: () => true }));
vi.mock("../src/renderer/src/lib/prefs", () => ({
  getUiPrefs: () => fx.prefs,
  setUiPref: (key: string, value: unknown) => {
    fx.prefs = { ...fx.prefs, [key]: value } as typeof fx.prefs;
    fx.listeners.forEach((l) => l());
  },
  useUiPrefs: () =>
    useSyncExternalStore(
      (l) => {
        fx.listeners.add(l);
        return () => fx.listeners.delete(l);
      },
      () => fx.prefs,
    ),
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
const labels = (sel: string) => [...q(sel).querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
const menu = () => fx.menus.at(-1)!.map((e) => (e === "separator" ? "—" : `${(e as Action).label}${(e as Action).toggle?.on ? " 📌" : ""}`));
const row = (label: string) => fx.menus.at(-1)!.find((e) => (e as { label?: string }).label === label) as Action;
const openMore = () => act(() => q('[aria-label="gutter.more"]').click());

beforeEach(() => {
  fx.menus = [];
  fx.ctx = [];
  fx.prefs = { turnBarPins: {} };
  fx.notesActive = false;
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
  it("is a toolbar shown on hover / focus only; by default today's 复制 · 分叉 · 书签, its buttons in the Tab order", () => {
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false })));
    const tb = q('[data-reply-bar][role="toolbar"]');
    expect(tb.className).toContain("opacity-0");
    expect(tb.className).toContain("focus-within:opacity-100");
    expect(tb.className).toContain("shadow-e2");
    // No opacity fade: a running fade composites the bar and flickers the text of the row its shadow reaches.
    expect(tb.className).not.toMatch(/\btransition/);
    expect(labels("[data-reply-bar]")).toEqual(["reply.copy", "reply.fork", "bookmarks.add", "gutter.more"]);
    for (const b of tb.querySelectorAll("button")) expect(b.tabIndex).toBe(0);
  });

  it("⋯: every action with a pin toggle — the pinned ones first, then 引用 / 回退 and the other ref.action items", () => {
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false })));
    expect(q('[aria-label="gutter.more"]').getAttribute("aria-haspopup")).toBe("menu");
    openMore();
    expect(menu()).toEqual(["reply.copy 📌", "reply.fork 📌", "bookmarks.add 📌", "—", "reply.quote", "reply.revert", "notes.addToTurn", "side-chat.open"]);
  });

  it("pin from ⋯: the icon joins the bar after the others; unpin there takes it off; the list is stored", () => {
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false })));
    openMore();
    act(() => row("side-chat.open").toggle!.onToggle(true));
    expect(labels("[data-reply-bar]")).toEqual(["reply.copy", "reply.fork", "bookmarks.add", "side-chat.open", "gutter.more"]);
    expect(fx.prefs.turnBarPins.reply).toEqual(["copy", "fork", "ref:bookmarks.turn", "ref:side-chat.turn"]);
    openMore();
    act(() => row("bookmarks.add").toggle!.onToggle(false));
    expect(labels("[data-reply-bar]")).toEqual(["reply.copy", "reply.fork", "side-chat.open", "gutter.more"]);
    // The user bubble keeps its own pins.
    expect(fx.prefs.turnBarPins.user).toBeUndefined();
  });

  it("right-click a pinned icon: 从操作栏取消固定", () => {
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false })));
    act(() => {
      q('[data-bar-pin="fork"]').dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    const unpin = fx.ctx.at(-1)![0] as Action;
    expect(unpin.label).toBe("turnBar.unpin");
    act(() => unpin.onSelect());
    expect(labels("[data-reply-bar]")).toEqual(["reply.copy", "bookmarks.add", "gutter.more"]);
  });

  it("回退 from ⋯ arms in the bar and keeps it shown until confirmed", () => {
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false })));
    openMore();
    act(() => row("reply.revert").onSelect());
    expect(q("[data-reply-bar]").className).toContain("opacity-100");
    expect(q("[data-reply-bar]").textContent).toContain("reply.revertArmed");
  });

  it("pinned 回退 still arms first: its icon turns into the armed confirm in place", () => {
    fx.prefs = { turnBarPins: { reply: ["copy", "revert"] } };
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false })));
    expect(labels("[data-reply-bar]")).toEqual(["reply.copy", "reply.revert", "gutter.more"]);
    act(() => q('[aria-label="reply.revert"]').click());
    expect(q('[data-bar-pin="revert"]').textContent).toContain("reply.revertArmed");
  });

  it("a module action whose state is on shows whether pinned or not", () => {
    fx.notesActive = true;
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false })));
    expect(labels("[data-reply-bar]")).toEqual(["reply.copy", "reply.fork", "bookmarks.add", "notes.addToTurn", "gutter.more"]);
  });

  it("a narrow row shows the first pins only; the rest stay in ⋯, still marked pinned", () => {
    fx.prefs = { turnBarPins: { reply: ["copy", "fork", "quote", "ref:side-chat.turn", "ref:bookmarks.turn"] } };
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false })));
    width.mockRestore();
    expect(labels("[data-reply-bar]")).toEqual(["reply.copy", "reply.fork", "reply.quote", "gutter.more"]);
    openMore();
    expect(menu().slice(0, 5)).toEqual(["reply.copy 📌", "reply.fork 📌", "reply.quote 📌", "side-chat.open 📌", "bookmarks.add 📌"]);
  });

  it("the status line (已回复 …) sits at the row's start, the bar at its end", () => {
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: false, status: h("span", { "data-status": "" }, "replied") })));
    const r = q("[data-reply-row]");
    expect(r.firstElementChild?.hasAttribute("data-status")).toBe(true);
    expect(r.lastElementChild?.hasAttribute("data-reply-bar")).toBe(true);
  });

  it("read-only history: copy only (nothing for ⋯, no ref.action items)", () => {
    act(() => root!.render(h(ReplyActions, { sessionId: "s", bar, readOnly: true })));
    expect(labels("[data-reply-bar]")).toEqual(["reply.copy"]);
  });
});

describe("the user bubble's bar", () => {
  it("the same pill, right-aligned; today's 复制 · 回退并编辑 · 书签; ⋯ has its own pins", () => {
    act(() => root!.render(h(UserActions, { sessionId: "s", text: "hi", turnId: "t1", dropped: 0, canRevert: true })));
    const tb = q('[data-user-bar][role="toolbar"]');
    expect(tb.className).toContain("shadow-e2");
    expect(tb.className).not.toMatch(/\btransition/);
    expect(tb.parentElement?.className).toContain("justify-end");
    expect(labels("[data-user-bar]")).toEqual(["reply.copy", "menu.editResend", "bookmarks.add", "gutter.more"]);
    openMore();
    expect(menu()).toEqual(["reply.copy 📌", "menu.editResend 📌", "bookmarks.add 📌", "—", "notes.addToTurn", "side-chat.open"]);
  });

  it("回退并编辑 still arms first, in place of its pinned icon", () => {
    act(() => root!.render(h(UserActions, { sessionId: "s", text: "hi", turnId: "t1", dropped: 2, canRevert: true })));
    act(() => q('[aria-label="menu.editResend"]').click());
    expect(q('[data-bar-pin="editResend"]').textContent).toContain("reply.editResendArmed");
    expect(q("[data-user-bar]").className).toContain("opacity-100");
  });
});
