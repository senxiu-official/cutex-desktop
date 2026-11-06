// 托盘 = 任务栏 (docs/design/001-tray-taskbar.md, owner 2026-10-21): the tray holds what is pinned AND what is
// open. A workspace that another one replaced (a sidebar click, the tray, ⌘K) does not close: its agent becomes
// "open, not on screen" and stays in the tray until the owner closes it there; 「—」 on a conversation
// (002, minimise) puts it there too and remembers its side, so a click brings it back on that side. Like a
// browser's tabs, the open items survive an app restart (this machine, localStorage).
// Alt+← / 「返回上一个」 undoes the last replace (and a minimise or a collapse to a strip — 002 「回来」).
//
// Replacements are seen, not announced: a subscription compares the pane layout before / after every change
// (the same pane showing another agent = a replace), so every path that replaces (store select, lib/workspaces,
// services.panes) is covered without each of them calling in. Pure parts tested in test/trayOpen.test.ts.
// Shell code: names no feature.
//
// Per window (multi-window P3.5, docs/desktop-modules.md §24.17): every app window has its own open list and its own
// 「返回上一个」 steps (lib/windowScope `windowStore`), stored per desk like the layout (`openStorageKey`). One copy per
// agent (lib/windowRoute): an agent that goes on screen in one window leaves every window's open list. A closed desk's
// items join the main window's (`handOpenToMain`).
import { create } from "zustand";
import { sidebarOf, useApp } from "../store";
import { listedIn } from "./archivedAgent";
import { conversationPanes, paneBinding, type PaneLayout } from "./paneLayout";
import { usePanes } from "./paneStore";
import { currentWindow, inWindow, MAIN_WINDOW, windowStore, type WindowKey } from "./windowScope";

export interface OpenAgent {
  hostId: string;
  sessionId: string;
  /** When it left the screen (ms): the newest first in the tray's open part. */
  at: number;
  /** Minimised from this side of two workspaces (a click puts it back there); absent: a replaced one. */
  side?: "left" | "right";
}

/** One step 「返回上一个」 can undo. */
export type BackStep =
  /** The agents on screen changed (a switch of workspace, a replaced column; design 039): undo = show `from` again. */
  | { kind: "workspace"; from: { hostId: string; sessionId: string }[]; to: { hostId: string; sessionId: string }[] }
  | { kind: "minimize"; hostId: string; sessionId: string; side: "left" | "right" | null }
  | { kind: "strip"; hostId: string; sessionId: string }
  | { kind: "shelfOnly"; hostId: string; sessionId: string };

export const OPEN_STORAGE_KEY = "cutex-desktop.trayOpen";
/** Kept at most (the oldest go): the tray shows the rest behind its overflow. */
export const MAX_OPEN = 40;
/** Steps 「返回上一个」 remembers. */
export const MAX_BACK = 30;

interface TrayOpenState {
  open: OpenAgent[];
  back: BackStep[];
}

const same = (a: { hostId: string; sessionId: string }, b: { hostId: string; sessionId: string }) => a.hostId === b.hostId && a.sessionId === b.sessionId;

/** Where a window's open list is stored: the main window's under OPEN_STORAGE_KEY (as before), a desk's beside it. */
export const openStorageKey = (key: WindowKey): string => (key === MAIN_WINDOW ? OPEN_STORAGE_KEY : `${OPEN_STORAGE_KEY}.desk:${key}`);

function readStored(key: WindowKey): OpenAgent[] {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(openStorageKey(key));
    return readOpen(raw ? JSON.parse(raw) : null);
  } catch {
    return [];
  }
}

/** Stored open items as read back (malformed entries dropped). Pure. */
export function readOpen(raw: unknown): OpenAgent[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { open?: unknown }).open) ? (raw as { open: unknown[] }).open : [];
  const out: OpenAgent[] = [];
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const { hostId, sessionId, at, side } = x as Record<string, unknown>;
    if (typeof hostId !== "string" || typeof sessionId !== "string" || !hostId || !sessionId) continue;
    if (out.some((o) => o.hostId === hostId && o.sessionId === sessionId)) continue;
    out.push({ hostId, sessionId, at: typeof at === "number" ? at : 0, ...(side === "left" || side === "right" ? { side } : {}) });
  }
  return out.slice(0, MAX_OPEN);
}

