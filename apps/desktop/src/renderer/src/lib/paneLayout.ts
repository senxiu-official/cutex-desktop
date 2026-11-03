// The window as panes (docs/desktop-modules.md §24; docs/research/panes-20261019.md §1): a pure layout
// model. The left dock (the agent list), columns of panes (each column split into ≤ 3 rows), panes
// holding tabs, each tab an instance `{kind, binding, params, state}`, collapsed chips, the focused pane
// and the maximised one.
//
// Two areas: the WORK area (conversation panes, step 2: up to two columns side by side; a conversation
// pane may also show a page — `page:<id>`, in memory only) and the TOOL area: the Shelves left / right of
// the conversations (§24.12, layout v2: `shelves`, each with ≤ 50 pages of ≤ 3 panes; v1 stored tool columns
// `area: "tools"` instead — `migrateLayoutV1` turns them into the right Shelf's pages). The tool area is
// kept by lib/sideLayout + lib/sideLayoutStore and stored here through `toolPartOf` / `toolRawOf`. Widths
// of work columns are shares (a Shelf has its own width, else appearance.sidePaneWidth). lib/paneStore
// keeps the work area (in step with the selection); lib/paneFile stores both per device. Like the rest
// of the shell, this file names no feature: pane kinds are opaque ids.
import type { SideLayout } from "./sideLayout";
import { MAX_SHELF_PAGES } from "./shelfLimits";

/** Layout JSON version (the persisted shape, §4 持久化; lib/paneStore). */
export const PANE_LAYOUT_VERSION = 2;
/** At most this many panes on screen (§1 限额, owner-approved). */
export const MAX_VISIBLE_PANES = 6;
/** At most this many panes stacked in one column. */
export const MAX_ROWS = 3;
/** At most this many collapsed chips in the tray (more: the oldest closes). */
export const MAX_CHIPS = 8;
/**
 * Chips a stored layout may hold: the oldest chips close beyond MAX_CHIPS unless closing them would end
 * something (`closeConfirm`), so the tray can briefly hold more; never more than this.
 */
export const MAX_STORED_CHIPS = 2 * MAX_CHIPS;
/** A pane kind's minimum size when it names none (`PaneKindItem.minSize`). */
export const DEFAULT_MIN_SIZE: Readonly<{ w: number; h: number }> = { w: 280, h: 120 };
/** The conversation's minimum width beside another conversation (its timeline, cards and composer stop fitting below). */
export const CONVERSATION_MIN_W = 400;
/** Tool columns right of the conversations (step 3; the former right side's pages). */
export const MAX_TOOL_COLUMNS = 2;
/** Tool panes in all: what the screen has left beside two conversation columns (6 − 2). */
export const MAX_TOOL_PANES = 4;
/** A derived page kind's prefix: `page:<main.page id>` (§24.4). */
export const PAGE_KIND_PREFIX = "page:";
/** The id prefix of the tool area's panes / instances in the stored JSON (they are the side engine's c… / i… ids). */
export const TOOL_ID_PREFIX = "t-";

/** The built-in kinds of the shell (§2): the agent list (the left dock) and a conversation. */
export const AGENTS_KIND = "core.agents";
export const CONVERSATION_KIND = "core.conversation";
/** The conversation pane of the default layout (and its one instance); = lib/conversationScope MAIN_CONVERSATION_PANE. */
export const MAIN_PANE = "main";

/**
 * What an instance shows: one agent of one host; a host; whatever the focused conversation shows
 * (`follow`, on its host); the focused conversation's workspace (`workspace`, a tool instance opened in
 * it); or nothing in particular. An agent binding with `sessionId: null` is a conversation pane with no
 * agent open (the start screen).
 */
export type PaneBinding =
  | { kind: "agent"; hostId: string; sessionId: string | null }
  | { kind: "host"; hostId: string }
  | { kind: "follow"; hostId?: string }
  | { kind: "workspace"; hostId: string; key: string }
  | { kind: "none" };

export interface PaneInstance {
  kind: string;
  binding: PaneBinding;
  params: Record<string, unknown>;
  state: unknown;
  /** Tool instances (step 3): dedupe key, state version, kept (not a preview), last used. */
  key?: string | null;
  v?: number;
  pinned?: boolean;
  at?: number;
}

export interface PaneDock {
  kind: string;
  /** open = the full list; rail = collapsed (today: hidden; step 5: the avatar rail). */
  mode: "open" | "rail";
  width: number;
}

export interface PaneRow {
  pane: string;
  /** Share of the column's height (the rows of a column sum to 1). */
  h: number;
}

export interface PaneColumn {
  /** Share of its area's width (the columns of an area sum to 1). */
  w: number;
  rows: PaneRow[];
  /** "tools": a tool column (right of the conversations); omitted: the work area. */
  area?: "tools";
  /** Tool columns: the side engine's page id, its placement groups and user-given name. */
  id?: string;
  groups?: string[];
  name?: string;
}

export interface Pane {
  /** Instance ids, in tab order. */
  tabs: string[];
  active: string;
  /** Last used (ms; LRU when the limits collapse panes). */
  at: number;
  /** Tool panes: the home kind (the kind it was made for) and whether it is folded to its header. */
  kind?: string;
  collapsed?: boolean;
  /** A chip (step 4): when it was collapsed and where it came from (its neighbours then). */
  home?: PaneHome;
}

/**
 * Where a collapsed pane (a chip in the tray) goes back to (step 4: 「放回原来的邻居旁边」). Work panes:
 * the conversation columns left / right of it then, its column index and width share. Tool panes: its
 * tool column (id, groups, name, index — the column may be gone by then) and the panes above / below it.
 */
export interface PaneHome {
  /** When it was collapsed (ms): the tray's order, the oldest closes first beyond MAX_CHIPS. */
  at: number;
  left?: string | null;
  right?: string | null;
  col?: number;
  w?: number;
  column?: { id: string; groups: string[]; name?: string; index: number; shelf?: string; side?: "left" | "right" };
  above?: string | null;
  below?: string | null;
}

/** The tool area's own state (step 3): shown, the focused tool column, the owner's per-kind overrides, the id counter. */
export interface PaneTools {
  open: boolean;
  focus: string | null;
  overrides: Record<string, { page: string; groups: string[]; at: number }>;
  seq: number;
  /** 只用一个 Shelf (§24.12); absent = off. */
  singleShelf?: boolean;
}

/** A Shelf's page as stored (v2): its panes top → bottom (none: an empty page the owner made). */
export interface PaneShelfPage {
  id: string;
  groups: string[];
  name?: string;
  icon?: string;
  kept?: boolean;
  /** 在所有对话中显示 (§24.13): a page every conversation's Shelf shows. */
  shared?: boolean;
  rows: PaneRow[];
}

/** A Shelf as stored (v2, §24.12). */
export interface PaneShelf {
  id: string;
  side: "left" | "right";
  width?: number;
  active: string | null;
  options: { allowMixing: boolean; railPlacement: "outer" | "inner" };
  /** Collapsed to its Shelf Rail (owner 2026-10-21; file v4). */
  collapsed?: boolean;
  /** File v3: the whole Shelf in the tray since (ms) — read as `collapsed` (paneFile `migrateShelfRails` rewrites it). */
  chip?: number;
  pages: PaneShelfPage[];
}

export interface PaneLayout {
  v: typeof PANE_LAYOUT_VERSION;
  dock: { left: PaneDock | null };
  cols: PaneColumn[];
  panes: Record<string, Pane>;
  instances: Record<string, PaneInstance>;
  /** Collapsed panes (the tray), oldest first. */
  chips: string[];
  focus: string | null;
  max: string | null;
  /** The tool area's state (stored layouts with Shelves). */
  tools?: PaneTools;
  /** The Shelves (v2; their panes and instances are in `panes` / `instances` with the TOOL_ID_PREFIX). */
  shelves?: PaneShelf[];
}

/** What a fresh window is made of (one conversation pane). */
export interface DefaultLayoutInput {
  sidebarOpen: boolean;
  sidebarWidth: number;
  /** The selected agent's host (`agentHost`: the focus host when none is open). */
  hostId: string;
  /** The selected agent (null: none open). */
  sessionId: string | null;
}

