// The pane layout as stored (docs/desktop-modules.md §24.6): localStorage `cutex-desktop.panes` =
// { v: 1, layouts: { "host:<focus host>": Layout } } — per device (the owner decided 2026-10-20: local
// only), one layout per focus host for every agent. A layout holds both areas: the work area
// (lib/paneStore: the conversation panes) and the tool area (lib/sideLayoutStore: the former right side).
// Each store writes its own area and keeps the other's as stored (read-modify-write of the one key).
//
// One-time migration (§24.7): the v1.16 right side (`cutex-desktop.side`, pages → cards → tabs with a
// view per agent) becomes the tool area of the same scope — the focused agent's page in view is the
// tool column, the other pages' cards join it as panes or tabs (no instance, param or state is lost) —
// and its `conversation.agent` cards become conversation columns. The old value moves to a backup key.
// Shell code: names no feature.
import { addConversationColumn, defaultLayout, joinLayout, splitLayout, toolPartOf, validateLayout, type PaneAgent, type PaneLayout, type ToolPart } from "./paneLayout";
import { closeInstances, foldPages, sanitizeLayout, type SideLayout } from "./sideLayout";
import { SIDE_AGENT_COMPONENT } from "./sideKinds";

export const PANES_STORAGE_KEY = "cutex-desktop.panes";
/** The v1.16 right side's key (read once by `migrateLegacySide`, then removed). */
export const LEGACY_SIDE_KEY = "cutex-desktop.side";
/** Where the migration keeps the v1.16 value, as it was (never read by the app). */
export const LEGACY_SIDE_BACKUP_KEY = "cutex-desktop.side.v1-backup";

interface PanesFile {
  v: 1;
  layouts: Record<string, unknown>;
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readPanesFile(): PanesFile {
  try {
    const raw = JSON.parse(storage()?.getItem(PANES_STORAGE_KEY) ?? "null") as unknown;
    if (isRecord(raw) && raw.v === 1 && isRecord(raw.layouts)) return raw as unknown as PanesFile;
  } catch {
    // unreadable: start empty
  }
  return { v: 1, layouts: {} };
}

function writePanesFile(file: PanesFile): void {
  try {
    storage()?.setItem(PANES_STORAGE_KEY, JSON.stringify(file));
  } catch {
    // storage full / unavailable: the layout lasts for this session only
  }
}

/** A scope key's host (`host:<id>`). */
export const scopeHost = (scope: string): string => (scope.startsWith("host:") ? scope.slice("host:".length) : "local");

/** A fresh work area: one conversation pane bound to no agent (lib/paneStore binds it to the selection). */
export const freshWork = (hostId: string): PaneLayout => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId, sessionId: null });

/** A scope's stored areas (null: none stored, or not a valid layout). */
export function readScope(scope: string): { raw: unknown; work: PaneLayout | null; tools: ToolPart | null } {
  const raw = readPanesFile().layouts[scope];
  const layout = validateLayout(raw);
  if (!layout) return { raw, work: null, tools: null };
  const { work, tools } = splitLayout(layout);
  return { raw, work, tools };
}

/** Stores a scope's work area; its stored tool area stays. */
export function writeWork(scope: string, work: PaneLayout): void {
  const file = readPanesFile();
  const stored = validateLayout(file.layouts[scope]);
  file.layouts[scope] = joinLayout(work, stored ? splitLayout(stored).tools : null);
  writePanesFile(file);
}

/** Stores a scope's tool area (the side engine's layout, prepared for saving); its stored work area stays. */
export function writeTools(scope: string, side: SideLayout): void {
  const file = readPanesFile();
  const stored = validateLayout(file.layouts[scope]);
  const work = stored ? splitLayout(stored).work : freshWork(scopeHost(scope));
  file.layouts[scope] = joinLayout(work, toolPartOf(side));
  writePanesFile(file);
}

// ── Migration from the v1.16 right side (§24.7) ──────────────────────────────────────────────────

