// @vitest-environment jsdom
// The conversation header's pane controls (owner 2026-10-21; lib/convPaneControls, components/ConversationHeader):
// 「Shelf」 「放大」 「关闭」 「⋯」 in one row on line 1 after the status items and a divider (right side variant A,
// .claude/preview-header.html `#a`; replaced the 2×2 block, which replaced the lone 「—」); the Shelf button
// folds / expands this conversation's Shelf, and for an empty Shelf (no rail any more) is 「＋ 打开 Shelf」 with the
// launchers; 关闭 closes the pane (the agent keeps running) and the first time ever says where to find it.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ menus: [] as { anchor: Element; entries: unknown[] }[], launched: [] as string[], closed: [] as string[] }));

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
  translate: (key: string) => key,
}));
const ctx = { hostId: "local", sessionId: "eva", workspaceKey: null, available: () => true };
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideView: () => ctx,
  sideViewNow: () => ctx,
  useSideRegistry: () => new Map(),
  sideRegistry: () => new Map(),
}));
vi.mock("../src/renderer/src/lib/contextMenu", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openMenuFrom: (anchor: Element, entries: unknown[]) => void fx.menus.push({ anchor, entries }),
}));
vi.mock("../src/renderer/src/lib/sideMenus", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  launchable: () => [{ kind: "workspace.files", label: "Files", icon: null, params: {} }],
  launch: (kind: string) => void fx.launched.push(kind),
}));
vi.mock("../src/renderer/src/lib/workspaces", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  closeWorkspace: (paneId: string) => void fx.closed.push(paneId),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, emptyLayout, place, placeSpec, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { useApp } from "../src/renderer/src/store";
import { setUiPref } from "../src/renderer/src/lib/prefs";
import { CLOSE_HINT_KEY, liveShelfState } from "../src/renderer/src/lib/convPaneControls";
import { defaultLayout, openBeside } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { ConversationHeader } from "../src/renderer/src/components/ConversationHeader";

const host: SideBinding = { kind: "host", hostId: "local" };
function withBrowser(l: SideLayout = emptyLayout()): SideLayout {
  const input = { kind: "browser.tab" as ItemId, binding: host, key: SINGLETON_KEY, state: {} as never, v: 1, pinned: false };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "browser" }));
  return applyOpen(l, decision, input, 1, { reveal: true, home: "browser" }).layout;
}
const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, formalAgentName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "/w", lifecycle: "active" }) as unknown as SessionResource;

let root: Root;
let container: HTMLElement;
const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const header = (focused = true, framed = true) => h(ConversationHeader, { paneId: "main", hostId: "local", sessionId: "eva", focused, closable: true, maxed: false, framed });

