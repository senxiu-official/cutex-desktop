// The pane layout as stored (docs/desktop-modules.md §24.6): the file { v: 1, layouts: { "host:<focus host>": Layout } }
// in IndexedDB, one record per piece (lib/paneDb, E-G10; without IndexedDB: localStorage `cutex-desktop.panes`) — per device (the owner decided 2026-10-20: local
// only), one layout per focus host for every agent. A layout holds both areas: the work area
// (lib/paneStore: the conversation panes) and the tool area (lib/sideLayoutStore: the former right side).
// Each store writes its own area and keeps the other's as stored (read-modify-write of the file; only the records
// that changed are written).
//
// One-time migrations (`migrateSideOnce`, both stores run it before their first read; idempotent):
// 1. §24.7 / §24.12: the v1.16 right side (`cutex-desktop.side`, pages → cards → tabs with a view per agent)
//    becomes the tool area of the same scope — its pages are the right Shelf's pages again (since Shelves;
//    step 3 folded them into one column), the focused agent's page in view — and its `conversation.agent`
//    cards become conversation columns. The old value moves to a backup key.
// 2. §24.12 (file v1 → v2): every stored v1 layout's tool columns become the right Shelf's pages
//    (`migrateLayoutV1`), and the step-3 backup's former pages come back as pages of that Shelf
//    (`restoreLegacyPages`: the instances still there move back into their old pages; nothing is lost).
// 3. owner 2026-10-20 (file v2 → v3): every Shelf starts with 允许混排 off, the migrated ones too. Step 2 used
//    to turn it on for the right Shelf it made, and a v2 file cannot tell that from the owner's own switch
//    (the option was hours old), so every stored Shelf's 允许混排 goes off once (`migrateMixingOff`); panes that
//    mix kinds already stay as they are. From v3 on the migrations write it off, so an on is the owner's.
//    The same step records the 只用一个 Shelf default: on for a new install (nothing stored at all), off for
//    everyone else (`singleShelfDefault`; a scope's own stored choice wins).
// 4. owner 2026-10-21 (file v3 → v4): a collapsed Shelf is its Shelf Rail in place, no longer a chip in the
//    tray — every stored Shelf with `chip` (in the tray since) becomes `collapsed: true` (`migrateShelfRails`).
// 5. owner 2026-10-21 (file v4 → v5, §24.13 workspaces): a Shelf per conversation. Each scope's stored tool area
//    (the one global Shelf until now) becomes the default layout new conversations copy (`template`) AND the
//    own Shelf of the conversation that was focused; nothing is dropped (the old tool area also stays in
//    `layouts`, unread from now on). Conversation chips leave the tray (「—」 closes a conversation pane now; its
//    agent keeps running in cutex): they are dropped from the work area (`migrateConvShelves`).
// 6. #7 (owner 2026-10-21, no file version: it runs on every load and only rewrites what still has chips): tool
//    panes are no longer chips in the tray. Each stored tool chip (the default layout, the shared pages, every
//    conversation's own Shelf) goes back into its Shelf (`resolveChips`); one that cannot is closed, and the
//    side store says once how many (`takeClosedToolChips`) (`migrateToolChips`).
// Shell code: names no feature.
import { addConversationColumn, closeChip, defaultLayout, focusedConversation, joinLayout, migrateLayoutV1, paneBinding, splitLayout, toolPartOf, toolRawOf, validateLayout, type PaneAgent, type PaneLayout, type ToolPart } from "./paneLayout";
import { convKey, MAX_CONV_SHELVES, type ShelfMeta } from "./convShelves";
import { closeInstances, emptyLayout, resolveChips, restoreLegacyPages, sanitizeLayout, withShelves, type SideLayout } from "./sideLayout";
import { SIDE_AGENT_COMPONENT } from "./sideKinds";
import { paneDb, parsePanesFile, PANES_STORAGE_KEY, type ConvShelfEntry, type ConvShelfScope, type PanesFile } from "./paneDb";
import { reportStorageFull } from "./storageFull";

export { PANES_STORAGE_KEY, type ConvShelfEntry, type ConvShelfScope };
/** The v1.16 right side's key (read once by `migrateLegacySide`, then removed). */
export const LEGACY_SIDE_KEY = "cutex-desktop.side";
/** Where the migration keeps the v1.16 value, as it was (never read by the app). */
export const LEGACY_SIDE_BACKUP_KEY = "cutex-desktop.side.v1-backup";

