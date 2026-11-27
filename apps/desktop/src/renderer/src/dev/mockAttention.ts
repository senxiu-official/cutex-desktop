// `?readstate` (preview only): the local mock host has cross-device read state (design 061, cutex
// `attention-state-v1`): one owner person with two devices — this preview, and another one driven from the console:
//   __cutexMockOtherDevice.read("ifm-dir")     the other device saw ifm-dir's newest reply
//   __cutexMockOtherDevice.dismiss("kai")      the other device closed kai's 需要你 items
//   __cutexMockOtherDevice.finish("ifm-dir")   a new reply of ifm-dir ends on the host (unread on both)
//   __cutexMockOtherDevice.start("ifm-dir")    a later turn of ifm-dir starts on the host (a failed mark turns plain)
//   __cutexMockOtherDevice.state()             the host's snapshot
// `?readstate=other`: the other device reads ifm-dir and closes the first waiting agent's items 6 s after start.
// The host starts clean (everything before it is read), then demo-done (writer) and ifm-dir (director) have unread replies (their threads' last
// turns, so reading them on sight works here). Its 需要你 items are the mock's own pending approvals, delegations in
// the 需要你 bucket and pending owner messages (read like cutex's summary does), plus a runtime error of scratch.
// Other mock hosts refuse it as a multi-person host this device is not bound on (they keep the local marks);
// `?readstate=unbound`: the local host refuses too (the 需要你 list says reads stay on this device).
// `?readstate=nofeed`: main's attentionChanged feed never goes live (the renderer re-reads every 60 s instead).
// Snapshots carry each agent's running turn (the mock sessions' runtime) and last turn start (turn/started events).
import type { DesktopApi } from "../../../shared/ipc";
import type { AttentionChange, AttentionNeed, AttentionResult, AttentionSnapshot } from "../../../shared/attention";
import type { ApprovalRecord, AskSummary } from "../../../shared/ipc";
import type { OwnerNotification } from "@cutex-desktop/protocol";
import { isPending } from "../../../shared/ownerNotify";
import { delegationReason } from "../lib/agentAttention";
import { delegationBucket } from "../lib/delegations";
import { ownerNeedReason } from "../lib/ownerNotify";

/** What the host's 需要你 is made of (the mock's own records). */
export interface MockNeedSources { approvals: readonly ApprovalRecord[] | null; asks: readonly AskSummary[] | null; notes: readonly OwnerNotification[] }

const Q = typeof location === "undefined" ? null : new URLSearchParams(location.search);
export const READ_STATE_SCENE = !!Q?.has("readstate");

interface Turn { seq: number; turnId: string; status: "completed" | "failed"; endedAt: string; token: string }
interface SourceTurn { id: string; status?: unknown; completedAt?: unknown }

