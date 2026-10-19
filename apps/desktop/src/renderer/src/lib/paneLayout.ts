// The window as panes (docs/desktop-modules.md §24; docs/research/panes-20261019.md §1): a pure layout
// model. The left dock (the agent list), columns of panes (each column split into ≤ 3 rows), panes
// holding tabs, each tab an instance `{kind, binding, params, state}`, collapsed chips, the focused pane
// and the maximised one.
//
// Two areas of columns: the WORK area (conversation panes, step 2: up to two columns side by side; a
// conversation pane may also show a page — `page:<id>`, in memory only) and, right of it, the TOOL area
// (step 3: the former right side — its pages are tool columns `area: "tools"`, its cards panes, its tabs
// tabs; kept by lib/sideLayout + lib/sideLayoutStore, stored here through `toolPartOf` / `toolRawOf`).
// Widths are shares within an area (the tool area's width is appearance.sidePaneWidth). lib/paneStore
// keeps the work area (in step with the selection); lib/paneFile stores both per device. Like the rest
// of the shell, this file names no feature: pane kinds are opaque ids.
import type { SideLayout } from "./sideLayout";

/** Layout JSON version (the persisted shape, §4 持久化; lib/paneStore). */
export const PANE_LAYOUT_VERSION = 1;
/** At most this many panes on screen (§1 限额, owner-approved). */
export const MAX_VISIBLE_PANES = 6;
/** At most this many panes stacked in one column. */
export const MAX_ROWS = 3;
/** At most this many collapsed chips in the tray (more: the oldest closes). */
export const MAX_CHIPS = 8;
/** A pane kind's minimum size when it names none (`PaneKindItem.minSize`). */
export const DEFAULT_MIN_SIZE: Readonly<{ w: number; h: number }> = { w: 280, h: 120 };
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
}

/** The tool area's own state (step 3): shown, the focused tool column, the owner's per-kind overrides, the id counter. */
export interface PaneTools {
  open: boolean;
  focus: string | null;
  overrides: Record<string, { page: string; groups: string[]; at: number }>;
  seq: number;
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
  /** The tool area's state (stored layouts with tool columns). */
  tools?: PaneTools;
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
  return isRecord(x) && typeof x.open === "boolean" && (x.focus === null || isId(x.focus)) && isRecord(x.overrides) && typeof x.seq === "number" && Number.isFinite(x.seq);
}

function validDock(x: unknown): x is PaneDock {
  return isRecord(x) && isId(x.kind) && (x.mode === "open" || x.mode === "rail") && typeof x.width === "number" && Number.isFinite(x.width) && x.width > 0;
}

/**
 * The layout if `raw` is a well-formed one within the limits, else null: the version; ≥ 1 work column;
 * the widths of each area's columns sum to 1 (≤ MAX_TOOL_COLUMNS tool columns, each with its id); 1–3
 * rows per column whose heights sum to 1; ≤ 6 panes on screen; every pane named once (on screen or as a
 * chip) and existing; every pane's tabs existing instances (each in one pane) with its active one among
 * them; focus / max a pane on screen or null; ≤ 8 chips; the tool state well-formed when present.
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
  const toolWidths: number[] = [];
  for (const col of raw.cols as unknown[]) {
    if (!isRecord(col) || !isShare(col.w) || !Array.isArray(col.rows)) return null;
    const tool = col.area === "tools";
    if (col.area !== undefined && !tool) return null;
    if (tool && (!isId(col.id) || (col.groups !== undefined && !(Array.isArray(col.groups) && col.groups.every((g) => typeof g === "string"))))) return null;
    if (col.rows.length === 0 || col.rows.length > MAX_ROWS) return null;
    const heights: number[] = [];
    for (const row of col.rows as unknown[]) {
      if (!isRecord(row) || !isId(row.pane) || !isShare(row.h) || !(row.pane in panes) || seen.has(row.pane)) return null;
      seen.add(row.pane);
      heights.push(row.h);
    }
    if (!sumsToOne(heights)) return null;
    (tool ? toolWidths : widths).push(col.w);
  }
  if (!widths.length || !sumsToOne(widths) || seen.size > MAX_VISIBLE_PANES) return null;
  if (toolWidths.length > MAX_TOOL_COLUMNS || (toolWidths.length && !sumsToOne(toolWidths))) return null;
  const visible = new Set(seen);
  if (raw.chips.length > MAX_CHIPS) return null;
  for (const chip of raw.chips as unknown[]) {
    if (!isId(chip) || !(chip in panes) || seen.has(chip)) return null;
    seen.add(chip);
  }
  // Every pane is placed (on screen or a chip): an unplaced one could never be reached.
  if (Object.keys(panes).some((id) => !seen.has(id))) return null;
  const owned = new Set<string>();
  for (const pane of Object.values(panes)) {
    if (!isRecord(pane) || !Array.isArray(pane.tabs) || pane.tabs.length === 0 || !isId(pane.active) || typeof pane.at !== "number" || !Number.isFinite(pane.at)) return null;
    for (const tab of pane.tabs as unknown[]) {
      if (!isId(tab) || owned.has(tab) || !validInstance(instances[tab])) return null;
      owned.add(tab);
    }
    if (!(pane.tabs as string[]).includes(pane.active)) return null;
  }
  // Every instance is a tab of some pane.
  if (Object.keys(instances).some((id) => !owned.has(id))) return null;
  for (const at of [raw.focus, raw.max]) if (at !== null && !(isId(at) && visible.has(at))) return null;
  return raw as unknown as PaneLayout;
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
 * Plain open (a click on an agent): already shown → that pane gets the focus; otherwise the focused
 * conversation pane shows it instead (replace).
 */