/** Today's window as a layout: the agent list docked left, one column with the one conversation (focused). */
export function defaultLayout({ sidebarOpen, sidebarWidth, hostId, sessionId }: DefaultLayoutInput): PaneLayout {
  return {
    v: PANE_LAYOUT_VERSION,
    dock: { left: { kind: AGENTS_KIND, mode: sidebarOpen ? "open" : "rail", width: sidebarWidth } },
    cols: [{ w: 1, rows: [{ pane: MAIN_PANE, h: 1 }] }],
    panes: { [MAIN_PANE]: { tabs: [MAIN_PANE], active: MAIN_PANE, at: 0 } },
    instances: { [MAIN_PANE]: { kind: CONVERSATION_KIND, binding: { kind: "agent", hostId, sessionId }, params: {}, state: null } },
    chips: [],
    focus: MAIN_PANE,
    max: null,
  };
}

// ---------- reads ----------

/** The panes on screen, column by column, top to bottom. */
export function visiblePanes(layout: PaneLayout): string[] {
  return layout.cols.flatMap((c) => c.rows.map((r) => r.pane));
}

const isToolColumn = (c: PaneColumn) => c.area === "tools";

/** The work area's panes (conversation panes) on screen, column by column. */
export function workPanes(layout: PaneLayout): string[] {
  return layout.cols.filter((c) => !isToolColumn(c)).flatMap((c) => c.rows.map((r) => r.pane));
}

/** The pane's shown instance (its active tab), or null. */
export function activeInstance(layout: PaneLayout, paneId: string): { id: string; instance: PaneInstance } | null {
  const pane = layout.panes[paneId];
  const instance = pane ? layout.instances[pane.active] : undefined;
  return pane && instance ? { id: pane.active, instance } : null;
}

// ---------- limits (§1 限额; enforced by the placement rules of later steps) ----------

/** Another pane fits on screen. */
export const canShowPane = (layout: PaneLayout): boolean => visiblePanes(layout).length < MAX_VISIBLE_PANES;

/** Column `col` can be split once more (and the screen has room for one more pane). */
export const canSplitColumn = (layout: PaneLayout, col: number): boolean => {
  const column = layout.cols[col];
  return !!column && column.rows.length < MAX_ROWS && canShowPane(layout);
};

/** Another chip fits in the tray. */
export const canAddChip = (layout: PaneLayout): boolean => layout.chips.length < MAX_CHIPS;

// ---------- validation (the stored JSON of later steps; never trusted as is) ----------

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isId = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 128;
const isShare = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0 && x <= 1;
/** Shares are stored rounded; their sum may drift a little. */
const sumsToOne = (shares: readonly number[]) => Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 0.01;

function validBinding(x: unknown): x is PaneBinding {
  if (!isRecord(x)) return false;
  switch (x.kind) {
    case "agent":
      return isId(x.hostId) && (x.sessionId === null || isId(x.sessionId));
    case "host":
      return isId(x.hostId);
    case "workspace":
      return isId(x.hostId) && typeof x.key === "string" && x.key.length > 0 && x.key.length <= 400;
    case "follow":
      return x.hostId === undefined || isId(x.hostId);
    case "none":
      return true;
    default:
      return false;
  }
}

function validInstance(x: unknown): x is PaneInstance {
  return isRecord(x) && isId(x.kind) && validBinding(x.binding) && isRecord(x.params) && "state" in x;
}

function validTools(x: unknown): x is PaneTools {
  return isRecord(x) && typeof x.open === "boolean" && (x.focus === null || isId(x.focus)) && isRecord(x.overrides) && typeof x.seq === "number" && Number.isFinite(x.seq) && (x.singleShelf === undefined || typeof x.singleShelf === "boolean");
}

const isRef = (x: unknown) => x === undefined || x === null || isId(x);

function validHome(x: unknown): x is PaneHome {
  if (!isRecord(x) || typeof x.at !== "number" || !Number.isFinite(x.at)) return false;
  if (!isRef(x.left) || !isRef(x.right) || !isRef(x.above) || !isRef(x.below)) return false;
  if (x.col !== undefined && !(typeof x.col === "number" && Number.isInteger(x.col) && x.col >= 0)) return false;
  if (x.w !== undefined && !isShare(x.w)) return false;
  const c = x.column;
  if (c !== undefined && !(isRecord(c) && isId(c.id) && Array.isArray(c.groups) && c.groups.every((g) => typeof g === "string") && typeof c.index === "number" && Number.isInteger(c.index) && c.index >= 0)) return false;
  return true;
}

function validDock(x: unknown): x is PaneDock {
  return isRecord(x) && isId(x.kind) && (x.mode === "open" || x.mode === "rail") && typeof x.width === "number" && Number.isFinite(x.width) && x.width > 0;
}

const SHELF_ID = /^s\d+$/;
const PAGE_ID = /^p\d+$/;

/** A stored Shelf's shape (its panes are checked with the others). */
function validShelf(x: unknown): x is PaneShelf {
  if (!isRecord(x) || typeof x.id !== "string" || !SHELF_ID.test(x.id) || (x.side !== "left" && x.side !== "right")) return false;
  if (!(x.active === null || (typeof x.active === "string" && PAGE_ID.test(x.active)))) return false;
  if (!isRecord(x.options) || typeof x.options.allowMixing !== "boolean" || (x.options.railPlacement !== "outer" && x.options.railPlacement !== "inner")) return false;
  if (x.width !== undefined && !(typeof x.width === "number" && Number.isFinite(x.width) && x.width > 0)) return false;
  if (x.chip !== undefined && !(typeof x.chip === "number" && Number.isFinite(x.chip))) return false;
  if (x.collapsed !== undefined && typeof x.collapsed !== "boolean") return false;
  if (!Array.isArray(x.pages) || x.pages.length === 0 || x.pages.length > MAX_SHELF_PAGES_STORED) return false;
  for (const page of x.pages as unknown[]) {
    if (!isRecord(page) || typeof page.id !== "string" || !PAGE_ID.test(page.id) || !Array.isArray(page.groups) || !page.groups.every((g) => typeof g === "string")) return false;
    if (page.name !== undefined && typeof page.name !== "string") return false;
    if (page.icon !== undefined && typeof page.icon !== "string") return false;
    if (!Array.isArray(page.rows) || page.rows.length > MAX_ROWS || (page.rows.length === 0 && page.kept !== true)) return false;
  }
  return true;
}

/** Pages a stored Shelf may have (= lib/sideLayout MAX_SHELF_PAGES). */
const MAX_SHELF_PAGES_STORED = MAX_SHELF_PAGES;

/**
 * The layout if `raw` is a well-formed v2 one within the limits, else null: the version; ≥ 1 work column
 * whose widths sum to 1; 1–3 rows per column whose heights sum to 1; ≤ 6 work panes on screen; ≤ 2
 * Shelves, one per side, each with 1–50 pages of 0–3 rows (0 only for a page the owner made) whose heights
 * sum to 1; every pane named once (on screen, on a Shelf's page or as a chip) and existing; every pane's
 * tabs existing instances (each in one pane) with its active one among them; focus / max a work pane on
 * screen or null; ≤ 16 stored chips; the tool state well-formed when present. (v1 = `migrateLayoutV1` first.)
 */