export const useTrayOpen = windowStore((key) => create<TrayOpenState>(() => ({ open: readStored(key), back: [] })));

function write(open: OpenAgent[], key: WindowKey = currentWindow()): void {
  try {
    localStorage.setItem(openStorageKey(key), JSON.stringify({ v: 1, open }));
  } catch {
    // not kept across a restart: harmless
  }
}

/** `a` added to the open list (newest first; already there: moved up, its side replaced). Pure. */
export function withOpen(list: readonly OpenAgent[], a: OpenAgent): OpenAgent[] {
  return [a, ...list.filter((o) => !same(o, a))].slice(0, MAX_OPEN);
}

/** Without `a`. Pure. */
export const withoutOpen = (list: readonly OpenAgent[], a: { hostId: string; sessionId: string }): OpenAgent[] => list.filter((o) => !same(o, a));

function setOpen(open: OpenAgent[]): void {
  if (open === useTrayOpen.getState().open) return;
  useTrayOpen.setState({ open });
  write(open);
}

/** These agents went on screen in window `here`: they leave the other windows' open lists (one copy per agent). */
function leaveOtherWindows(here: WindowKey, agents: readonly { hostId: string; sessionId: string }[]): void {
  if (!agents.length) return;
  for (const key of useTrayOpen.windows()) {
    if (key === here) continue;
    inWindow(key, () => {
      const open = useTrayOpen.getState().open;
      const kept = open.filter((o) => !agents.some((a) => same(a, o)));
      if (kept.length !== open.length) setOpen(kept);
    });
  }
}

/** Two open lists as one: newest first, an agent once (its newer item kept). Pure. */
export function mergeOpen(into: readonly OpenAgent[], from: readonly OpenAgent[]): OpenAgent[] {
  const out: OpenAgent[] = [];
  for (const o of [...into, ...from].sort((a, b) => b.at - a.at)) if (!out.some((x) => same(x, o))) out.push(o);
  return out.slice(0, MAX_OPEN);
}

/**
 * A desk closed for good (not the app quitting): its open items join the main window's tray and its stored list goes.
 * Also for a remembered desk that does not come back (its store was never made): the stored list is read.
 */
export function handOpenToMain(deskId: string): void {
  if (deskId === MAIN_WINDOW) return;
  const had = useTrayOpen.windows().includes(deskId);
  const from = had ? useTrayOpen.of(deskId).getState().open : readStored(deskId);
  if (from.length) inWindow(MAIN_WINDOW, () => setOpen(mergeOpen(useTrayOpen.getState().open, from)));
  if (had) useTrayOpen.of(deskId).setState({ open: [], back: [] });
  try {
    localStorage.removeItem(openStorageKey(deskId));
  } catch {
    // no storage (tests)
  }
}

/** Whether `a` is open in the tray (off screen). */
export const isOpenInTray = (a: { hostId: string; sessionId: string }): boolean => useTrayOpen.getState().open.some((o) => same(o, a));

/** The open item of `a` (its side when minimised), or null. */
export const openEntry = (a: { hostId: string; sessionId: string }): OpenAgent | null => useTrayOpen.getState().open.find((o) => same(o, a)) ?? null;

/** Closing an open item in the tray: it leaves the tray (a pinned one stays as a pin). */
export function closeOpen(a: { hostId: string; sessionId: string }): void {
  setOpen(withoutOpen(useTrayOpen.getState().open, a));
}

/** Puts `a` in the tray as open (lib/workspaceEffects minimise; `side`: where it comes back). */
export function addOpen(a: { hostId: string; sessionId: string }, side: "left" | "right" | null = null): void {
  setOpen(withOpen(useTrayOpen.getState().open, { hostId: a.hostId, sessionId: a.sessionId, at: Date.now(), ...(side ? { side } : {}) }));
}

export function pushBack(step: BackStep): void {
  if (replaying) return;
  useTrayOpen.setState((s) => ({ back: [...s.back, step].slice(-MAX_BACK) }));
}

