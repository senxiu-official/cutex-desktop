// Panes step 3 (docs/desktop-modules.md §24; research panes-20261019.md §7 row 3): the tool area inside
// the stored pane layout (lib/paneLayout toolPartOf / toolRawOf / splitLayout / joinLayout, lib/paneFile),
// the one-time migration of the v1.16 right side (`cutex-desktop.side` → `cutex-desktop.panes`, backup
// key), and pages over a conversation pane (showPageIn / closePaneOverlay).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import {
  addConversationColumn,
  closePaneOverlay,
  conversationPanes,
  CONVERSATION_KIND,
  defaultLayout,
  joinLayout,
  MAIN_PANE,
  MAX_TOOL_PANES,
  openBeside,
  paneBinding,
  panePage,
  restoreLayout,
  showPageIn,
  splitLayout,
  toolPartOf,
  toolRawOf,
  validateLayout,
  type PaneLayout,
} from "../src/renderer/src/lib/paneLayout";
import { applyOpen, emptyLayout, place, placeSpec, prepareForSave, sanitizeLayout, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const FOLLOW: SideBinding = { kind: "follow", hostId: "local" };
const WS: SideBinding = { kind: "workspace", hostId: "local", key: "w1" };
let clock = 100;

function open(layout: SideLayout, kind: string, binding: SideBinding, key: string | null = SINGLETON_KEY, home = "workspace", state: unknown = null) {
  const input = { kind: kind as ItemId, binding, key, state: state as never, v: 1, pinned: false };
  const decision = place(layout, { ...input, transient: false, activePage: layout.activePage, columnOpen: layout.open }, placeSpec({ home }));
  return applyOpen(layout, decision, input, ++clock, { reveal: true, home });
}

/** files, changes, terminal [t1 (state), t2]: one full tool column. */
function tools(): SideLayout {
  let l = emptyLayout();
  l = open(l, "workspace.files", FOLLOW).layout;
  l = open(l, "workspace.changes", FOLLOW).layout;
  l = open(l, "terminal.pty", WS, "t1", "workspace", { pty: 7 }).layout;
  l = open(l, "terminal.pty", WS, "t2").layout;
  return l;
}

const work = (sessionId: string | null = "a1") => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId });

describe("the tool area in the pane layout JSON", () => {
  it("toolPartOf → JSON → toolRawOf → sanitizeLayout keeps the side engine's layout (params / state, keys, pins, sizes, overrides)", () => {
    const side = { ...tools(), overrides: { "workspace.files": { page: "p1", groups: ["workspace"], at: 3 } } };
    const saved = prepareForSave(side, { persist: () => true });
    const part = JSON.parse(JSON.stringify(toolPartOf(saved)));
    expect(part.cols).toHaveLength(1);
    expect(part.cols[0]).toMatchObject({ area: "tools", id: "p1", groups: ["workspace"] });
    expect(Object.keys(part.panes).every((id: string) => id.startsWith("t-"))).toBe(true);
    expect(sanitizeLayout(toolRawOf(part))).toEqual(saved);
  });

  it("work + tool area: a valid layout (≤ 6 panes on screen); split gives both back; joining drops page tabs; a step-2 layout (no tools) still restores", () => {
    const joined = joinLayout(work(), toolPartOf(tools()));
    expect(validateLayout(JSON.parse(JSON.stringify(joined)))).not.toBeNull();
    const { work: w, tools: t } = splitLayout(joined);
    expect(w.cols).toHaveLength(1);
    expect(conversationPanes(w)).toEqual([MAIN_PANE]);
    expect(t!.cols.map((c) => c.area)).toEqual(["tools"]);
    expect(restoreLayout(JSON.parse(JSON.stringify(joined)))).toEqual({ ...w, max: null, focus: MAIN_PANE });
    // two conversation columns + 4 tool panes = 6 panes
    const two = openBeside(work(), { hostId: "local", sessionId: "b2" }, 1);
    let side = tools();
    side = open(side, "browser.tab", { kind: "host", hostId: "local" }, "u", "browser").layout;
    expect(Object.keys(toolPartOf(side).panes)).toHaveLength(3); // full column: the browser is a tab
    expect(validateLayout(JSON.parse(JSON.stringify(joinLayout(two, toolPartOf(side)))))).not.toBeNull();
    // page tabs never reach storage
    const withPage = showPageIn(work(), MAIN_PANE, "projects.page", { tab: "agents" });
    expect(Object.values(joinLayout(withPage, null).instances).map((i) => i.kind)).toEqual([CONVERSATION_KIND]);
    // a tool column must name its id; widths are shares per area
    const bad = JSON.parse(JSON.stringify(joined)) as PaneLayout;
    delete bad.cols[1]!.id;
    expect(validateLayout(bad)).toBeNull();
    expect(MAX_TOOL_PANES).toBe(4);
  });
});

