// Handled server requests (requestUserInput wizards, approvals, elicitation) stay in the timeline
// as one row: what was asked, every option, and how it was settled. Records come from two sources:
// the live request / reply stream of this run (below `── record source ──`), and, on a host with
// session-interaction-history-v1, the answered questions / approvals cutex saved (`savedRecord`,
// read by store hydrateInteractions), so they are still there after a reload. One identity for both:
// the runtime generation + the native request id (shared/interactionHistory interactionKey). A saved
// record upgrades a live one in place (same row, same position, an open row stays open); a later live
// reply or resolved event never overwrites a saved one. On a host without the feature only this run's
// live records exist, as before.
import { create } from "zustand";
import type { InteractionActor, InteractionHistoryRecord } from "@cutex-desktop/protocol";
import type { ServerRequestReply } from "../../../shared/ipc";
import { interactionKey } from "../../../shared/interactionHistory";
import { toInteraction, type Choice, type InteractionModel, type PendingRequest } from "./interactions";

/** How a request was settled. */
export type InteractionSettled =
  /** Answered on this desktop; `result` is the reply payload that was sent (answers / decision / form). */
  | { kind: "answered"; result: unknown }
  /**
   * Resolved without this desktop's reply — answered on another device, or cancelled / timed out
   * server-side: `serverRequest/resolved` carries no reason, so the row can only say 已在别处处理.
   */
  | { kind: "elsewhere" };

export interface InteractionRecord {
  /** interactionKey(runtimeGeneration, native id): the row's identity in its host/session view. */
  key: string;
  requestId: string;
  /** The native method (names the row when `asked` could not be rebuilt, e.g. trimmed params). */
  method?: string;
  /** The turn the row is placed in: the request's own turnId when it has one, else the turn that
   *  was active when this desktop saw it. */
  turnId: string | null;
  /** Unix seconds when it was settled (this desktop's clock). */
  at: number;
  /** What was asked (lib/interactions toInteraction); null when only the resolution was ever seen. */
  asked: InteractionModel | null;
  settled: InteractionSettled;
  /** Read from cutex's saved history (session-interaction-history-v1); a live record never replaces it. */
  saved?: boolean;
  /** Who answered (saved records); `name`: the agent's name on this host when known. */
  actor?: InteractionActor & { agentName?: string | null };
  /** Secret questions whose answer is not kept (shown as hidden, never as unanswered). */
  redacted?: readonly string[];
  /** cutex kept the approval text abbreviated (16 KiB a string): the opened row says so. */
  truncated?: boolean;
  /** The native request's itemId: a saved row is placed after that item when the 回合 has it. */
  itemId?: string | null;
}

// ── record source ── (swap for the cutex interface once it exists)

/** The turn a pending request belongs to: its params' turnId when present, else the active turn. */
export function requestTurnId(timeline: { activeTurnId: string | null }, request: PendingRequest): string | null {
  const turnId = (request.params as { turnId?: unknown } | null | undefined)?.turnId;
  return typeof turnId === "string" && turnId ? turnId : timeline.activeTurnId;
}

/** The secret questions of a requestUserInput (their answers are never kept in a record). */
function secretQuestionIds(asked: InteractionModel | null): string[] {
  return asked?.kind === "questions" ? asked.questions.filter((q) => q.isSecret).map((q) => q.id) : [];
}

/** A reply with the secret answers left out, as cutex keeps it: the ids of those answered go to `redacted`. */
function maskSecrets(result: unknown, secret: readonly string[]): { result: unknown; redacted: string[] } {
  const answers = (result as { answers?: Record<string, { answers?: unknown }> } | null)?.answers;
  if (!secret.length || !answers || typeof answers !== "object") return { result, redacted: [] };
  const kept: Record<string, unknown> = {};
  const redacted: string[] = [];
  for (const [id, entry] of Object.entries(answers)) {
    if (!secret.includes(id)) { kept[id] = entry; continue; }
    if (Array.isArray(entry?.answers) && entry.answers.length) redacted.push(id);
  }
  return { result: { ...(result as object), answers: kept }, redacted };
}

/** Record of a reply this desktop sent (store.respond success); `generation`: captured before it was sent. */
export function answeredRecord(request: PendingRequest, reply: ServerRequestReply, turnId: string | null, at: number, generation = 0): InteractionRecord {
  const asked = toInteraction(request);
  // Secret answers stay out of the record (as in cutex's saved one): only that they were answered.
  const { result, redacted } = maskSecrets("result" in reply ? reply.result : null, secretQuestionIds(asked));
  return { key: interactionKey(generation, request.id), requestId: String(request.id), method: request.method, turnId, at, asked, settled: { kind: "answered", result }, ...(redacted.length ? { redacted } : {}) };
}

