// Projects cute-codex thread history (thread/read) + live app-server notifications into a
// renderable timeline. Pure and framework-free so it can be unit-tested.
import { windowsSandboxSetupOutcomeOf, type WindowsSandboxSetupOutcome } from "../../../shared/windowsSandbox";
import type { EventEnvelope, LatestPlan, LatestTokenUsage, PendingServerRequest } from "@cutex-desktop/protocol";
import type { ApprovalsReviewer, GuardianApprovalReviewAction, GuardianApprovalReviewStatus, GuardianRiskLevel, GuardianUserAuthorization, ThreadGoal } from "@cutex-desktop/protocol/codex/v2";
import { messageImages, type MessageImage } from "../../../shared/input";
import { mergeRateLimits, type RateLimitsLike } from "./quota";
import { nextPlan } from "./planState";
import { agentMessageText, deliveryKindOf, type AgentEnvelope, type DeliveryKind } from "./agentMessages";
import type { InteractionRecord } from "./interactionLog";
import { retryNoticeOf, type RetryNotice } from "./retryNotice";

export type TurnStatus = "inProgress" | "completed" | "interrupted" | "failed";

/** Minimal structural view of the ThreadItem union we render; unknown variants pass through. */
export interface RawItem {
  type: string;
  id: string;
  [key: string]: unknown;
}

export interface ExternalMessage {
  senderId: string;
  senderName: string;
  deliveryMode: string | null;
  text: string;
  schema: string | null;
  /** Structured view data (externalInputView.data), e.g. task assignment fields. */
  data: Record<string, unknown>;
  /** The event body's `type` ("MESSAGE" | "ASK" | "ANSWER" | "QUESTION" | …; older cutex: "message", "alarm", …). */
  eventType: string | null;
  /** The event body's `source.kind` ("agent" | "service" | "owner" | …). */
  sourceKind: string | null;
  /** Agent messages v2: the structured Sender header / view facts (absent on older messages). */
  envelope?: AgentEnvelope;
}

export type TimelineEntry =
  | { kind: "user"; id: string; text: string; turnId: string; images?: MessageImage[]; /** clientUserMessageId cutex passed through (cute-codex userMessage.clientId). */ clientId?: string }
  | { kind: "agent"; id: string; text: string; turnId: string; streaming: boolean }
  | { kind: "received"; id: string; turnId: string; message: ExternalMessage }
  | { kind: "sent"; id: string; turnId: string | null; to: string; deliveryMode: string; text: string; /** Bus message id (status lookup); absent on older entries. */ messageId?: string; /** note / wake as cutex reported it (agent-messages-v2). */ deliveryKind?: DeliveryKind }
  | { kind: "tool"; id: string; turnId: string; item: RawItem }
  /** `/review`: enteredReviewMode (what is reviewed) / exitedReviewMode (the review text). */
  | { kind: "review"; id: string; turnId: string; phase: "entered" | "exited"; text: string }
  /** Plan mode's proposed plan (native `plan` item, parsed out of `<proposed_plan>`). */
  | { kind: "plan"; id: string; turnId: string; text: string; streaming: boolean }
  /** `update_plan` checklist (turn/plan/updated), one per turn, replaced on each update. */
  | { kind: "checklist"; id: string; turnId: string; explanation: string | null; steps: PlanStep[] }
  /**
   * Native `reasoning` item: raw reasoning text (`content`, models that stream it) and/or reasoning
   * summaries (`summary`), filled live by item/reasoning/* deltas. Times are when this desktop saw it
   * start / end (unix s; null from history, which carries none).
   */
  | { kind: "reasoning"; id: string; turnId: string; summary: string[]; content: string[]; streaming: boolean; startedAt: number | null; completedAt: number | null }
  /** A handled server request (question / approval / elicitation) kept as one row (lib/interactionLog). */
  | { kind: "interaction"; id: string; turnId: string; record: InteractionRecord }
  /**
   * Native's automatic approval reviewer outside a tool row: a review without a target item (network
   * access) or a `guardianWarning` no running review accounts for.
   */
  | { kind: "notice"; id: string; turnId: string; review?: AutoReview; text?: string }
  | { kind: "other"; id: string; turnId: string; item: RawItem };

