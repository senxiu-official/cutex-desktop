// Delegations (委托, cutex "asks") for the delegation cards, the received delegation rows and the
// open-delegations overviews: status words and glyphs, buckets and ordering, optimistic merging of
// `cutex/ask/*` events, and what a transcript alone tells (the `agent_delegate` call, wait results,
// close rows) for delegations cutex no longer has. Pure, so it is unit-tested; the live records are
// kept by lib/delegationStore. Wire names (askId, AskSummary, …) are kept as cutex sends them.
import type { AskAttemptView, AskClosed, AskDetail, AskExecution, AskHold, AskLateAnswer, AskQuestion, AskRemote, AskRequester, AskReview, AskSummary } from "../../../shared/ipc";
import { isSessionRef, parseIdRef, sameId } from "./shortIds";
import { resultDelegationId, toolArgs, toolResult } from "./taskRows";
import type { ExternalMessage, RawItem, TimelineEntry, TimelineState, TurnView } from "./timeline";

export type { AskSummary } from "../../../shared/ipc";

/** cutex capability gates. */
export const ASKS_FEATURE = "agent-asks";
export const DELEGATION_VIEWS_FEATURE = "delegation-views";

// ---------- parties ----------

/** The requesting agent's session id (stored `cutex_session_id`, view `cutexSessionId`); null for the owner. */
export function requesterSession(r: AskRequester | null | undefined): string | null {
  if (!r || r.kind !== "agent") return null;
  return r.cutexSessionId ?? r.cutex_session_id ?? null;
}

export function requesterName(r: AskRequester | null | undefined): string | null {
  if (r?.kind === "peer") return peerPartyText(r.name ?? null, r.cutexSessionId, r.label);
  return r && r.kind === "agent" ? (r.name ?? null) : null;
}

/** A requester on a paired host (peers-v2): never a local session, never the owner. */
export type PeerRequester = Extract<AskRequester, { kind: "peer" }>;
export function requesterPeer(r: AskRequester | null | undefined): PeerRequester | null {
  return r?.kind === "peer" ? r : null;
}

/** The remote id shortened like the short session ids (last 6). */
const shortRemote = (id: string) => (id.length > 12 ? `…${id.slice(-6)}` : id);

/** 「<name> @ <peer label>」 — the one spelling of an agent on another host. */
export function peerPartyText(name: string | null | undefined, remoteId: string | null | undefined, label: string): string {
  const who = name?.trim() || (remoteId ? shortRemote(remoteId) : "?");
  return `${who} @ ${label}`;
}

/** The far end of a delegation when it lives on another host: the requester (incoming) or the target (outgoing mirror). */
export function peerSideOf(d: Pick<AskSummary, "requester" | "remote" | "target" | "targetName">): { side: "requester" | "target"; peerId: string; label: string; name: string } | null {
  const r = requesterPeer(d.requester);
  if (r) return { side: "requester", peerId: r.peerId, label: r.label, name: peerPartyText(r.name ?? null, r.cutexSessionId, r.label) };
  if (d.remote) return { side: "target", peerId: d.remote.peerId, label: d.remote.label, name: peerPartyText(d.remote.targetName || d.targetName || null, d.target, d.remote.label) };
  return null;
}

/**
 * The interrupt reason of a delegation: the attempt's, else the mirror's (an outgoing mirror has no
 * local attempt; peer removal / disable / expiry is recorded on `remote`).
 */
export function interruptReasonOf(d: Partial<Pick<AskSummary, "attempt" | "remote">>): string | null {
  return d.attempt?.interruptReason ?? d.remote?.interruptReason ?? null;
}

/** What a remote sync state means, as a `delegation.remote.sync.*` key suffix; null = in sync / nothing to say. */
export function remoteSyncKey(remote: Pick<AskRemote, "syncState"> | null | undefined): "queued" | "unknown" | "unreachable" | "rejected" | "incompatible" | "outcomeUnknown" | "disabled" | "removed" | "other" | null {
  const s = remote?.syncState;
  if (!s || s === "synced") return null;
  if (s === "queued") return "queued";
  if (s === "remoteStateUnknown") return "unknown";
  if (s === "peer_unreachable" || s === "peerUnreachable") return "unreachable";
  if (s === "peer_request_incompatible" || s === "peer_unsupported" || s === "peerVersionMismatch") return "incompatible";
  if (s === "recipient_outside_boundary" || s === "peer_rate_limited" || s === "remote_credential_refused") return "rejected";
  if (s === "outcomeUnknown") return "outcomeUnknown";
  if (s === "peerDisabled" || s === "peersDisabled") return "disabled";
  if (s === "peerRemoved" || s === "removedByPeer") return "removed";
  return "other";
}

/** A late answer worth showing (metadata only; the text lives in a local artifact). */
export function lateAnswerOf(d: Pick<AskSummary, "lateAnswer">): AskLateAnswer | null {
  const l = d.lateAnswer;
  return l && (l.artifactId || l.preview) ? l : null;
}

export const isOwnerRequest = (r: AskRequester | null | undefined): boolean => r?.kind === "owner";

