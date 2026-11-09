// A sidebar row's line after 回退 (cutex `cutex/session/history/revert`, r265 D4 D-6). cutex trims the thread but not the
// session resource's `activity` projection (`lastOutput` / `lastToolCall` still name the removed reply), and the live
// preview map kept the removed reply too. On a revert this desktop remembers, per agent, the newest activity time it
// had seen (`hideUpTo`) and the last message of the turns that stay (`replacement`); the resource's activity up to
// `hideUpTo` is then replaced by it (lib/activity previewFromResource). Anything newer — the next reply — shows as
// usual. Kept in localStorage (a restart re-seeds rows from the same stale projection), newest REVERT_MARKS_MAX agents.
import type { ActivityPreview } from "./activity";
import type { TimelineState } from "./timeline";

export interface RevertMark {
  /** Activity times (epoch ms) at or before this are from before the revert. */
  hideUpTo: number;
  /** What the row shows instead: the last message kept (empty text = none known; the row shows its status). */
  replacement: ActivityPreview;
}

export const REVERT_MARKS_MAX = 100;
const KEY = "cutex-desktop.revertedPreviews";
const MAX = 140;

const line = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, MAX);

/**
 * The last message of the turns before `beforeTurnId` in `timeline` (what stays after the revert), as a preview at
 * `at`. Unknown (the turn is not loaded, nothing said yet): an empty output line.
 */
export function previewOfKept(timeline: Pick<TimelineState, "turns" | "entries"> | null | undefined, beforeTurnId: string, at: number, plain: (text: string) => string = (t) => t, shownSender?: (id: string) => string | undefined): ActivityPreview {
  const empty: ActivityPreview = { kind: "output", text: "", at };
  if (!timeline) return empty;
  const index = timeline.turns.findIndex((t) => t.id === beforeTurnId);
  if (index < 0) return empty;
  for (const turn of timeline.turns.slice(0, index).reverse()) {
    for (const id of [...turn.entryIds].reverse()) {
      const entry = timeline.entries.get(id);
      if (!entry) continue;
      if (entry.kind === "agent" && line(plain(entry.text))) return { kind: "output", text: line(plain(entry.text)), at };
      if (entry.kind === "user" && line(entry.text)) return { kind: "input", text: line(entry.text), at };
      if (entry.kind === "received" && line(entry.message.text)) return { kind: "received", text: line(`${shownSender?.(entry.message.senderId) || entry.message.senderName || entry.message.senderId}: ${entry.message.text}`), at };
    }
  }
  return empty;
}

/** `marks` with `id` set (moved to the newest end), capped at `max`. */
export function putMark(marks: Map<string, RevertMark>, id: string, mark: RevertMark, max = REVERT_MARKS_MAX): Map<string, RevertMark> {
  const next = new Map(marks);
  next.delete(id);
  next.set(id, mark);
  while (next.size > max) next.delete(next.keys().next().value as string);
  return next;
}

const KINDS = new Set(["output", "input", "received"]);

/** Stored JSON (`[[id, mark], …]`, oldest first) → marks; anything malformed is skipped. */
export function parseMarks(raw: unknown, max = REVERT_MARKS_MAX): Map<string, RevertMark> {
  const out = new Map<string, RevertMark>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw.slice(-max)) {
    if (!Array.isArray(item) || typeof item[0] !== "string") continue;
    const m = item[1] as Partial<RevertMark> | null;
    const r = m?.replacement as Partial<ActivityPreview> | undefined;
    if (!m || typeof m.hideUpTo !== "number" || !r || typeof r.text !== "string" || typeof r.at !== "number" || !KINDS.has(String(r.kind))) continue;
    out.set(item[0], { hideUpTo: m.hideUpTo, replacement: { kind: r.kind as ActivityPreview["kind"], text: r.text, at: r.at } });
  }
  return out;
}

/**
 * The resource's activity seen through a revert mark: a line (output or tool) at or before `hideUpTo` is from a removed
 * turn and gives way to the kept message. `said` / `tool` are what lib/activity read from the resource.
 */
export function applyMark(said: ActivityPreview | null, tool: ActivityPreview | null, mark: RevertMark | null | undefined): { said: ActivityPreview | null; tool: ActivityPreview | null; fallback: ActivityPreview | null } {
  if (!mark) return { said, tool, fallback: null };
  const kept = mark.replacement.text.trim() ? mark.replacement : null;
  return {
    said: said && said.at > mark.hideUpTo ? said : kept,
    tool: tool && tool.at > mark.hideUpTo ? tool : null,
    fallback: mark.replacement,
  };
}

// ---------- persisted store ----------

let marks: Map<string, RevertMark> | null = null;

function current(): Map<string, RevertMark> {
  if (!marks) {
    try {
      marks = parseMarks(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "[]"));
    } catch {
      marks = new Map();
    }
  }
  return marks;
}

export function revertMarkOf(sessionId: string): RevertMark | null {
  return current().get(sessionId) ?? null;
}

/** Remember a revert of `sessionId` (cutex session ids are unique across hosts). */
export function markReverted(sessionId: string, mark: RevertMark): void {
  marks = putMark(current(), sessionId, mark);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...marks]));
  } catch {
    // not persisted
  }
}

/** Tests: forget every mark (memory only). */
export function resetRevertMarks(): void {
  marks = new Map();
}
