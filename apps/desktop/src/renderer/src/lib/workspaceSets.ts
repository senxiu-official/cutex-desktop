// 工作区 = 组 (docs/design/039-workspace-groups.md, owner 2026-10-23): the conversation columns shown side by side
// (A+B) are ONE workspace. The tray draws it as one entry (a capsule), and it is remembered when another workspace
// replaces it on screen: a plain click on C goes to C's own workspace, A+B stays intact and comes back whole when A,
// B or the capsule is clicked. An agent belongs to at most one workspace (the last one it was put in).
//
// Like lib/trayOpen, sets are seen, not announced: a subscription compares the agents on screen before / after every
// pane-layout change (`observe`), so every path that changes a column (a click, a drop, ⌘K, the services API) is
// covered. What happens to the remembered sets follows from the two lists alone:
//   the agents on screen now = one workspace (created, or the equal one touched);
//   they leave every other set (so replacing B by C in A+B leaves B on its own, a single-agent workspace);
//   a set none of whose members is on screen any more stays as it was (the full switch: A+B kept).
// Pure parts are tested in test/workspaceSets.test.ts. Shell code: names no feature.
//
// Per window (multi-window P3.5, docs/desktop-modules.md §24.17): every app window remembers its own workspaces
// (lib/windowScope `windowStore`), stored per desk like the layout (`setsStorageKey`). One copy per agent
// (lib/windowRoute): the agents on screen in one window leave the other windows' sets. A closed desk's sets join the
// main window's (`handSetsToMain`).
import { create } from "zustand";
import { conversationPanes, paneBinding, type PaneLayout } from "./paneLayout";
import { usePanes } from "./paneStore";
import { currentWindow, inWindow, MAIN_WINDOW, windowStore, type WindowKey } from "./windowScope";

export interface AgentId {
  hostId: string;
  sessionId: string;
}

/** A remembered workspace: its agents left → right, and when it was last on screen (ms). */
export interface WsSet {
  id: string;
  members: AgentId[];
  at: number;
}

export const SETS_STORAGE_KEY = "cutex-desktop.trayWorkspaces";
/** Unpinned workspaces kept (the tray's 最近): the oldest drop. A pinned one does not count. */
export const MAX_RECENT = 6;

export const agentKey = (a: AgentId): string => `${a.hostId}\u0000${a.sessionId}`;
const same = (a: AgentId, b: AgentId): boolean => a.hostId === b.hostId && a.sessionId === b.sessionId;
const sameMembers = (a: readonly AgentId[], b: readonly AgentId[]): boolean => a.length === b.length && a.every((x) => b.some((y) => same(x, y)));