/** Wire state words from peers/asks; unknown values remain visible for newer daemons. */
export function peerStateKey(state: string): DelegationStatusKey | null {
  const aliases: Record<string, DelegationStatusKey> = {
    admitted: "starting", completed: "answered", targetBusy: "waitTurn",
    waitingForApproval: "pendingReview", waitingForInput: "question",
    heldByRuntime: "blocked", runtimeUnsupported: "blocked", profileSwitchPending: "blocked",
    waitingForEvent: "waitingForEvent",
  };
  if (Object.hasOwn(aliases, state)) return aliases[state]!;
  const known: readonly DelegationStatusKey[] = [
    "pendingReview", "queued", "running", "question", "answered", "interrupted",
    "failed", "rejected", "cancelled", "awaitingAcceptance", "accepted", "changesRequested",
    "abandoned", "stopped", "superseded", "paused", "blocked", "peerUnreachable",
    "peerIdentityChanged", "peerVersionMismatch", "peerUnknown",
  ];
  return known.includes(state as DelegationStatusKey) ? state as DelegationStatusKey : null;
}

// ---------- status ----------

export type DelegationStatusKey =
  | "interrupted"
  | "superseded"
  | "waitingForEvent"
  | "pendingReview"
  | "queued"
  | "queuedAt"
  | "waitTurn"
  | "paused"
  | "planMode"
  | "offline"
  | "blocked"
  | "starting"
  | "running"
  | "question"
  | "answered"
  | "ended"
  | "awaitingAcceptance"
  | "accepted"
  | "changesRequested"
  | "abandoning"
  | "abandoningOffline"
  | "stopping"
  | "stoppingOffline"
  | "abandoned"
  | "failed"
  | "rejected"
  | "cancelled"
  | "stopped"
  | "ownerStopped"
  | "runtimeRestart"
  | "outcomeUnknown"
  // peers-v2: an outgoing mirror held by its peer, or interrupted by the peer relationship
  | "peerUnreachable"
  | "peerIdentityChanged"
  | "peerVersionMismatch"
  | "peerUnknown"
  | "peerRemoved"
  | "peerDisabled"
  | "peersDisabled"
  | "removedByPeer"
  | "peerStripped";

export type StatusTone = "warn" | "muted" | "accent" | "green" | "danger" | "neutral";
/** hollow = waiting on someone; ring = stopped but can resume; pulse = running. */
export type StatusGlyph = "hollow" | "dot" | "pulse" | "check" | "cross" | "ring";

export interface DelegationStatus {
  key: DelegationStatusKey;
  tone: StatusTone;
  glyph: StatusGlyph;
  /** Queue position for `queuedAt`. */
  n?: number;
  /** The word itself in danger colour (offline / blocked) while the glyph stays quiet. */
  dangerText?: boolean;
}

export type StatusInput = Pick<AskSummary, "execution"> & Partial<Pick<AskSummary, "hold" | "review" | "closed" | "queuePosition" | "attempt" | "remote">>;

/**
 * What the desktop knows besides the ask record: the target agent's runtime (sidebar). cutex keeps
 * a running attempt `running` while the target is offline (until reconciliation / stop settlement),
 * so the record alone cannot tell that nothing runs.
 */
export interface DelegationContext {
  /** The target is known (sidebar, archived agents included) and its runtime is not online. */
  targetOffline?: boolean;
}

const TERMINAL = new Set<AskExecution>(["failed", "rejected", "cancelled"]);
/** Interrupt reasons that come from the peer relationship (the mirror is closed for good). */
const PEER_INTERRUPTS = new Set<string>(["peerRemoved", "peerDisabled", "peersDisabled", "removedByPeer", "peerStripped"]);

/**
 * A stop cutex accepted but the target has not carried out yet; the ask is still open and closes
 * when the turn ends. `abandon`: the requester abandoned a running review delegation (cutex
 * `close_ask(abandoned)` on an admitted / running attempt sets review `abandoned`, the attempt's
 * `stopRequested` and queues the stop; `closed` comes with the turn's end). `stop`: the attempt says
 * `stopRequested` (full record; list rows have it only once cutex sends it).
 */
export function stopPending(d: StatusInput): "abandon" | "stop" | null {
  if (d.closed || (d.execution !== "admitted" && d.execution !== "running")) return null;
  if (d.review === "abandoned") return "abandon";
  return d.attempt?.stopRequested === true ? "stop" : null;
}

/** The word for a hold on a queued / admitted delegation. */
function holdStatus(hold: AskHold | null | undefined, queuePosition: number | null | undefined): DelegationStatus {
  const s = (key: DelegationStatusKey, extra: Partial<DelegationStatus> = {}): DelegationStatus => ({ key, tone: "muted", glyph: "hollow", ...extra });
  if (!hold) return queuePosition && queuePosition > 1 ? s("queuedAt", { n: queuePosition }) : s("queued");
  switch (hold.reason) {
    case "targetBusy": {
      const n = hold.position ?? queuePosition ?? null;
      // First in line: only the target's own current turn is in the way.
      return n && n > 1 ? s("queuedAt", { n }) : s("waitTurn");
    }
    case "paused":
      return s(hold.by === "planMode" ? "planMode" : "paused");
    case "blocked":
      return hold.by === "runtimeDown" ? s("offline", { dangerText: true }) : s("blocked", { dangerText: true });
    case "waitingForInput":
      return { key: "question", tone: "warn", glyph: "pulse" };
    case "peerUnreachable":
    case "peerIdentityChanged":
    case "peerVersionMismatch":
      return s(hold.reason, { dangerText: true });
    case "peerUnknown":
      return s("peerUnknown");
    default:
      // heldByRuntime / runtimeUnsupported / profileSwitchPending / waitingForApproval: one word.
      return s("blocked", { dangerText: true });
  }
}

