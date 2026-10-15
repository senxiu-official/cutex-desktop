// Handled server requests (requestUserInput wizards, approvals, elicitation) stay in the timeline
// as one row: what was asked, every option, and how it was settled. cutex keeps no handled server
// requests (only the serverRequest/resolved event), so records live in this renderer store for the
// current run only — a reload / restart loses them. Everything below `── record source ──` builds
// records from the live request / reply stream; when cutex gains a persisted interface (lead), that
// part is replaced with reading it and only the row rendering stays.
import { create } from "zustand";
import type { ServerRequestReply } from "../../../shared/ipc";
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
  requestId: string;
  /** The turn the row is placed in: the request's own turnId when it has one, else the turn that
   *  was active when this desktop saw it. */
  turnId: string | null;
  /** Unix seconds when it was settled (this desktop's clock). */
  at: number;
  /** What was asked (lib/interactions toInteraction); null when only the resolution was ever seen. */
  asked: InteractionModel | null;
  settled: InteractionSettled;
}

// ── record source ── (swap for the cutex interface once it exists)

/** The turn a pending request belongs to: its params' turnId when present, else the active turn. */
export function requestTurnId(timeline: { activeTurnId: string | null }, request: PendingRequest): string | null {
  const turnId = (request.params as { turnId?: unknown } | null | undefined)?.turnId;
  return typeof turnId === "string" && turnId ? turnId : timeline.activeTurnId;
}

/** Record of a reply this desktop sent (store.respond success). */
export function answeredRecord(request: PendingRequest, reply: ServerRequestReply, turnId: string | null, at: number): InteractionRecord {
  return { requestId: String(request.id), turnId, at, asked: toInteraction(request), settled: { kind: "answered", result: "result" in reply ? reply.result : null } };
}

/** Record of a `serverRequest/resolved` without our reply: answered elsewhere / cancelled. */
export function elsewhereRecord(request: PendingRequest, turnId: string | null, at: number): InteractionRecord {
  return { requestId: String(request.id), turnId, at, asked: toInteraction(request), settled: { kind: "elsewhere" } };
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

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
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
  // Unknown requests are answered with an error reply (the dock declines what it cannot show).
  return record.asked ? "reject" : "elsewhere";
}

/** The collapsed row's subject: what the request was about (null: none — the component falls back
 *  to a per-kind label; permissions subjects are JSON, not a readable line). */
export function rowParts(record: InteractionRecord): { subject: string | null } {
  const asked = record.asked;
  if (!asked) return { subject: null };
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
const MAX_PER_SESSION = 200;

interface InteractionLogState {
  bySession: Record<string, InteractionRecord[]>;
}

export const useInteractionLog = create<InteractionLogState>(() => ({ bySession: {} }));

export function recordsOf(sessionId: string): InteractionRecord[] {
  return useInteractionLog.getState().bySession[sessionId] ?? [];
}

/**
 * Upsert one record. An `answered` record replaces any earlier one for the same request (a
 * resolved-elsewhere row written while our reply was in flight is upgraded when the reply lands);
 * `elsewhere` never overwrites. Returns true when the store changed.
 */
export function putRecord(sessionId: string, record: InteractionRecord): boolean {
  const state = useInteractionLog.getState();
  const list = state.bySession[sessionId] ?? [];
  const at = list.findIndex((r) => r.requestId === record.requestId);
  if (at >= 0) {
    if (list[at]!.settled.kind !== "elsewhere" || record.settled.kind !== "answered") return false;
    const next = [...list];
    next[at] = record;
    useInteractionLog.setState({ bySession: { ...state.bySession, [sessionId]: next } });
    return true;
  }
  const appended = [...list, record];
  useInteractionLog.setState({ bySession: { ...state.bySession, [sessionId]: appended.slice(Math.max(0, appended.length - MAX_PER_SESSION)) } });
  return true;
}

/** Drop the records of sessions whose timeline views went away with them (openAgent's cache). */
export function retainSessions(keep: readonly string[]): void {
  const state = useInteractionLog.getState();
  const next: Record<string, InteractionRecord[]> = {};
  for (const id of keep) if (state.bySession[id]) next[id] = state.bySession[id]!;
  if (Object.keys(next).length === Object.keys(state.bySession).length) return;
  useInteractionLog.setState({ bySession: next });
}