export function validateLayout(raw: unknown): PaneLayout | null {
  if (!isRecord(raw) || raw.v !== PANE_LAYOUT_VERSION) return null;
  if (!isRecord(raw.dock) || !(raw.dock.left === null || validDock(raw.dock.left))) return null;
  if (!Array.isArray(raw.cols) || raw.cols.length === 0) return null;
  if (!isRecord(raw.panes) || !isRecord(raw.instances) || !Array.isArray(raw.chips)) return null;
  const panes = raw.panes;
  const instances = raw.instances;
  if (raw.tools !== undefined && !validTools(raw.tools)) return null;
  const seen = new Set<string>();
  const widths: number[] = [];
  const rowsOk = (rows: unknown[], allowEmpty: boolean): boolean => {
    if ((rows.length === 0 && !allowEmpty) || rows.length > MAX_ROWS) return false;
    const heights: number[] = [];
    for (const row of rows) {
      if (!isRecord(row) || !isId(row.pane) || !isShare(row.h) || !(row.pane in panes) || seen.has(row.pane)) return false;
      seen.add(row.pane);
      heights.push(row.h);
    }
    return rows.length === 0 || sumsToOne(heights);
  };
  for (const col of raw.cols as unknown[]) {
    if (!isRecord(col) || !isShare(col.w) || !Array.isArray(col.rows) || col.area !== undefined) return null;
    if (!rowsOk(col.rows, false)) return null;
    widths.push(col.w);
  }
  if (!widths.length || !sumsToOne(widths) || seen.size > MAX_VISIBLE_PANES) return null;
  const visible = new Set(seen);
  if (raw.shelves !== undefined) {
    if (!Array.isArray(raw.shelves) || raw.shelves.length > MAX_TOOL_COLUMNS) return null;
    const sides = new Set<string>();
    const ids = new Set<string>();
    for (const shelf of raw.shelves as unknown[]) {
      if (!validShelf(shelf) || sides.has(shelf.side) || ids.has(shelf.id)) return null;
      sides.add(shelf.side);
      ids.add(shelf.id);
      for (const page of shelf.pages) {
        if (ids.has(page.id)) return null;
        ids.add(page.id);
        if (!rowsOk(page.rows, true)) return null;
      }
    }
  }
  if (raw.chips.length > MAX_STORED_CHIPS) return null;
  for (const chip of raw.chips as unknown[]) {
    if (!isId(chip) || !(chip in panes) || seen.has(chip)) return null;
    seen.add(chip);
  }
  // Every pane is placed (on screen, on a page or a chip): an unplaced one could never be reached.
  if (Object.keys(panes).some((id) => !seen.has(id))) return null;
  const owned = new Set<string>();
  for (const pane of Object.values(panes)) {
    if (!isRecord(pane) || !Array.isArray(pane.tabs) || pane.tabs.length === 0 || !isId(pane.active) || typeof pane.at !== "number" || !Number.isFinite(pane.at)) return null;
    for (const tab of pane.tabs as unknown[]) {
      if (!isId(tab) || owned.has(tab) || !validInstance(instances[tab])) return null;
      owned.add(tab);
    }
    if (!(pane.tabs as string[]).includes(pane.active)) return null;
    if (pane.home !== undefined && !validHome(pane.home)) return null;
  }
  // Every instance is a tab of some pane.
  if (Object.keys(instances).some((id) => !owned.has(id))) return null;
  for (const at of [raw.focus, raw.max]) if (at !== null && !(isId(at) && visible.has(at))) return null;
  return raw as unknown as PaneLayout;
}

/**
 * A stored v1 layout (step 3 – 5: tool columns `area: "tools"`) as v2 (§24.12): the work area as it was;
 * the tool columns become the pages of ONE right Shelf (column order = rail order, the focused column its
 * page in view) that does not allow mixing (owner 2026-10-20: every Shelf starts with it off; panes that mix
 * kinds already stay as they are — nothing regroups, only new placements keep kinds apart). Untrusted
 * in, untrusted out (validate after). Anything else is returned as it is.
 */
export function migrateLayoutV1(raw: unknown): unknown {
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.cols)) return raw;
  const cols = raw.cols as unknown[];
  const work = cols.filter((c) => !(isRecord(c) && c.area === "tools"));
  const tools = cols.filter((c): c is Record<string, unknown> => isRecord(c) && c.area === "tools");
  const out: Record<string, unknown> = { ...raw, v: PANE_LAYOUT_VERSION, cols: work };
  delete out.shelves;
  if (!tools.length) return out;
  let seq = isRecord(raw.tools) && typeof raw.tools.seq === "number" && Number.isFinite(raw.tools.seq) ? raw.tools.seq : 0;
  const pages: PaneShelfPage[] = tools.map((c) => ({
    id: typeof c.id === "string" ? c.id : "",
    groups: Array.isArray(c.groups) ? c.groups.filter((g): g is string => typeof g === "string") : [],
    ...(typeof c.name === "string" && c.name ? { name: c.name } : {}),
    rows: Array.isArray(c.rows) ? (c.rows as PaneRow[]) : [],
  }));
  seq += 1;
  const focus = isRecord(raw.tools) && typeof raw.tools.focus === "string" ? raw.tools.focus : null;
  out.shelves = [{ id: `s${seq}`, side: "right", active: pages.some((p) => p.id === focus) ? focus : (pages[0]?.id ?? null), options: { allowMixing: false, railPlacement: "outer" }, pages }];
  if (isRecord(raw.tools)) out.tools = { ...raw.tools, seq };
  return out;
}

// ---------- conversation panes (step 2: `core.conversation` multi-instance, ≤ 2 columns) ----------
//
// Step 2 places conversation panes only: one column each, side by side (at most
// MAX_CONVERSATION_COLUMNS). The focused one is bound to the store's selection (the 「focused
// conversation」: sidebar highlight, title bar, follow-bound side cards); the others keep their agent.
// An agent is shown in one pane at most (dedupe key host + session). Every op returns a new layout
// (or the same object when nothing changes) and never names a feature.

/** At most this many conversation columns side by side (step 2). */
export const MAX_CONVERSATION_COLUMNS = 2;
/** The setting 「允许 3 列」 (lib/workspaceGroupPrefs): off = MAX_CONVERSATION_COLUMNS, on = 3. */
const THREE_COLUMNS = 3;
let allowThree = false;
export function setAllowThreeColumns(on: boolean): void {
  allowThree = on;
}
/** How many conversation columns the window may show side by side now (design 039). */
export const maxConversationColumns = (): number => (allowThree ? THREE_COLUMNS : MAX_CONVERSATION_COLUMNS);
/** Neither of two columns gets narrower than this share of the work area. */
export const MIN_COLUMN_SHARE = 0.2;

/** An agent a conversation pane shows. */
export interface PaneAgent {
  hostId: string;
  sessionId: string;
}

/** A pane's conversation tab (the `core.conversation` instance among its tabs), or null. */
export function conversationTab(layout: PaneLayout, paneId: string): string | null {
  return layout.panes[paneId]?.tabs.find((id) => layout.instances[id]?.kind === CONVERSATION_KIND) ?? null;
}

const isConversation = (layout: PaneLayout, paneId: string) => conversationTab(layout, paneId) !== null;

/** The conversation panes on screen, left to right (a pane showing a page over its conversation is one too). */
export function conversationPanes(layout: PaneLayout): string[] {
  return workPanes(layout).filter((id) => isConversation(layout, id));
}

/** A conversation pane's agent binding (`sessionId` null: no agent open), or null for another pane. */
export function paneBinding(layout: PaneLayout, paneId: string): { hostId: string; sessionId: string | null } | null {
  const tab = conversationTab(layout, paneId);
  const binding = tab ? layout.instances[tab]!.binding : null;
  return binding?.kind === "agent" ? { hostId: binding.hostId, sessionId: binding.sessionId } : null;
}

/** The pane on screen showing this agent, or null. */
export function paneShowing(layout: PaneLayout, hostId: string, sessionId: string): string | null {
  return conversationPanes(layout).find((id) => {
    const b = paneBinding(layout, id);
    return b?.hostId === hostId && b.sessionId === sessionId;
  }) ?? null;
}

/** The focused conversation pane: the focus when it is one, else the first conversation pane (null: none). */
export function focusedConversation(layout: PaneLayout): string | null {
  if (layout.focus && isConversation(layout, layout.focus) && visiblePanes(layout).includes(layout.focus)) return layout.focus;
  return conversationPanes(layout)[0] ?? null;
}

/** The agents of the conversation panes on screen ("looking at" is every visible conversation). */
export function shownAgents(layout: PaneLayout): PaneAgent[] {
  return conversationPanes(layout).flatMap((id) => {
    const b = paneBinding(layout, id);
    return b?.sessionId ? [{ hostId: b.hostId, sessionId: b.sessionId }] : [];
  });
}

const touch = (layout: PaneLayout, paneId: string, now: number): Record<string, Pane> => ({ ...layout.panes, [paneId]: { ...layout.panes[paneId]!, at: now } });

/** Focus a pane on screen (its `at` = now). */
export function focusPane(layout: PaneLayout, paneId: string, now: number): PaneLayout {
  if (!visiblePanes(layout).includes(paneId)) return layout;
  if (layout.focus === paneId && layout.panes[paneId]?.at === now) return layout;
  return { ...layout, focus: paneId, panes: touch(layout, paneId, now) };
}

