// Title-bar launchers (contract v1.11, docs/desktop-modules.md §18.3, owner 2026-10-12): pins (per-device
// pref over the component's `launcher.pin`), order (pinned first, by launcher.order), the click rule
// (open on the current page / the page-button icon rule / Ctrl/⌘ = new instance), narrow-window collapse,
// launcher-kind badges, and the glue in lib/sideMenus (pressLauncher, the ＋ menu, gating).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SideComponentItem } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import type { MenuAction } from "../src/renderer/src/lib/contextMenu";
import { fitLaunchers, isPinned, launcherClickAction, migrateLauncherPins, splitLaunchers, withPin, type LauncherClickInput } from "../src/renderer/src/lib/sideLaunchers";
import { kindBadges } from "../src/renderer/src/lib/sidePills";
import { emptyLayout, type SideLayout, type SideViewContext } from "../src/renderer/src/lib/sideLayout";

const env = vi.hoisted(() => ({
  prefs: { sideLauncherPins: {} as Record<string, boolean>, sideCurrentPageClick: "stay", sideMode: "push" } as Record<string, unknown>,
  registry: new Map<string, { moduleId: string; item: Partial<SideComponentItem> }>(),
  gate: new Set<string>(),
  opened: [] as { kind: string; params: unknown; opts: Record<string, unknown> }[],
}));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: { getState: () => ({ hosts: { active: "local" }, selectedId: "A", sidebar: null, notify: () => {} }) },
  agentHost: () => "local",
  selectedSidebar: () => null,
  sidebarOf: () => null,
}));
vi.mock("../src/renderer/src/lib/prefs", () => ({
  getUiPrefs: () => env.prefs,
  setUiPref: (k: string, v: unknown) => {
    env.prefs = { ...env.prefs, [k]: v };
  },
}));
vi.mock("../src/renderer/src/lib/hostGatingView", () => ({ entryGateNow: (_host: string, entry: { item: { id?: string } }) => ({ ok: !env.gate.has(entry.item.id ?? "") }) }));
vi.mock("../src/renderer/src/lib/sideOpen", () => ({
  openSide: (kind: string, params: unknown, opts: Record<string, unknown>) => {
    env.opened.push({ kind, params, opts });
    return { status: "opened" };
  },
  toggleSideColumn: () => {},
}));
vi.mock("../src/renderer/src/lib/sideComponents", () => ({
  sideRegistry: () => env.registry,
  specFrom: () => null,
  sideViewNow: () => ({ hostId: "local", sessionId: "A", workspaceKey: null, available: (k: string) => env.registry.has(k) }),
}));

const { pressLauncher, launcherMenu, launchable, setLauncherPinned, launcherContextMenu } = await import("../src/renderer/src/lib/sideMenus");
const { useSide } = await import("../src/renderer/src/lib/sideLayoutStore");

// ── pure rules ────────────────────────────────────────────────────────────────────────────────────

describe("pins", () => {
  it("the owner's choice wins over launcher.pin; never can't be pinned", () => {
    expect(isPinned("a", "default", {})).toBe(true);
    expect(isPinned("a", undefined, {})).toBe(false);
    expect(isPinned("a", "default", { a: false })).toBe(false);
    expect(isPinned("a", undefined, { a: true })).toBe(true);
    expect(isPinned("a", "never", { a: true })).toBe(false);
  });

  it("withPin stores only departures from the default", () => {
    expect(withPin({}, "a", "default", false)).toEqual({ a: false });
    expect(withPin({ a: false }, "a", "default", true)).toEqual({});
    expect(withPin({}, "b", undefined, true)).toEqual({ b: true });
    expect(withPin({ b: true }, "b", undefined, false)).toEqual({});
    const pins = { c: true };
    expect(withPin(pins, "x", "never", true)).toBe(pins);
  });

  it("migrate keeps booleans only", () => {
    expect(migrateLauncherPins(null)).toEqual({});
    expect(migrateLauncherPins([true])).toEqual({});
    expect(migrateLauncherPins({ a: true, b: "yes", c: false })).toEqual({ a: true, c: false });
  });

  it("order: pinned first, each by launcher.order then id", () => {
    const entries = [
      { kind: "t", order: 800, pin: "default" as const },
      { kind: "n", order: 300 },
      { kind: "s", order: 200, pin: "default" as const },
      { kind: "b", order: 700, pin: "default" as const },
      { kind: "a", order: 300 },
    ];
    const { pinned, others } = splitLaunchers(entries, { b: false, n: true });
    expect(pinned.map((e) => e.kind)).toEqual(["s", "n", "t"]);
    expect(others.map((e) => e.kind)).toEqual(["a", "b"]);
  });

  it("status categories come after the tool kinds, whatever their order", () => {
    const entries = [
      { kind: "status:alarms", order: 100, group: "status" as const },
      { kind: "notes", order: 300, group: "tool" as const },
      { kind: "status:jobs", order: 50, group: "status" as const, pin: "default" as const },
      { kind: "chat", order: 200, group: "tool" as const, pin: "default" as const },
    ];
    const { pinned, others } = splitLaunchers(entries, {});
    expect(pinned.map((e) => e.kind)).toEqual(["chat", "status:jobs"]);
    expect(others.map((e) => e.kind)).toEqual(["notes", "status:alarms"]);
  });
});