/** Status word + glyph (never colour alone) of a delegation; the table in DESIGN §4.21. */
export function delegationStatus(d: StatusInput, ctx: DelegationContext = {}): DelegationStatus {
  if (d.closed === "accepted") return { key: "accepted", tone: "green", glyph: "check" };
  const stop = stopPending(d);
  if (stop) {
    const key = stop === "abandon" ? (ctx.targetOffline ? "abandoningOffline" : "abandoning") : ctx.targetOffline ? "stoppingOffline" : "stopping";
    return { key, tone: "muted", glyph: "hollow", ...(ctx.targetOffline ? { dangerText: true } : {}) };
  }
  if (d.closed === "abandoned" || d.review === "abandoned") return { key: "abandoned", tone: "muted", glyph: "cross" };
  if (d.closed === "cancelled" && d.execution !== "failed" && d.execution !== "rejected") return { key: "cancelled", tone: "muted", glyph: "cross" };
  if (d.closed === "stopped" && d.execution !== "interrupted") {
    const reason = interruptReasonOf(d);
    return reason && PEER_INTERRUPTS.has(reason) ? { key: reason as DelegationStatusKey, tone: "neutral", glyph: "cross" } : { key: "stopped", tone: "neutral", glyph: "ring" };
  }
  // A close event can precede the refreshed execution snapshot. completed includes failures too:
  // show a neutral end until the outcome is known, never the stale running / queued state.
  if (d.closed && (d.execution === "pendingReview" || d.execution === "queued" || d.execution === "admitted" || d.execution === "running"))
    return { key: "ended", tone: "neutral", glyph: "dot" };
  switch (d.execution) {
    case "pendingReview":
      return { key: "pendingReview", tone: "warn", glyph: "hollow" };
    case "queued":
      return holdStatus(d.hold, d.queuePosition);
    case "admitted":
      return d.hold ? holdStatus(d.hold, d.queuePosition) : { key: "starting", tone: "accent", glyph: "pulse" };
    case "running":
      if (d.hold?.reason === "waitingForInput") return { key: "question", tone: "warn", glyph: "pulse" };
      // Nothing runs while the target is offline; cutex owns reconciliation / stop settlement.
      return ctx.targetOffline ? { key: "offline", tone: "muted", glyph: "hollow", dangerText: true } : { key: "running", tone: "accent", glyph: "pulse" };
    case "answered":
      if (d.review === "changesRequested") return { key: "changesRequested", tone: "muted", glyph: "ring" };
      if (d.closed) return { key: "answered", tone: "green", glyph: "check" };
      if (d.review === "awaitingAcceptance") return { key: "awaitingAcceptance", tone: "warn", glyph: "hollow" };
      if (d.review === "accepted") return { key: "accepted", tone: "green", glyph: "check" };
      return { key: "answered", tone: "green", glyph: "check" };
    case "failed":
      return { key: "failed", tone: "danger", glyph: "cross" };
    case "rejected":
      return { key: "rejected", tone: "danger", glyph: "cross" };
    case "cancelled":
      return { key: "cancelled", tone: "muted", glyph: "cross" };
    case "interrupted": {
      const reason = interruptReasonOf(d);
      if (reason === "outcomeUnknown") return { key: "outcomeUnknown", tone: "warn", glyph: "hollow" };
      if (reason && PEER_INTERRUPTS.has(reason)) return { key: reason as DelegationStatusKey, tone: "neutral", glyph: "cross" };
      if (d.closed === "stopped") return { key: "stopped", tone: "neutral", glyph: "ring" };
      return { key: reason === "ownerStopped" ? "ownerStopped" : reason === "runtimeRestart" ? "runtimeRestart" : "stopped", tone: "neutral", glyph: "ring" };
    }
  }
}

// ---------- buckets ----------

export type DelegationBucket = "needsYou" | "waiting" | "active" | "done";
export const DELEGATION_BUCKETS: DelegationBucket[] = ["needsYou", "waiting", "active", "done"];

type BucketInput = StatusInput & Pick<AskSummary, "requester"> & Partial<Pick<AskSummary, "ownerQuestions">>;

/**
 * 需要你: the owner must act (every gated delegation is reviewed by the owner in P1; a question routed
 * to the owner; an attempt whose outcome is unknown; a result awaiting the owner's acceptance).
 * 等待 / 受阻: held, waiting for a question's answer, stopped (retryable), awaiting an agent's
 * acceptance, a stop not carried out yet, running on an offline target. 进行中: admitted / running
 * without hold. 已结束: closed, answered, failed, …
 */
