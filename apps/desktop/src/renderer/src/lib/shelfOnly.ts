// 只看 Shelf (docs/design/002 补充 10-22, owner: 「会话列似乎也没法最小化」): the conversation column folds to its
// in-place strip (lib/convStrips' look: avatar, 需要你, running) while its Shelf stays on screen and takes the
// width the column gave up — filling (智能 with two / 铺满窗口): the whole workspace's width; by content: as far as
// the row has free room (the desktop gap beside the group). Also with one workspace. A click on the strip (or
// Alt+←, or opening that agent again from the sidebar / tray) brings the conversation back and the Shelf to the
// width it had. Per conversation, kept on this machine.
//
// The Shelf's new width is stored as its own width (clamped to its range, max 1600) and the old one remembered:
// a window resize afterwards follows the usual width rules (the Shelf keeps its pixels; the folds for lack of
// room keep their 48 px slack, lib/foldHysteresis). The row treats the column as a STRIP_W card with its Shelves
// still drawn (lib/workspaceRow `strip` + `keepShelves`; one workspace: components/side/SideArea `shelfOnly`).
// `shelfOnlyPlan` measures once and serves both the preview (「变宽到 N px」) and the action.
// Shell code: names no feature. Pure parts tested in test/shelfOnly.test.ts.
import { create } from "zustand";
import { getLiveWidth } from "./appearance";
import { RANGES } from "./appearanceModel";
import { convKey } from "./convShelves";
import { paneArea, shelfSideArea } from "./foretellAreas";
import { conversationPanes, focusedConversation, paneBinding, type PaneLayout } from "./paneLayout";
import { focusConversationPane, usePanes } from "./paneStore";
import { columnsOnScreen, setShelfWidth } from "./sideLayout";
import { sideViewNow } from "./sideComponents";
import { liveConversation, updateLayout, useSide } from "./sideLayoutStore";
import { pushBack } from "./trayOpen";
import { markSeenOn } from "./turnUnread";
import { STRIP_W } from "./workspaceRow";
import { queryAllAppWindows, queryAppWindows } from "./appWindowSet";

export const SHELF_ONLY_STORAGE_KEY = "cutex-desktop.shelfOnly";

export interface ShelfOnlyRecord {
  at: number;
  /** The Shelf that took the width and its own width before (null: it had none — the default width). */
  shelfId: string;
  before: number | null;
}

/** Stored records as read back (malformed ones dropped). Pure. */
export function readShelfOnly(raw: unknown): Record<string, ShelfOnlyRecord> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ShelfOnlyRecord> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || !key.includes("|")) continue;
    const { at, shelfId, before } = v as Record<string, unknown>;
    if (typeof shelfId !== "string" || !shelfId) continue;
    out[key] = { at: typeof at === "number" ? at : 0, shelfId, before: typeof before === "number" ? before : null };
  }
  return out;
}