/**
 * One decision of Codex's automatic approval reviewer (`item/autoApprovalReview/started|completed`,
 * [UNSTABLE] native shape). A review with a target item is shown on that tool row: the item carries it
 * as `item.autoReview` (desktop-only field, re-attached whenever the item is replaced).
 */
export interface AutoReview {
  reviewId: string;
  targetItemId: string | null;
  turnId: string;
  status: GuardianApprovalReviewStatus;
  riskLevel: GuardianRiskLevel | null;
  userAuthorization: GuardianUserAuthorization | null;
  rationale: string | null;
  action: GuardianApprovalReviewAction | null;
}

/** The review a tool item carries (see {@link AutoReview}), else null. */
export function autoReviewOf(item: RawItem): AutoReview | null {
  const review = item.autoReview as AutoReview | undefined;
  return review && typeof review.reviewId === "string" ? review : null;
}

/** An `item/autoApprovalReview/*` payload as an {@link AutoReview}, else null. */
export function autoReviewFromParams(params: Record<string, unknown>, fallbackTurnId: string | null): AutoReview | null {
  const review = params.review as { status?: unknown; riskLevel?: unknown; userAuthorization?: unknown; rationale?: unknown } | undefined;
  if (typeof params.reviewId !== "string" || !review || typeof review.status !== "string") return null;
  return {
    reviewId: params.reviewId,
    targetItemId: typeof params.targetItemId === "string" && params.targetItemId ? params.targetItemId : null,
    turnId: typeof params.turnId === "string" && params.turnId ? params.turnId : (fallbackTurnId ?? ""),
    status: review.status as GuardianApprovalReviewStatus,
    riskLevel: typeof review.riskLevel === "string" ? (review.riskLevel as GuardianRiskLevel) : null,
    userAuthorization: typeof review.userAuthorization === "string" ? (review.userAuthorization as GuardianUserAuthorization) : null,
    rationale: typeof review.rationale === "string" && review.rationale.trim() ? review.rationale.trim() : null,
    action: params.action && typeof params.action === "object" ? (params.action as GuardianApprovalReviewAction) : null,
  };
}

/** One step of the model's `update_plan` todo list (TurnPlanStep on the wire). */
export interface PlanStep {
  step: string;
  status: "pending" | "inProgress" | "completed";
}

/** The latest `update_plan` snapshot of a thread (what the status capsule's 进程 shows). */
export interface PlanSnapshot {
  threadId: string | null;
  turnId: string;
  explanation: string | null;
  steps: PlanStep[];
  /** The agent emptied its list since (lib/planState): kept, shown greyed as 已清空. */
  cleared?: boolean;
  /** The owner hid it (×) until a different non-empty snapshot arrives. */
  dismissed?: boolean;
}

export interface TurnView {
  id: string;
  status: TurnStatus;
  startedAt: number | null;
  completedAt: number | null;
  entryIds: string[];
  /** A failed turn's error (`turn.error`: message, then additionalDetails), shown after the turn
   *  (TurnErrorRow). Absent / null otherwise. */
  error?: string | null;
  /** Native is retrying the model request (`error` with willRetry): the latest attempt, shown under
   *  the running turn until the next output (delta / item) or the turn's end. */
  retry?: RetryNotice | null;
}

export interface TimelineState {
  threadId: string | null;
  turns: TurnView[];
  entries: Map<string, TimelineEntry>;
  /** Pending server requests (approvals / questions) keyed by native request id. */
  pending: Map<string, { id: string | number; method: string; params: unknown }>;
  /**
   * Requests this desktop answered whose reply is still in flight (store.respond): out of `pending`
   * already, back in if the reply fails — unless `serverRequest/resolved` removed them from here.
   */
  answering: Set<string>;
  activeTurnId: string | null;
  /** Live thread settings (model, effort, approvalPolicy, sandboxPolicy, …). */
  settings: ThreadSettingsView | null;
  /** Context usage: last-turn input tokens vs model context window. */
  contextUsage: { used: number; window: number | null } | null;
  /** Account rate limits of this agent's app-server (sparse updates merged). */
  rateLimits: RateLimitsLike | null;
  /** When the last rate-limit update arrived (unix seconds; shown as "queried at"). */
  rateLimitsObservedAt: number | null;
  /** Thread goal (`/goal`): seeded by thread/goal/get, live via thread/goal/updated|cleared. */
  goal: ThreadGoal | null;
  /**
   * Latest `update_plan` snapshot (live from turn/plan/updated). Native history has none
   * (thread/read never contains it), so after a re-bootstrap it is re-seeded (`seedPlan`) from what
   * this desktop saw on the host feed, else from cutex `latestPlan` (recovered from the rollout).
   */
  plan: PlanSnapshot | null;
  /** Last native `windowsSandbox/setupCompleted` of this agent's runtime (cutex windows-sandbox-readiness). */
  windowsSandboxSetup?: WindowsSandboxSetupOutcome | null;
  /** Automatic-reviewer decisions seen live, by reviewId (thread/read has none). */
  autoReviews?: Map<string, AutoReview>;
}