let seq = 0;
const newId = (): string => `w${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * The sets after the agents on screen became `cur` (left → right): the equal set is touched (its order follows the
 * screen); otherwise `cur` leaves every set it was in (a set left without members goes) and is one set of its own.
 * Nothing on screen: unchanged. Pure.
 */
export function observe(sets: readonly WsSet[], cur: readonly AgentId[], now: number, id: () => string = newId): WsSet[] {
  if (!cur.length) return sets as WsSet[];
  const equal = sets.find((s) => sameMembers(s.members, cur));
  if (equal) return sets.map((s) => (s === equal ? { ...s, members: [...cur], at: now } : s));
  const rest = sets
    .map((s) => (s.members.some((m) => cur.some((c) => same(c, m))) ? { ...s, members: s.members.filter((m) => !cur.some((c) => same(c, m))) } : s))
    .filter((s) => s.members.length > 0);
  return [{ id: id(), members: [...cur], at: now }, ...rest];
}

/** The set `a` belongs to (null: none). Pure. */
export const setOf = (sets: readonly WsSet[], a: AgentId): WsSet | null => sets.find((s) => s.members.some((m) => same(m, a))) ?? null;

/**
 * The unpinned sets the tray keeps: newest first, at most MAX_RECENT; the set on screen (`current`) is never the one
 * that drops. `pinned`: an agent that is pinned (a set made only of pinned agents is not a 最近 entry). Pure.
 */
export function trimSets(sets: readonly WsSet[], pinned: (a: AgentId) => boolean, current: readonly AgentId[] = [], max = MAX_RECENT): WsSet[] {
  const sorted = [...sets].sort((a, b) => b.at - a.at);
  const isPinnedOnly = (s: WsSet) => s.members.every(pinned);
  const isCurrent = (s: WsSet) => current.length > 0 && sameMembers(s.members, current);
  let n = 0;
  return sorted.filter((s) => {
    if (isPinnedOnly(s)) return true;
    if (isCurrent(s)) return true;
    return ++n <= max - (sorted.some((x) => isCurrent(x) && !isPinnedOnly(x)) ? 1 : 0);
  });
}

/** A set with `a` taken out (the set goes when it was the only member). Pure. */
export function withoutMember(sets: readonly WsSet[], a: AgentId): WsSet[] {
  return sets.map((s) => ({ ...s, members: s.members.filter((m) => !same(m, a)) })).filter((s) => s.members.length > 0);
}

/** `a` leaves its set to be a set of its own (右键「拆出」). Pure. */
export function splitOut(sets: readonly WsSet[], a: AgentId, now: number, id: () => string = newId): WsSet[] {
  const from = setOf(sets, a);
  if (!from || from.members.length < 2) return sets as WsSet[];
  return [{ id: id(), members: [{ ...a }], at: now }, ...withoutMember(sets, a)];
}

/** Stored sets as read back (malformed entries dropped, one set per agent). Pure. */
export function readSets(raw: unknown): WsSet[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { sets?: unknown }).sets) ? (raw as { sets: unknown[] }).sets : [];
  const seen = new Set<string>();
  const out: WsSet[] = [];
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const { id, members, at } = x as Record<string, unknown>;
    if (typeof id !== "string" || !id || !Array.isArray(members)) continue;
    const ok: AgentId[] = [];
    for (const m of members) {
      if (!m || typeof m !== "object") continue;
      const { hostId, sessionId } = m as Record<string, unknown>;
      if (typeof hostId !== "string" || typeof sessionId !== "string" || !hostId || !sessionId) continue;
      const k = agentKey({ hostId, sessionId });
      if (seen.has(k)) continue;
      seen.add(k);
      ok.push({ hostId, sessionId });
    }
    if (ok.length) out.push({ id, members: ok, at: typeof at === "number" ? at : 0 });
  }
  return out;
}

/** Sets seeded from the tray's old 「打开着」 list (lib/trayOpen): each agent its own, newest first. Pure. */
export function setsFromOpen(open: readonly (AgentId & { at: number })[], id: () => string = newId): WsSet[] {
  return open.map((o) => ({ id: id(), members: [{ hostId: o.hostId, sessionId: o.sessionId }], at: o.at }));
}

// ── The store ───────────────────────────────────────────────────────────────────────────────────

interface SetsState {
  sets: WsSet[];
  /** Pinned agents (the home pins; the tray keeps them up to date) — they do not count towards MAX_RECENT. */
  pinned: ReadonlySet<string>;
}

/** The agents the panes of `layout` show, left → right. */
export function screenAgents(layout: PaneLayout): AgentId[] {
  return conversationPanes(layout).flatMap((id) => {
    const b = paneBinding(layout, id);
    return b?.sessionId ? [{ hostId: b.hostId, sessionId: b.sessionId }] : [];
  });
}

/** Where a window's sets are stored: the main window's under SETS_STORAGE_KEY (as before), a desk's beside it. */
export const setsStorageKey = (key: WindowKey): string => (key === MAIN_WINDOW ? SETS_STORAGE_KEY : `${SETS_STORAGE_KEY}.desk:${key}`);

function readStored(key: WindowKey): WsSet[] {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(setsStorageKey(key));
    if (raw) return readSets(JSON.parse(raw));
    // A desk starts with none (the seeding below is the main window's first run).
    if (key !== MAIN_WINDOW) return [];
    // First run: the tray's open list (lib/trayOpen) becomes single-agent workspaces.
    const old = typeof localStorage === "undefined" ? null : localStorage.getItem("cutex-desktop.trayOpen");
    const open = old ? ((JSON.parse(old) as { open?: unknown }).open ?? []) : [];
    return Array.isArray(open) ? setsFromOpen(open.filter((o): o is AgentId & { at: number } => !!o && typeof o.hostId === "string" && typeof o.sessionId === "string").map((o) => ({ ...o, at: typeof o.at === "number" ? o.at : 0 }))) : [];
  } catch {
    return [];
  }
}

export const useWorkspaceSets = windowStore((key) => create<SetsState>(() => ({ sets: readStored(key), pinned: new Set() })));

function write(sets: WsSet[], key: WindowKey = currentWindow()): void {
  try {
    localStorage.setItem(setsStorageKey(key), JSON.stringify({ v: 1, sets }));
  } catch {
    // not kept across a restart: harmless
  }
}

function setSets(sets: WsSet[]): void {
  const cur = useWorkspaceSets.getState().sets;
  if (sets === cur || JSON.stringify(sets) === JSON.stringify(cur)) return;
  useWorkspaceSets.setState({ sets });
  write(sets);
}

/** These agents are on screen in window `here`: they leave the other windows' sets (one copy per agent). */
function leaveOtherWindows(here: WindowKey, agents: readonly AgentId[]): void {
  if (!agents.length) return;
  for (const key of useWorkspaceSets.windows()) {
    if (key === here) continue;
    inWindow(key, () => {
      const sets = useWorkspaceSets.getState().sets;
      let next = sets;
      for (const a of agents) next = withoutMember(next, a);
      if (JSON.stringify(next) !== JSON.stringify(sets)) setSets(next);
    });
  }
}

/** Two windows' sets as one: an agent in one set only (the newer set keeps it), newest first. Pure. */
export function mergeSets(into: readonly WsSet[], from: readonly WsSet[]): WsSet[] {
  const seen = new Set<string>();
  const out: WsSet[] = [];
  for (const s of [...into, ...from].sort((a, b) => b.at - a.at)) {
    const members = s.members.filter((m) => !seen.has(agentKey(m)));
    for (const m of members) seen.add(agentKey(m));
    if (members.length && !out.some((o) => o.id === s.id)) out.push(members.length === s.members.length ? s : { ...s, members });
  }
  return out;
}

/**
 * A desk closed for good (not the app quitting): its workspaces join the main window's tray (trimmed to its 最近) and
 * its stored sets go. Also for a remembered desk that does not come back (its store was never made): the stored sets are read.
 */
export function handSetsToMain(deskId: string): void {
  if (deskId === MAIN_WINDOW) return;
  const had = useWorkspaceSets.windows().includes(deskId);
  const from = had ? useWorkspaceSets.of(deskId).getState().sets : readStored(deskId);
  if (from.length) {
    inWindow(MAIN_WINDOW, () => setSets(trimSets(mergeSets(useWorkspaceSets.getState().sets, from), isPinnedAgent, screenAgents(usePanes.getState().layout))));
  }
  if (had) useWorkspaceSets.of(deskId).setState({ sets: [] });
  try {
    localStorage.removeItem(setsStorageKey(deskId));
  } catch {
    // no storage (tests)
  }
}

const isPinnedAgent = (a: AgentId): boolean => useWorkspaceSets.getState().pinned.has(agentKey(a));

/** The pinned agents changed (the tray reads the home pins): the trimmed list may change. */
export function setPinnedAgents(keys: ReadonlySet<string>): void {
  const cur = useWorkspaceSets.getState().pinned;
  if (cur.size === keys.size && [...keys].every((k) => cur.has(k))) return;
  useWorkspaceSets.setState({ pinned: keys });
  setSets(trimSets(useWorkspaceSets.getState().sets, isPinnedAgent, screenAgents(usePanes.getState().layout)));
}

/** A workspace left the tray (× on a 最近 entry; its columns were closed by the caller). */
export function removeSet(id: string): void {
  setSets(useWorkspaceSets.getState().sets.filter((s) => s.id !== id));
}

/** An agent left the tray (deleted, closed): it leaves its workspace. */
export function removeAgentFromSets(a: AgentId): void {
  setSets(withoutMember(useWorkspaceSets.getState().sets, a));
}

/** 「拆出」: `a` becomes a workspace of its own. */
export function splitAgentOut(a: AgentId): void {
  setSets(splitOut(useWorkspaceSets.getState().sets, a, Date.now()));
}

let started = false;

/** Keeps the sets in step with the pane layout (App mounts it once); returns the stop. */
export function startWorkspaceSets(): () => void {
  if (started) return () => {};
  started = true;
  const apply = () => {
    const cur = screenAgents(usePanes.getState().layout);
    const next = trimSets(observe(useWorkspaceSets.getState().sets, cur, Date.now()), isPinnedAgent, cur);
    setSets(next);
    // Runs in the window whose layout changed (lib/windowScope): its agents leave the other windows' sets.
    leaveOtherWindows(currentWindow(), cur);
  };
  apply();
  const off = usePanes.subscribe((s, prev) => {
    // Another host's scope loaded: not a change of the workspace.
    if (s.scope !== prev.scope || s.layout === prev.layout) return;
    apply();
  });
  return () => {
    started = false;
    off();
  };
}

/** An entry unpinned keeps a place in 最近: these agents are remembered as one workspace (newest). */
export function rememberSet(members: readonly AgentId[]): void {
  if (!members.length) return;
  setSets(observe(useWorkspaceSets.getState().sets, members, Date.now()));
}