/** The file version the migrations end at. */
export const PANES_FILE_VERSION = 5;

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The stored file, to change and write back: its containers are the caller's; the records in them are shared, never changed in place. */
export function readPanesFile(): PanesFile {
  if (paneDb.active) {
    const file = paneDb.read();
    return { ...file, layouts: { ...file.layouts }, ...(file.convShelves ? { convShelves: { ...file.convShelves } } : {}) };
  }
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(PANES_STORAGE_KEY) ?? null;
  } catch {
    raw = null;
  }
  return parsePanesFile(raw);
}

function writePanesFile(file: PanesFile): void {
  if (paneDb.active) return paneDb.write(file);
  try {
    storage()?.setItem(PANES_STORAGE_KEY, JSON.stringify(file));
  } catch {
    // storage full / unavailable: the layout lasts for this session only — and the owner is told (once).
    reportStorageFull();
  }
}

/** A scope key's host (`host:<id>`, a desk's `host:<id>/desk:<deskId>`, multi-window P3). */
export const scopeHost = (scope: string): string => (scope.startsWith("host:") ? scope.slice("host:".length).replace(/\/desk:[^/]*$/, "") : "local");

/**
 * The scope a conversation's own Shelf and the default layout are stored in: a desk's scope stores them with its
 * host's (a conversation's Shelf follows it into and out of a desk window; one copy per agent, so one writer), while
 * its shared pages stay the desk's own.
 */
export const convScopeOf = (scope: string): string => scope.replace(/\/desk:[^/]*$/, "");

/** A fresh work area: one conversation pane bound to no agent (lib/paneStore binds it to the selection). */
export const freshWork = (hostId: string): PaneLayout => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId, sessionId: null });

/** A scope's stored areas (null: none stored, or not a valid layout). */
export function readScope(scope: string): { raw: unknown; work: PaneLayout | null; tools: ToolPart | null } {
  const raw = readPanesFile().layouts[scope];
  const layout = validateLayout(migrateLayoutV1(raw));
  if (!layout) return { raw, work: null, tools: null };
  const { work, tools } = splitLayout(layout);
  return { raw, work, tools };
}

/** Stores a scope's work area; its stored tool area stays. */
export function writeWork(scope: string, work: PaneLayout): void {
  const file = readPanesFile();
  const stored = validateLayout(migrateLayoutV1(file.layouts[scope]));
  file.layouts[scope] = joinLayout(work, stored ? splitLayout(stored).tools : null);
  writePanesFile(file);
}

/** Stores a scope's tool area (the side engine's layout, prepared for saving); its stored work area stays. */
export function writeTools(scope: string, side: SideLayout): void {
  const file = readPanesFile();
  const stored = validateLayout(migrateLayoutV1(file.layouts[scope]));
  const work = stored ? splitLayout(stored).work : freshWork(scopeHost(scope));
  file.layouts[scope] = joinLayout(work, toolPartOf(side));
  writePanesFile(file);
}

// ── Migration from the v1.16 right side (§24.7) ──────────────────────────────────────────────────