/** Bind a conversation pane to an agent (`sessionId` null: none open). */
export function bindPane(layout: PaneLayout, paneId: string, hostId: string, sessionId: string | null): PaneLayout {
  const tab = conversationTab(layout, paneId);
  if (!tab) return layout;
  const instance = layout.instances[tab]!;
  const b = instance.binding;
  if (b.kind === "agent" && b.hostId === hostId && b.sessionId === sessionId) return layout;
  return { ...layout, instances: { ...layout.instances, [tab]: { ...instance, binding: { kind: "agent", hostId, sessionId } } } };
}

/**
 * Plain open (a click on an agent): already shown → that pane gets the focus; in the tray → its chip goes
 * back next to its old neighbours (step 4: 已经开着就放回原位); otherwise the focused conversation pane
 * shows it instead (replace).
 */
export function showAgent(layout: PaneLayout, agent: PaneAgent, now: number): PaneLayout {
  const at = paneShowing(layout, agent.hostId, agent.sessionId);
  if (at) return focusPane(layout, at, now);
  const chip = chipShowing(layout, agent.hostId, agent.sessionId);
  if (chip) return restoreConversation(layout, chip, now);
  const target = focusedConversation(layout);
  if (!target) return layout;
  return focusPane(bindPane(layout, target, agent.hostId, agent.sessionId), target, now);
}

/** A pane / instance id not used yet (`c2`, `c3`, …). */
function freshId(layout: PaneLayout): string {
  for (let n = 2; ; n++) {
    const id = `c${n}`;
    if (!(id in layout.panes) && !(id in layout.instances)) return id;
  }
}

/**
 * Ctrl/⌘ + click, middle click, 「在旁边打开」: the agent in a conversation pane beside the focused one,
 * focused. Already shown → focused there; in the tray → its chip comes back. The focused pane shows no
 * agent → it shows this one. Room for another column (< MAX_CONVERSATION_COLUMNS, and `room`: the work
 * area fits another column at its minimum width) → a new column right of the focused pane's, which gives
 * it half its width. Otherwise (step 4, LRU) the other conversation pane — or, without the width for a
 * second column, the focused one — shows it and its agent goes to the tray.
 */
export function openBeside(layout: PaneLayout, agent: PaneAgent, now: number, opts: { focus?: boolean; room?: boolean; noChip?: boolean } = {}): PaneLayout {
  const focusIt = opts.focus !== false;
  const at = paneShowing(layout, agent.hostId, agent.sessionId);
  if (at) return focusIt ? focusPane(layout, at, now) : layout;
  const chip = chipShowing(layout, agent.hostId, agent.sessionId);
  if (chip) return restoreConversation(layout, chip, now, { focus: focusIt, room: opts.room });
  const focused = focusedConversation(layout);
  if (!focused) return layout;
  if (!paneBinding(layout, focused)?.sessionId) return showAgent(layout, agent, now);
  const panes = conversationPanes(layout);
  if (panes.length >= maxConversationColumns() || opts.room === false) {
    const other = panes.length >= maxConversationColumns() ? panes.find((id) => id !== focused)! : focused;
    // §24.13 (`noChip`): the workspace there just shows the agent — the one it showed is remembered with its
    // Shelf, it does not go to the tray (no conversation chips since).
    const bound = opts.noChip ? bindPane(closePaneOverlay(layout, other), other, agent.hostId, agent.sessionId) : replaceToChip(layout, other, agent, now);
    return focusIt ? focusPane(bound, other, now) : bound;
  }
  const col = layout.cols.findIndex((c) => c.rows.some((r) => r.pane === focused));
  if (col < 0 || !canShowPane(layout)) return layout;
  const id = freshId(layout);
  const half = layout.cols[col]!.w / 2;
  const cols = [...layout.cols.slice(0, col), { ...layout.cols[col]!, w: half }, { w: half, rows: [{ pane: id, h: 1 }] }, ...layout.cols.slice(col + 1)];
  return {
    ...layout,
    cols,
    panes: { ...layout.panes, [id]: { tabs: [id], active: id, at: now } },
    instances: { ...layout.instances, [id]: { kind: CONVERSATION_KIND, binding: { kind: "agent", hostId: agent.hostId, sessionId: agent.sessionId }, params: {}, state: null } },
    focus: focusIt ? id : layout.focus,
  };
}

/**
 * An empty conversation column (no agent: a page goes over it, e.g. 新建{{agent}} with Ctrl/⌘, design 038) right of the
 * focused one, which gives it half its width; focused. Unchanged without room (MAX_CONVERSATION_COLUMNS, `room`
 * false: the work area does not fit another column at its minimum width).
 */
export function openEmptyBeside(layout: PaneLayout, hostId: string, now: number, room = true): PaneLayout {
  const focused = focusedConversation(layout);
  if (!focused || !room || conversationPanes(layout).length >= maxConversationColumns()) return layout;
  const col = layout.cols.findIndex((c) => c.rows.some((r) => r.pane === focused));
  if (col < 0 || !canShowPane(layout)) return layout;
  const id = freshId(layout);
  const half = layout.cols[col]!.w / 2;
  const cols = [...layout.cols.slice(0, col), { ...layout.cols[col]!, w: half }, { w: half, rows: [{ pane: id, h: 1 }] }, ...layout.cols.slice(col + 1)];
  return {
    ...layout,
    cols,
    panes: { ...layout.panes, [id]: { tabs: [id], active: id, at: now } },
    instances: { ...layout.instances, [id]: { kind: CONVERSATION_KIND, binding: { kind: "agent", hostId, sessionId: null }, params: {}, state: null } },
    focus: id,
  };
}

/**
 * Another conversation column right of the others, showing `agent`, without moving the focus (the
 * migration of v1.16 side agent cards, §24.7). Already shown, or no room (MAX_CONVERSATION_COLUMNS) →
 * unchanged. The new column takes a half of the right-most one.
 */
export function addConversationColumn(layout: PaneLayout, agent: PaneAgent, now: number): PaneLayout {
  if (paneShowing(layout, agent.hostId, agent.sessionId) || conversationPanes(layout).length >= maxConversationColumns() || !canShowPane(layout)) return layout;
  const work = layout.cols.map((c, i) => ({ c, i })).filter(({ c }) => !isToolColumn(c));
  const last = work[work.length - 1];
  if (!last) return layout;
  const id = freshId(layout);
  const half = last.c.w / 2;
  const cols = [...layout.cols];
  cols.splice(last.i, 1, { ...last.c, w: half }, { w: half, rows: [{ pane: id, h: 1 }] });
  return {
    ...layout,
    cols,
    panes: { ...layout.panes, [id]: { tabs: [id], active: id, at: now } },
    instances: { ...layout.instances, [id]: { kind: CONVERSATION_KIND, binding: { kind: "agent", hostId: agent.hostId, sessionId: agent.sessionId }, params: {}, state: null } },
  };
}

/**
 * 工作区 (design 039): the conversation columns show exactly `agents` (left → right, at most maxConversationColumns()).
 * The columns already showing one of them stay; the others are bound to the agents still to show, a column is added when
 * there are too few (`room` false: the window has no width for a further one — then fewer agents show), surplus columns
 * close; the focus goes to `focus`'s column. Pure.
 */
export function showAgentsLayout(layout: PaneLayout, agents: readonly PaneAgent[], focus: PaneAgent | null, now: number, room = true): PaneLayout {
  const want = agents.slice(0, room ? maxConversationColumns() : 1);
  if (!want.length) return layout;
  let l = layout;
  const shownAt = (a: PaneAgent) => paneShowing(l, a.hostId, a.sessionId);
  const keep = new Set(want.flatMap((a) => shownAt(a) ?? []));
  const free = conversationPanes(l).filter((id) => !keep.has(id));
  for (const a of want) {
    if (shownAt(a)) continue;
    const pane = free.shift();
    if (pane) l = bindPane(closePaneOverlay(l, pane), pane, a.hostId, a.sessionId);
    else l = addConversationColumn(l, a, now);
  }
  for (const pane of free) l = closePane(l, pane);
  // The first agent leftmost (a kept column may have been right of a rebound one).
  const first = shownAt(want[0]!);
  if (want.length > 1 && first && conversationPanes(l)[0] !== first) l = moveConversation(l, first, { edge: "left" });
  const at = focus ? shownAt(focus) : null;
  return focusPane(l, at ?? shownAt(want[0]!) ?? conversationPanes(l)[0]!, now);
}