export interface ThreadSettingsView {
  model?: string | null;
  modelProvider?: string | null;
  effort?: string | null;
  /** Selected service tier (`priority` = Fast, `default` = standard, null = profile config). */
  serviceTier?: string | null;
  approvalPolicy?: unknown;
  /** Who reviews escalations (native ThreadSettings / thread resume): `auto_review` = 「自动」. */
  approvalsReviewer?: ApprovalsReviewer | null;
  sandboxPolicy?: { type?: string } | null;
  activePermissionProfile?: { id?: string } | null;
  cwd?: string | null;
  /** cute-codex CollaborationMode (`/plan`). */
  collaborationMode?: { mode?: string | null; settings?: Record<string, unknown> | null } | null;
  [key: string]: unknown;
}

export function emptyTimeline(): TimelineState {
  return { threadId: null, turns: [], entries: new Map(), pending: new Map(), answering: new Set(), activeTurnId: null, settings: null, contextUsage: null, rateLimits: null, rateLimitsObservedAt: null, goal: null, plan: null };
}

/** The `update_plan` snapshot carried by a native `turn/plan/updated` envelope, else null. */
export function planSnapshotOf(envelope: EventEnvelope): PlanSnapshot | null {
  const message = envelope.native?.message;
  if (envelope.native?.kind === "serverRequest" || message?.method !== "turn/plan/updated") return null;
  const params = (message.params ?? {}) as { threadId?: unknown; turnId?: unknown; explanation?: unknown; plan?: unknown };
  return {
    threadId: typeof params.threadId === "string" ? params.threadId : null,
    turnId: String(params.turnId ?? ""),
    explanation: typeof params.explanation === "string" ? params.explanation : null,
    steps: Array.isArray(params.plan) ? (params.plan as PlanStep[]) : [],
  };
}

/** cutex `latestPlan` (bootstrap / offline history) as a snapshot, else null. */
export function planFromLatest(latest: LatestPlan | null | undefined): PlanSnapshot | null {
  if (!latest || typeof latest.turnId !== "string" || !Array.isArray(latest.plan)) return null;
  return { threadId: latest.threadId ?? null, turnId: latest.turnId, explanation: latest.explanation ?? null, steps: latest.plan };
}

/**
 * After a re-bootstrap (agent re-opened, resync, revert), put back the kept snapshot — thread/read has
 * no plan. Only for this thread and when the timeline has no live plan yet; which snapshot (local
 * cache or cutex `latestPlan`) and whether its turn was reverted is decided by lib/planState
 * (bootPlan / planTurnGone). Returns true if seeded.
 */
export function seedPlan(state: TimelineState, plan: PlanSnapshot | null | undefined): boolean {
  if (!plan || state.plan || !state.threadId) return false;
  if (plan.threadId !== state.threadId) return false;
  state.plan = plan;
  return true;
}

/**
 * Put one handled-interaction record (lib/interactionLog) into its turn, after the entries already
 * there (records are created when the reply lands, so at that moment they are chronologically last;
 * later items append behind them). An update of an existing row keeps its position. The record's
 * turn gone (revert, history window) or unknown → not shown. Returns true if anything changed.
 */