/** Record of a `serverRequest/resolved` without our reply: answered elsewhere / cancelled. */
export function elsewhereRecord(request: PendingRequest, turnId: string | null, at: number, generation = 0): InteractionRecord {
  return { key: interactionKey(generation, request.id), requestId: String(request.id), method: request.method, turnId, at, asked: toInteraction(request), settled: { kind: "elsewhere" } };
}

/**
 * A saved answer from cutex (session-interaction-history-v1) as a record: what was asked rebuilt from the native
 * request (null when its params were trimmed or unreadable), the reply as forwarded, who and when.
 * `agentName`: the answering agent's name on this host, when the list has it.
 */
export function savedRecord(row: InteractionHistoryRecord, optionsV1 = false, agentName?: (id: string) => string | null | undefined): InteractionRecord | null {
  const native = row?.native;
  if (!native || (typeof native.id !== "string" && typeof native.id !== "number") || typeof native.method !== "string") return null;
  if (typeof row.runtimeGeneration !== "number") return null;
  let asked: InteractionModel | null = null;
  // `truncated`: the stored params are abbreviated, not missing (a missing flag from an earlier server: false).
  if (native.params !== undefined && native.params !== null) {
    try { asked = toInteraction({ id: native.id, method: native.method, params: native.params }, optionsV1); } catch { asked = null; }
  }
  const parsed = Date.parse(row.answeredAt);
  const actor = row.actor && typeof row.actor === "object" && typeof row.actor.kind === "string" ? row.actor : undefined;
  const itemId = (native.params as { itemId?: unknown } | null | undefined)?.itemId;
  return {
    key: interactionKey(row.runtimeGeneration, native.id),
    requestId: String(native.id),
    method: native.method,
    turnId: typeof row.turnId === "string" && row.turnId ? row.turnId : null,
    at: Number.isFinite(parsed) ? parsed / 1000 : 0,
    asked,
    settled: { kind: "answered", result: row.result ?? null },
    saved: true,
    ...(actor ? { actor: actor.kind === "agent" ? { ...actor, agentName: agentName?.(actor.cutexSessionId) ?? null } : actor } : {}),
    redacted: Array.isArray(row.redactedQuestionIds) ? row.redactedQuestionIds.filter((id): id is string => typeof id === "string") : [],
    ...(row.truncated === true ? { truncated: true } : {}),
    itemId: typeof itemId === "string" ? itemId : null,
  };
}

// ── row view (pure; the component adds i18n) ──

/** The row's symbol: question, approval granted, approval refused, or settled elsewhere. */
export type InteractionGlyph = "question" | "approve" | "reject" | "elsewhere";

/** The approval choice the reply picked (label + tone), matched against the offered choices. */
export function choiceOf(record: InteractionRecord): Choice | null {
  if (record.asked?.kind !== "approval" || record.settled.kind !== "answered") return null;
  const result = record.settled.result;
  return record.asked.choices.find((c) => c.result === result || sameJson(c.result, result)) ?? null;
}

/** Same JSON value (object key order ignored): a saved structured decision still matches its choice. */
function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  } catch {
    return false;
  }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  return value;
}

/** A question whose answer is hidden: a secret one (its answer never kept) that was answered. */
export function answerHidden(record: InteractionRecord, questionId: string): boolean {
  return !!record.redacted?.includes(questionId);
}

/** An elicitation's action ("accept" | "decline" | "cancel"), else null. */
export function elicitationAction(record: InteractionRecord): string | null {
  if (record.asked?.kind !== "elicitation" || record.settled.kind !== "answered") return null;
  const action = (record.settled.result as { action?: unknown } | null)?.action;
  return typeof action === "string" ? action : null;
}

/** The requestUserInput answers as sent: per question id the selected values (option labels or typed). */
export function questionAnswers(record: InteractionRecord): Record<string, string[]> {
  if (record.asked?.kind !== "questions" || record.settled.kind !== "answered") return {};
  const answers = (record.settled.result as { answers?: Record<string, { answers?: unknown }> } | null)?.answers ?? {};
  const out: Record<string, string[]> = {};
  for (const [id, entry] of Object.entries(answers)) out[id] = Array.isArray(entry?.answers) ? entry.answers.map(String) : [];
  return out;
}