describe("narrow windows", () => {
  it("as many as fit; the rest collapse into ＋", () => {
    expect(fitLaunchers(Number.POSITIVE_INFINITY, 3, 30)).toBe(3);
    expect(fitLaunchers(200, 3, 30)).toBe(3);
    expect(fitLaunchers(89, 3, 30)).toBe(2);
    expect(fitLaunchers(30, 3, 30)).toBe(1);
    expect(fitLaunchers(-50, 3, 30)).toBe(0);
    expect(fitLaunchers(100, 0, 30)).toBe(0);
  });
});

describe("launcherClickAction", () => {
  const base: LauncherClickInput = { newInstance: false, multi: false, open: true, activePage: "p1", layered: false, page: "p1", card: null, elsewhere: null, setting: "stay" };

  it("not on the current page → open it there (column closed too)", () => {
    expect(launcherClickAction(base)).toEqual({ kind: "open", page: "p1", fresh: false });
    expect(launcherClickAction({ ...base, open: false })).toEqual({ kind: "open", page: "p1", fresh: false });
    expect(launcherClickAction({ ...base, page: null, activePage: null })).toEqual({ kind: "open", page: null, fresh: false });
  });

  it("there → the page-button icon rule", () => {
    const card = { id: "c1", collapsed: false };
    expect(launcherClickAction({ ...base, card })).toEqual({ kind: "focus", cardId: "c1" });
    expect(launcherClickAction({ ...base, card: { id: "c1", collapsed: true } })).toEqual({ kind: "expand", cardId: "c1" });
    expect(launcherClickAction({ ...base, card, setting: "collapse" })).toEqual({ kind: "close" });
    // Column closed: open it on that page, expanding the card.
    expect(launcherClickAction({ ...base, card, open: false })).toEqual({ kind: "switch", pageId: "p1", expand: "c1" });
    // Maximised / full screen: the mode follows the page.
    expect(launcherClickAction({ ...base, card, layered: true })).toEqual({ kind: "switch", pageId: "p1", expand: null });
  });

  it("on another page → reveal that instance there (singleton or multi alike); on the page wins", () => {
    expect(launcherClickAction({ ...base, elsewhere: "i7" })).toEqual({ kind: "reveal", instanceId: "i7" });
    expect(launcherClickAction({ ...base, multi: true, elsewhere: "i7" })).toEqual({ kind: "reveal", instanceId: "i7" });
    expect(launcherClickAction({ ...base, open: false, page: null, activePage: null, elsewhere: "i7" })).toEqual({ kind: "reveal", instanceId: "i7" });
    expect(launcherClickAction({ ...base, card: { id: "c1", collapsed: false }, elsewhere: "i7" })).toEqual({ kind: "focus", cardId: "c1" });
    // Ctrl/⌘ still opens a new one on the current page
    expect(launcherClickAction({ ...base, multi: true, newInstance: true, elsewhere: "i7" })).toEqual({ kind: "open", page: "p1", fresh: true });
  });

  it("Ctrl/⌘ / middle click = a new instance, multi kinds only", () => {
    const card = { id: "c1", collapsed: false };
    expect(launcherClickAction({ ...base, card, newInstance: true, multi: true })).toEqual({ kind: "open", page: "p1", fresh: true });
    expect(launcherClickAction({ ...base, card, newInstance: true, multi: false })).toEqual({ kind: "focus", cardId: "c1" });
  });
});

