// What each agent wants from the owner (sidebar v2 status, the 需要你 strip above the composer):
// needs-you reasons gathered from what the store already knows (pending server requests of the
// agents opened recently, owner approvals, delegations in the 需要你 bucket), the done / failed turn
// marks (lib/turnUnread), and one display signal per agent. Pure, so it is unit-tested.
import type { OwnerNotification } from "@cutex-desktop/protocol";
import type { ApprovalRecord, AskSummary } from "../../../shared/ipc";
import { isPending } from "../../../shared/ownerNotify";
import { delegationBucket } from "./delegations";
import { ownerNeedReason } from "./ownerNotify";
import { rowKey, type AgentRow } from "./sidebar";
import type { TurnMark, TurnMarks } from "./turnUnread";

/**
 * Why an agent needs the owner: `confirm` a pending approval of a command / file change (native
 * request), `question` a question to answer (native request or a delegation's owner question),
 * `approval` an owner approval (cutex owner-approvals), `acceptance` a delegation result awaiting
 * the owner's acceptance (待验收), `review` a gated delegation waiting for the owner (待审核),
 * `check` a delegation whose outcome is unknown (待确认), `ownerMessage` an agent → owner message
 * not seen yet (owner-notify), `ownerReply` one that waits for the owner's reply. Notices cutex wrote
 * itself (owner-notify origin system) are records only and never a reason.
 */
export type NeedsYouReason = "confirm" | "question" | "approval" | "acceptance" | "review" | "check" | "ownerMessage" | "ownerReply";

export interface NeedsYou {
  count: number;
  /** Distinct reasons, in the order they were found. */
  reasons: NeedsYouReason[];
  /** Delegations (askId) behind it, oldest first. */
  askIds: string[];
  /** Pending owner-notify messages behind it, oldest first (absent when none). */
  notificationIds?: string[];
}

export interface NeedsYouInput {
  /** Pending native server-request methods per agent (agents whose timeline is loaded). */
  pending?: Readonly<Record<string, readonly string[]>>;
  approvals?: readonly ApprovalRecord[] | null;
  delegations?: readonly AskSummary[] | null;
  /** owner-notify records (any state; only pending ones count). */
  ownerNotes?: readonly OwnerNotification[] | null;
}

const QUESTION_METHODS = new Set(["item/tool/requestUserInput", "mcpServer/elicitation/request"]);

export function pendingReason(method: string): NeedsYouReason {
  return QUESTION_METHODS.has(method) ? "question" : "confirm";
}

/** The 需要你 reason of a delegation in that bucket (its target agent is the one to look at). */
export function delegationReason(d: AskSummary): NeedsYouReason {
  if ((d.ownerQuestions ?? 0) > 0) return "question";
  if (d.execution === "pendingReview") return "review";
  if (d.execution === "interrupted") return "check";
  return "acceptance";
}

/** Needs-you per agent id (only agents with at least one item). */
export function needsYouByAgent(input: NeedsYouInput): Map<string, NeedsYou> {
  const out = new Map<string, NeedsYou>();
  const add = (id: string, reason: NeedsYouReason, askId?: string, notificationId?: string) => {
    const n = out.get(id) ?? { count: 0, reasons: [], askIds: [] };
    n.count++;
    if (!n.reasons.includes(reason)) n.reasons.push(reason);
    if (askId) n.askIds.push(askId);
    if (notificationId) n.notificationIds = [...(n.notificationIds ?? []), notificationId];
    out.set(id, n);
  };
  for (const [id, methods] of Object.entries(input.pending ?? {})) for (const m of methods) add(id, pendingReason(m));
  for (const a of input.approvals ?? []) if (a.state === "pending") add(a.requesterCutexSessionId, "approval");
  const asks = [...(input.delegations ?? [])].filter((d) => delegationBucket(d) === "needsYou").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const d of asks) add(d.target, delegationReason(d), d.askId);
  const notes = [...(input.ownerNotes ?? [])].filter(isPending).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const r of notes) add(r.agentId, ownerNeedReason(r), undefined, r.notificationId);
  return out;
}