export function insertInteraction(state: TimelineState, record: InteractionRecord): boolean {
  const id = `interaction:${record.requestId}`;
  // A record of a turn this view no longer has (reverted, outside the loaded history window) stays
  // out — never moved into whatever turn runs now. Only a record without a turn falls back to it.
  const turnId = !record.turnId ? state.activeTurnId : state.turns.some((t) => t.id === record.turnId) || record.turnId === state.activeTurnId ? record.turnId : null;
  if (!turnId) return false;
  const known = state.entries.get(id);
  if (known?.kind === "interaction" && known.record === record) return false;
  if (!state.entries.has(id)) ensureTurn(state, turnId).entryIds.push(id);
  state.entries.set(id, { kind: "interaction", id, turnId, record });
  return true;
}

/** Re-put this run's interaction rows into a freshly bootstrapped timeline (load / resync). */
export function seedInteractions(state: TimelineState, records: readonly InteractionRecord[]): boolean {
  let changed = false;
  for (const record of records) if (insertInteraction(state, record)) changed = true;
  return changed;
}

/** Context usage carried by a native `thread/tokenUsage/updated` envelope (with its thread), else null. */
export function contextUsageOf(envelope: EventEnvelope): { threadId: string | null; used: number; window: number | null } | null {
  const message = envelope.native?.message;
  if (envelope.native?.kind === "serverRequest" || message?.method !== "thread/tokenUsage/updated") return null;
  const params = (message.params ?? {}) as { threadId?: unknown; tokenUsage?: { last?: { inputTokens?: number }; modelContextWindow?: number | null } };
  if (!params.tokenUsage) return null;
  return {
    threadId: typeof params.threadId === "string" ? params.threadId : null,
    used: params.tokenUsage.last?.inputTokens ?? 0,
    window: params.tokenUsage.modelContextWindow ?? null,
  };
}

/**
 * cutex `latestTokenUsage` (bootstrap / offline history, recovered from the rollout) in the shape
 * of {@link contextUsageOf}, else null.
 */
export function contextUsageFromLatest(latest: LatestTokenUsage | null | undefined): { threadId: string | null; used: number; window: number | null } | null {
  if (!latest || typeof latest.threadId !== "string" || !latest.tokenUsage) return null;
  return {
    threadId: latest.threadId,
    used: latest.tokenUsage.last?.inputTokens ?? 0,
    window: latest.tokenUsage.modelContextWindow ?? null,
  };
}

/**
 * After a re-bootstrap, put back the context usage this desktop last saw for the thread: thread/read
 * has no token usage and the runtime only reports it at the end of a model request, so without this
 * the composer's context ring stays empty until the next turn. Returns true if seeded.
 */
export function seedContextUsage(state: TimelineState, cached: { threadId: string | null; used: number; window: number | null } | null | undefined): boolean {
  if (!cached || state.contextUsage || !state.threadId || cached.threadId !== state.threadId) return false;
  state.contextUsage = { used: cached.used, window: cached.window };
  return true;
}

/** Decode cute-codex external input (functionCallOutput name=external_event). */
export function parseExternalInput(item: RawItem): ExternalMessage | null {
  if (item.type !== "functionCallOutput" || item.name !== "external_event") return null;
  const view = item.externalInputView as { schema?: string; data?: Record<string, unknown> } | null | undefined;
  let body: { source?: { id?: string; kind?: unknown }; text?: string; type?: unknown } = {};
  // FunctionCallOutputBody = string | Array<{type:"input_text", text} | ...>
  const output = item.output;
  const outputText =
    typeof output === "string"
      ? output
      : Array.isArray(output)
        ? output
            .filter((part): part is { type: "input_text"; text: string } => part?.type === "input_text")
            .map((part) => part.text)
            .join("")
        : JSON.stringify(output ?? "");
  try {
    body = JSON.parse(outputText) as typeof body;
  } catch {
    body = { text: outputText };
  }
  const data = view?.data ?? {};
  // Agent messages: the view body (v2) or the payload after the header; the v2 Sender header is
  // returned as nvelope. Other views keep their raw text (lib/agentMessages).
  const agentView = !view?.schema || view.schema === "cutex.agent-message.v1";
  const { text, envelope } = agentMessageText(String(body.text ?? ""), agentView ? data : {});
  const senderId = String(data.senderId ?? body.source?.id ?? "unknown");
  return {
    senderId,
    senderName: String(data.senderName ?? senderId),
    deliveryMode: typeof data.deliveryMode === "string" ? data.deliveryMode : null,
    text,
    schema: view?.schema ?? null,
    data,
    eventType: typeof body.type === "string" ? body.type : null,
    sourceKind: typeof body.source?.kind === "string" ? body.source.kind : null,
    ...(envelope ? { envelope } : {}),
  };
}