describe("kindBadges", () => {
  it("sums the kind's visible instances on any page", () => {
    const l = emptyLayout();
    const add = (id: string, kind: ItemId, sessionId: string) => (l.instances[id] = { kind, binding: { kind: "agent", hostId: "local", sessionId }, key: id, state: null, v: 1, pinned: false, lastActiveAt: 1 });
    add("i1", "x.term", "A");
    add("i2", "x.term", "A");
    add("i3", "x.term", "B"); // another agent's: not counted
    add("i4", "x.chat", "A");
    const ctx: SideViewContext = { hostId: "local", sessionId: "A", workspaceKey: null, available: () => true };
    const info = { i1: { title: "", attention: 2 }, i2: { title: "", busy: true, unread: true }, i3: { title: "", attention: 5 }, i4: { title: "", attention: 1 } } as Record<string, { title: string; attention?: number; busy?: boolean; unread?: boolean }>;
    expect(kindBadges(l, "x.term", ctx, (id) => info[id])).toEqual({ attention: 2, unread: true, busy: true });
    expect(kindBadges(l, "x.none", ctx, (id) => info[id])).toEqual({ attention: 0, unread: false, busy: false });
  });
});

// ── glue (lib/sideMenus) ────────────────────────────────────────────────────────────────────────

const item = (id: ItemId, extra: Partial<SideComponentItem>): Partial<SideComponentItem> => ({
  id,
  titleKey: "side.column",
  icon: () => null,
  instances: "singleton",
  defaultBinding: "agent",
  placement: { home: "workspace" },
  ...extra,
});

/** One page p1 with a card of `kind` (agent A), column open. */
function layoutWith(kind: ItemId | null, collapsed = false): SideLayout {
  const l = emptyLayout();
  const page = { id: "p1", groups: ["workspace"], cards: [] as SideLayout["pages"][number]["cards"] };
  if (kind) {
    l.instances.i1 = { kind, binding: { kind: "agent", hostId: "local", sessionId: "A" }, key: "i1", state: null, v: 1, pinned: false, lastActiveAt: 1 };
    page.cards.push({ id: "c1", kind, tabs: ["i1"], active: "i1", size: 1, collapsed });
  } else {
    l.instances.i9 = { kind: "x.other", binding: { kind: "agent", hostId: "local", sessionId: "A" }, key: "i9", state: null, v: 1, pinned: false, lastActiveAt: 1 };
    page.cards.push({ id: "c9", kind: "x.other", tabs: ["i9"], active: "i9", size: 1, collapsed: false });
  }
  l.pages.push(page);
  l.activePage = "p1";
  l.open = true;
  return l;
}

beforeEach(() => {
  env.prefs = { sideLauncherPins: {}, sideCurrentPageClick: "stay", sideMode: "push" };
  env.gate = new Set();
  env.opened = [];
  env.registry = new Map([
    ["x.chat", { moduleId: "x", item: item("x.chat", { launcher: { order: 200, pin: "default", params: () => ({}) } }) }],
    ["x.term", { moduleId: "x", item: item("x.term", { instances: "multi", launcher: { order: 800, pin: "default", params: () => ({ adopt: true }), newParams: () => ({ create: true }) } }) }],
    ["x.notes", { moduleId: "x", item: item("x.notes", { launcher: { order: 300, params: () => ({}) } }) }],
    ["status:alarm" as ItemId, { moduleId: "x", item: item("status:alarm" as ItemId, { launcher: { order: 100, pin: "never", params: () => ({}) } }) }],
    ["status:jobs" as ItemId, { moduleId: "x", item: item("status:jobs" as ItemId, { launcher: { order: 600, params: () => ({}) } }) }],
    ["x.other", { moduleId: "x", item: item("x.other", {}) }],
  ]);
  useSide.setState({ scope: "host:local", layout: layoutWith(null), mode: null, revealed: {}, tabInfo: {}, flash: null, focusedCard: null });
});