export function delegationBucket(d: BucketInput, ctx: DelegationContext = {}): DelegationBucket {
  if (d.closed || TERMINAL.has(d.execution)) return "done";
  if (d.execution === "pendingReview" || (d.ownerQuestions ?? 0) > 0) return "needsYou";
  if (d.execution === "interrupted") return interruptReasonOf(d) === "outcomeUnknown" ? "needsYou" : "waiting";
  if (d.execution === "answered") {
    if (d.review === "awaitingAcceptance") return isOwnerRequest(d.requester) ? "needsYou" : "waiting";
    return "done";
  }
  if (d.hold) return "waiting";
  if (d.execution === "queued") return "waiting";
  if (stopPending(d) || (d.execution === "running" && ctx.targetOffline)) return "waiting";
  return "active";
}

export const isUnfinished = (d: BucketInput): boolean => delegationBucket(d) !== "done";

/** Counts as 运行中 (header count, accent chip, run time): exactly when the status word says so. */
export function isDelegationRunning(d: StatusInput, ctx: DelegationContext = {}): boolean {
  const key = delegationStatus(d, ctx).key;
  return key === "running" || key === "question";
}

const ms = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** How long it has waited (s): from creation — `holdSince` resets on every queue move. */
export function waitSeconds(d: Pick<AskSummary, "createdAt">, now: number): number {
  return Math.max(0, Math.round((now - ms(d.createdAt)) / 1000));
}

/** Running / run time of the current attempt (s); null without the attempt's start (cutex delegation-views). */
export function attemptSeconds(attempt: AskAttemptView | null | undefined, now: number): number | null {
  const start = ms(attempt?.startedAt);
  if (!start) return null;
  const end = ms(attempt?.endedAt) || now;
  return Math.max(0, Math.round((end - start) / 1000));
}

/** Short duration: "3.3s", "12s", "4m", "1h 5m", "3d". */
export function formatSpan(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 10) return `${Math.round(s * 10) / 10}s`;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

/** The context of a row (`DelegationContext`); none = the record alone. */
export type ContextOf = (d: AskSummary) => DelegationContext;
const NO_CONTEXT: ContextOf = () => ({});

/** Waiting buckets: oldest first (longest wait on top). Active: latest start first. Done: latest end first. */
export function sortDelegations(bucket: DelegationBucket, rows: readonly AskSummary[]): AskSummary[] {
  const key = (d: AskSummary): number => {
    if (bucket === "needsYou" || bucket === "waiting") return -ms(d.createdAt);
    if (bucket === "active") return ms(d.attempt?.startedAt) || ms(d.updatedAt);
    return ms(d.closedAt) || ms(d.updatedAt);
  };
  return [...rows].sort((a, b) => key(b) - key(a));
}

/** Rows in display order: bucket by bucket, each in its own order. */
export function orderDelegations(rows: readonly AskSummary[], ctxOf: ContextOf = NO_CONTEXT): AskSummary[] {
  return DELEGATION_BUCKETS.flatMap((b) => sortDelegations(b, rows.filter((d) => delegationBucket(d, ctxOf(d)) === b)));
}

/** "Needs you" count (sidebar 任务 badge). */
export function needsYouCount(rows: readonly AskSummary[]): number {
  return rows.filter((d) => delegationBucket(d) === "needsYou").length;
}

/**
 * The time an overview row shows (s): waiting buckets = since creation; active = the attempt's run
 * time (without delegation-views: since creation); done = null (the row shows when it ended).
 */
export function rowSeconds(d: AskSummary, bucket: DelegationBucket, now: number): number | null {
  if (bucket === "done") return null;
  if (bucket === "active") return attemptSeconds(d.attempt, now) ?? waitSeconds(d, now);
  return waitSeconds(d, now);
}

/**
 * An agent's delegations for the capsule: unfinished ones by direction (display order), the most
 * recent finished ones (newest first, at most `doneLimit`) and the finished count.
 */
export function agentDelegations(byId: Record<string, AskSummary>, sessionId: string, doneLimit = 10, ctxOf: ContextOf = NO_CONTEXT): { mine: AskSummary[]; toMe: AskSummary[]; done: AskSummary[]; finished: number } {
  const mine: AskSummary[] = [];
  const toMe: AskSummary[] = [];
  const done: AskSummary[] = [];
  for (const d of Object.values(byId)) {
    const isMine = requesterSession(d.requester) === sessionId;
    if (!isMine && d.target !== sessionId) continue;
    if (!isUnfinished(d)) done.push(d);
    else (isMine ? mine : toMe).push(d);
  }
  return { mine: orderDelegations(mine, ctxOf), toMe: orderDelegations(toMe, ctxOf), done: sortDelegations("done", done).slice(0, doneLimit), finished: done.length };
}

const NOT_STARTED = new Set<AskExecution>(["pendingReview", "queued", "admitted"]);

/**
 * The queue panel's 待处理委托: delegations to this agent that have not started (review, queued,
 * admitted), by queue position, then oldest first.
 */
export function pendingForAgent(byId: Record<string, AskSummary>, sessionId: string): AskSummary[] {
  return Object.values(byId)
    .filter((d) => d.target === sessionId && !d.closed && NOT_STARTED.has(d.execution))
    .sort((a, b) => (a.queuePosition ?? Infinity) - (b.queuePosition ?? Infinity) || ms(a.createdAt) - ms(b.createdAt));
}