/** The last step and the list without it (null: nothing to undo). */
export function popBack(): BackStep | null {
  const back = useTrayOpen.getState().back;
  const last = back[back.length - 1] ?? null;
  if (last) useTrayOpen.setState({ back: back.slice(0, -1) });
  return last;
}

let replaying = false;
/** Runs `fn` without recording what it does as a step (「返回上一个」 itself). */
export function replayingBack(fn: () => void): void {
  replaying = true;
  try {
    fn();
  } finally {
    replaying = false;
  }
}

// ── Watching the layout ─────────────────────────────────────────────────────────────────────────

type Agent = { hostId: string; sessionId: string };

/** What changed between two layouts of the same scope: replacements (pane, from, to) and the agents on screen now. Pure. */
export function layoutChange(prev: PaneLayout, next: PaneLayout): { replaced: { paneId: string; from: Agent; to: Agent }[]; onScreen: Agent[] } {
  const agentOf = (l: PaneLayout, id: string): Agent | null => {
    const b = paneBinding(l, id);
    return b?.sessionId ? { hostId: b.hostId, sessionId: b.sessionId } : null;
  };
  const nextPanes = conversationPanes(next);
  const onScreen = nextPanes.flatMap((id) => {
    const a = agentOf(next, id);
    return a ? [a] : [];
  });
  const replaced: { paneId: string; from: Agent; to: Agent }[] = [];
  for (const id of conversationPanes(prev)) {
    if (!nextPanes.includes(id)) continue;
    const from = agentOf(prev, id);
    const to = agentOf(next, id);
    if (from && to && !same(from, to)) replaced.push({ paneId: id, from, to });
  }
  return { replaced, onScreen };
}

/** The open list after a layout change: replaced agents (not on screen any more) join, agents on screen leave. Pure. */
export function openAfter(list: readonly OpenAgent[], change: ReturnType<typeof layoutChange>, now: number): OpenAgent[] {
  let out = list.filter((o) => !change.onScreen.some((a) => same(a, o)));
  for (const r of change.replaced) if (!change.onScreen.some((a) => same(a, r.from))) out = withOpen(out, { ...r.from, at: now });
  return out.length === list.length && out.every((o, i) => o === list[i]) ? (list as OpenAgent[]) : out;
}

const screenAgentsOf = (layout: PaneLayout): Agent[] =>
  conversationPanes(layout).flatMap((id) => {
    const b = paneBinding(layout, id);
    return b?.sessionId ? [{ hostId: b.hostId, sessionId: b.sessionId }] : [];
  });

let started = false;

/** Keeps the open list in step with the pane layout (App mounts it once); returns the stop. */
export function startTrayOpen(): () => void {
  if (started) return () => {};
  started = true;
  const offPanes = usePanes.subscribe((s, prev) => {
    // Another host's scope loaded: not a replacement.
    if (s.scope !== prev.scope || s.layout === prev.layout) return;
    const change = layoutChange(prev.layout, s.layout);
    const before = screenAgentsOf(prev.layout);
    const after = change.onScreen;
    if (before.length && after.length && !(before.length === after.length && before.every((a) => after.some((b) => same(a, b))))) pushBack({ kind: "workspace", from: before, to: after });
    setOpen(openAfter(useTrayOpen.getState().open, change, Date.now()));
    // The listener runs in the window whose layout changed (lib/windowScope): what it shows leaves the others' trays.
    leaveOtherWindows(currentWindow(), after);
  });
  // Agents deleted meanwhile (their host lists them no more) leave the tray — every window's.
  const offApp = useApp.subscribe((s, prev) => {
    if (s.sidebar === prev.sidebar && s.byHost === prev.byHost) return;
    for (const key of useTrayOpen.windows()) {
      inWindow(key, () => {
        const open = useTrayOpen.getState().open;
        const kept = open.filter((o) => listedIn(sidebarOf(s, o.hostId), o.sessionId) !== false);
        if (kept.length !== open.length) setOpen(kept);
      });
    }
  });
  return () => {
    started = false;
    offPanes();
    offApp();
  };
}