async function render(node: ReturnType<typeof header>) {
  await act(async () => root.render(node));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fx.menus = [];
  fx.launched = [];
  fx.closed = [];
  localStorage.clear();
  setUiPref("titleTwoLines", true);
  useApp.setState({ hosts: null, selectedId: "eva", selectedHost: null, sidebar: { active: [session("eva", "Eva")], retired: [], hostRows: {}, projects: null } as never });
  useSide.setState({ scope: null, layout: emptyLayout(), mode: null });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the pane controls (variant A)", () => {
  it("one row on line 1 — status │ Shelf · — · 放大 · 关闭 · ⋯, all the same size; the same with one line; no 2×2 grid (002: 「—」 = 最小化 back; 「‹ / ›」 only beside another workspace)", async () => {
    await render(header());
    const block = q("[data-pane-controls]")!;
    expect(block.dataset.paneControls).toBe("row");
    expect(block.className).not.toContain("grid");
    expect(block.closest('[data-conv-line="1"]')).not.toBeNull();
    // Design 040 step 7: 放大 and 关闭 first; Shelf · — · ⋯ at the end. Owner 2026-10-25: none is hover-only any more —
    // 放大 / 关闭 show quieter (opacity-60) until the header is hovered.
    expect([...block.children].map((b) => [...(b as HTMLElement).getAttributeNames()].find((n) => /^data-pane-(shelf|strip|minimize|max|collapse|more)$/.test(n)))).toEqual(["data-pane-max", "data-pane-collapse", "data-pane-shelf", "data-pane-minimize", "data-pane-more"]);
    const onDemand = (sel: string) => /(^| )opacity-0( |$)/.test(q(sel)!.className);
    expect(onDemand("[data-pane-max]")).toBe(false);
    expect(onDemand("[data-pane-collapse]")).toBe(false);
    // 放大 with no gap to grow into: dimmer still (opacity-25).
    expect(q("[data-pane-max]")!.className).toMatch(/(^| )opacity-(60|25)( |$)/);
    expect(q("[data-pane-collapse]")!.className).toMatch(/(^| )opacity-60( |$)/);
    expect(onDemand("[data-pane-shelf]")).toBe(false);
    expect(onDemand("[data-pane-minimize]")).toBe(false);
    expect(onDemand("[data-pane-more]")).toBe(false);
    // Same-size 24 px icon buttons (the bell too, when shown).
    const sizes = new Set([...block.children, q('[data-conv-item="mute"]')].filter((b) => b !== null).map((b) => (b as HTMLElement).className.match(/\bsize-6\b/)?.[0]));
    expect([...sizes]).toEqual(["size-6"]);
    // No divider; the start / stop button comes first.
    const right = q("[data-conv-right]")!;
    const kids = [...right.children] as HTMLElement[];
    expect(right.querySelector("[data-conv-divider]")).toBeNull();
    expect(kids[0]!.dataset.paneControls).toBe("row");
    expect(q('[data-conv-left] [data-conv-item="online"]')).not.toBeNull();
    expect(right.querySelector('[data-conv-item="online"]')).toBeNull();
    // The Shelf's own toggle icon (a panel, owner 2026-10-25), not the layers icon an empty page used to share.
    expect(q('[data-pane-shelf] svg.lucide-panel-right-open, [data-pane-shelf] svg.lucide-panel-right-close')).not.toBeNull();
    expect(q('[data-pane-shelf] svg.lucide-layers')).toBeNull();
    expect(q("[data-pane-collapse]")!.getAttribute("data-tip")).toBe("convHeader.close");
    // One workspace: 「—」 = into the tray, back to the desktop; no 「‹ / ›」 (nothing to fold beside).
    expect(q("[data-pane-minimize]")!.getAttribute("data-tip")).toBe("strip.minimizeLast");
    expect(q("[data-pane-strip]")).toBeNull();
    // Nothing folded: no dot on ⋯.
    expect(q("[data-conv-folded-dot]")).toBeNull();
    act(() => setUiPref("titleTwoLines", false));
    expect(q("[data-pane-controls]")!.dataset.paneControls).toBe("row");
    expect(q('[data-conv-line="2"]')).toBeNull();
  });

  it("beside another workspace (002): 「‹」 on the left one folds it to its strip, 「—」 minimises it; both foretell first (008)", async () => {
    vi.useFakeTimers();
    const before = usePanes.getState().layout;
    usePanes.setState({ layout: openBeside(defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }), { hostId: "local", sessionId: "b2" }, 10) });
    await render(header(false));
    const strip = q("[data-pane-strip]")!;
    expect(strip.dataset.paneStrip).toBe("left");
    expect(strip.querySelector("svg.lucide-chevron-left")).not.toBeNull();
    expect(q("[data-pane-minimize]")!.getAttribute("data-tip")).toBe("strip.minimize");
    const { useForetellStore } = await import("../src/renderer/src/lib/foretell");
    act(() => strip.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(200));
    expect(useForetellStore.getState().shown).toMatchObject({ tone: "fold", text: "foretell.strip" });
    act(() => strip.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })));
    expect(useForetellStore.getState().shown).toBeNull();
    // ⋯: 独占 (the other one folds).
    act(() => q("[data-pane-more]")!.click());
    const labels = (fx.menus.at(-1)!.entries as { label?: string; disabled?: boolean }[]).filter(Boolean);
    expect(labels.find((e) => e.label === "panel.exclusive")).toBeTruthy();
    usePanes.setState({ layout: before });
    vi.useRealTimers();
  });

  it("⋯ holds the agent's menu (and, beside another workspace, 移到左边 / 右边; what a narrow header folded)", async () => {
    await render(header());
    act(() => q("[data-pane-more]")!.click());
    const labels = (fx.menus.at(-1)!.entries as { label?: string }[]).filter(Boolean).map((e) => e.label);
    expect(labels).toContain("Eva");
    // 全屏 (F11) first; nothing folded and nothing to move beside: no folded note, no 移到….
    expect(labels[0]).toBe("panel.fullscreen");
    expect(labels).not.toContain("convHeader.foldedNote");
    expect(labels).not.toContain("convHeader.moveLeft");
    expect(labels).not.toContain("convHeader.moveRight");
  });

  it("a narrow column beside another workspace: a dot on ⋯; its menu = 全屏 F11 · 移到右边 · the folded items under a note · the agent", async () => {
    // jsdom has no layout: the header measures 300 px (everything folds).
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return { width: this.hasAttribute("data-conv-header") ? 300 : 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const before = usePanes.getState().layout;
    usePanes.setState({ layout: openBeside(defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }), { hostId: "local", sessionId: "b2" }, 10) });
    await render(header());
    // The independent chip folded (no services, no bell here): only what has something to show.
    expect(q("[data-pane-more]")!.dataset.convOverflow).toBe("project");
    expect(q('[data-conv-item="project"]')).toBeNull();
    expect(q("[data-pane-more] [data-conv-folded-dot]")).not.toBeNull();
    act(() => q("[data-pane-more]")!.click());
    const entries = fx.menus.at(-1)!.entries as ({ label: string; hint?: string; note?: boolean; submenu?: unknown[] } | "separator")[];
    const shape = entries.map((e) => (e === "separator" ? "—" : e.note ? `note:${e.label}` : e.label));
    // 「‹」 and 「—」 never fold (002's entries); 独占 is in ⋯.
    expect(q("[data-pane-strip]")).not.toBeNull();
    expect(q("[data-pane-minimize]")).not.toBeNull();
    expect(shape).toEqual(["panel.fullscreen", "panel.exclusive", "shelfOnly.action", "—", "columnPick.menu", "convHeader.moveRight", "—", "note:convHeader.foldedNote", "convHeader.item.project", "—", "Eva", "—", "settings.panel.menu.conversation", "—", "onboarding.panel.menu"]);
    expect((entries[0] as { hint?: string }).hint).toBe("F11");
    usePanes.setState({ layout: before });
    vi.restoreAllMocks();
  });
});

