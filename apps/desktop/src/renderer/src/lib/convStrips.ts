// 收起一个会话 (docs/design/002-collapse-conversation.md, owner 2026-10-21): with two workspaces on screen, one
// conversation column folds in place to a ~44 px strip (avatar, 需要你, running) — its Shelf goes with it (no
// Shelf Rail is left) and comes back as it was when the strip is clicked. Rules:
//   - only with two workspaces; never both (at least one stays expanded);
//   - the focus never stays on a strip: focusing it (a click, Ctrl+Alt+arrows, the tray) expands it;
//   - per conversation, kept on this machine like a Shelf's collapse;
//   - the width it frees: by 工作区宽度 (filling: the neighbour column; by content: the desktop shows) — or,
//     collapsed from a preview's 「太窄？收起 X」, given to that preview's Shelf (and taken back on expand);
//   - 独占 = every other workspace to its strip (the same mechanism; components/ConversationHeader ⋯).
// The row's geometry treats a strip workspace as a fixed STRIP_W column without Shelves (lib/workspaceRow).
// Shell code: names no feature. Pure parts tested in test/convStrips.test.ts.
import { create } from "zustand";
import { getLiveWidth } from "./appearance";
import { convKey } from "./convShelves";
import { conversationPanes, focusedConversation, paneBinding, type PaneLayout } from "./paneLayout";
import { focusConversationPane, usePanes } from "./paneStore";
import { setShelfWidth } from "./sideLayout";
import { liveConversation, updateLayout, useSide } from "./sideLayoutStore";
import { pushBack } from "./trayOpen";
import { setFoldedTest } from "./foldedTest";
import { shelfOnlyPanes, useShelfOnly, type ShelfOnlyRecord } from "./shelfOnly";
import { markSeenOn } from "./turnUnread";
import { STRIP_W } from "./workspaceRow";
import { queryAllAppWindows, queryAppWindows } from "./appWindowSet";

/** A strip's width (px; the Shelf Rail is 48): lib/workspaceRow's (the row's geometry is pure). */
export { STRIP_W };

export const STRIPS_STORAGE_KEY = "cutex-desktop.convStrips";

export interface StripRecord {
  at: number;
  /** Collapsed from 「太窄？收起 X」: the preview's Shelf took the width; its width before (restored on expand). */
  gave?: { owner: string; shelfId: string; before: number | null };
}

interface StripsState {
  /** By conversation (convKey). */
  strips: Record<string, StripRecord>;
}

function readStored(): Record<string, StripRecord> {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STRIPS_STORAGE_KEY);
    return readStrips(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

/** Stored strips as read back (malformed ones dropped). Pure. */
export function readStrips(raw: unknown): Record<string, StripRecord> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, StripRecord> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || !key.includes("|")) continue;
    const at = (v as { at?: unknown }).at;
    const gave = (v as { gave?: unknown }).gave as StripRecord["gave"] | undefined;
    out[key] = { at: typeof at === "number" ? at : 0, ...(gave && typeof gave.owner === "string" && typeof gave.shelfId === "string" ? { gave: { owner: gave.owner, shelfId: gave.shelfId, before: typeof gave.before === "number" ? gave.before : null } } : {}) };
  }
  return out;
}

export const useStrips = create<StripsState>(() => ({ strips: readStored() }));

function setStrips(strips: Record<string, StripRecord>): void {
  useStrips.setState({ strips });
  try {
    localStorage.setItem(STRIPS_STORAGE_KEY, JSON.stringify(strips));
  } catch {
    // not kept: harmless
  }
}

const keyOfPane = (layout: PaneLayout, paneId: string): string | null => {
  const b = paneBinding(layout, paneId);
  return b?.sessionId ? convKey(b.hostId, b.sessionId) : null;
};

/**
 * The panes drawn as strips now: two workspaces, a stored strip, not the focused pane, and never both (the
 * focused one stays expanded). Pure.
 */
