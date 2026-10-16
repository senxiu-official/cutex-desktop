// The queue card's compact form (UI review 2026-10-15 #2): one header row of count chips
// (「排队 2 · 留言 1 · 委托 3」) instead of the sections, when more than one kind of thing waits or the
// window is short; a click expands. An explicit collapse (lib/queueView) still wins; an explicit expand
// lasts for this run (per agent, memory only), so the automatic rule comes back after a restart. Pure
// except the window-height hook. The whole rule is opt-in since 2026-10-16 (pref `queuePanelFold`,
// Settings → 对话 → 输入框 「「接下来」面板」): ★ 始终展开 never compacts, 自动折叠 applies it.
import { useSyncExternalStore } from "react";
import type { AdmissionNextStep } from "@cutex-desktop/protocol";
import type { AdmissionRow } from "./admissionOrder";

export type QueueChipKind = "queued" | "inserting" | "paused" | "messages" | "delegations" | "alarms" | "asksPaused" | "quota";

export interface QueueChip {
  kind: QueueChipKind;
  /** The count shown (omitted for a state chip: 委托已暂停, 额度用完). */
  n?: number;
  /** Warn tone (paused / held / quota). */
  warn?: boolean;
}

/** Below this window height (px) the card starts compact as soon as it has more than one row. */
export const SHORT_WINDOW = 800;

export interface ChipCounts {
  /** Owner messages queued (plain queue or owner turns) + their optimistic sends. */
  queued: number;
  /** Steers waiting for the next tool boundary (incl. undelivered ones and optimistic sends). */
  inserting: number;
  /** Items held by the queue pause. */
  paused: number;
  /** Delegation turns in the turn frame. */
  asks: number;
  /** Ride-along deliveries (admission `nextStep`). */
  nextStep: readonly AdmissionNextStep[];
}

/** Ride-along kinds: a delegation's answer / question counts as 委托, an alarm as 闹钟, the rest as 留言. */
function rideAlongKind(item: AdmissionNextStep): "delegations" | "alarms" | "messages" {
  if (item.deliveryKind === "answer" || item.deliveryKind === "question") return "delegations";
  if (item.deliveryKind === "alarm") return "alarms";
  return "messages";
}

/** The chips of the card's own sections, in reading order (the extra sections add theirs after). */
export function queueChips(c: ChipCounts): QueueChip[] {
  const n = { messages: 0, delegations: c.asks, alarms: 0 };
  for (const item of c.nextStep) n[rideAlongKind(item)] += 1;
  const out: QueueChip[] = [];
  if (c.inserting > 0) out.push({ kind: "inserting", n: c.inserting });
  if (c.queued > 0) out.push({ kind: "queued", n: c.queued });
  if (c.paused > 0) out.push({ kind: "paused", n: c.paused, warn: true });
  if (n.messages > 0) out.push({ kind: "messages", n: n.messages });
  if (n.delegations > 0) out.push({ kind: "delegations", n: n.delegations });
  if (n.alarms > 0) out.push({ kind: "alarms", n: n.alarms });
  return out;
}

/** Owner / delegation turns of the turn frame. */
export function turnCounts(turns: readonly AdmissionRow[]): { owner: number; asks: number } {
  let owner = 0;
  for (const r of turns) if (r.kind === "owner") owner += 1;
  return { owner, asks: turns.length - owner };
}

/** Same kind twice (an extra section and the frame both list delegations): one chip, counts added. */
export function mergeChips(chips: readonly QueueChip[]): QueueChip[] {
  const out: QueueChip[] = [];
  for (const c of chips) {
    const same = out.find((o) => o.kind === c.kind);
    if (!same) out.push({ ...c });
    else if (c.n !== undefined) same.n = (same.n ?? 0) + c.n;
  }
  return out;
}

/**
 * Whether the card starts compact: more than one kind waits, or the window is short and the card has
 * more than one row. A single kind in a tall window shows as before.
 */
export function autoCompact(chips: readonly QueueChip[], rows: number, short: boolean): boolean {
  return chips.length > 1 || (short && rows > 1);
}

/** 「接下来」面板 setting: "open" = 始终展开 (★), "auto" = 自动折叠 (the compact rule above). */
export type QueuePanelFold = "open" | "auto";
export const DEFAULT_QUEUE_PANEL_FOLD: QueuePanelFold = "open";
export const migrateQueuePanelFold = (raw: unknown): QueuePanelFold => (raw === "auto" ? "auto" : DEFAULT_QUEUE_PANEL_FOLD);

/** The QueuePanel `autoCompact` prop for a setting: undefined (never compact by itself) under 始终展开. */
export function queueAutoCompact(fold: QueuePanelFold, short: boolean): { short: boolean } | undefined {
  return fold === "auto" ? { short } : undefined;
}

function subscribeResize(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

/** The window is shorter than SHORT_WINDOW (false without a window: tests, SSR). */
export function useShortWindow(): boolean {
  return useSyncExternalStore(
    subscribeResize,
    () => window.innerHeight < SHORT_WINDOW,
    () => false,
  );
}

/** Agents whose compact card the owner expanded in this run. */
const opened = new Set<string>();
export const openedThisRun = (sessionId: string | undefined): boolean => !!sessionId && opened.has(sessionId);
export function setOpenedThisRun(sessionId: string | undefined, open: boolean): void {
  if (!sessionId) return;
  if (open) opened.add(sessionId);
  else opened.delete(sessionId);
}