/**
 * The owner's commands that apply now (cutex/ask/stop | retry | close). No 停止 while a stop is
 * pending: cutex already queued it (another only queues the same stop again).
 */
export function delegationActions(d: StatusInput & { closed?: AskClosed | null }): { stop: boolean; retry: boolean; accept: boolean; abandon: boolean } {
  const open = !d.closed && !TERMINAL.has(d.execution);
  return {
    stop: open && !stopPending(d) && (d.execution === "pendingReview" || d.execution === "queued" || d.execution === "admitted" || d.execution === "running"),
    // A mirror cannot be retried across hosts (cutex remote_unsupported).
    retry: open && d.execution === "interrupted" && !d.remote,
    accept: open && d.execution === "answered" && d.review === "awaitingAcceptance",
    abandon: open && (d.execution === "interrupted" || (d.execution === "answered" && d.review === "awaitingAcceptance")),
  };
}

/**
 * The owner steered text into the delegation's turn (「加入此委托」): the answer's metadata says
 * `ownerSteered` (cutex §5.6), else the latest attempt record does (answer not captured yet).
 * Only the full record has it (`GET /v2/asks/{id}`), not the list summary or the results view.
 */
export function ownerSteeredOf(detail: Pick<AskDetail, "answer" | "attempts"> | null | undefined): boolean {
  if (!detail) return false;
  if (detail.answer?.metadata?.ownerSteered === true) return true;
  const last = detail.attempts?.[detail.attempts.length - 1] as Record<string, unknown> | undefined;
  return last?.ownerSteered === true;
}

// ---------- events (optimistic, corrected by the next refresh) ----------

export interface ProgressNote {
  text: string;
  at: string;
}