export function stripPanes(layout: PaneLayout, strips: Readonly<Record<string, StripRecord>>): string[] {
  const panes = conversationPanes(layout);
  if (panes.length < 2) return [];
  const focus = focusedConversation(layout);
  const out = panes.filter((id) => id !== focus && !!strips[keyOfPane(layout, id) ?? ""]);
  return out.length >= panes.length ? out.slice(0, panes.length - 1) : out;
}

/** Live: the panes drawn as strips. */
export function useStripPanes(): string[] {
  const layout = usePanes((s) => s.layout);
  const strips = useStrips((s) => s.strips);
  return stripPanes(layout, strips);
}

/** Live: per conversation pane (left → right), whether it is drawn as its strip (the work row's workspaces). */
export function useStripFlags(): boolean[] {
  const layout = usePanes((s) => s.layout);
  const strips = useStripPanes();
  return conversationPanes(layout).map((id) => strips.includes(id));
}

/** Live: whether this pane is a strip now. */
export function useIsStrip(paneId: string | null): boolean {
  const panes = useStripPanes();
  return !!paneId && panes.includes(paneId);
}

/** Whether `paneId` can fold to a strip now: two workspaces, it shows an agent and the other is not a strip. */
export function canStrip(layout: PaneLayout, paneId: string, strips: Readonly<Record<string, StripRecord>> = useStrips.getState().strips): boolean {
  const panes = conversationPanes(layout);
  if (panes.length < 2 || !panes.includes(paneId) || !keyOfPane(layout, paneId)) return false;
  const shown = stripPanes(layout, strips);
  return !shown.includes(paneId) && panes.filter((id) => id !== paneId && !shown.includes(id)).length > 0;
}

/** The freed width (px) a strip of `paneId` gives: its column and its Shelves on screen, less the strip. DOM. */
function freedWidth(paneId: string): number {
  if (typeof document === "undefined") return 0;
  const col = queryAppWindows<HTMLElement>(`[data-conv-pane="${CSS.escape(paneId)}"]`)?.getBoundingClientRect().width ?? 0;
  let shelves = 0;
  for (const el of queryAllAppWindows<HTMLElement>(`[data-ws-shelf="${CSS.escape(paneId)}"]`)) shelves += el.getBoundingClientRect().width;
  return Math.max(0, Math.round(col + shelves - STRIP_W));
}

/**
 * Folds `paneId` to its strip (the focus moves to the other workspace). `giveTo`: the live Shelf of the other
 * workspace whose preview asked for room (「太窄？收起 X」) — it takes the freed width. False: not possible now.
 */
export function collapseToStrip(paneId: string, opts: { giveTo?: { shelfId: string } } = {}): boolean {
  const layout = usePanes.getState().layout;
  if (!canStrip(layout, paneId)) return false;
  const key = keyOfPane(layout, paneId)!;
  const other = conversationPanes(layout).find((id) => id !== paneId)!;
  let gave: StripRecord["gave"];
  if (opts.giveTo) {
    const freed = freedWidth(paneId);
    // The other workspace's Shelf is the live layout once it has the focus.
    focusConversationPane(other);
    const owner = liveConversation();
    const shelf = useSide.getState().layout.shelves?.find((x) => x.id === opts.giveTo!.shelfId) ?? null;
    if (owner && shelf && freed > 0) {
      const before = shelf.width ?? null;
      const base = before ?? getLiveWidth("sidePaneWidth");
      if (base > 0) {
        gave = { owner, shelfId: shelf.id, before };
        updateLayout((l) => setShelfWidth(l, shelf.id, base + freed));
      }
    }
  }
  setStrips({ ...useStrips.getState().strips, [key]: { at: Date.now(), ...(gave ? { gave } : {}) } });
  focusConversationPane(other);
  const b = paneBinding(layout, paneId)!;
  pushBack({ kind: "strip", hostId: b.hostId, sessionId: b.sessionId! });
  return true;
}

/** The strip of conversation `key` goes (its Shelf's borrowed width back first, while that Shelf is live). */
function dropStrip(key: string): void {
  const rec = useStrips.getState().strips[key];
  if (!rec) return;
  if (rec.gave && liveConversation() === rec.gave.owner) {
    const { shelfId, before } = rec.gave;
    updateLayout((l) => setShelfWidth(l, shelfId, before));
  }
  const { [key]: _gone, ...rest } = useStrips.getState().strips;
  setStrips(rest);
}