describe("pages over a conversation pane (§24.4)", () => {
  it("one page per pane, each page in one pane; closing it shows the conversation again; still a conversation pane", () => {
    let l = openBeside(work(), { hostId: "local", sessionId: "b2" }, 1);
    const right = l.focus!;
    l = showPageIn(l, right, "projects.page", { tab: "agents" });
    expect(panePage(l, right)).toEqual({ page: "projects.page", params: { tab: "agents" } });
    expect(conversationPanes(l)).toEqual([MAIN_PANE, right]);
    expect(paneBinding(l, right)).toEqual({ hostId: "local", sessionId: "b2" });
    expect(showPageIn(l, right, "projects.page", { tab: "agents" })).toBe(l);
    // the same page in the other pane moves there
    const moved = showPageIn(l, MAIN_PANE, "projects.page", {});
    expect(panePage(moved, right)).toBeNull();
    expect(panePage(moved, MAIN_PANE)).toEqual({ page: "projects.page", params: {} });
    // another page replaces the pane's page
    const other = showPageIn(l, right, "jobs.page", {});
    expect(other.panes[right]!.tabs).toHaveLength(2);
    const closed = closePaneOverlay(other, right);
    expect(panePage(closed, right)).toBeNull();
    expect(closed.panes[right]!.tabs).toHaveLength(1);
    expect(closePaneOverlay(closed, right)).toBe(closed);
  });

  it("addConversationColumn (the migrated side agent cards): beside, no focus change, never twice, ≤ 2 columns", () => {
    const l = addConversationColumn(work(), { hostId: "local", sessionId: "b2" }, 0);
    expect(conversationPanes(l)).toHaveLength(2);
    expect(l.focus).toBe(MAIN_PANE);
    expect(addConversationColumn(l, { hostId: "local", sessionId: "b2" }, 0)).toBe(l);
    expect(addConversationColumn(l, { hostId: "local", sessionId: "c3" }, 0)).toBe(l);
    expect(validateLayout(l)).not.toBeNull();
  });
});