const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
/** A stable 64-hex key for an occurrence (FNV-1a stretched; the mock's itemKey). */
function keyOf(text: string): string {
  let out = "";
  for (let round = 0; out.length < 64; round++) {
    let h = 0x811c9dc5 ^ round;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

const PERSON = "owner";
const EPOCH = hex(32);
const turns = new Map<string, Turn[]>();
const readThrough = new Map<string, number>();
const dismissed = new Set<string>();
const needs = new Map<string, AttentionNeed[]>();
let seq = 0;
let streamAfter = 1;
let emitChange: (change: AttentionChange) => void = () => {};
let runtimeOf: (id: string) => { activeTurnId: string | null; activeTurnObservedAt: string | null } | null = () => null;
const lastStarted = new Map<string, string>();
const runningTurn = new Map<string, string | null>();
let started = false;

const need = (agentId: string, kind: string, id: string, title: string, at: string | null): AttentionNeed => ({ kind, id, title, at, itemKey: keyOf(JSON.stringify([agentId, kind, id, at])) });
let readSources: (() => Promise<MockNeedSources>) | null = null;

/** The host's needs from the records (like cutex's needs_by_agent: approvals, delegations, owner messages). */
async function refreshNeeds(): Promise<void> {
  if (!readSources) return;
  const { approvals, asks, notes } = await readSources().catch(() => ({ approvals: null, asks: null, notes: [] }));
  const next = new Map<string, AttentionNeed[]>();
  const add = (agentId: string, n: AttentionNeed) => next.set(agentId, [...(next.get(agentId) ?? []), n]);
  const open = (asks ?? []).filter((d) => delegationBucket(d) === "needsYou");
  const reviewed = new Set(open.filter((d) => d.execution === "pendingReview").map((d) => d.askId));
  for (const a of approvals ?? []) {
    if (a.state !== "pending" || (a.kind === "ask_delivery" && typeof a.details?.askId === "string" && reviewed.has(a.details.askId))) continue;
    add(a.requesterCutexSessionId, need(a.requesterCutexSessionId, "ownerApproval", a.approvalId, a.summary ?? "", a.createdAt ?? null));
  }
  for (const d of open) add(d.target, need(d.target, delegationReason(d), d.askId, d.title ?? "", d.createdAt ?? null));
  for (const n of notes.filter(isPending)) add(n.agentId, need(n.agentId, ownerNeedReason(n), n.notificationId, n.text ?? "", n.createdAt ?? null));
  add("scratch", need("scratch", "runtimeError", "runtime-error", "Runtime error", new Date(Date.now() - 20 * 60_000).toISOString()));
  needs.clear();
  for (const [id, list] of next) needs.set(id, list);
}

function addTurn(agentId: string, turnId: string, status: "completed" | "failed", endedAt: string): boolean {
  const list = turns.get(agentId) ?? [];
  if (list.some((t) => t.turnId === turnId)) return false;
  list.push({ seq: ++seq, turnId, status, endedAt, token: hex(32) });
  turns.set(agentId, list.slice(-512));
  return true;
}

function changed(agentIds: string[]): void {
  streamAfter++;
  emitChange({ agentIds });
}

/**
 * Start the host: `agents` = the local host's agent ids; `threadTurns(id)` = that agent's thread turns (the reply to read on
 * sight must be the timeline's last turn); `emit` = an `attentionChanged` of the local host.
 */
export function startMockAttention(agents: readonly string[], threadTurns: (id: string) => readonly SourceTurn[], emit: (change: AttentionChange) => void, sources?: () => Promise<MockNeedSources>, runtime?: typeof runtimeOf, feed?: (live: boolean) => void): void {
  emitChange = emit;
  if (runtime) runtimeOf = runtime;
  // main's feed goes live once the first snapshot was read (here: right away), unless ?readstate=nofeed.
  if (READ_STATE_SCENE && Q?.get("readstate") !== "nofeed") setTimeout(() => feed?.(true), 500);
  readSources = sources ?? null;
  if (started || !READ_STATE_SCENE) return;
  started = true;
  for (const id of agents) {
    for (const t of threadTurns(id)) {
      if (t.status !== "completed" && t.status !== "failed") continue;
      const at = typeof t.completedAt === "number" ? new Date(t.completedAt * 1000).toISOString() : new Date().toISOString();
      addTurn(id, t.id, t.status, at);
    }
    // The clean start: everything before the host had read state is read.
    const list = turns.get(id);
    if (list?.length) readThrough.set(id, list.at(-1)!.seq);
  }
  // Unread after the start: writer's last two replies, ifm director's last one (idle agents with nothing waiting).
  for (const [id, n] of [["demo-done", 2], ["ifm-dir", 1]] as const) {
    const list = turns.get(id);
    if (list?.length) readThrough.set(id, list.length > n ? list[list.length - 1 - n]!.seq : 0);
  }
  if (Q?.get("readstate") === "other") setTimeout(() => { otherDevice.read("ifm-dir"); otherDevice.dismiss(otherDevice.firstWaiting() ?? ""); }, 6000);
}

/** A turn of a local agent started in the mock (its `turn/started`): the host's running turn and last start. */
export function mockAttentionTurnStarted(agentId: string, params: unknown): void {
  if (!started) return;
  const id = (params as { turn?: { id?: unknown } } | null)?.turn?.id;
  lastStarted.set(agentId, new Date().toISOString());
  runningTurn.set(agentId, typeof id === "string" ? id : null);
  changed([agentId]);
}

/** A turn of a local agent ended in the mock (its `turn/completed`): a new reply on the host, unread for the person. */
export function mockAttentionTurnEnded(agentId: string, params: unknown): void {
  if (!started) return;
  runningTurn.set(agentId, null);
  const turn = (params as { turn?: { id?: unknown; status?: unknown } } | null)?.turn;
  if (typeof turn?.id !== "string" || (turn.status !== "completed" && turn.status !== "failed")) return;
  if (addTurn(agentId, turn.id, turn.status, new Date().toISOString())) changed([agentId]);
}

/** The agent's running turn and last turn start: what the mock saw start, else its session's runtime. */
function runningOf(agentId: string): { running: { turnId: string; observedAt: string | null } | null; lastTurnStartedAt: string | null } {
  const rt = runtimeOf(agentId);
  const seen = runningTurn.get(agentId);
  const turnId = seen !== undefined ? seen : (rt?.activeTurnId ?? null);
  const observedAt = seen !== undefined ? (lastStarted.get(agentId) ?? null) : (rt?.activeTurnObservedAt ?? null);
  return { running: turnId ? { turnId, observedAt } : null, lastTurnStartedAt: lastStarted.get(agentId) ?? rt?.activeTurnObservedAt ?? null };
}

function snapshot(): AttentionSnapshot {
  const ids = new Set([...turns.keys(), ...needs.keys()]);
  let count = 0;
  const agents = [...ids].map((agentId) => {
    const list = turns.get(agentId) ?? [];
    const last = list.at(-1);
    const through = readThrough.get(agentId) ?? 0;
    const visible = (needs.get(agentId) ?? []).filter((n) => !dismissed.has(n.itemKey));
    if (visible.length) count++;
    return {
      agentId,
      unreadTurns: list.filter((t) => t.seq > through).length,
      latest: last ? { turnId: last.turnId, status: last.status, endedAt: last.endedAt, through: `${EPOCH}/${last.token}` } : null,
      ...runningOf(agentId),
      needs: visible,
    };
  });
  return { instanceId: "mock-instance-local", personKey: PERSON, cursor: { streamId: "mock-summary", after: String(streamAfter) }, agents, unlistedNeeds: [], needsYouCount: count };
}

function read(reads: readonly { agentId: string; through: string }[]): AttentionResult<{ changed: number }> {
  let n = 0;
  const affected: string[] = [];
  for (const r of reads) {
    const [epoch, token] = r.through.split("/");
    const turn = turns.get(r.agentId)?.find((t) => t.token === token);
    if (epoch !== EPOCH || !turn) return { ok: false, code: "attention_stale" };
    if ((readThrough.get(r.agentId) ?? 0) < turn.seq) {
      readThrough.set(r.agentId, turn.seq);
      n++;
      affected.push(r.agentId);
    }
  }
  if (affected.length) changed(affected);
  return { ok: true, value: { changed: n } };
}

function dismiss(items: readonly { agentId: string; itemKey: string }[]): AttentionResult<{ changed: number }> {
  let n = 0;
  const affected = new Set<string>();
  for (const i of items) {
    if (!(needs.get(i.agentId) ?? []).some((x) => x.itemKey === i.itemKey) || dismissed.has(i.itemKey)) continue;
    dismissed.add(i.itemKey);
    n++;
    affected.add(i.agentId);
  }
  if (affected.size) changed([...affected]);
  return { ok: true, value: { changed: n } };
}

const latency = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 120));