/** Expands the strip of `paneId` (a click on it, 「返回上一个」) and gives it the focus. */
export function expandStrip(paneId: string): void {
  const b = paneBinding(usePanes.getState().layout, paneId);
  const key = keyOfPane(usePanes.getState().layout, paneId);
  if (key) dropStrip(key);
  focusConversationPane(paneId);
  // Looked at again (owner 2026-10-22): its unread mark clears like on a select.
  if (b?.sessionId) markSeenOn(b.hostId, b.sessionId);
}

/** Expands the strip of conversation `hostId|sessionId` wherever it is (「返回上一个」). */
export function expandStripOf(hostId: string, sessionId: string): void {
  const layout = usePanes.getState().layout;
  const pane = conversationPanes(layout).find((id) => keyOfPane(layout, id) === convKey(hostId, sessionId));
  if (pane) expandStrip(pane);
  else dropStrip(convKey(hostId, sessionId));
}

/** 独占: every other workspace folds to its strip; `paneId` keeps (or gets) the focus. */
export function soloWorkspace(paneId: string): void {
  const layout = usePanes.getState().layout;
  for (const id of conversationPanes(layout)) if (id !== paneId) collapseToStrip(id);
  focusConversationPane(paneId);
}

/** Whether 独占 would change anything (another workspace still expanded). */
export function canSolo(layout: PaneLayout, paneId: string): boolean {
  return conversationPanes(layout).some((id) => id !== paneId && canStrip(layout, id));
}

let started = false;

/**
 * Keeps the strips honest (App mounts it once): the focus landing on a strip expands it (聚焦窄条 = 展开它); a
 * conversation that is no longer one of two workspaces forgets its strip.
 */
export function startConvStrips(): () => void {
  if (started) return () => {};
  started = true;
  // Folded = not looked at (owner 2026-10-22): store looksAt asks this (lib/foldedTest).
  setFoldedTest(isFolded);
  const off = usePanes.subscribe((s, prev) => {
    if (s.layout === prev.layout) return;
    const strips = useStrips.getState().strips;
    if (!Object.keys(strips).length) return;
    const layout = s.layout;
    const panes = conversationPanes(layout);
    const keys = panes.map((id) => keyOfPane(layout, id));
    const focus = focusedConversation(layout);
    const focusKey = focus ? keyOfPane(layout, focus) : null;
    for (const key of Object.keys(strips)) {
      // Focused, or not one of two workspaces any more: expanded.
      if (key === focusKey || panes.length < 2 || !keys.includes(key)) dropStrip(key);
    }
  });
  return () => {
    started = false;
    setFoldedTest(null);
    off();
  };
}

/**
 * Whether this agent's conversation is on screen folded — a strip, or 只看 Shelf (lib/shelfOnly). Pure over the
 * stores' state; `layout` / records default to the live ones.
 */
export function foldedKeys(layout: PaneLayout, strips: Readonly<Record<string, StripRecord>>, shelfOnly: Readonly<Record<string, ShelfOnlyRecord>>): string[] {
  return [...stripPanes(layout, strips), ...shelfOnlyPanes(layout, shelfOnly)].flatMap((id) => {
    const key = keyOfPane(layout, id);
    return key ? [key] : [];
  });
}

export function isFolded(hostId: string, sessionId: string): boolean {
  return foldedKeys(usePanes.getState().layout, useStrips.getState().strips, useShelfOnly.getState().records).includes(convKey(hostId, sessionId));
}

/** Live: whether this pane's conversation is folded (its view does not count as looked at). */
export function useIsFolded(paneId: string): boolean {
  const layout = usePanes((s) => s.layout);
  const strips = useStrips((s) => s.strips);
  const shelfOnly = useShelfOnly((s) => s.records);
  return stripPanes(layout, strips).includes(paneId) || shelfOnlyPanes(layout, shelfOnly).includes(paneId);
}