const IMAGE_PARTS = new Set(["image", "localImage"]);

function userText(item: RawItem): string {
  const content = (item.content as { type: string; text?: string }[] | undefined) ?? [];
  return content
    .filter((part) => !IMAGE_PARTS.has(part.type) && part.type !== "skill" && part.type !== "mention")
    .map((part) => (part.type === "text" ? part.text ?? "" : `[${part.type}]`))
    .join("\n");
}

const TOOL_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "collabAgentToolCall",
  "imageView",
]);

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : "")) : []);

/** When a native event arrived (cutex's receive time), unix seconds. */
function eventTime(envelope: EventEnvelope): number {
  const received = Date.parse(envelope.receivedAt);
  return (Number.isFinite(received) ? received : Date.now()) / 1000;
}

/** Live reasoning text: append `delta` to part `index` of `summary` / `content` (creating the entry). */
function appendReasoning(state: TimelineState, itemId: string, turnId: string, field: "summary" | "content", index: number, delta: string, at: number): void {
  const existing = state.entries.get(itemId);
  const entry = existing?.kind === "reasoning" ? existing : { kind: "reasoning" as const, id: itemId, turnId, summary: [], content: [], streaming: true, startedAt: at, completedAt: null };
  const parts = [...entry[field]];
  while (parts.length <= index) parts.push("");
  parts[index] += delta;
  upsert(state, { ...entry, [field]: parts });
}

export function entryFromItem(item: RawItem, turnId: string, streaming = false): TimelineEntry {
  switch (item.type) {
    case "userMessage": {
      const images = messageImages((item.content as { type: string }[] | undefined) ?? []);
      const clientId = typeof item.clientId === "string" && item.clientId ? item.clientId : undefined;
      return { kind: "user", id: item.id, text: userText(item), turnId, ...(images.length ? { images } : {}), ...(clientId ? { clientId } : {}) };
    }
    case "agentMessage":
      return { kind: "agent", id: item.id, text: String(item.text ?? ""), turnId, streaming };
    case "functionCallOutput": {
      const message = parseExternalInput(item);
      if (message) return { kind: "received", id: item.id, turnId, message };
      return { kind: "other", id: item.id, turnId, item };
    }
    case "plan":
      return { kind: "plan", id: item.id, turnId, text: String(item.text ?? ""), streaming };
    case "enteredReviewMode":
    case "exitedReviewMode":
      return { kind: "review", id: item.id, turnId, phase: item.type === "enteredReviewMode" ? "entered" : "exited", text: String(item.review ?? "") };
    case "reasoning":
      return { kind: "reasoning", id: item.id, turnId, summary: strings(item.summary), content: strings(item.content), streaming, startedAt: null, completedAt: null };
    default:
      return TOOL_TYPES.has(item.type)
        ? { kind: "tool", id: item.id, turnId, item }
        : { kind: "other", id: item.id, turnId, item };
  }
}

interface RawTurn {
  id: string;
  status: TurnStatus;
  items?: RawItem[];
  startedAt?: number | null;
  completedAt?: number | null;
  error?: { message?: unknown; additionalDetails?: unknown } | null;
}

/** The text of a native `turn.error` (`TurnError`: message + optional additionalDetails); null when absent. */
export function turnErrorText(error: RawTurn["error"]): string | null {
  if (!error || typeof error !== "object") return null;
  const parts = [error.message, error.additionalDetails]
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? [...new Set(parts)].join("\n") : null;
}

/**
 * Build initial state from bootstrap `native.result` (thread/read) and
 * `cutexState.pendingServerRequests` (each `{runtimeGeneration, native: {id, method, params}}`).
 */