/** The local host's routes (`?readstate`); without it the host has no such routes. */
export const mockAttentionApi: Pick<DesktopApi, "attention" | "attentionRead" | "attentionDismiss"> = {
  attention: async () => {
    if (!started) return latency({ ok: false as const, code: "http_404" });
    if (Q?.get("readstate") === "unbound") return latency({ ok: false as const, code: "attention_person_binding_required" });
    await refreshNeeds();
    return latency({ ok: true as const, value: snapshot() });
  },
  attentionRead: (reads) => latency(read(reads)),
  attentionDismiss: (items) => latency(dismiss(items)),
};

/** Another mock host: a multi-person host this device is not bound on (the desktop keeps its local marks there). */
export const mockAttentionUnbound: Pick<DesktopApi, "attention" | "attentionRead" | "attentionDismiss"> = {
  attention: () => latency({ ok: false as const, code: "attention_person_binding_required" }),
  attentionRead: () => latency({ ok: false as const, code: "attention_person_binding_required" }),
  attentionDismiss: () => latency({ ok: false as const, code: "attention_person_binding_required" }),
};

/** The person's other device (console / `?readstate=other`). */
const otherDevice = {
  read(agentId: string) {
    const last = turns.get(agentId)?.at(-1);
    return last ? read([{ agentId, through: `${EPOCH}/${last.token}` }]) : null;
  },
  dismiss(agentId: string) {
    const keys = (needs.get(agentId) ?? []).map((n) => n.itemKey);
    return keys.length ? dismiss(keys.map((itemKey) => ({ agentId, itemKey }))) : null;
  },
  finish(agentId: string, status: "completed" | "failed" = "completed") {
    if (addTurn(agentId, `mock-${agentId}-${seq + 1}`, status, new Date().toISOString())) changed([agentId]);
  },
  start(agentId: string) {
    lastStarted.set(agentId, new Date().toISOString());
    runningTurn.set(agentId, `mock-${agentId}-run-${seq + 1}`);
    changed([agentId]);
  },
  state: snapshot,
  /** The first agent (by name order of ids) with 需要你 items other than a runtime error. */
  firstWaiting: () => [...needs].filter(([, list]) => list.some((n) => n.kind !== "runtimeError" && !dismissed.has(n.itemKey))).map(([id]) => id).sort()[0] ?? null,
};
if (READ_STATE_SCENE && typeof window !== "undefined") (window as unknown as { __cutexMockOtherDevice?: typeof otherDevice }).__cutexMockOtherDevice = otherDevice;