export function glyphOf(record: InteractionRecord): InteractionGlyph {
  if (record.settled.kind === "elsewhere") return "elsewhere";
  if (record.asked?.kind === "questions") return "question";
  const choice = choiceOf(record);
  if (choice) return choice.label === "decline" || choice.label === "cancel" ? "reject" : "approve";
  const action = elicitationAction(record);
  if (action) return action === "accept" ? "approve" : "reject";
  // A saved answer whose request could not be rebuilt (trimmed params): named by its method and reply.
  if (!record.asked && record.saved && record.settled.kind === "answered") {
    if (record.method === "item/tool/requestUserInput") return "question";
    const result = record.settled.result as { decision?: unknown; permissions?: unknown } | null;
    const decision = result?.decision;
    if (decision === "decline" || decision === "cancel") return "reject";
    if (record.method === "item/permissions/requestApproval") return result?.permissions && typeof result.permissions === "object" && Object.keys(result.permissions).length ? "approve" : "reject";
    return decision !== undefined ? "approve" : "question";
  }
  // Unknown requests are answered with an error reply (the dock declines what it cannot show).
  return record.asked ? "reject" : "elsewhere";
}

/** The collapsed row's subject: what the request was about (null: none — the component falls back
 *  to a per-kind label; permissions subjects are JSON, not a readable line). */
export function rowParts(record: InteractionRecord): { subject: string | null } {
  const asked = record.asked;
  if (!asked) return { subject: record.saved && record.method ? record.method : null };
  if (asked.kind === "questions") return { subject: asked.questions[0]?.question ?? null };
  if (asked.kind === "approval") {
    if (asked.title === "permissions") return { subject: null };
    const firstLine = asked.subject?.split("\n").find((l) => l.trim());
    return { subject: firstLine?.trim() ?? null };
  }
  if (asked.kind === "elicitation") return { subject: asked.params.serverName ?? null };
  // Unknown: name the method so the row is still identifiable.
  return { subject: asked.request.method };
}

// ── store (this run only; no file / localStorage — business state belongs to cutex) ──

/** Per session, oldest first; capped so a long-running window cannot grow without bound. */
const MAX_PER_SESSION = 500;

interface InteractionLogState {
  bySession: Record<string, InteractionRecord[]>;
}

export const useInteractionLog = create<InteractionLogState>(() => ({ bySession: {} }));

export function recordsOf(sessionId: string): InteractionRecord[] {
  return useInteractionLog.getState().bySession[sessionId] ?? [];
}

/** Whether `next` replaces `known` (same request): a saved record wins over live ones and is never replaced; a
 *  live answer upgrades an 已在别处处理 row; `elsewhere` never overwrites. */
export function upgrades(known: InteractionRecord, next: InteractionRecord): boolean {
  if (known.saved) return false;
  if (next.saved) return true;
  return known.settled.kind === "elsewhere" && next.settled.kind === "answered";
}

/**
 * Upsert one record (`sessionId`: the host/session view key), by its identity (`key`). See {@link upgrades}. An
 * upgraded record keeps the earlier one's turn, so its row stays where it was. Returns the record now stored when
 * the store changed, else null.
 */
export function putRecord(sessionId: string, record: InteractionRecord): InteractionRecord | null {
  const state = useInteractionLog.getState();
  const list = state.bySession[sessionId] ?? [];
  const at = list.findIndex((r) => r.key === record.key);
  if (at >= 0) {
    const known = list[at]!;
    if (!upgrades(known, record)) return null;
    let stored = known.turnId && record.turnId !== known.turnId ? { ...record, turnId: known.turnId } : record;
    // A saved record with abbreviated text upgrading a live row: the request as this desktop saw it stays whole.
    if (record.saved && record.truncated && known.asked) stored = { ...stored, asked: known.asked, truncated: false };
    const next = [...list];
    next[at] = stored;
    useInteractionLog.setState({ bySession: { ...state.bySession, [sessionId]: next } });
    return stored;
  }
  const appended = [...list, record];
  useInteractionLog.setState({ bySession: { ...state.bySession, [sessionId]: appended.slice(Math.max(0, appended.length - MAX_PER_SESSION)) } });
  return record;
}

/** Drop the records of sessions whose timeline views went away with them (openAgent's cache). */
export function retainSessions(keep: readonly string[]): void {
  const state = useInteractionLog.getState();
  const next: Record<string, InteractionRecord[]> = {};
  for (const id of keep) if (state.bySession[id]) next[id] = state.bySession[id]!;
  if (Object.keys(next).length === Object.keys(state.bySession).length) return;
  useInteractionLog.setState({ bySession: next });
}