export function timelineFromThreadRead(result: unknown, pending: readonly PendingServerRequest[] = []): TimelineState {
  const state = emptyTimeline();
  const thread = (result as { thread?: { id?: string; turns?: RawTurn[] } } | null)?.thread;
  state.threadId = thread?.id ?? null;
  for (const turn of thread?.turns ?? []) {
    const view = ensureTurn(state, turn.id);
    view.status = turn.status;
    view.startedAt = turn.startedAt ?? null;
    view.completedAt = turn.completedAt ?? null;
    view.error = turnErrorText(turn.error);
    for (const item of turn.items ?? []) upsert(state, entryFromItem(item, turn.id));
    if (turn.status === "inProgress") state.activeTurnId = turn.id;
  }
  for (const request of pending) {
    const native = request.native;
    if (native && (typeof native.id === "string" || typeof native.id === "number") && typeof native.method === "string")
      state.pending.set(String(native.id), { id: native.id, method: native.method, params: native.params ?? {} });
  }
  return state;
}

function ensureTurn(state: TimelineState, turnId: string): TurnView {
  let turn = state.turns.find((t) => t.id === turnId);
  if (!turn) {
    turn = { id: turnId, status: "inProgress", startedAt: null, completedAt: null, entryIds: [] };
    state.turns.push(turn);
  }
  return turn;
}

function upsert(state: TimelineState, entry: TimelineEntry): void {
  if (!state.entries.has(entry.id) && entry.turnId) ensureTurn(state, entry.turnId).entryIds.push(entry.id);
  state.entries.set(entry.id, entry.kind === "tool" ? withReview(state, entry) : entry);
}

/** A tool entry with the latest review of its item attached (a replaced item loses the field). */
function withReview(state: TimelineState, entry: Extract<TimelineEntry, { kind: "tool" }>): TimelineEntry {
  let latest: AutoReview | null = null;
  for (const review of state.autoReviews?.values() ?? []) if (review.targetItemId === entry.item.id) latest = review;
  if (!latest || entry.item.autoReview === latest) return entry;
  return { ...entry, item: { ...entry.item, autoReview: latest } };
}

/** Record a review and show it: on its tool row (now or once the item arrives), else as a notice. */
function applyAutoReview(state: TimelineState, review: AutoReview): boolean {
  const reviews = (state.autoReviews ??= new Map());
  reviews.delete(review.reviewId); // keep insertion order = latest last
  reviews.set(review.reviewId, review);
  if (!review.targetItemId) {
    if (!review.turnId) return true;
    upsert(state, { kind: "notice", id: `autoReview:${review.reviewId}`, turnId: review.turnId, review });
    return true;
  }
  const entry = state.entries.get(review.targetItemId);
  if (entry?.kind === "tool") upsert(state, entry);
  return true;
}

/**
 * Apply one management event. Mutates `state` in place and returns true if anything changed
 * (callers clone shallowly for React).
 */
/** Native thread an event belongs to (cutex forwards subagent threads on the parent's stream). */
export function eventThreadId(envelope: EventEnvelope): string | null {
  const params = envelope.native?.message.params as { threadId?: unknown } | undefined;
  const fromParams = typeof params?.threadId === "string" ? params.threadId : null;
  const correlation = envelope.correlation as { threadId?: string | null } | undefined;
  return fromParams ?? correlation?.threadId ?? null;
}

/** True for a native event of another (subagent) thread than `boundThreadId`. */
export function isChildThreadEvent(envelope: EventEnvelope, boundThreadId: string | null): boolean {
  if (!envelope.native || !boundThreadId) return false;
  const tid = eventThreadId(envelope);
  return tid !== null && tid !== boundThreadId;
}

/**
 * Server requests of every thread wait in the bound thread's dock (a subagent's approvals are
 * answered there too), so the request and its `serverRequest/resolved` both belong to that timeline.
 */
export function isDockEvent(envelope: EventEnvelope): boolean {
  const native = envelope.native;
  return !!native && (native.kind === "serverRequest" || native.message.method === "serverRequest/resolved");
}

/** Output arrived again: the turn's retry notice (if any) is over. */
function clearRetry(state: TimelineState, turnId: string | null | undefined): boolean {
  const turn = state.turns.find((t) => t.id === (turnId || state.activeTurnId));
  if (!turn?.retry) return false;
  turn.retry = null;
  return true;
}