describe("pressLauncher", () => {
  it("kind not on the current page → opens it into that page with focus + reveal", () => {
    pressLauncher("x.chat");
    expect(env.opened).toEqual([{ kind: "x.chat", params: {}, opts: { page: "p1", focus: true, reveal: true } }]);
  });

  it("kind on the page: collapsed → expands, visible → focus (no open)", () => {
    useSide.setState({ layout: layoutWith("x.chat", true) });
    pressLauncher("x.chat");
    expect(env.opened).toEqual([]);
    expect(useSide.getState().layout.pages[0]!.cards[0]!.collapsed).toBe(false);
    vi.stubGlobal("document", { querySelector: () => null });
    vi.stubGlobal("CSS", { escape: (s: string) => s });
    pressLauncher("x.chat");
    vi.unstubAllGlobals();
    expect(useSide.getState().focusedCard).toBe("c1");
  });

  it("with 点击当前页图标 = 收起侧栏 a visible card's launcher closes the column", () => {
    env.prefs.sideCurrentPageClick = "collapse";
    useSide.setState({ layout: layoutWith("x.chat") });
    pressLauncher("x.chat");
    expect(useSide.getState().layout.open).toBe(false);
  });

  it("column closed with the kind on its page → reopens on it", () => {
    const l = layoutWith("x.chat", true);
    l.open = false;
    useSide.setState({ layout: l });
    pressLauncher("x.chat");
    expect(useSide.getState().layout.open).toBe(true);
    expect(useSide.getState().layout.pages[0]!.cards[0]!.collapsed).toBe(false);
  });

  it("a multi kind whose card is on another page: reveal it there (focus + flash), no new instance", () => {
    const l = layoutWith(null); // p1 shows x.other
    l.instances.i5 = { kind: "x.term", binding: { kind: "agent", hostId: "local", sessionId: "A" }, key: "i5", state: null, v: 1, pinned: false, lastActiveAt: 5 };
    l.pages.push({ id: "p2", groups: ["workspace"], cards: [{ id: "c5", kind: "x.term", tabs: ["i5"], active: "i5", size: 1, collapsed: true }] });
    useSide.setState({ layout: l });
    pressLauncher("x.term");
    expect(env.opened).toEqual([]);
    const after = useSide.getState();
    expect(after.layout.activePage).toBe("p2");
    expect(after.layout.open).toBe(true);
    expect(after.focusedCard).toBe("c5");
    expect(after.flash).toBeTruthy();
    // Ctrl/⌘+Shift still opens a new one on the page in view, shown
    pressLauncher("x.term", { newInstance: true, focus: true });
    expect(env.opened).toEqual([{ kind: "x.term", params: { create: true }, opts: { page: "p2", focus: true, reveal: true } }]);
  });

  it("Ctrl/⌘ on a multi kind opens a new instance with newParams in the background, even when one is on the page", () => {
    useSide.setState({ layout: layoutWith("x.term") });
    pressLauncher("x.term", { newInstance: true, focus: false });
    expect(env.opened).toEqual([{ kind: "x.term", params: { create: true }, opts: { page: "p1", pin: true, background: true } }]);
  });
});

describe("launcher list and ＋ menu", () => {
  it("gated-off kinds never show; pin toggles store per device", () => {
    env.gate.add("x.chat");
    expect(launchable().map((i) => i.kind)).toEqual(["x.notes", "x.term", "status:alarm", "status:jobs"]);
    env.gate.clear();
    setLauncherPinned("x.chat", false);
    setLauncherPinned("x.notes", true);
    expect(env.prefs.sideLauncherPins).toEqual({ "x.chat": false, "x.notes": true });
    setLauncherPinned("x.chat", true);
    expect(env.prefs.sideLauncherPins).toEqual({ "x.notes": true });
  });

  it("＋ lists pinned first, then tools, a divider, status categories; a pin toggle except for never; then 新… and 新页面", () => {
    const entries = launcherMenu().filter((e): e is MenuAction | "separator" => !!e);
    // pinned (chat, term) | notes | status categories (alarm, jobs)
    const heads = entries.slice(0, 8).map((e) => (e === "separator" ? "|" : e.toggle ? (e.toggle.on ? "on" : "off") : "-"));
    expect(heads).toEqual(["on", "on", "|", "off", "|", "-", "off", "|"]);
    const rows = entries.filter((e): e is MenuAction => e !== "separator");
    const labels = rows.map((r) => r.label);
    expect(rows[3]!.toggle).toBeUndefined(); // pin: "never"
    const fresh = rows.find((r) => r.label.includes("side.launcherNew") || /新|New/.test(r.label));
    expect(fresh).toBeTruthy();
    fresh!.onSelect();
    expect(env.opened.at(-1)).toMatchObject({ kind: "x.term", params: { create: true } });
    expect(labels.length).toBeGreaterThan(5);
    // toggling from the menu unpins
    rows[0]!.toggle!.onToggle(false);
    expect(env.prefs.sideLauncherPins).toEqual({ "x.chat": false });
  });

  it("right-click on a launcher: 新… for multi kinds, then 从标题栏取消固定", () => {
    const rows = launcherContextMenu("x.term").filter((e): e is MenuAction => !!e && e !== "separator");
    expect(rows).toHaveLength(3); // title, 新…, unpin
    rows[2]!.onSelect();
    expect(env.prefs.sideLauncherPins).toEqual({ "x.term": false });
    expect(launcherContextMenu("x.chat").filter((e) => !!e && e !== "separator")).toHaveLength(2);
  });
});