/** Shares rescaled to sum to 1. */
const normalised = (cols: PaneColumn[]): PaneColumn[] => {
  const sum = cols.reduce((a, c) => a + c.w, 0);
  return sum > 0 ? cols.map((c) => ({ ...c, w: c.w / sum })) : cols;
};

/**
 * Close a conversation pane (its × with two shown): its column goes, the others share its width; the
 * focus moves to the most recently used pane left. The last conversation pane never closes.
 */
export function closePane(layout: PaneLayout, paneId: string): PaneLayout {
  const panes = conversationPanes(layout);
  if (!panes.includes(paneId) || panes.length <= 1) return layout;
  const pane = layout.panes[paneId]!;
  const cols = normalised(
    layout.cols
      .filter((c) => !isToolColumn(c))
      .map((c) => {
        const rows = c.rows.filter((r) => r.pane !== paneId);
        if (rows.length === c.rows.length) return c;
        const sum = rows.reduce((a, r) => a + r.h, 0);
        return { ...c, rows: rows.map((r) => ({ ...r, h: r.h / sum })) };
      })
      .filter((c) => c.rows.length > 0),
  );
  const panesLeft = { ...layout.panes };
  delete panesLeft[paneId];
  const instances = { ...layout.instances };
  for (const tab of pane.tabs) delete instances[tab];
  const next: PaneLayout = { ...layout, cols, panes: panesLeft, instances, chips: layout.chips.filter((c) => c !== paneId), max: layout.max === paneId ? null : layout.max };
  if (layout.focus !== paneId) return next;
  const recent = visiblePanes(next).sort((a, b) => (next.panes[b]?.at ?? 0) - (next.panes[a]?.at ?? 0))[0] ?? null;
  return { ...next, focus: recent };
}

/** The divider between column `index` and the next: column `index` takes `share` of their two widths' sum (clamped). */
export function resizeColumns(layout: PaneLayout, index: number, share: number): PaneLayout {
  const left = layout.cols[index];
  const right = layout.cols[index + 1];
  if (!left || !right || !Number.isFinite(share)) return layout;
  const pair = left.w + right.w;
  const min = Math.min(MIN_COLUMN_SHARE, pair / 2);
  const w = Math.min(pair - min, Math.max(min, share * pair));
  if (Math.abs(w - left.w) < 1e-4) return layout;
  const cols = [...layout.cols];
  cols[index] = { ...left, w };
  cols[index + 1] = { ...right, w: pair - w };
  return { ...layout, cols };
}

/**
 * Conversation panes whose agent is gone (`gone(hostId, sessionId)` true: its host lists it no more)
 * close; the last one shows no agent instead. Chips of gone agents close too.
 */
export function dropGoneAgents(layout: PaneLayout, gone: (hostId: string, sessionId: string) => boolean): PaneLayout {
  let next = layout;
  for (const id of conversationPanes(layout)) {
    const b = paneBinding(next, id);
    if (!b?.sessionId || !gone(b.hostId, b.sessionId)) continue;
    const closed = closePane(next, id);
    next = closed !== next ? closed : bindPane(next, id, b.hostId, null);
  }
  for (const id of layout.chips) {
    const b = paneBinding(next, id);
    if (b?.sessionId && gone(b.hostId, b.sessionId)) next = closeChip(next, id);
  }
  return next;
}

/**
 * A stored layout as the work area shows it, or null (then the default layout): well-formed
 * (`validateLayout`), conversation panes only, ≤ MAX_CONVERSATION_COLUMNS columns of one pane each, chips
 * of one agent's conversation each (step 4), not maximised (§4: 最大化不恢复). The focus is a pane on screen.
 */
export function restoreLayout(raw: unknown): PaneLayout | null {
  const stored = validateLayout(raw);
  if (!stored) return null;
  const layout = splitLayout(stored).work;
  if (layout.cols.length > maxConversationColumns() || layout.cols.some((c) => c.rows.length !== 1)) return null;
  for (const id of visiblePanes(layout)) {
    const pane = layout.panes[id]!;
    if (pane.tabs.length !== 1 || !paneBinding(layout, id)) return null;
  }
  for (const id of layout.chips) {
    const pane = layout.panes[id]!;
    if (pane.tabs.length !== 1 || !paneBinding(layout, id)?.sessionId) return null;
  }
  return { ...layout, max: null, focus: focusedConversation(layout) };
}

// ---------- step 4: chips (the tray), maximise, moving conversation columns ----------
//
// 「—」 collapses a pane to a chip in the tray at the work area's bottom; its home records the
// neighbours it had (a click on the chip puts it back next to them). The last conversation pane leaves
// an empty one (no agent: today's empty state) in its place, so the work area always has a conversation
// column. A pane comes back within the limits: at MAX_CONVERSATION_COLUMNS the least recently used
// conversation pane goes to the tray (LRU). Maximise is in memory only (joinLayout drops it).

/** A conversation pane showing no agent (the start screen, today's empty state): nothing to collapse. */
export function isEmptyPane(layout: PaneLayout, paneId: string): boolean {
  const b = paneBinding(layout, paneId);
  return !!b && !b.sessionId && layout.panes[paneId]!.tabs.length === 1;
}

/** The chip holding this agent's conversation, or null. */
export function chipShowing(layout: PaneLayout, hostId: string, sessionId: string): string | null {
  return (
    layout.chips.find((id) => {
      const b = paneBinding(layout, id);
      return b?.hostId === hostId && b.sessionId === sessionId;
    }) ?? null
  );
}

/** The column holding `paneId` (index into layout.cols), or -1. */
const columnOf = (layout: PaneLayout, paneId: string) => layout.cols.findIndex((c) => c.rows.some((r) => r.pane === paneId));

/** Indices (into layout.cols) of the work area's columns, left to right. */
const workColumns = (layout: PaneLayout) => layout.cols.flatMap((c, i) => (isToolColumn(c) ? [] : [i]));

/** The work columns' shares rescaled to sum to 1 (tool columns untouched). */
function normaliseWork(cols: PaneColumn[]): PaneColumn[] {
  const sum = cols.reduce((a, c) => a + (isToolColumn(c) ? 0 : c.w), 0);
  return sum > 0 ? cols.map((c) => (isToolColumn(c) ? c : { ...c, w: c.w / sum })) : cols;
}

/** Columns without `paneId` (an emptied column goes; the work columns share its width). */
function withoutPane(cols: PaneColumn[], paneId: string): PaneColumn[] {
  return normaliseWork(
    cols
      .map((c) => {
        const rows = c.rows.filter((r) => r.pane !== paneId);
        if (rows.length === c.rows.length) return c;
        const sum = rows.reduce((a, r) => a + r.h, 0);
        return { ...c, rows: rows.map((r) => ({ ...r, h: r.h / sum })) };
      })
      .filter((c) => c.rows.length > 0),
  );
}

/** The most recently used pane on screen (null: none). */
const mostRecentPane = (layout: PaneLayout): string | null => visiblePanes(layout).sort((a, b) => (layout.panes[b]?.at ?? 0) - (layout.panes[a]?.at ?? 0))[0] ?? null;

/** Where a work pane sits now: its conversation neighbours, column index (among the work columns) and width. */
function workHome(layout: PaneLayout, paneId: string, now: number): PaneHome {
  const work = workColumns(layout);
  const col = columnOf(layout, paneId);
  const k = work.indexOf(col);
  const first = (i: number | undefined) => (i === undefined ? null : (layout.cols[i]!.rows[0]?.pane ?? null));
  return { at: now, left: first(work[k - 1]), right: first(work[k + 1]), col: Math.max(0, k), w: layout.cols[col]?.w ?? 1 };
}

/** A conversation instance of `agent` (the new pane / chip `id`'s only tab). */
const conversationOf = (id: string, hostId: string, sessionId: string | null, at: number): { pane: Pane; instance: PaneInstance } => ({
  pane: { tabs: [id], active: id, at },
  instance: { kind: CONVERSATION_KIND, binding: { kind: "agent", hostId, sessionId }, params: {}, state: null },
});