export function applyEvent(state: TimelineState, envelope: EventEnvelope): boolean {
  if (envelope.native) {
    const message = envelope.native.message;
    const params = (message.params ?? {}) as Record<string, unknown>;
    if (envelope.native.kind === "serverRequest" && message.id !== undefined) {
      state.pending.set(String(message.id), { id: message.id, method: message.method, params });
      return true;
    }
    const retryCleared = message.method.startsWith("item/") && clearRetry(state, typeof params.turnId === "string" ? params.turnId : null);
    switch (message.method) {
      case "turn/started": {
        const turn = params.turn as RawTurn;
        const view = ensureTurn(state, turn.id);
        view.status = "inProgress";
        view.startedAt = turn.startedAt ?? Date.now() / 1000;
        state.activeTurnId = turn.id;
        return true;
      }
      case "turn/completed": {
        const turn = params.turn as RawTurn;
        const view = ensureTurn(state, turn.id);
        view.status = turn.status;
        view.completedAt = turn.completedAt ?? Date.now() / 1000;
        // A final `error` (willRetry false) may have set it already; turn/completed's own wins.
        view.error = turnErrorText(turn.error) ?? (turn.status === "failed" ? (view.error ?? null) : null);
        view.retry = null;
        if (state.activeTurnId === turn.id) state.activeTurnId = null;
        for (const id of view.entryIds) {
          const entry = state.entries.get(id);
          if ((entry?.kind === "agent" || entry?.kind === "plan") && entry.streaming) state.entries.set(id, { ...entry, streaming: false });
          if (entry?.kind === "reasoning" && entry.streaming) state.entries.set(id, { ...entry, streaming: false, completedAt: entry.startedAt === null ? null : view.completedAt });
        }
        return true;
      }
      case "item/started":
      case "item/completed": {
        const item = params.item as RawItem;
        const turnId = String(params.turnId ?? state.activeTurnId ?? "");
        const started = message.method === "item/started";
        const next = entryFromItem(item, turnId, started);
        if (next.kind === "reasoning") {
          // Keep what the deltas built when the item arrives without text; time it as seen here.
          const prev = state.entries.get(item.id);
          const live = prev?.kind === "reasoning" ? prev : null;
          const at = eventTime(envelope);
          upsert(state, {
            ...next,
            summary: next.summary.some(Boolean) ? next.summary : (live?.summary ?? []),
            content: next.content.some(Boolean) ? next.content : (live?.content ?? []),
            startedAt: live?.startedAt ?? (started ? at : null),
            completedAt: started ? null : live?.startedAt != null ? at : null,
          });
          return true;
        }
        upsert(state, next);
        return true;
      }
      case "item/reasoning/summaryPartAdded":
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const field = message.method === "item/reasoning/textDelta" ? "content" : "summary";
        const index = Number(field === "summary" ? params.summaryIndex : params.contentIndex) || 0;
        const delta = message.method === "item/reasoning/summaryPartAdded" ? "" : String(params.delta ?? "");
        appendReasoning(state, String(params.itemId), String(params.turnId ?? state.activeTurnId ?? ""), field, index, delta, eventTime(envelope));
        return true;
      }
      case "item/agentMessage/delta": {
        const id = String(params.itemId);
        const existing = state.entries.get(id);
        const delta = String(params.delta ?? "");
        if (existing?.kind === "agent") state.entries.set(id, { ...existing, text: existing.text + delta });
        else upsert(state, { kind: "agent", id, text: delta, turnId: String(params.turnId ?? ""), streaming: true });
        return true;
      }
      case "item/plan/delta": {
        const id = String(params.itemId);
        const existing = state.entries.get(id);
        const delta = String(params.delta ?? "");
        if (existing?.kind === "plan") state.entries.set(id, { ...existing, text: existing.text + delta });
        else upsert(state, { kind: "plan", id, text: delta, turnId: String(params.turnId ?? ""), streaming: true });
        return true;
      }
      case "turn/plan/updated": {
        const plan = planSnapshotOf(envelope);
        if (!plan) return false;
        state.plan = nextPlan(state.plan, { ...plan, threadId: plan.threadId ?? state.threadId });
        upsert(state, { kind: "checklist", id: `checklist:${plan.turnId}`, turnId: plan.turnId, explanation: plan.explanation, steps: plan.steps });
        return true;
      }
      case "error": {
        // willRetry: native retries the request (StreamError, "Reconnecting... 3/5") — a transient
        // notice. Otherwise the turn's final error: turn/completed (failed) carries the same text, kept
        // here too in case that never arrives (runtime gone).
        const turnId = typeof params.turnId === "string" && params.turnId ? params.turnId : state.activeTurnId;
        if (!turnId) return false;
        const view = ensureTurn(state, turnId);
        if (params.willRetry === true) {
          view.retry = retryNoticeOf(params.error);
          return true;
        }
        view.retry = null;
        view.error = turnErrorText(params.error as RawTurn["error"]) ?? view.error ?? null;
        return true;
      }
      case "serverRequest/resolved": {
        const key = String(params.requestId);
        // Answered while our reply was in flight (another client, or ours landed): a failing reply must not put it back.
        state.answering.delete(key);
        return state.pending.delete(key);
      }
      case "item/autoApprovalReview/started":
      case "item/autoApprovalReview/completed": {
        const review = autoReviewFromParams(params, state.activeTurnId);
        return review ? applyAutoReview(state, review) : false;
      }
      case "guardianWarning": {
        // The reviewer's one-line summary of a decision its review events already show; kept only
        // when no review of the running turn is in progress (another reviewer message).
        const turnId = state.activeTurnId;
        const text = typeof params.message === "string" ? params.message.trim() : "";
        if (!turnId || !text) return false;
        for (const review of state.autoReviews?.values() ?? []) if (review.turnId === turnId && review.status === "inProgress") return false;
        const id = `guardianWarning:${turnId}:${text}`;
        if (state.entries.has(id)) return false;
        upsert(state, { kind: "notice", id, turnId, text });
        return true;
      }
      case "thread/goal/updated": {
        state.goal = (params.goal as ThreadGoal | undefined) ?? state.goal;
        return true;
      }
      case "thread/goal/cleared": {
        if (!state.goal) return false;
        state.goal = null;
        return true;
      }
      case "thread/settings/updated": {
        state.settings = (params.threadSettings as ThreadSettingsView) ?? state.settings;
        return true;
      }
      case "thread/tokenUsage/updated": {
        const usage = contextUsageOf(envelope);
        if (!usage) return false;
        state.contextUsage = { used: usage.used, window: usage.window };
        return true;
      }
      case "windowsSandbox/setupCompleted": {
        const outcome = windowsSandboxSetupOutcomeOf(params);
        if (!outcome) return false;
        state.windowsSandboxSetup = outcome;
        return true;
      }
      case "account/rateLimits/updated": {
        const update = params.rateLimits as RateLimitsLike | undefined;
        if (!update) return false;
        state.rateLimits = mergeRateLimits(state.rateLimits, update);
        const received = Date.parse(envelope.receivedAt);
        state.rateLimitsObservedAt = Math.round((Number.isFinite(received) ? received : Date.now()) / 1000);
        return true;
      }
      default:
        return retryCleared;
    }
  }
  if (envelope.cutex) {
    const { method, params } = envelope.cutex;
    if (method === "cutex/agentBus/messageSent" && params.fromCutexSessionId === envelope.cutexSessionId) {
      const messageId = String(params.messageId);
      const id = `sent:${messageId}`;
      const kind = typeof params.deliveryKind === "string" ? deliveryKindOf(params.deliveryKind) : null;
      const entry: TimelineEntry = {
        kind: "sent",
        id,
        turnId: state.activeTurnId,
        to: String(params.toCutexSessionId),
        deliveryMode: String(params.deliveryMode ?? ""),
        text: String((typeof params.body === "string" ? params.body : params.content) ?? ""),
        messageId,
        ...(kind ? { deliveryKind: kind } : {}),
      };
      if (entry.turnId) upsert(state, entry);
      else state.entries.set(id, entry);
      return true;
    }
  }
  return false;
}

/** Flatten to display order. */
export function orderedEntries(state: TimelineState): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const turn of state.turns) {
    for (const id of turn.entryIds) {
      const entry = state.entries.get(id);
      if (entry) out.push(entry);
    }
  }
  return out;
}