/**
 * One display state per agent, most urgent first: needs-you (amber), running (ring + elapsed), error
 * (runtime error, or the last turn failed and wasn't seen), done (a finished turn not seen yet),
 * offline (grey), idle (nothing shown), unknown (not confirmed yet: dimmed, 「连接中」).
 */
export type AgentSignal = "needsYou" | "running" | "error" | "done" | "offline" | "idle" | "unknown";

export function agentSignal(row: Pick<AgentRow, "status">, needs: NeedsYou | undefined, mark: TurnMark | undefined): AgentSignal {
  if (row.status === "needsInput" || (needs?.count ?? 0) > 0) return "needsYou";
  if (row.status === "running") return "running";
  if (row.status === "error" || mark?.failed) return "error";
  if (mark) return "done";
  return row.status === "offline" ? "offline" : row.status === "unknown" ? "unknown" : "idle";
}

/** The running ring: a running signal, or a turn in the snapshot of a row confirmed online (never a stale / offline one). */
export function showsRunningRing(signal: AgentSignal, session: Pick<AgentRow["session"], "runtime">): boolean {
  return signal === "running" || (signal !== "offline" && signal !== "unknown" && !!session.runtime.activeTurnId);
}

/** Signals that keep a sidebar row in full and put a chip in the 需要你 strip. */
export function wantsOwner(signal: AgentSignal): boolean {
  return signal === "needsYou" || signal === "error" || signal === "done";
}

export interface AttentionChip {
  id: string;
  /** The row key (`rowKey`: host + id in a multi-host list). */
  key: string;
  /** The agent's host (rows of a multi-host list; undefined: the focus host). */
  hostId?: string;
  name: string;
  signal: "needsYou" | "error" | "done";
  /** needs-you: the reason when there is only one kind; null = several (「需要你 ×N」). */
  reason: NeedsYouReason | null;
  count: number;
  /** The first delegation behind it (its #N tag), if any. */
  askId: string | null;
  /** For ordering: when the done / failed turn ended (needs-you chips: 0). */
  at: number;
}

const CHIP_RANK = { needsYou: 0, error: 1, done: 2 } as const;

/** The 需要你 strip: every agent that wants the owner except `exclude` (the open one), most urgent first. */
/**
 * Chips of the 需要你 strip. `signals` / `needs` / `exclude` are by row key (`rowKey`: the bare id for
 * rows without a host); `marks`: the focus host's marks by id, or a row's own mark (multi-host lists).
 */
export function attentionChips(rows: readonly AgentRow[], signals: ReadonlyMap<string, AgentSignal>, needs: ReadonlyMap<string, NeedsYou>, marks: TurnMarks | ((row: AgentRow) => TurnMark | undefined), exclude: string | null): AttentionChip[] {
  const markOf = typeof marks === "function" ? marks : (row: AgentRow) => marks[row.id];
  const chips: AttentionChip[] = [];
  for (const row of rows) {
    const key = rowKey(row);
    const signal = signals.get(key);
    if (key === exclude || !signal || !wantsOwner(signal)) continue;
    const n = needs.get(key);
    const s = signal as AttentionChip["signal"];
    chips.push({
      id: row.id,
      key,
      ...(row.hostId !== undefined ? { hostId: row.hostId } : {}),
      name: row.name,
      signal: s,
      reason: s === "needsYou" ? (n && n.reasons.length === 1 ? n.reasons[0]! : n ? null : "confirm") : null,
      count: s === "needsYou" ? Math.max(1, n?.count ?? 0) : 1,
      askId: s === "needsYou" ? (n?.askIds[0] ?? null) : null,
      at: markOf(row)?.at ?? 0,
    });
  }
  return chips.sort((a, b) => CHIP_RANK[a.signal] - CHIP_RANK[b.signal] || b.at - a.at || a.name.localeCompare(b.name));
}

/** When the running turn started (ms; cutex `activeTurnObservedAt`), else null. */
export function runningSince(row: AgentRow): number | null {
  const at = row.session.runtime.activeTurnObservedAt ? Date.parse(row.session.runtime.activeTurnObservedAt) : NaN;
  return Number.isFinite(at) ? at : null;
}

/** Elapsed time for a running row: "8s", "4m", "1h05", "2d". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  return `${Math.floor(s / 86400)}d`;
}