describe("migration of the v1.16 right side (lib/paneFile)", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    vi.resetModules();
    storage = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  });

  /** A v1.16 layout: 工作区 (files, changes, preview, terminal), 浏览器, 智能体 (a side agent card); A looked at the browser page last. */
  function legacy() {
    const inst = (kind: string, binding: unknown, key: string | null, state: unknown, at: number) => ({ kind, binding, key, state, v: 1, pinned: false, lastActiveAt: at });
    return {
      open: true,
      activePage: "p1",
      seq: 20,
      pages: [
        { id: "p1", groups: ["workspace"], cards: [
          { id: "c2", kind: "workspace.files", tabs: ["i3"], active: "i3", size: 0.25, collapsed: false },
          { id: "c4", kind: "workspace.changes", tabs: ["i5"], active: "i5", size: 0.25, collapsed: false },
          { id: "c6", kind: "workspace.preview", tabs: ["i7"], active: "i7", size: 0.25, collapsed: false },
          { id: "c8", kind: "terminal.pty", tabs: ["i9"], active: "i9", size: 0.25, collapsed: false },
        ] },
        { id: "p10", groups: ["browser"], cards: [{ id: "c11", kind: "browser.tab", tabs: ["i12"], active: "i12", size: 1, collapsed: false }] },
        { id: "p13", groups: ["agents"], cards: [{ id: "c14", kind: "conversation.agent", tabs: ["i15"], active: "i15", size: 1, collapsed: false }] },
      ],
      instances: {
        i3: inst("workspace.files", { kind: "follow", hostId: "local" }, "∅", null, 1),
        i5: inst("workspace.changes", { kind: "follow", hostId: "local" }, "∅", null, 2),
        i7: inst("workspace.preview", { kind: "agent", hostId: "local", sessionId: "a1" }, "src/a.ts", { path: "src/a.ts", line: 4 }, 3),
        i9: inst("terminal.pty", { kind: "workspace", hostId: "local", key: "w1" }, "t1", { pty: 9 }, 4),
        i12: inst("browser.tab", { kind: "host", hostId: "local" }, "u", { url: "https://example.com" }, 5),
        i15: inst("conversation.agent", { kind: "host", hostId: "local" }, "b2", { sessionId: "b2" }, 6),
      },
      overrides: { "browser.tab": { page: "p10", groups: ["browser"], at: 1 } },
      views: { a1: { open: true, page: "p10", at: 50 }, b2: { open: false, page: null, at: 10 } },
    };
  }

  it("migrateSideLayout: the focused agent's page is the column, the rest folds in, no instance / param / state is lost; agent cards become agents", async () => {
    const { migrateSideLayout } = await import("../src/renderer/src/lib/paneFile");
    const { side, agents } = migrateSideLayout(legacy(), "local", "conversation.agent");
    expect(side.pages.map((p) => p.id)).toEqual(["p10"]);
    expect(side.open).toBe(true);
    expect(side.pages[0]!.cards.map((c) => c.kind)).toEqual(["browser.tab", "workspace.files", "workspace.changes"]);
    expect(side.pages[0]!.cards[2]!.tabs).toEqual(["i5", "i7", "i9"]);
    expect(Object.keys(side.instances).sort()).toEqual(["i12", "i3", "i5", "i7", "i9"]);
    expect(side.instances.i7!.state).toEqual({ path: "src/a.ts", line: 4 });
    expect(side.instances.i9!.state).toEqual({ pty: 9 });
    expect(agents).toEqual([{ hostId: "local", sessionId: "b2" }]);
    // no views: the active page is kept, its open state
    const plain = { ...legacy(), views: undefined };
    expect(migrateSideLayout(plain, "local", "conversation.agent").side.pages.map((p) => p.id)).toEqual(["p1"]);
  });

  it("migrateLegacySide: once per install; every scope gets its tool area and the agent column; the old value goes to the backup key", async () => {
    const file = await import("../src/renderer/src/lib/paneFile");
    const raw = JSON.stringify({ v: 1, layouts: { "host:local": legacy(), "host:ssh-1": { ...legacy(), views: {} } } });
    storage.set(file.LEGACY_SIDE_KEY, raw);
    // a step-2 work area stored already for local: kept, the agent column added beside it
    storage.set(file.PANES_STORAGE_KEY, JSON.stringify({ v: 1, layouts: { "host:local": work("a1") } }));
    expect(file.migrateLegacySide("conversation.agent")).toEqual(["host:local", "host:ssh-1"]);
    expect(storage.get(file.LEGACY_SIDE_KEY)).toBeUndefined();
    expect(storage.get(file.LEGACY_SIDE_BACKUP_KEY)).toBe(raw);
    expect(file.migrateLegacySide("conversation.agent")).toBeNull();
    const local = file.readScope("host:local");
    expect(local.work && conversationPanes(local.work).map((id) => paneBinding(local.work!, id))).toEqual([
      { hostId: "local", sessionId: "a1" },
      { hostId: "local", sessionId: "b2" },
    ]);
    expect(local.tools!.cols).toHaveLength(1);
    expect(Object.keys(local.tools!.instances)).toHaveLength(5);
    const remote = file.readScope("host:ssh-1");
    expect(remote.work).not.toBeNull();
    expect(remote.tools!.cols[0]!.id).toBe("p1");
  });

  it("writeWork / writeTools keep each other's area", async () => {
    const file = await import("../src/renderer/src/lib/paneFile");
    file.writeTools("host:local", tools());
    file.writeWork("host:local", openBeside(work(), { hostId: "local", sessionId: "b2" }, 1));
    const both = file.readScope("host:local");
    expect(conversationPanes(both.work!)).toHaveLength(2);
    expect(both.tools!.cols).toHaveLength(1);
    file.writeTools("host:local", emptyLayout());
    const again = file.readScope("host:local");
    expect(conversationPanes(again.work!)).toHaveLength(2);
    expect(again.tools!.cols).toEqual([]);
  });
});