describe("the Shelf button", () => {
  it("an empty Shelf (no rail): 「＋ 打开 Shelf」 opens the launchers; a pick opens in this conversation's Shelf", async () => {
    await render(header());
    const btn = q("[data-pane-shelf]")!;
    expect(btn.dataset.paneShelf).toBe("empty");
    expect(btn.getAttribute("aria-label")).toBe("convHeader.shelfOpen");
    act(() => btn.click());
    const entries = fx.menus.at(-1)!.entries as { label: string; note?: boolean; onSelect(): void }[];
    expect(entries[0]).toMatchObject({ label: "convHeader.shelfLaunch", note: true });
    act(() => entries.find((e) => e.label === "Files")!.onSelect());
    expect(fx.launched).toEqual(["workspace.files"]);
  });

  it("an empty Shelf: 「＋ 打开 Shelf」 → 新建空页 makes the first, empty page (owner 2026-10-24: same as the second)", async () => {
    await render(header());
    act(() => q("[data-pane-shelf]")!.click());
    const entries = fx.menus.at(-1)!.entries as ({ label: string; hint?: string; onSelect(): void } | "separator")[];
    const make = entries.find((e) => e !== "separator" && e.label === "side.newPage") as { hint?: string; onSelect(): void };
    expect(make.hint).toBe("Ctrl+Shift+N");
    expect(entries.at(-2)).toBe("separator");
    act(() => make.onSelect());
    const layout = useSide.getState().layout;
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]).toMatchObject({ cards: [], launcher: true });
    expect(layout.activePage).toBe(layout.pages[0]!.id);
    expect(layout.open).toBe(true);
    expect(fx.launched).toEqual([]);
  });

  it("a Shelf with pages: expanded → folds to its rail; folded → expands (the live conversation's)", async () => {
    useSide.setState({ layout: withBrowser() });
    await render(header());
    expect(liveShelfState(useSide.getState().layout, ctx)).toBe("expanded");
    expect(q("[data-pane-shelf]")!.dataset.paneShelf).toBe("expanded");
    // The live conversation is the focused one (lib/sideLayoutStore liveConversation): none in this test → it focuses first.
    const sideStore = await import("../src/renderer/src/lib/sideLayoutStore");
    vi.spyOn(sideStore, "liveConversation").mockReturnValue("local|eva");
    act(() => q("[data-pane-shelf]")!.click());
    expect(shelvesOf(useSide.getState().layout)[0]!.collapsed).toBe(true);
    expect(q("[data-pane-shelf]")!.dataset.paneShelf).toBe("folded");
    act(() => q("[data-pane-shelf]")!.click());
    expect(shelvesOf(useSide.getState().layout)[0]!.collapsed).toBeFalsy();
  });
});

describe("关闭", () => {
  it("closes the pane (the agent keeps running); the first time ever a toast says where to find it — only once", async () => {
    const notify = vi.spyOn(useApp.getState(), "notify").mockImplementation(() => {});
    await render(header());
    act(() => q("[data-pane-collapse]")!.click());
    expect(fx.closed).toEqual(["main"]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toBe("convHeader.closedToast");
    expect(localStorage.getItem(CLOSE_HINT_KEY)).toBe("1");
    act(() => q("[data-pane-collapse]")!.click());
    expect(fx.closed).toEqual(["main", "main"]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("放大 next to other panes, and alone too (§24.16: the column takes the whole work row instead of its reading width)", async () => {
    await render(header(true, false));
    expect((q("[data-pane-max]") as HTMLButtonElement).disabled).toBe(false);
    await render(header(true, true));
    expect((q("[data-pane-max]") as HTMLButtonElement).disabled).toBe(false);
  });
});