export interface DelegationRecords {
  byId: Record<string, AskSummary>;
  progress: Record<string, ProgressNote[]>;
  questions: Record<string, AskQuestion[]>;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A stored ask record (`cutex/ask/created`, `GET /v2/asks/{id}`) as a list row. */
export function summaryFromRecord(raw: unknown): AskSummary | null {
  const r = obj(raw);
  const askId = str(r?.askId);
  if (!r || !askId) return null;
  const attempts = Array.isArray(r.attempts) ? (r.attempts as AskAttemptView[]) : [];
  const last = attempts[attempts.length - 1] ?? null;
  const questions = Array.isArray(r.questions) ? (r.questions as AskQuestion[]) : [];
  return {
    askId,
    title: str(r.title) ?? "",
    requester: (obj(r.requester) as AskRequester | null) ?? { kind: "owner" },
    target: str(r.targetCutexSessionId) ?? str(r.target) ?? "",
    targetName: str(r.targetName),
    projectId: str(r.projectId),
    execution: (str(r.execution) as AskExecution | null) ?? "queued",
    hold: (obj(r.hold) as AskHold | null) ?? null,
    holdSince: str(r.holdSince),
    review: (str(r.review) as AskReview | null) ?? null,
    closed: (str(r.closed) as AskClosed | null) ?? null,
    queuePosition: num(r.queuePosition),
    attempts: typeof r.attempts === "number" ? r.attempts : attempts.length,
    answerId: str(r.answerId),
    openQuestions: questions.filter((q) => q.state === "open").length,
    ownerQuestions: questions.filter((q) => q.state === "open" && (q.route === "owner" || !!q.routedToOwnerAt)).length,
    createdAt: str(r.createdAt) ?? new Date(0).toISOString(),
    updatedAt: str(r.updatedAt) ?? str(r.createdAt) ?? new Date(0).toISOString(),
    revision: num(r.revision) ?? 0,
    attempt: last ? { n: last.n, state: last.state, turnId: last.turnId ?? null, startedAt: last.startedAt ?? null, endedAt: last.endedAt ?? null, profile: last.profile ?? null, model: last.model ?? null, activity: last.activity ?? null, interruptReason: last.interruptReason ?? null, lastError: last.lastError ?? null, ...(last.stopRequested ? { stopRequested: true } : {}) } : null,
    closedAt: str(r.closedAt),
    followUpOf: str(r.followUpOf),
    ...(num(r.hops) !== null ? { hops: num(r.hops)! } : {}),
    ...(obj(r.remote) ? { remote: obj(r.remote) as unknown as AskRemote } : {}),
    ...(obj(r.lateAnswer) ? { lateAnswer: obj(r.lateAnswer) as AskLateAnswer } : {}),
    ...(r.resultUndeliverable === true ? { resultUndeliverable: true } : {}),
  };
}

const PROGRESS_KEEP = 20;

/**
 * Apply a `cutex/ask/*` host event to the records. Returns the changed parts (null = nothing to
 * apply here; a refresh follows every event anyway). Each event reaches the host feed once per
 * session stream (requester and target), so every step is idempotent: revisions guard state,
 * progress notes and questions are de-duplicated.
 */
export function applyAskEvent(records: DelegationRecords, method: string, rawParams: unknown): Partial<DelegationRecords> | null {
  const p = obj(rawParams) ?? {};
  const askId = str(p.askId);
  const current = askId ? records.byId[askId] : undefined;
  const put = (next: AskSummary): Partial<DelegationRecords> => ({ byId: { ...records.byId, [next.askId]: next } });
  switch (method) {
    case "cutex/ask/created": {
      const s = summaryFromRecord(p.ask);
      if (!s) return null;
      const known = records.byId[s.askId];
      return known && known.revision >= s.revision ? null : put(known ? { ...known, ...s } : s);
    }
    case "cutex/ask/stateChanged": {
      // The `targetReverted` variant only says the target's history moved: the refresh tells.
      if (!current || !("execution" in p)) return null;
      const revision = num(p.revision);
      if (revision !== null && revision <= current.revision) return null;
      const attempt = obj(p.attempt) as Partial<AskAttemptView> | null;
      return put({
        ...current,
        execution: (str(p.execution) as AskExecution | null) ?? current.execution,
        hold: (obj(p.hold) as AskHold | null) ?? null,
        review: (str(p.review) as AskReview | null) ?? null,
        revision: revision ?? current.revision,
        ...(attempt ? { attempt: { ...(current.attempt ?? { n: attempt.n ?? current.attempts }), ...attempt } as AskAttemptView } : {}),
      });
    }
    case "cutex/ask/answered": {
      if (!current) return null;
      const preview = str(p.preview);
      const answerId = str(p.answerId);
      if (answerId === current.answerId && (!preview || preview === current.answerPreview)) return null;
      return put({ ...current, answerId: answerId ?? current.answerId, answerPreview: preview ?? current.answerPreview ?? null });
    }
    case "cutex/ask/closed": {
      if (!current) return null;
      const revision = num(p.revision);
      if (revision !== null && revision <= current.revision) return null;
      return put({ ...current, closed: (str(p.outcome) as AskClosed | null) ?? current.closed ?? "completed", closedAt: current.closedAt ?? new Date().toISOString(), revision: revision ?? current.revision });
    }
    case "cutex/ask/progress": {
      const text = str(p.text);
      if (!askId || !text) return null;
      const at = str(p.at) ?? "";
      const list = records.progress[askId] ?? [];
      if (list.some((n) => n.at === at && n.text === text)) return null;
      return { progress: { ...records.progress, [askId]: [...list, { text, at }].slice(-PROGRESS_KEEP) } };
    }
    case "cutex/ask/question": {
      const q = obj(p.question) as AskQuestion | null;
      const id = q ? str(q.askId) : null;
      if (!q || !id || !str(q.questionId)) return null;
      const list = records.questions[id] ?? [];
      const routed = p.routedToOwner === true ? { route: "owner" as const } : {};
      const next = { ...q, ...routed };
      const at = list.findIndex((x) => x.questionId === q.questionId);
      return { questions: { ...records.questions, [id]: at >= 0 ? list.map((x, i) => (i === at ? { ...x, ...next } : x)) : [...list, next] } };
    }
    default:
      return null;
  }
}

/** Merge a fresh list (open refresh, per-agent fetch) into the records: newer revisions win. */
export function mergeSummaries(byId: Record<string, AskSummary>, rows: readonly AskSummary[]): Record<string, AskSummary> {
  let next: Record<string, AskSummary> | null = null;
  for (const row of rows) {
    const known = byId[row.askId];
    // Equal revision: the list is authoritative for fields events don't carry (attempt, preview, …).
    if (known && known.revision > row.revision) continue;
    (next ??= { ...byId })[row.askId] = known ? { ...row, answerPreview: row.answerPreview ?? known.answerPreview ?? null } : row;
  }
  return next ?? byId;
}

// ---------- transcript ----------

const DELEGATE_TOOLS = new Set(["agent_delegate", "agent_ask"]);
const WAIT_TOOLS = new Set(["delegation_wait", "agent_wait"]);
const CLOSE_TOOLS = new Set(["delegation_close", "ask_close"]);

/** An `agent_delegate` call (or the old `agent_ask`) and what its result said. */
export interface DelegateCall {
  /** null until the result is back, or when the call was refused. */
  askId: string | null;
  title: string | null;
  brief: string | null;
  targetId: string | null;
  targetName: string | null;
  /** false: cutex returned an existing delegation for the same action. */
  created: boolean | null;
  /** The delegation's state when the call returned. */
  snapshot: Partial<AskSummary>;
}

/** A session id (full or the short `cutex.…3f9a1c` of tool results) or an agent name. */
const asParty = (ref: string | null) => (isSessionRef(ref) ? { id: ref, name: null } : { id: null, name: ref });

/** Requester view (`agent_delegate` result, `delegation_wait` `delegations[]`) → summary fields. */
function fromRequesterView(r: Record<string, unknown>): Partial<AskSummary> {
  const out: Partial<AskSummary> = {};
  const state = str(r.state);
  if (state) out.execution = state as AskExecution;
  if ("hold" in r) out.hold = (obj(r.hold) as AskHold | null) ?? null;
  if ("review" in r) out.review = (str(r.review) as AskReview | null) ?? null;
  if ("closed" in r) out.closed = (str(r.closed) as AskClosed | null) ?? null;
  const pos = num(r.queue_position);
  if (pos !== null) out.queuePosition = pos;
  const n = num(r.attempt);
  const reason = str(r.interrupt_reason);
  if (n !== null || reason) out.attempt = { n: n ?? 1, interruptReason: (reason as AskAttemptView["interruptReason"]) ?? null, activity: (obj(r.activity) as AskAttemptView["activity"]) ?? null };
  return out;
}

/** A cutex delegate call (agent_delegate / old agent_ask): cheap and pure, for renderer matching. */
export function isDelegateTool(item: RawItem): boolean {
  return item.type === "mcpToolCall" && item.server === "cutex" && DELEGATE_TOOLS.has(String(item.tool ?? ""));
}

export function delegateCallOf(item: RawItem): DelegateCall | null {
  if (!isDelegateTool(item)) return null;
  const a = toolArgs(item);
  const r = toolResult(item);
  const refused = r?.ok === false || obj(item.result)?.isError === true || item.status === "failed";
  const target = asParty(str(a.target));
  return {
    askId: refused ? null : resultDelegationId(r),
    title: str(a.title) ?? str(r?.title),
    brief: str(a.text),
    targetId: str(r?.target_id) ?? target.id,
    targetName: str(r?.target) ?? target.name,
    created: typeof r?.created === "boolean" ? r.created : null,
    snapshot: r && !refused ? fromRequesterView(r) : {},
  };
}

const isRunning = (item: RawItem) => item.status === "inProgress" || item.status === "running";

/** A finished `agent_delegate` call with a delegation id: shown as a card, never folded into a work group. */
export function isStandalone(entry: TimelineEntry): boolean {
  if (entry.kind !== "tool" || isRunning(entry.item)) return false;
  return !!delegateCallOf(entry.item)?.askId;
}

/** Of two spellings of one id, the more complete: a full id, else the longer abbreviation; ties keep `a`. */
function moreComplete(a: string, b: string): string {
  const x = parseIdRef(a);
  const y = parseIdRef(b);
  if (!x || !y || x.mode === "full") return a;
  if (y.mode === "full") return b;
  return y.hex.length > x.hex.length ? b : a;
}

/** What a transcript alone says about a delegation (cutex purges closed ones after 30 days). */
export type InferredDelegation = Partial<AskSummary> & { askId: string };

/**
 * Delegations as this requester's transcript shows them: the delegate call's result, then what
 * later `delegation_wait` results (answers, state) and close calls say. Later rows win.
 */
export function inferDelegations(entries: Iterable<TimelineEntry>): Map<string, InferredDelegation> {
  const out = new Map<string, InferredDelegation>();
  // Rows of one delegation may spell its id differently (full from an older daemon, a short
  // `ask-123456` that grows after a collision, an agent-written prefix): one entry, keyed by the
  // most complete spelling seen.
  const merge = (ref: string, patch: Partial<AskSummary>) => {
    let key = ref;
    if (!out.has(ref)) {
      const known = [...out.keys()].filter((k) => sameId(k, ref));
      if (known.length === 1) key = known[0]!;
    }
    const prev = out.get(key);
    const askId = moreComplete(key, ref);
    if (askId !== key) out.delete(key);
    out.set(askId, { ...(prev ?? { askId }), ...patch, askId });
  };
  for (const e of entries) {
    if (e.kind !== "tool" || e.item.type !== "mcpToolCall" || e.item.server !== "cutex") continue;
    const tool = String(e.item.tool ?? "");
    const call = delegateCallOf(e.item);
    if (call?.askId) {
      merge(call.askId, { title: call.title ?? call.brief ?? "", target: call.targetId ?? undefined, targetName: call.targetName, ...call.snapshot });
      continue;
    }
    const r = toolResult(e.item);
    if (WAIT_TOOLS.has(tool) && r) {
      for (const v of Array.isArray(r.delegations) ? r.delegations : Array.isArray(r.asks) ? r.asks : []) {
        const view = obj(v);
        const id = resultDelegationId(view);
        if (view && id) merge(id, fromRequesterView(view));
      }
      for (const x of Array.isArray(r.results) ? r.results : []) {
        const item = obj(x);
        const id = resultDelegationId(item);
        if (!item || !id || item.kind !== "answer") continue;
        const answer = str(item.answer);
        merge(id, {
          execution: item.status === "failed" ? "failed" : item.status === "interrupted" ? "interrupted" : "answered",
          ...(item.awaiting_acceptance === true ? { review: "awaitingAcceptance" as const } : {}),
          ...(answer ? { answerPreview: answer.slice(0, 300) } : {}),
        });
      }
    } else if (CLOSE_TOOLS.has(tool) && r && r.ok !== false && obj(e.item.result)?.isError !== true) {
      const a = toolArgs(e.item);
      const id = str(a.delegation) ?? str(a.delegation_id) ?? str(a.ask) ?? str(a.ask_id) ?? resultDelegationId(r);
      const outcome = str(a.outcome);
      if (id && outcome) merge(id, { closed: outcome === "stop" ? "stopped" : (outcome as AskClosed) });
    }
  }
  return out;
}

/**
 * A delegation as a list row when cutex has no record (purged, or not loaded yet): what the call
 * and the rest of the transcript say. Unknown times are empty strings (no wait / run time shown).
 */
export function fallbackSummary(askId: string, call: DelegateCall | null, inferred: InferredDelegation | undefined, requesterId: string | null): AskSummary {
  return {
    askId,
    title: call?.title ?? call?.brief ?? "",
    requester: requesterId ? { kind: "agent", cutexSessionId: requesterId } : { kind: "owner" },
    target: call?.targetId ?? "",
    targetName: call?.targetName ?? null,
    execution: "queued",
    attempts: 0,
    createdAt: "",
    updatedAt: "",
    revision: -1,
    ...call?.snapshot,
    ...inferred,
  };
}

// ---------- received delegation rows (view schemas cutex.delegation-*.v1) ----------

/** A delegation this agent was given (ASK event, `cutex.delegation-ask.v1`). */
export interface DelegationAskRow {
  askId: string;
  attempt: number;
  requesterId: string | null;
  requesterName: string | null;
  owner: boolean;
  /** peers-v2: the requester is an agent on this paired host (label); `requesterName` is then 「name @ label」. */
  peerLabel?: string | null;
  title: string;
  followUpOf: string | null;
  gated: boolean;
}

export function delegationAskRow(message: ExternalMessage): DelegationAskRow | null {
  if (message.schema !== "cutex.delegation-ask.v1") return null;
  const d = message.data;
  const askId = str(d.askId);
  if (!askId) return null;
  const requester = obj(d.requester) as AskRequester | null;
  return {
    askId,
    attempt: num(d.attempt) ?? 1,
    requesterId: requesterSession(requester),
    requesterName: requesterName(requester),
    owner: requester?.kind === "owner",
    ...(requester?.kind === "peer" ? { peerLabel: requester.label } : {}),
    title: str(d.title) ?? "",
    followUpOf: str(d.followUpOf),
    gated: d.gated === true,
  };
}

/** One item of an ANSWER / QUESTION batch (`cutex.delegation-results.v1`). */
export interface DelegationResultItem {
  kind: "answer" | "question" | "state";
  askId: string;
  title: string;
  targetId: string | null;
  targetName: string | null;
  status: string | null;
  state: string | null;
  questionId: string | null;
  preview: string | null;
}

export function delegationResultItems(message: ExternalMessage): DelegationResultItem[] {
  if (message.schema !== "cutex.delegation-results.v1") return [];
  const items = Array.isArray(message.data.items) ? message.data.items : [];
  return items.flatMap((x): DelegationResultItem[] => {
    const i = obj(x);
    const askId = i ? str(i.askId) : null;
    if (!i || !askId) return [];
    const kind = i.kind === "question" || i.kind === "state" ? i.kind : "answer";
    const target = obj(i.target);
    return [{ kind, askId, title: str(i.title) ?? "", targetId: str(target?.id), targetName: str(target?.name), status: str(i.status), state: str(i.state), questionId: str(i.questionId), preview: str(i.preview) }];
  });
}

/**
 * Handler side: the final reply of each finished turn that a delegation (ASK row) started, keyed by
 * that reply's entry id — it gets the 已回复 badge. The turn is recognised by its ASK input, not by
 * the attempt's turn id.
 */
export function handlerReplies(entries: readonly TimelineEntry[], turns: readonly TurnView[]): Map<string, DelegationAskRow> {
  const finished = new Set(turns.filter((t) => t.status !== "inProgress").map((t) => t.id));
  const askOf = new Map<string, DelegationAskRow>();
  const lastReply = new Map<string, string>();
  for (const e of entries) {
    if (!e.turnId) continue;
    if (e.kind === "received") {
      const row = delegationAskRow(e.message);
      if (row && !askOf.has(e.turnId)) askOf.set(e.turnId, row);
    } else if (e.kind === "agent") lastReply.set(e.turnId, e.id);
  }
  const out = new Map<string, DelegationAskRow>();
  for (const [turnId, row] of askOf) {
    const reply = lastReply.get(turnId);
    if (reply && finished.has(turnId)) out.set(reply, row);
  }
  return out;
}

/** The delegation the running turn handles (its ASK input), if any. */
export function activeDelegationAsk(timeline: TimelineState): DelegationAskRow | null {
  const turn = timeline.turns.find((t) => t.id === timeline.activeTurnId);
  for (const id of turn?.entryIds ?? []) {
    const e = timeline.entries.get(id);
    if (e?.kind === "received") {
      const row = delegationAskRow(e.message);
      if (row) return row;
    }
  }
  return null;
}

/** Where the `agent_delegate` card of a delegation is: its entry and turn (focusDelegation). */
export function delegateEntryOf(entries: Iterable<TimelineEntry>, askId: string): { entryId: string; turnId: string } | null {
  for (const e of entries) {
    // The card's call result may carry the short form (`ask-123456`) of the full `askId`.
    if (e.kind === "tool" && sameId(delegateCallOf(e.item)?.askId, askId)) return { entryId: e.id, turnId: e.turnId };
  }
  return null;
}

/** Handler side: the latest turn a delegation's ASK row started (focusDelegation on the target's timeline). */
export function askRowTurnOf(entries: Iterable<TimelineEntry>, askId: string): string | null {
  let turn: string | null = null;
  for (const e of entries) {
    if (e.kind === "received" && e.turnId && delegationAskRow(e.message)?.askId === askId) turn = e.turnId;
  }
  return turn;
}