export interface MigratedSide {
  /** The tool area: one column (the focused agent's page, the other pages folded into it). */
  side: SideLayout;
  /** The agents of its `agentKind` cards, most recently used first (they become conversation columns). */
  agents: PaneAgent[];
}

/**
 * One stored v1.16 side layout → the tool area. The focused agent = the per-agent view used last
 * (`views`, D27′); its page in view is kept, its open / closed state is the tool area's. Cards of
 * `agentKind` (another agent's live conversation, now a conversation pane) leave the tool area.
 */
export function migrateSideLayout(raw: unknown, hostId: string, agentKind: string): MigratedSide {
  let keep: string | null = null;
  let open: boolean | null = null;
  if (isRecord(raw) && isRecord(raw.views)) {
    let best = -Infinity;
    for (const view of Object.values(raw.views)) {
      if (!isRecord(view) || typeof view.open !== "boolean") continue;
      const at = typeof view.at === "number" && Number.isFinite(view.at) ? view.at : 0;
      if (at <= best) continue;
      best = at;
      keep = typeof view.page === "string" ? view.page : null;
      open = view.open;
    }
  }
  let side = sanitizeLayout(raw, hostId, { legacy: true });
  const agents: (PaneAgent & { at: number })[] = [];
  const drop: string[] = [];
  for (const [id, inst] of Object.entries(side.instances)) {
    if (inst.kind !== agentKind) continue;
    drop.push(id);
    const sessionId = isRecord(inst.state) && typeof inst.state.sessionId === "string" ? inst.state.sessionId : null;
    if (sessionId && inst.binding.kind === "host") agents.push({ hostId: inst.binding.hostId, sessionId, at: inst.lastActiveAt });
  }
  if (drop.length) side = closeInstances(side, drop);
  side = foldPages(side, keep ?? side.activePage);
  side = { ...side, open: (open ?? side.open) && side.pages.length > 0 };
  agents.sort((a, b) => b.at - a.at);
  return { side, agents: agents.map(({ hostId: h, sessionId }) => ({ hostId: h, sessionId })) };
}

/**
 * Runs the migration once (both stores call it before their first read; idempotent): every scope of
 * `cutex-desktop.side` gets its tool area (unless it has one already) and its agent cards as
 * conversation columns (while there is room); the old value moves to LEGACY_SIDE_BACKUP_KEY.
 * Returns the migrated scopes (null: nothing to migrate).
 */
export function migrateLegacySide(agentKind: string): string[] | null {
  const store = storage();
  let raw: string | null = null;
  try {
    raw = store?.getItem(LEGACY_SIDE_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw === null || !store) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const file = readPanesFile();
  const scopes: string[] = [];
  const layouts = isRecord(parsed) && parsed.v === 1 && isRecord(parsed.layouts) ? parsed.layouts : {};
  for (const [scope, legacy] of Object.entries(layouts)) {
    if (!/^host:.+/.test(scope)) continue;
    const stored = validateLayout(file.layouts[scope]);
    const parts = stored ? splitLayout(stored) : { work: null, tools: null };
    if (parts.tools) continue;
    const host = scopeHost(scope);
    const migrated = migrateSideLayout(legacy, host, agentKind);
    let work = parts.work ?? freshWork(host);
    for (const agent of migrated.agents) work = addConversationColumn(work, agent, 0);
    file.layouts[scope] = joinLayout(work, toolPartOf(migrated.side));
    scopes.push(scope);
  }
  try {
    store.setItem(LEGACY_SIDE_BACKUP_KEY, raw);
    writePanesFile(file);
    store.removeItem(LEGACY_SIDE_KEY);
  } catch {
    // storage full: the old layout stays where it was (tried again next start)
  }
  return scopes;
}

/** The migration with the app's agent kind (the v1.16 side agent cards); both stores call it first. */
export function migrateSideOnce(): string[] | null {
  return migrateLegacySide(SIDE_AGENT_COMPONENT);
}