export interface MigratedSide {
  /** The tool area: the right Shelf with the old pages (the focused agent's page in view; mixing off). */
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
  // The old pages become the right Shelf's (mixing off like every Shelf; panes that mix kinds stay as they are).
  side = withShelves(drop.length ? closeInstances(side, drop) : side);
  const shown = keep && side.pages.some((p) => p.id === keep) ? keep : side.activePage;
  side = { ...side, activePage: shown, shelves: (side.shelves ?? []).map((x) => (side.pages.some((p) => p.id === shown && p.shelf === x.id) ? { ...x, active: shown } : x)) };
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

/**
 * File v1 → v2 (§24.12), once: every v1 layout's tool columns → the right Shelf's pages; then, when the
 * step-3 backup (LEGACY_SIDE_BACKUP_KEY) exists, its former pages come back as that Shelf's pages
 * (`restoreLegacyPages`) in every scope it has, except `skip` (scopes migrated from the v1.16 side just
 * now: their pages are pages already). The backup stays where it is. Returns the scopes whose pages came
 * back (null: the file was v2 already).
 */
export function migrateShelves(agentKind: string, skip: readonly string[] = []): string[] | null {
  const store = storage();
  const file = readPanesFile();
  if (file.v !== 1 || !store) return null;
  for (const [scope, raw] of Object.entries(file.layouts)) file.layouts[scope] = migrateLayoutV1(raw);
  let backup: unknown = null;
  try {
    backup = JSON.parse(store.getItem(LEGACY_SIDE_BACKUP_KEY) ?? "null");
  } catch {
    backup = null;
  }
  const restored: string[] = [];
  const legacyLayouts = isRecord(backup) && isRecord(backup.layouts) ? backup.layouts : {};
  for (const [scope, legacyRaw] of Object.entries(legacyLayouts)) {
    if (!/^host:.+/.test(scope) || skip.includes(scope)) continue;
    const host = scopeHost(scope);
    let legacy = sanitizeLayout(legacyRaw, host, { legacy: true });
    const agentCards = Object.entries(legacy.instances).filter(([, inst]) => inst.kind === agentKind).map(([id]) => id);
    if (agentCards.length) legacy = closeInstances(legacy, agentCards);
    if (!legacy.pages.some((p) => p.cards.length)) continue;
    const stored = validateLayout(file.layouts[scope]);
    const parts = stored ? splitLayout(stored) : { work: null, tools: null };
    const current = parts.tools ? sanitizeLayout(toolRawOf(parts.tools), host) : emptyLayout();
    const next = restoreLegacyPages(current, legacy);
    if (next === current) continue;
    file.layouts[scope] = joinLayout(parts.work ?? freshWork(host), toolPartOf(next));
    restored.push(scope);
  }
  file.v = 2;
  writePanesFile(file);
  return restored;
}

/**
 * File v2 → v3 (owner 2026-10-20), once: every stored Shelf's 允许混排 off (the panes stay as they are),
 * and the 只用一个 Shelf default (`fresh`: a new install — on). False: nothing to do (v3 already / no file
 * yet to move up: run `migrateShelves` first).
 */
export function migrateMixingOff(fresh: boolean): boolean {
  const file = readPanesFile();
  if (file.v !== 2 || !storage()) return false;
  for (const [scope, raw] of Object.entries(file.layouts)) {
    if (!isRecord(raw) || !Array.isArray(raw.shelves)) continue;
    file.layouts[scope] = { ...raw, shelves: (raw.shelves as unknown[]).map((x) => (isRecord(x) && isRecord(x.options) ? { ...x, options: { ...x.options, allowMixing: false } } : x)) };
  }
  file.v = 3;
  file.singleShelf = fresh;
  writePanesFile(file);
  return true;
}

/**
 * File v3 → v4 (owner 2026-10-21), once: a Shelf collapsed into the tray (`chip`) becomes collapsed to its
 * Shelf Rail in place (`collapsed: true`); its pages, panes and instances stay. False: nothing to do (v4
 * already / an older file: run the steps before first).
 */
export function migrateShelfRails(): boolean {
  const file = readPanesFile();
  if (file.v !== 3 || !storage()) return false;
  for (const [scope, raw] of Object.entries(file.layouts)) {
    if (!isRecord(raw) || !Array.isArray(raw.shelves)) continue;
    file.layouts[scope] = {
      ...raw,
      shelves: (raw.shelves as unknown[]).map((x) => {
        if (!isRecord(x) || x.chip === undefined) return x;
        const rest = { ...x };
        delete rest.chip;
        return { ...rest, collapsed: true };
      }),
    };
  }
  file.v = 4;
  writePanesFile(file);
  return true;
}

/**
 * File v4 → v5 (owner 2026-10-21, §24.13), once: every scope's stored tool area becomes its default layout
 * (`template`) and the own Shelf of the conversation focused then (the focused conversation pane's agent);
 * conversation chips are dropped from the work area (their agents keep running; the tray holds no conversations
 * any more). False: nothing to do (v5 already / an older file: run the steps before first).
 */
export function migrateConvShelves(now = Date.now()): boolean {
  const file = readPanesFile();
  if (file.v !== 4 || !storage()) return false;
  const shelves: Record<string, ConvShelfScope> = { ...(file.convShelves ?? {}) };
  for (const [scope, raw] of Object.entries(file.layouts)) {
    const layout = validateLayout(raw);
    if (!layout) continue;
    let { work, tools } = splitLayout(layout);
    for (const id of [...work.chips]) work = closeChip(work, id);
    file.layouts[scope] = joinLayout(work, tools);
    if (shelves[scope]) continue;
    const focused = focusedConversation(work);
    const b = focused ? paneBinding(work, focused) : null;
    const conv: Record<string, ConvShelfEntry> = {};
    if (tools && b?.sessionId) conv[convKey(b.hostId, b.sessionId)] = { part: tools, meta: {}, at: now };
    shelves[scope] = { template: tools, shared: null, conv };
  }
  file.convShelves = shelves;
  file.v = 5;
  writePanesFile(file);
  return true;
}

const isPart = (x: unknown): x is ToolPart => isRecord(x) && Array.isArray(x.shelves) && isRecord(x.panes) && isRecord(x.instances) && isRecord(x.tools);

/** A stored tool area back as the engine's layout (validated; null: none or not valid). */
export function partLayout(part: unknown, hostId: string): SideLayout | null {
  if (!isPart(part)) return null;
  const valid = validateLayout(joinLayout(freshWork(hostId), part));
  const tools = valid ? splitLayout(valid).tools : null;
  return tools ? sanitizeLayout(toolRawOf(tools), hostId) : null;
}

/** A scope's stored Shelves (v5): the template, the shared pages, one conversation's own Shelf + what it showed. */
export function readConvShelf(scope: string, key: string | null): { template: SideLayout | null; shared: SideLayout | null; own: SideLayout | null; meta: ShelfMeta; known: string[] } {
  const host = scopeHost(scope);
  const entry = readPanesFile().convShelves?.[scope];
  const base = convScopeOf(scope) === scope ? entry : readPanesFile().convShelves?.[convScopeOf(scope)];
  const conv = base && isRecord(base.conv) ? base.conv : {};
  const own = key && isRecord(conv[key]) ? (conv[key] as ConvShelfEntry) : null;
  return {
    template: base ? partLayout(base.template, host) : null,
    shared: entry ? partLayout(entry.shared, host) : null,
    own: own ? partLayout(own.part, host) : null,
    meta: own && isRecord(own.meta) ? own.meta : {},
    known: Object.keys(conv),
  };
}

/**
 * Stores a conversation's own Shelf (prepared for saving, no shared page), what it showed and the shared pages
 * (`shared`: prepared too; null = leave them as stored). Beyond MAX_CONV_SHELVES the least recently used go.
 */
export function writeConvShelf(scope: string, key: string, own: SideLayout, meta: ShelfMeta, shared: SideLayout | null, now = Date.now()): void {
  const file = readPanesFile();
  const all = { ...(file.convShelves ?? {}) };
  const convScope = convScopeOf(scope);
  const entry: ConvShelfScope = all[convScope] ? { ...all[convScope]!, conv: { ...all[convScope]!.conv } } : { template: null, shared: null, conv: {} };
  entry.conv[key] = { part: toolPartOf(own), meta, at: now };
  const keys = Object.keys(entry.conv);
  if (keys.length > MAX_CONV_SHELVES) {
    for (const k of keys.sort((a, b) => (entry.conv[a]!.at ?? 0) - (entry.conv[b]!.at ?? 0)).slice(0, keys.length - MAX_CONV_SHELVES)) delete entry.conv[k];
  }
  all[convScope] = entry;
  // The shared pages are the window's own (a desk's in its desk scope).
  if (shared) {
    const own = all[scope] ?? { template: null, shared: null, conv: {} };
    all[scope] = { ...own, shared: shared.pages.length ? toolPartOf(shared) : null };
  }
  file.convShelves = all;
  writePanesFile(file);
}

/** The default layout new conversations copy (Shelf ⋯ 「设为新对话的默认布局」): `template` prepared for saving. */
export function writeShelfTemplate(windowScope: string, template: SideLayout): void {
  const scope = convScopeOf(windowScope);
  const file = readPanesFile();
  const all = { ...(file.convShelves ?? {}) };
  const entry: ConvShelfScope = all[scope] ? { ...all[scope]! } : { template: null, shared: null, conv: {} };
  entry.template = template.pages.length ? toolPartOf(template) : null;
  all[scope] = entry;
  file.convShelves = all;
  writePanesFile(file);
}

/**
 * Settings → Shelf Rail 在 Shelf 的 外侧 / 内侧 (owner 2026-10-21): every stored Shelf of every scope — the default
 * layout, the shared pages, each conversation's own — gets the placement. Returns how many changed.
 */
export function setStoredShelfRails(placement: "outer" | "inner"): number {
  const file = readPanesFile();
  if (!file.convShelves) return 0;
  let n = 0;
  const fix = (part: ToolPart | null): ToolPart | null => {
    if (!part || !Array.isArray(part.shelves)) return part;
    if (part.shelves.every((x) => x.options?.railPlacement === placement)) return part;
    n += part.shelves.filter((x) => x.options?.railPlacement !== placement).length;
    return { ...part, shelves: part.shelves.map((x) => ({ ...x, options: { ...x.options, railPlacement: placement } })) };
  };
  const all: Record<string, ConvShelfScope> = {};
  for (const [scope, entry] of Object.entries(file.convShelves)) {
    const conv: Record<string, ConvShelfEntry> = {};
    for (const [key, e] of Object.entries(entry.conv ?? {})) conv[key] = { ...e, part: fix(e.part) ?? e.part };
    all[scope] = { template: fix(entry.template), shared: fix(entry.shared), conv };
  }
  if (!n) return 0;
  file.convShelves = all;
  writePanesFile(file);
  return n;
}

/** Forgets the stored Shelves of conversations `gone` says are deleted. Returns how many went. */
export function pruneConvShelves(windowScope: string, gone: (key: string) => boolean): number {
  const scope = convScopeOf(windowScope);
  const file = readPanesFile();
  const entry = file.convShelves?.[scope];
  if (!entry) return 0;
  const drop = Object.keys(entry.conv).filter(gone);
  if (!drop.length) return 0;
  const conv = { ...entry.conv };
  for (const k of drop) delete conv[k];
  file.convShelves = { ...file.convShelves, [scope]: { ...entry, conv } };
  writePanesFile(file);
  return drop.length;
}

/** 只用一个 Shelf for a scope with no stored tool area: on for a new install, else off (§24.12). */
export function singleShelfDefault(): boolean {
  return readPanesFile().singleShelf === true;
}

/** Nothing of the panes is stored yet (no file here or in IndexedDB, no v1.16 side, no backup of it): a new install. */
function nothingStored(): boolean {
  const store = storage();
  try {
    return !!store && !paneDb.hadStored && [PANES_STORAGE_KEY, LEGACY_SIDE_KEY, LEGACY_SIDE_BACKUP_KEY].every((k) => store.getItem(k) === null);
  } catch {
    return false;
  }
}

/** Tool chips `migrateToolChips` closed since the side store last asked (it tells the owner once). */
let closedToolChips = 0;

/** How many stored tool chips the migration had to close (then 0 until it closes more). */
export function takeClosedToolChips(): number {
  const n = closedToolChips;
  closedToolChips = 0;
  return n;
}

/**
 * #7 (step 6 above): every stored tool part with chips (v5 Shelves: the default layout, the shared pages, each
 * conversation's own) gets them resolved — back into their Shelves, else closed (`resolveChips`) — and is
 * written back, so it happens once. Returns how many chips were closed (0: nothing to do / all went back).
 */
export function migrateToolChips(now = Date.now()): number {
  const file = readPanesFile();
  if (file.v !== PANES_FILE_VERSION || !file.convShelves || !storage()) return 0;
  let changed = false;
  let closed = 0;
  const fix = (part: ToolPart | null, host: string): ToolPart | null => {
    if (!part || !Array.isArray(part.chips) || !part.chips.length) return part;
    const layout = partLayout(part, host);
    changed = true;
    if (!layout) return { ...part, chips: [] };
    const out = resolveChips(layout, now);
    closed += out.closed;
    return toolPartOf(out.layout);
  };
  const all: Record<string, ConvShelfScope> = {};
  for (const [scope, entry] of Object.entries(file.convShelves)) {
    const host = scopeHost(scope);
    const conv: Record<string, ConvShelfEntry> = {};
    for (const [key, e] of Object.entries(entry.conv ?? {})) conv[key] = { ...e, part: fix(e.part, host) ?? e.part };
    all[scope] = { ...entry, template: fix(entry.template, host), shared: fix(entry.shared, host), conv };
  }
  if (!changed) return 0;
  file.convShelves = all;
  writePanesFile(file);
  closedToolChips += closed;
  return closed;
}

/** The migrations with the app's agent kind (the v1.16 side agent cards); both stores call it first. */
export function migrateSideOnce(): string[] | null {
  const fresh = readPanesFile().v === PANES_FILE_VERSION ? false : nothingStored();
  const scopes = migrateLegacySide(SIDE_AGENT_COMPONENT);
  migrateShelves(SIDE_AGENT_COMPONENT, scopes ?? []);
  migrateMixingOff(fresh);
  migrateShelfRails();
  migrateConvShelves();
  migrateToolChips();
  return scopes;
}