function readStored(): Record<string, ShelfOnlyRecord> {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(SHELF_ONLY_STORAGE_KEY);
    return readShelfOnly(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

export const useShelfOnly = create<{ records: Record<string, ShelfOnlyRecord> }>(() => ({ records: readStored() }));

function setRecords(records: Record<string, ShelfOnlyRecord>): void {
  useShelfOnly.setState({ records });
  try {
    localStorage.setItem(SHELF_ONLY_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // not kept: harmless
  }
}

const keyOfPane = (layout: PaneLayout, paneId: string): string | null => {
  const b = paneBinding(layout, paneId);
  return b?.sessionId ? convKey(b.hostId, b.sessionId) : null;
};

/** The panes showing only their Shelf now (their conversation a strip). Pure. */
export function shelfOnlyPanes(layout: PaneLayout, records: Readonly<Record<string, ShelfOnlyRecord>>): string[] {
  return conversationPanes(layout).filter((id) => !!records[keyOfPane(layout, id) ?? ""]);
}

/** Live: the panes showing only their Shelf. */
export function useShelfOnlyPanes(): string[] {
  const layout = usePanes((s) => s.layout);
  const records = useShelfOnly((s) => s.records);
  return shelfOnlyPanes(layout, records);
}

/** Live: whether this pane shows only its Shelf. */
export function useIsShelfOnly(paneId: string | null): boolean {
  const panes = useShelfOnlyPanes();
  return !!paneId && panes.includes(paneId);
}

/**
 * The Shelf's new width (its own width, rail not counted): what it has + what the column gives up (its width less
 * the strip) + the row's free room (by content: the desktop gap beside the group; filling: none), within its
 * range. Pure.
 */
export function shelfOnlyWidth(i: { shelf: number; column: number; free: number }): number {
  const want = i.shelf + Math.max(0, i.column - STRIP_W) + Math.max(0, i.free);
  return Math.round(Math.min(RANGES.sidePaneWidth[1], Math.max(RANGES.sidePaneWidth[0], want)));
}

export interface ShelfOnlyPlan {
  paneId: string;
  shelfId: string;
  side: "left" | "right";
  /** Its own width now (null: the default) and after. */
  before: number | null;
  width: number;
}

const boxW = (selector: string): number => {
  if (typeof document === "undefined") return 0;
  for (const one of selector.split(",")) for (const el of queryAllAppWindows<HTMLElement>(one.trim())) {
    const w = el.getBoundingClientRect().width;
    if (w > 0) return w;
  }
  return 0;
};

/** The row's free room beside the group (by content; 0 when the panes fill it). DOM. */
function rowFree(): number {
  if (typeof document === "undefined") return 0;
  const work = queryAppWindows<HTMLElement>("[data-side-work]");
  if (!work) return 0;
  const r = work.getBoundingClientRect();
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const el of work.children) {
    const b = (el as HTMLElement).getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) continue;
    left = Math.min(left, b.left);
    right = Math.max(right, b.right);
  }
  return Number.isFinite(left) ? Math.max(0, Math.round(r.width - (right - left))) : 0;
}

/**
 * What 只看 Shelf would do for `paneId` now (null: it cannot — no agent, already, or no expanded Shelf of the live
 * workspace on screen). Only the focused workspace's Shelf is live: another workspace's is planned once it has the
 * focus (the action focuses it first). Measures the DOM.
 */
export function shelfOnlyPlan(paneId: string): ShelfOnlyPlan | null {
  const layout = usePanes.getState().layout;
  const key = keyOfPane(layout, paneId);
  if (!key || useShelfOnly.getState().records[key] || focusedConversation(layout) !== paneId || liveConversation() !== key) return null;
  const side = useSide.getState().layout;
  if (!side.open) return null;
  const shown = columnsOnScreen(side, sideViewNow(), null).filter((e) => !e.shelf.collapsed);
  // The right one when both are expanded (只用一个 Shelf is the usual case).
  const entry = shown.find((e) => e.shelf.side === "right") ?? shown[0];
  if (!entry) return null;
  const before = entry.shelf.width ?? null;
  const shelf = before ?? getLiveWidth("sidePaneWidth");
  const column = boxW(paneArea(paneId));
  if (column <= STRIP_W) return null;
  return { paneId, shelfId: entry.shelf.id, side: entry.shelf.side, before, width: shelfOnlyWidth({ shelf, column, free: rowFree() }) };
}

/** Whether 只看 Shelf is possible for `paneId` (another workspace: once focused it may be). */
export function canShelfOnly(paneId: string): boolean {
  const layout = usePanes.getState().layout;
  if (focusedConversation(layout) !== paneId) return !!keyOfPane(layout, paneId) && !useShelfOnly.getState().records[keyOfPane(layout, paneId)!];
  return !!shelfOnlyPlan(paneId);
}

/** 只看 Shelf: the plan applied (`plan` from shelfOnlyPlan — the preview's). False: nothing done. */
export function enterShelfOnly(plan: ShelfOnlyPlan | null): boolean {
  if (!plan) return false;
  const layout = usePanes.getState().layout;
  const key = keyOfPane(layout, plan.paneId);
  if (!key) return false;
  updateLayout((l) => setShelfWidth(l, plan.shelfId, plan.width));
  setRecords({ ...useShelfOnly.getState().records, [key]: { at: Date.now(), shelfId: plan.shelfId, before: plan.before } });
  const b = paneBinding(layout, plan.paneId)!;
  pushBack({ kind: "shelfOnly", hostId: b.hostId, sessionId: b.sessionId! });
  return true;
}

/** The conversation `key` comes back (its Shelf to its width before, while it is the live one). */
function leave(key: string): void {
  const rec = useShelfOnly.getState().records[key];
  if (!rec) return;
  if (liveConversation() === key) updateLayout((l) => setShelfWidth(l, rec.shelfId, rec.before));
  const { [key]: _gone, ...rest } = useShelfOnly.getState().records;
  setRecords(rest);
}

/** A click on the strip: the conversation comes back, focused, its Shelf at its width before. */
export function leaveShelfOnly(paneId: string): void {
  const b = paneBinding(usePanes.getState().layout, paneId);
  const key = keyOfPane(usePanes.getState().layout, paneId);
  focusConversationPane(paneId);
  if (key) leave(key);
  // Looked at again (owner 2026-10-22): its unread mark clears.
  if (b?.sessionId) markSeenOn(b.hostId, b.sessionId);
}

/** The same by agent (「返回上一个」). False: not on screen (nothing done — its record stays for when it is back). */
export function leaveShelfOnlyOf(hostId: string, sessionId: string): boolean {
  const layout = usePanes.getState().layout;
  const key = convKey(hostId, sessionId);
  const pane = conversationPanes(layout).find((id) => keyOfPane(layout, id) === key);
  if (!pane || !useShelfOnly.getState().records[key]) return false;
  leaveShelfOnly(pane);
  return true;
}

/** Live: per conversation pane (left → right), whether it shows only its Shelf (the work row's workspaces). */
export function useShelfOnlyFlags(): boolean[] {
  const layout = usePanes((s) => s.layout);
  const records = useShelfOnly((s) => s.records);
  const panes = shelfOnlyPanes(layout, records);
  return conversationPanes(layout).map((id) => panes.includes(id));
}