export function showAgent(layout: PaneLayout, agent: PaneAgent, now: number): PaneLayout {
  const at = paneShowing(layout, agent.hostId, agent.sessionId);
  if (at) return focusPane(layout, at, now);
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
 * focused. Already shown → focused there. The focused pane shows no agent → it shows this one. Room
 * for another column (< MAX_CONVERSATION_COLUMNS) → a new column right of the focused pane's, which
 * gives it half its width. Otherwise the other conversation pane shows it (replace beside).
 */
export function openBeside(layout: PaneLayout, agent: PaneAgent, now: number, opts: { focus?: boolean } = {}): PaneLayout {
  const focusIt = opts.focus !== false;
  const at = paneShowing(layout, agent.hostId, agent.sessionId);
  if (at) return focusIt ? focusPane(layout, at, now) : layout;
  const focused = focusedConversation(layout);
  if (!focused) return layout;
  if (!paneBinding(layout, focused)?.sessionId) return showAgent(layout, agent, now);
  const panes = conversationPanes(layout);
  if (panes.length >= MAX_CONVERSATION_COLUMNS) {
    const other = panes.find((id) => id !== focused)!;
    const bound = bindPane(layout, other, agent.hostId, agent.sessionId);
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
 * Another conversation column right of the others, showing `agent`, without moving the focus (the
 * migration of v1.16 side agent cards, §24.7). Already shown, or no room (MAX_CONVERSATION_COLUMNS) →
 * unchanged. The new column takes a half of the right-most one.
 */
export function addConversationColumn(layout: PaneLayout, agent: PaneAgent, now: number): PaneLayout {
  if (paneShowing(layout, agent.hostId, agent.sessionId) || conversationPanes(layout).length >= MAX_CONVERSATION_COLUMNS || !canShowPane(layout)) return layout;
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
 * close; the last one shows no agent instead.
 */
export function dropGoneAgents(layout: PaneLayout, gone: (hostId: string, sessionId: string) => boolean): PaneLayout {
  let next = layout;
  for (const id of conversationPanes(layout)) {
    const b = paneBinding(next, id);
    if (!b?.sessionId || !gone(b.hostId, b.sessionId)) continue;
    const closed = closePane(next, id);
    next = closed !== next ? closed : bindPane(next, id, b.hostId, null);
  }
  return next;
}

/**
 * A stored layout as step 2 shows it, or null (then the default layout): well-formed (`validateLayout`),
 * conversation panes only, ≤ MAX_CONVERSATION_COLUMNS columns of one pane each, no chips, not maximised
 * (§4: 最大化不恢复). The focus is a pane on screen.
 */
export function restoreLayout(raw: unknown): PaneLayout | null {
  const stored = validateLayout(raw);
  if (!stored) return null;
  const layout = splitLayout(stored).work;
  if (layout.cols.length > MAX_CONVERSATION_COLUMNS || layout.cols.some((c) => c.rows.length !== 1)) return null;
  if (layout.chips.length) return null;
  for (const id of visiblePanes(layout)) {
    const pane = layout.panes[id]!;
    if (pane.tabs.length !== 1 || !paneBinding(layout, id)) return null;
  }
  return { ...layout, max: null, focus: focusedConversation(layout) };
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

/** The tool area as stored (lib/paneFile): its columns, panes, instances and state. */
export interface ToolPart {
  cols: PaneColumn[];
  panes: Record<string, Pane>;
  instances: Record<string, PaneInstance>;
  tools: PaneTools;
}

/**
 * A stored layout's two areas: the work area as lib/paneStore keeps it (conversation panes only, page
 * tabs dropped) and the tool area (null: none stored).
 */
export function splitLayout(layout: PaneLayout): { work: PaneLayout; tools: ToolPart | null } {
  const workCols = layout.cols.filter((c) => !isToolColumn(c));
  const toolCols = layout.cols.filter(isToolColumn);
  const pick = (ids: string[]) => {
    const panes: Record<string, Pane> = {};
    const instances: Record<string, PaneInstance> = {};
    for (const id of ids) {
      const pane = layout.panes[id]!;
      panes[id] = pane;
      for (const t of pane.tabs) instances[t] = layout.instances[t]!;
    }
    return { panes, instances };
  };
  const rowsOf = (cols: PaneColumn[]) => cols.flatMap((c) => c.rows.map((r) => r.pane));
  // Chips (step 4) belong to the work area until they record where they came from.
  const w = pick([...rowsOf(workCols), ...layout.chips]);
  let work: PaneLayout = { v: layout.v, dock: layout.dock, cols: workCols, panes: w.panes, instances: w.instances, chips: [...layout.chips], focus: layout.focus && w.panes[layout.focus] && !layout.chips.includes(layout.focus) ? layout.focus : null, max: layout.max && w.panes[layout.max] ? layout.max : null };
  for (const id of Object.keys(work.panes)) work = closePaneOverlay(work, id);
  const t = pick(rowsOf(toolCols));
  const tools = toolCols.length || layout.tools ? { cols: toolCols, panes: t.panes, instances: t.instances, tools: layout.tools ?? { open: false, focus: null, overrides: {}, seq: 0 } } : null;
  return { work, tools };
}

/** The layout to store: the work area (page tabs dropped) and the tool area right of it. */
export function joinLayout(work: PaneLayout, tools: ToolPart | null): PaneLayout {
  let w: PaneLayout = { ...work, cols: work.cols.filter((c) => !isToolColumn(c)), max: null };
  delete w.tools;
  for (const id of Object.keys(w.panes)) w = closePaneOverlay(w, id);
  if (!tools) return w;
  return { ...w, cols: [...w.cols, ...tools.cols], panes: { ...w.panes, ...tools.panes }, instances: { ...w.instances, ...tools.instances }, tools: tools.tools };
}

const toolId = (id: string) => `${TOOL_ID_PREFIX}${id}`;
const engineId = (id: string) => (id.startsWith(TOOL_ID_PREFIX) ? id.slice(TOOL_ID_PREFIX.length) : id);

/**
 * The side engine's layout (lib/sideLayout: pages = tool columns, cards = panes, instances = tabs) as the
 * stored tool area. Launcher columns (no pane yet) are not stored. Lossless for what the engine stores
 * (`toolRawOf` reads it back; lib/sideLayout `sanitizeLayout` validates it).
 */
export function toolPartOf(side: SideLayout): ToolPart {
  const pages = side.pages.filter((p) => p.cards.length > 0);
  const cols: PaneColumn[] = [];
  const panes: Record<string, Pane> = {};
  const instances: Record<string, PaneInstance> = {};
  for (const page of pages) {
    cols.push({ w: 1 / pages.length, area: "tools", id: page.id, groups: [...page.groups], ...(page.name ? { name: page.name } : {}), rows: page.cards.map((c) => ({ pane: toolId(c.id), h: c.size })) });
    for (const card of page.cards) {
      const at = Math.max(0, ...card.tabs.map((t) => side.instances[t]?.lastActiveAt ?? 0));
      panes[toolId(card.id)] = { tabs: card.tabs.map(toolId), active: toolId(card.active ?? card.tabs[0]!), at, kind: card.kind, collapsed: card.collapsed };
      for (const t of card.tabs) {
        const inst = side.instances[t]!;
        instances[toolId(t)] = { kind: inst.kind, binding: inst.binding, params: {}, state: inst.state, key: inst.key, v: inst.v, pinned: inst.pinned, at: inst.lastActiveAt };
      }
    }
  }
  const focus = side.activePage && pages.some((p) => p.id === side.activePage) ? side.activePage : (pages[0]?.id ?? null);
  return { cols, panes, instances, tools: { open: side.open && pages.length > 0, focus, overrides: { ...side.overrides }, seq: side.seq } };
}

/** The stored tool area back as the side engine's raw layout (untrusted: pass it through `sanitizeLayout`). */
export function toolRawOf(part: ToolPart): unknown {
  const instances: Record<string, unknown> = {};
  for (const [id, inst] of Object.entries(part.instances)) {
    instances[engineId(id)] = { kind: inst.kind, binding: inst.binding, key: inst.key ?? null, state: inst.state ?? null, v: inst.v ?? 1, pinned: inst.pinned === true, lastActiveAt: inst.at ?? 0 };
  }
  const pages = part.cols.map((c) => ({
    id: c.id,
    groups: c.groups ?? [],
    ...(c.name ? { name: c.name } : {}),
    cards: c.rows.map((r) => {
      const pane = part.panes[r.pane];
      return pane ? { id: engineId(r.pane), kind: pane.kind ?? part.instances[pane.active]?.kind, tabs: pane.tabs.map(engineId), active: engineId(pane.active), size: r.h, collapsed: pane.collapsed === true } : null;
    }),
  }));
  return { open: part.tools.open, activePage: part.tools.focus, pages, instances, overrides: part.tools.overrides, seq: part.tools.seq };
}