/**
 * 「—」 on a conversation pane: it goes to the tray (its page closes; a pane with no agent has nothing
 * to keep and stays). The last conversation pane leaves an empty pane (today's empty state) in its
 * place; otherwise its column goes and the other takes its width. The focus moves to the most recently
 * used pane left; a maximised pane is no longer maximised.
 */
export function collapseConversation(layout: PaneLayout, paneId: string, now: number): PaneLayout {
  if (!conversationPanes(layout).includes(paneId)) return layout;
  const b = paneBinding(layout, paneId);
  if (!b?.sessionId) return layout;
  const l = closePaneOverlay(layout, paneId);
  const home = workHome(l, paneId, now);
  const panes = { ...l.panes, [paneId]: { ...l.panes[paneId]!, home } };
  const chips = [...l.chips.filter((c) => c !== paneId), paneId];
  const max = l.max === paneId ? null : l.max;
  if (conversationPanes(l).length <= 1) {
    const id = freshId(l);
    const empty = conversationOf(id, b.hostId, null, now);
    const cols = l.cols.map((c) => (c.rows.some((r) => r.pane === paneId) ? { ...c, rows: c.rows.map((r) => (r.pane === paneId ? { ...r, pane: id } : r)) } : c));
    return { ...l, cols, chips, max, panes: { ...panes, [id]: empty.pane }, instances: { ...l.instances, [id]: empty.instance }, focus: !l.focus || l.focus === paneId ? id : l.focus };
  }
  const next: PaneLayout = { ...l, cols: withoutPane(l.cols, paneId), panes, chips, max };
  return l.focus === paneId ? { ...next, focus: mostRecentPane(next) } : next;
}

/**
 * Conversation pane `paneId` shows `agent`; the agent it showed goes to the tray as a chip of its own
 * that comes back right of this pane (open beside with no room for another column: LRU).
 */
export function replaceToChip(layout: PaneLayout, paneId: string, agent: PaneAgent, now: number): PaneLayout {
  const b = paneBinding(layout, paneId);
  if (!b) return layout;
  const l = closePaneOverlay(layout, paneId);
  if (!b.sessionId) return bindPane(l, paneId, agent.hostId, agent.sessionId);
  const id = freshId(l);
  const chip = conversationOf(id, b.hostId, b.sessionId, l.panes[paneId]!.at);
  const home: PaneHome = { ...workHome(l, paneId, now), left: paneId, right: null };
  home.col = (home.col ?? 0) + 1;
  const next: PaneLayout = { ...l, chips: [...l.chips, id], panes: { ...l.panes, [id]: { ...chip.pane, home } }, instances: { ...l.instances, [id]: chip.instance } };
  return bindPane(next, paneId, agent.hostId, agent.sessionId);
}

/**
 * A click on a conversation chip: the pane comes back next to the neighbours it had (else at its old
 * column index), with its old width share (kept between 0.3 and 0.7 beside another column), focused
 * unless `focus: false`. An empty pane (no agent) gives its place to it. Within the limits: at
 * MAX_CONVERSATION_COLUMNS — or without the width for another column (`room: false`) — the least recently
 * used conversation pane goes to the tray first (LRU).
 */
export function restoreConversation(layout: PaneLayout, paneId: string, now: number, opts: { focus?: boolean; room?: boolean } = {}): PaneLayout {
  if (!layout.chips.includes(paneId) || !conversationTab(layout, paneId)) return layout;
  const focusIt = opts.focus !== false;
  const { home, ...pane } = layout.panes[paneId]!;
  let l: PaneLayout = { ...layout, chips: layout.chips.filter((c) => c !== paneId), panes: { ...layout.panes, [paneId]: { ...pane, at: now } } };
  const empty = conversationPanes(l).find((id) => isEmptyPane(l, id));
  if (empty) {
    const cols = l.cols.map((c) => (c.rows.some((r) => r.pane === empty) ? { ...c, rows: c.rows.map((r) => (r.pane === empty ? { ...r, pane: paneId } : r)) } : c));
    const panes = { ...l.panes };
    delete panes[empty];
    const instances = { ...l.instances };
    for (const tab of l.panes[empty]!.tabs) delete instances[tab];
    return { ...l, cols, panes, instances, focus: focusIt || l.focus === empty ? paneId : l.focus, max: l.max === empty ? null : l.max };
  }
  const limit = opts.room === false ? 1 : maxConversationColumns();
  while (conversationPanes(l).length >= limit || !canShowPane(l)) {
    const lru = conversationPanes(l).sort((a, b) => l.panes[a]!.at - l.panes[b]!.at)[0];
    const next = lru ? collapseConversation(l, lru, now) : l;
    if (next === l) break;
    l = next;
    // The last one leaves an empty pane: this chip takes its place.
    const left = conversationPanes(l).find((id) => isEmptyPane(l, id));
    if (left) return restoreConversation({ ...l, chips: [...l.chips, paneId], panes: { ...l.panes, [paneId]: { ...pane, ...(home ? { home } : {}) } } }, paneId, now, { focus: focusIt });
  }
  const work = workColumns(l);
  const leftCol = home?.left ? columnOf(l, home.left) : -1;
  const rightCol = home?.right ? columnOf(l, home.right) : -1;
  let at: number;
  if (leftCol >= 0 && !isToolColumn(l.cols[leftCol]!)) at = leftCol + 1;
  else if (rightCol >= 0 && !isToolColumn(l.cols[rightCol]!)) at = rightCol;
  else {
    const k = Math.min(home?.col ?? work.length, work.length);
    at = k < work.length ? work[k]! : work.length ? work[work.length - 1]! + 1 : 0;
  }
  const w = work.length ? Math.min(0.7, Math.max(0.3, home?.w ?? 0.5)) : 1;
  const cols = l.cols.map((c) => (isToolColumn(c) ? c : { ...c, w: c.w * (1 - w) }));
  cols.splice(at, 0, { w, rows: [{ pane: paneId, h: 1 }] });
  return { ...l, cols: normaliseWork(cols), focus: focusIt ? paneId : l.focus };
}

/** A chip's × (or the oldest chip beyond MAX_CHIPS): the pane and its tabs go. */
export function closeChip(layout: PaneLayout, paneId: string): PaneLayout {
  if (!layout.chips.includes(paneId)) return layout;
  const panes = { ...layout.panes };
  const instances = { ...layout.instances };
  for (const tab of layout.panes[paneId]?.tabs ?? []) delete instances[tab];
  delete panes[paneId];
  return { ...layout, chips: layout.chips.filter((c) => c !== paneId), panes, instances };
}

/**
 * 显示桌面 without conversation chips (§24.13): one conversation pane is left, showing no agent (the desktop
 * shows through); the caller keeps the layout before to put it back. Its page closes, nothing is maximised.
 */
export function emptyWork(layout: PaneLayout): PaneLayout {
  const panes = conversationPanes(layout);
  if (!panes.length) return layout;
  const keep = focusedConversation(layout) ?? panes[0]!;
  let l = layout;
  for (const id of panes) if (id !== keep) l = closePane(l, id);
  const b = paneBinding(l, keep)!;
  l = bindPane(closePaneOverlay(l, keep), keep, b.hostId, null);
  return { ...l, max: null, focus: keep };
}

/** ⤢ / double-click on a pane header / Ctrl+Shift+M: maximise a pane on screen, or restore it. */
export function toggleMaximized(layout: PaneLayout, paneId: string): PaneLayout {
  if (layout.max === paneId) return { ...layout, max: null };
  return visiblePanes(layout).includes(paneId) ? { ...layout, max: paneId } : layout;
}

/** No pane maximised (Esc, another pane maximised, a drop). */
export const clearMaximized = (layout: PaneLayout): PaneLayout => (layout.max ? { ...layout, max: null } : layout);

/** Where a dragged conversation column goes: beside another conversation pane, or at an edge of the work area. */
export type ConversationDrop = { near: string; side: "left" | "right" } | { edge: "left" | "right" };

/**
 * A conversation pane dragged by its header (step 4): its column moves left / right of another
 * conversation column or to the work area's far edge (two conversations reorder). The same layout when
 * nothing would change.
 */
