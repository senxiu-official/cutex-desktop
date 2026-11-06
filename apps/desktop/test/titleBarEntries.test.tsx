// @vitest-environment jsdom
// Sidebar v5 (design 040 §4.1, owner 2026-10-23): the `nav.primary` top entries are flat icons in the window bar,
// right of the host picker — a divider, the pinned entries (新建智能体, 快速启动, 委托, 审批) with a CountBadge for a
// number, 显示桌面 (owner 2026-10-23: moved here from the right-hand group, last before ⋯), 「⋯ 更多」 with today's
// menu; narrow, the first stays and the rest (显示桌面 too) fold into one ⋯ carrying their total.
// The roster sidebar shows only search + roster (the restore notice stays).
import { readFileSync } from "node:fs";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({ entries: [] as unknown[], width: 1500, panes: 1, menus: [] as { owner?: string; labels: string[] }[], runs: [] as string[], opened: [] as string[] }));
vi.mock("../src/renderer/src/modules/react", () => ({ useSlot: () => data.entries }));
vi.mock("../src/renderer/src/modules/Outlet", () => ({ ItemBoundary: ({ children }: { children: unknown }) => children }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, v?: Record<string, unknown>) => (v ? `${key}:${JSON.stringify(v)}` : key) }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({
  contextMenu: (build: () => { label: string }[]) => (e: Event) => {
    e.preventDefault();
    data.menus.push({ owner: "context", labels: build().map((r) => r.label) });
  },
  openMenuFrom: (_el: unknown, entries: (string | { label: string })[], o?: { owner?: string }) => data.menus.push({ owner: o?.owner, labels: entries.map((r) => (typeof r === "string" ? r : r.label)) }),
  useMenuOwner: () => null,
}));
vi.mock("../src/renderer/src/lib/navEntries", () => ({ runNav: (item: { id: string }) => data.runs.push(item.id), useNavActive: () => false }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ navPins: null }), getUiPrefs: () => ({ navPins: null }), setUiPref: () => {} }));
vi.mock("../src/renderer/src/lib/workspaces", () => ({ watchWindow: () => {}, useWsUi: (sel: (s: unknown) => unknown) => sel({ windowWidth: data.width }) }));
vi.mock("../src/renderer/src/lib/paneStore", () => ({ usePanes: () => data.panes }));
vi.mock("../src/renderer/src/lib/paneLayout", () => ({ conversationPanes: () => [] }));
vi.mock("../src/renderer/src/components/ShowDesktopButton", () => ({
  ShowDesktopButton: () => h("button", { "data-titlebar-entry": "show-desktop" }),
  useShowDesktopRow: () => ({ label: "pane.desktop", onSelect: () => data.runs.push("show-desktop") }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TitleBarEntries, entriesCompact, badgeCount } = await import("../src/renderer/src/components/SidebarNav");

const Icon = () => h("svg");
const entry = (id: string, extra: Record<string, unknown> = {}) => ({ moduleId: id.split(".")[0], mode: "show", missing: [], waiting: false, item: { id, icon: Icon, titleKey: id, target: { page: `${id}.page` }, ...extra } });
const ENTRIES = [
  entry("home.nav", { lead: true }),
  entry("quick-chats.nav", { menu: { open: (el: HTMLElement) => data.opened.push(`quick:${el.dataset.titlebarEntry}`), hintKey: "quick-chats.menuHint" } }),
  entry("agent-config.newAgent", { menu: { open: (el: HTMLElement) => data.opened.push(`new:${el.dataset.titlebarEntry}`), hintKey: "agent-config.newAgentMenuHint" } }),
  entry("projects.nav"),
  entry("delegations.nav", { useBadge: () => ({ text: "⚠ 7", attention: true }) }),
  entry("approvals.nav", { useBadge: () => ({ text: "⚠ 10", attention: true }) }),
  entry("shell.settings", { area: "footer" }),
];

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const icons = () => [...host.querySelectorAll<HTMLElement>("[data-titlebar-entry]")].map((b) => b.dataset.titlebarEntry);
function mount() {
  act(() => root!.render(h(TitleBarEntries, { btn: "ICON" })));
}

beforeEach(() => {
  Object.assign(data, { entries: ENTRIES, width: 1500, panes: 1, menus: [], runs: [], opened: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

describe("pure", () => {
  it("folds under 900 px, or with two workspaces under 1280 px", () => {
    expect(entriesCompact({ windowWidth: 1500, workspaces: 1 })).toBe(false);
    expect(entriesCompact({ windowWidth: 899, workspaces: 1 })).toBe(true);
    expect(entriesCompact({ windowWidth: 1200, workspaces: 1 })).toBe(false);
    expect(entriesCompact({ windowWidth: 1200, workspaces: 2 })).toBe(true);
  });
  it("the number in a badge", () => {
    expect(badgeCount({ text: "⚠ 7", attention: true })).toBe(7);
    expect(badgeCount({ dot: true })).toBeNull();
    expect(badgeCount(null)).toBeNull();
  });
});

describe("wide window bar", () => {
  it("a divider, the four pinned entries in pin order (no lead 桌面, no footer entries, no unpinned ones), 显示桌面, ⋯ last", () => {
    mount();
    expect(q('[data-window-bar="entries"]')!.getAttribute("role")).toBe("toolbar");
    expect(q("[data-titlebar-divider]")).not.toBeNull();
    expect(icons()).toEqual(["agent-config.newAgent", "quick-chats.nav", "delegations.nav", "approvals.nav", "show-desktop", "more"]);
  });

  it("no entries (every module off): 显示桌面 stays, alone after the divider", () => {
    data.entries = [];
    mount();
    expect(icons()).toEqual(["show-desktop"]);
  });

  it("委托 / 审批 carry a CountBadge and say 「N 件等你」", () => {
    mount();
    const deleg = q('[data-titlebar-entry="delegations.nav"]')!;
    expect(deleg.querySelector("[data-count-badge]")!.textContent).toBe("7");
    expect(deleg.getAttribute("aria-label")).toContain('"n":7');
    expect(q('[data-titlebar-entry="approvals.nav"] [data-count-badge]')!.textContent).toBe("10");
    expect(q('[data-titlebar-entry="quick-chats.nav"] [data-count-badge]')).toBeNull();
  });

  it("click opens the entry; right-click on 新建 / 快速启动 opens their menu below the icon, on others pin / unpin", () => {
    mount();
    act(() => q('[data-titlebar-entry="delegations.nav"]')!.click());
    expect(data.runs).toEqual(["delegations.nav"]);
    const right = (id: string) => act(() => void q(`[data-titlebar-entry="${id}"]`)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    right("agent-config.newAgent");
    right("quick-chats.nav");
    expect(data.opened).toEqual(["new:agent-config.newAgent", "quick:quick-chats.nav"]);
    expect(q('[data-titlebar-entry="agent-config.newAgent"]')!.getAttribute("data-tip")).toContain("agent-config.newAgentMenuHint");
    right("approvals.nav");
    expect(data.menus.at(-1)!.labels).toEqual(["navMore.unpin"]);
  });

  it("⋯ is today's 更多 menu: every entry, pinned first", () => {
    mount();
    act(() => q('[data-titlebar-entry="more"]')!.click());
    expect(data.menus.at(-1)).toEqual({ owner: "titlebar.navMore", labels: ["agent-config.newAgent", "quick-chats.nav", "delegations.nav", "approvals.nav", "separator", "projects.nav"] });
  });
});

describe("narrow window bar", () => {
  it("keeps 新建, folds the rest into one ⋯ with the 委托 + 审批 total; its list is flat (显示桌面 after the entries), 「更多 ›」 last", () => {
    data.width = 860;
    mount();
    expect(icons()).toEqual(["agent-config.newAgent", "fold"]);
    const fold = q('[data-titlebar-entry="fold"]')!;
    expect(fold.querySelector("[data-count-badge]")!.textContent).toBe("17");
    act(() => fold.click());
    expect(data.menus.at(-1)).toEqual({ owner: "titlebar.navFold", labels: ["quick-chats.nav", "delegations.nav", "approvals.nav", "pane.desktop", "separator", "titlebar.entries.more"] });
  });

  it("two workspaces side by side fold it too", () => {
    data.width = 1200;
    data.panes = 2;
    mount();
    expect(icons()).toEqual(["agent-config.newAgent", "fold"]);
  });
});

describe("wiring (source)", () => {
  const src = (rel: string) => readFileSync(`src/renderer/src/${rel}`, "utf8");
  it("the window bar draws the group right after the host picker", () => {
    expect(src("components/TitleBar.tsx")).toMatch(/<HostSwitcher \/>\s*<TitleBarEntries btn=\{ICON_BTN\} \/>/);
  });
  it("the roster sidebar has no entry list (search, the restore notice, the roster)", () => {
    const sidebar = src("components/Sidebar.tsx");
    expect(sidebar).not.toMatch(/<TopNav /);
    expect(sidebar.indexOf("data-sidebar-search")).toBeLessThan(sidebar.indexOf("<RestoreBanner compact />"));
  });
  it("新建智能体 is 「person +」 and, like 快速启动, opens 快速启动's menu on right-click", () => {
    expect(src("modules/agent-config/index.ts")).toMatch(/icon: UserPlus[^\n]*menu: \{ open: openQuickStartMenu/);
    expect(src("modules/quick-chats/index.ts")).toMatch(/menu: \{ open: openQuickStartMenu/);
  });
});