export function moveConversation(layout: PaneLayout, paneId: string, to: ConversationDrop): PaneLayout {
  const from = columnOf(layout, paneId);
  if (from < 0 || isToolColumn(layout.cols[from]!) || ("near" in to && to.near === paneId)) return layout;
  const column = layout.cols[from]!;
  const cols = layout.cols.filter((_, i) => i !== from);
  const work = cols.flatMap((c, i) => (isToolColumn(c) ? [] : [i]));
  let at: number;
  if ("edge" in to) at = to.edge === "left" ? (work[0] ?? 0) : work.length ? work[work.length - 1]! + 1 : 0;
  else {
    const k = cols.findIndex((c) => c.rows.some((r) => r.pane === to.near));
    if (k < 0 || isToolColumn(cols[k]!)) return layout;
    at = to.side === "left" ? k : k + 1;
  }
  cols.splice(at, 0, column);
  return cols.every((c, i) => c === layout.cols[i]) ? layout : { ...layout, cols };
}

/** A chip in the tray, whichever area it is from (the tray sorts them by `at`, oldest first). */
export interface TrayEntry {
  key: string;
  at: number;
  /** Closing it ends nothing (no `closeConfirm` warning): it may close by itself beyond MAX_CHIPS. */
  closable: boolean;
}

/** The chips to close so the tray keeps ≤ `max` (the oldest closable ones first; a chip that would end something stays). */
export function overflowChips(entries: readonly TrayEntry[], max = MAX_CHIPS): string[] {
  const order = [...entries].sort((a, b) => a.at - b.at);
  let over = order.length - max;
  const out: string[] = [];
  for (const e of order) {
    if (over <= 0) break;
    if (!e.closable) continue;
    out.push(e.key);
    over--;
  }
  return out;
}

/** The pane on screen next to `from` in a direction (Ctrl+Alt+arrows), by the boxes the panes take (client px). */
export function paneInDirection(boxes: readonly { id: string; left: number; top: number; width: number; height: number }[], from: string | null, dir: "left" | "right" | "up" | "down"): string | null {
  const here = boxes.find((b) => b.id === from);
  if (!here) return boxes[0]?.id ?? null;
  const cx = here.left + here.width / 2;
  const cy = here.top + here.height / 2;
  let best: { id: string; score: number } | null = null;
  for (const b of boxes) {
    if (b.id === here.id) continue;
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const ahead = dir === "left" ? cx - bx : dir === "right" ? bx - cx : dir === "up" ? cy - by : by - cy;
    if (ahead <= 1) continue;
    // Only a pane straight ahead (overlapping across the axis); the nearest, then the best aligned.
    const across = dir === "left" || dir === "right" ? Math.min(here.top + here.height, b.top + b.height) - Math.max(here.top, b.top) : Math.min(here.left + here.width, b.left + b.width) - Math.max(here.left, b.left);
    if (across <= 0) continue;
    const off = dir === "left" || dir === "right" ? Math.abs(by - cy) : Math.abs(bx - cx);
    const score = ahead + off * 0.5;
    if (!best || score < best.score) best = { id: b.id, score };
  }
  return best?.id ?? null;
}

// ---------- pages in a conversation pane (§24.4: `services.ui.openPage` opens in the focused pane) ----------
//
// A `main.page` shows as a `page:<id>` tab of a conversation pane, over its conversation (the
// conversation tab stays; closing the page shows it again). One page per pane, each page in one pane
// (kind `single`); params in memory only (never stored: `splitLayout(…).work` keeps no page tab).

export const pageKind = (page: string): string => `${PAGE_KIND_PREFIX}${page}`;
export const isPageKind = (kind: string): boolean => kind.startsWith(PAGE_KIND_PREFIX);

/** The page a pane shows over its conversation (its active tab is a page), or null. */
export function panePage(layout: PaneLayout, paneId: string): { page: string; params: Record<string, unknown> } | null {
  const shown = activeInstance(layout, paneId);
  return shown && isPageKind(shown.instance.kind) ? { page: shown.instance.kind.slice(PAGE_KIND_PREFIX.length), params: shown.instance.params } : null;
}

/** Without `paneId`'s page tab (its conversation shows again); the same layout when it has none. */
export function closePaneOverlay(layout: PaneLayout, paneId: string): PaneLayout {
  const pane = layout.panes[paneId];
  const tab = pane?.tabs.find((id) => isPageKind(layout.instances[id]?.kind ?? ""));
  if (!pane || !tab) return layout;
  const tabs = pane.tabs.filter((id) => id !== tab);
  const instances = { ...layout.instances };
  delete instances[tab];
  return { ...layout, panes: { ...layout.panes, [paneId]: { ...pane, tabs, active: pane.active === tab ? (conversationTab(layout, paneId) ?? tabs[0]!) : pane.active } }, instances };
}

/** `page` (with `params`) shown in conversation pane `paneId`, over its conversation; another pane showing it drops it. */
export function showPageIn(layout: PaneLayout, paneId: string, page: string, params: Record<string, unknown>): PaneLayout {
  if (!conversationTab(layout, paneId)) return layout;
  const kind = pageKind(page);
  const now = panePage(layout, paneId);
  if (now?.page === page && JSON.stringify(now.params) === JSON.stringify(params)) return layout;
  let next = layout;
  for (const id of conversationPanes(layout)) {
    if (id === paneId) continue;
    if (layout.panes[id]!.tabs.some((t) => layout.instances[t]?.kind === kind)) next = closePaneOverlay(next, id);
  }
  next = closePaneOverlay(next, paneId);
  const tab = `${paneId}:page`;
  const pane = next.panes[paneId]!;
  return { ...next, panes: { ...next.panes, [paneId]: { ...pane, tabs: [...pane.tabs, tab], active: tab } }, instances: { ...next.instances, [tab]: { kind, binding: { kind: "none" }, params, state: null } } };
}

// ---------- the stored layout: work area + tool area (step 3) ----------

/** The tool area as stored (lib/paneFile): its Shelves, panes, instances and state. */
export interface ToolPart {
  shelves: PaneShelf[];
  panes: Record<string, Pane>;
  instances: Record<string, PaneInstance>;
  tools: PaneTools;
  /** Collapsed tool panes (step 4; their panes are in `panes` with a home). */
  chips?: string[];
}

const isToolChip = (id: string) => id.startsWith(TOOL_ID_PREFIX);

/**
 * A stored layout's two areas: the work area as lib/paneStore keeps it (conversation panes only, page
 * tabs dropped) and the tool area (null: none stored).
 */
export function splitLayout(layout: PaneLayout): { work: PaneLayout; tools: ToolPart | null } {
  const workCols = layout.cols.filter((c) => !isToolColumn(c));
  const pick = (ids: string[]) => {
    const panes: Record<string, Pane> = {};
    const instances: Record<string, PaneInstance> = {};
    for (const id of ids) {
      const pane = layout.panes[id];
      if (!pane) continue;
      panes[id] = pane;
      for (const t of pane.tabs) instances[t] = layout.instances[t]!;
    }
    return { panes, instances };
  };
  const rowsOf = (cols: PaneColumn[]) => cols.flatMap((c) => c.rows.map((r) => r.pane));
  // Chips (step 4): the tool area's carry its id prefix, the rest are conversation panes.
  const workChips = layout.chips.filter((id) => !isToolChip(id));
  const toolChips = layout.chips.filter(isToolChip);
  const w = pick([...rowsOf(workCols), ...workChips]);
  let work: PaneLayout = { v: layout.v, dock: layout.dock, cols: workCols, panes: w.panes, instances: w.instances, chips: workChips, focus: layout.focus && w.panes[layout.focus] && !layout.chips.includes(layout.focus) ? layout.focus : null, max: layout.max && w.panes[layout.max] ? layout.max : null };
  for (const id of Object.keys(work.panes)) work = closePaneOverlay(work, id);
  const shelves = layout.shelves ?? [];
  const t = pick([...shelves.flatMap((x) => x.pages.flatMap((p) => p.rows.map((r) => r.pane))), ...toolChips]);
  const tools = shelves.length || toolChips.length || layout.tools ? { shelves, panes: t.panes, instances: t.instances, tools: layout.tools ?? { open: false, focus: null, overrides: {}, seq: 0 }, chips: toolChips } : null;
  return { work, tools };
}

/** The layout to store: the work area (page tabs dropped) and the Shelves. */
export function joinLayout(work: PaneLayout, tools: ToolPart | null): PaneLayout {
  let w: PaneLayout = { ...work, v: PANE_LAYOUT_VERSION, cols: work.cols.filter((c) => !isToolColumn(c)), chips: work.chips.filter((id) => !isToolChip(id)), max: null };
  delete w.tools;
  delete w.shelves;
  for (const id of Object.keys(w.panes)) w = closePaneOverlay(w, id);
  if (!tools) return w;
  return { ...w, shelves: tools.shelves, panes: { ...w.panes, ...tools.panes }, instances: { ...w.instances, ...tools.instances }, chips: [...w.chips, ...(tools.chips ?? [])], tools: tools.tools };
}

const toolId = (id: string) => `${TOOL_ID_PREFIX}${id}`;
const engineId = (id: string) => (id.startsWith(TOOL_ID_PREFIX) ? id.slice(TOOL_ID_PREFIX.length) : id);

/**
 * The side engine's layout (lib/sideLayout: Shelves → pages → cards = panes → instances = tabs) as the
 * stored tool area. Launcher pages (no pane yet, not kept) are not stored. Lossless for what the engine
 * stores (`toolRawOf` reads it back; lib/sideLayout `sanitizeLayout` validates it).
 */
export function toolPartOf(side: SideLayout): ToolPart {
  const pages = side.pages.filter((p) => p.cards.length > 0 || p.kept);
  const panes: Record<string, Pane> = {};
  const instances: Record<string, PaneInstance> = {};
  const putInstance = (t: string) => {
    const inst = side.instances[t]!;
    instances[toolId(t)] = { kind: inst.kind, binding: inst.binding, params: {}, state: inst.state, key: inst.key, v: inst.v, pinned: inst.pinned, at: inst.lastActiveAt };
  };
  const stored = (page: SideLayout["pages"][number]): PaneShelfPage => {
    for (const card of page.cards) {
      const at = Math.max(0, ...card.tabs.map((t) => side.instances[t]?.lastActiveAt ?? 0));
      panes[toolId(card.id)] = { tabs: card.tabs.map(toolId), active: toolId(card.active ?? card.tabs[0]!), at, kind: card.kind, collapsed: card.collapsed };
      for (const t of card.tabs) putInstance(t);
    }
    return {
      id: page.id,
      groups: [...page.groups],
      ...(page.name ? { name: page.name } : {}),
      ...(page.icon ? { icon: page.icon } : {}),
      ...(page.kept ? { kept: true } : {}),
      ...(page.shared ? { shared: true } : {}),
      rows: page.cards.map((c) => ({ pane: toolId(c.id), h: c.size })),
    };
  };
  const shelves: PaneShelf[] = [];
  for (const shelf of side.shelves ?? []) {
    const own = pages.filter((p) => p.shelf === shelf.id);
    if (!own.length) continue;
    shelves.push({
      id: shelf.id,
      side: shelf.side,
      ...(shelf.width !== undefined ? { width: shelf.width } : {}),
      active: own.some((p) => p.id === shelf.active) ? shelf.active : own[0]!.id,
      options: { ...shelf.options },
      ...(shelf.collapsed ? { collapsed: true } : {}),
      pages: own.map(stored),
    });
  }
  // Pages of no known Shelf (a layout the engine did not make consistent): the right Shelf's.
  const orphans = pages.filter((p) => !shelves.some((x) => x.pages.some((q) => q.id === p.id)));
  if (orphans.length) {
    const right = shelves.find((x) => x.side === "right");
    if (right) right.pages.push(...orphans.map(stored));
    else if (shelves.length < MAX_TOOL_COLUMNS) shelves.push({ id: `s${side.seq + 1}`, side: "right", active: orphans[0]!.id, options: { allowMixing: false, railPlacement: "outer" }, pages: orphans.map(stored) });
  }
  const chips: string[] = [];
  for (const chip of side.chips ?? []) {
    const card = chip.card;
    if (!card.tabs.length) continue;
    const at = Math.max(0, ...card.tabs.map((t) => side.instances[t]?.lastActiveAt ?? 0));
    const column = { id: chip.page.id, groups: [...chip.page.groups], ...(chip.page.name ? { name: chip.page.name } : {}), index: chip.page.index, ...(chip.page.shelf ? { shelf: chip.page.shelf } : {}), ...(chip.page.side ? { side: chip.page.side } : {}) };
    const home: PaneHome = { at: chip.at, column, above: chip.above ? toolId(chip.above) : null, below: chip.below ? toolId(chip.below) : null };
    panes[toolId(card.id)] = { tabs: card.tabs.map(toolId), active: toolId(card.active ?? card.tabs[0]!), at, kind: card.kind, home };
    chips.push(toolId(card.id));
    for (const t of card.tabs) putInstance(t);
  }
  const all = shelves.flatMap((x) => x.pages);
  const focus = side.activePage && all.some((p) => p.id === side.activePage) ? side.activePage : (shelves.find((x) => x.side === "right")?.active ?? shelves[0]?.active ?? null);
  return { shelves, panes, instances, tools: { open: side.open && all.length > 0, focus, overrides: { ...side.overrides }, seq: side.seq, ...(side.singleShelf !== undefined ? { singleShelf: side.singleShelf } : {}) }, chips };
}

/** The stored tool area back as the side engine's raw layout (untrusted: pass it through `sanitizeLayout`). */
export function toolRawOf(part: ToolPart): unknown {
  const instances: Record<string, unknown> = {};
  for (const [id, inst] of Object.entries(part.instances)) {
    instances[engineId(id)] = { kind: inst.kind, binding: inst.binding, key: inst.key ?? null, state: inst.state ?? null, v: inst.v ?? 1, pinned: inst.pinned === true, lastActiveAt: inst.at ?? 0 };
  }
  const pages = part.shelves.flatMap((shelf) =>
    shelf.pages.map((c) => ({
      id: c.id,
      groups: c.groups ?? [],
      shelf: shelf.id,
      ...(c.name ? { name: c.name } : {}),
      ...(c.icon ? { icon: c.icon } : {}),
      ...(c.kept ? { kept: true } : {}),
      ...(c.shared === true ? { shared: true } : {}),
      cards: c.rows.map((r) => {
        const pane = part.panes[r.pane];
        return pane ? { id: engineId(r.pane), kind: pane.kind ?? part.instances[pane.active]?.kind, tabs: pane.tabs.map(engineId), active: engineId(pane.active), size: r.h, collapsed: pane.collapsed === true } : null;
      }),
    })),
  );
  const shelves = part.shelves.map((x) => ({ id: x.id, side: x.side, active: x.active, options: x.options, ...(x.width !== undefined ? { width: x.width } : {}), ...(x.collapsed === true || x.chip !== undefined ? { collapsed: true } : {}) }));
  const chips = (part.chips ?? []).flatMap((id) => {
    const pane = part.panes[id];
    const home = pane?.home;
    if (!pane || !home?.column) return [];
    return [
      {
        card: { id: engineId(id), kind: pane.kind ?? part.instances[pane.active]?.kind, tabs: pane.tabs.map(engineId), active: engineId(pane.active), size: 1, collapsed: false },
        page: home.column,
        above: home.above ? engineId(home.above) : null,
        below: home.below ? engineId(home.below) : null,
        at: home.at,
      },
    ];
  });
  return { open: part.tools.open, activePage: part.tools.focus, pages, shelves, instances, overrides: part.tools.overrides, seq: part.tools.seq, chips, ...(part.tools.singleShelf !== undefined ? { singleShelf: part.tools.singleShelf } : {}) };
}

/**
 * A conversation comes back from a closed desk window (multi-window P1, lib/deskStore): a chip in the tray
 * that opens right of the work area's columns. Nothing changes when it is on screen or in the tray already.
 */
export function addConversationChip(layout: PaneLayout, agent: PaneAgent, now: number): PaneLayout {
  if (paneShowing(layout, agent.hostId, agent.sessionId) || chipShowing(layout, agent.hostId, agent.sessionId)) return layout;
  const id = freshId(layout);
  const chip = conversationOf(id, agent.hostId, agent.sessionId, now);
  const home: PaneHome = { at: now, left: null, right: null, col: workColumns(layout).length };
  return { ...layout, panes: { ...layout.panes, [id]: { ...chip.pane, home } }, instances: { ...layout.instances, [id]: chip.instance }, chips: [...layout.chips, id] };
}
