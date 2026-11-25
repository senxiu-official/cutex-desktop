import type { Json } from "../types";
import type { SideOpenInput } from "../../../../shared/sideChat";
import type { SideQuote } from "./model";

/** `quote`: a passage for 批注追问 (index.ts), shown above the composer and sent with the owner's note; its source is
 *  `quoteTurnId`, else `turnId` (the turn the side chat forks at). `draft`: a note carried into a reopened side chat,
 *  put in the composer and never sent by itself (unlike `text`, which a new side chat sends). */
export type SideParams = { text?: string; quote?: string; quoteTurnId?: string; draft?: string; turnId?: string; lastTurnId?: string; model?: string };
// One-shot prompts stay in memory, not in the container's persisted 4 KiB state.
export type SideState = { chatId?: string; start?: string; request?: string };
const starts = new Map<string, SideParams>();
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(v) && v !== "." && v !== "..";
export function parseSideParams(raw: Json): SideParams | null {
  if (!record(raw)) return null;
  const result: SideParams = {};
  for (const name of ["turnId", "lastTurnId", "quoteTurnId"] as const) {
    if (raw[name] !== undefined) { if (!id(raw[name])) return null; result[name] = raw[name] as string; }
  }
  for (const name of ["text", "quote", "draft"] as const) {
    if (raw[name] === undefined) continue;
    if (typeof raw[name] !== "string" || new TextEncoder().encode(raw[name] as string).length > 65_536) return null;
    result[name] = raw[name] as string;
  }
  if (raw.model !== undefined) {
    if (typeof raw.model !== "string" || !raw.model.trim() || /[\u0000-\u001f\u007f]/.test(raw.model) || new TextEncoder().encode(raw.model).length > 200) return null;
    result.model = raw.model;
  }
  return result;
}
export function initSide(params: SideParams, previous: SideState | null): SideState {
  const token = crypto.randomUUID(); starts.set(token, params);
  // These are only pending UI intents, never daemon threads. Bound forgotten intents.
  if (starts.size > 256) starts.delete(starts.keys().next().value!);
  return previous?.chatId ? { chatId: previous.chatId, request: token } : { start: previous?.start ?? token };
}
export function restoreSide(raw: Json): SideState | null {
  return record(raw) && id(raw.chatId) ? { chatId: raw.chatId as string } : null;
}
export function sideStart(token?: string): SideParams { return (token && starts.get(token)) || {}; }
export function takeSideText(token?: string): string {
  const params = sideStart(token), text = params.text ?? "";
  if (token && text) starts.set(token, { ...params, text: undefined });
  return text;
}
/** The pending quote of an open intent, once (like takeSideText). */
export function takeSideQuote(token?: string): SideQuote | null {
  const params = sideStart(token), text = params.quote ?? "";
  if (!text.trim()) return null;
  if (token) starts.set(token, { ...params, quote: undefined, quoteTurnId: undefined });
  return { text, turnId: params.quoteTurnId ?? params.turnId ?? null };
}
/** The carried note of an open intent, once. */
export function takeSideDraft(token?: string): string {
  const params = sideStart(token), draft = params.draft ?? "";
  if (token && draft) starts.set(token, { ...params, draft: undefined });
  return draft;
}
/**
 * 「从 … 重开」: the new side chat's intent. What the owner was writing in the old one comes along (its quote, unless the
 * request brings a newer one, and its note); closing the old side chat clears them (review 2026-11-25 P2-1).
 */
export function reopenParams(params: SideParams, carried: { quote?: SideQuote | null; draft?: string } | null): SideParams {
  const next: SideParams = { ...params, text: undefined };
  if (!next.quote?.trim() && carried?.quote?.text.trim()) {
    next.quote = carried.quote.text;
    if (carried.quote.turnId) next.quoteTurnId = carried.quote.turnId;
  }
  if (carried?.draft?.trim()) next.draft = carried.draft;
  return next;
}
export function forkInput(params: SideParams, scope: string, model: string): SideOpenInput {
  const selectedModel = params.model?.trim() || model.trim();
  return { ...(params.turnId ? { anchorTurnId: params.turnId } : {}),
    ...(params.lastTurnId ? { lastTurnId: params.lastTurnId } : scope === "through" && params.turnId ? { lastTurnId: params.turnId } : {}),
    ...(selectedModel ? { model: selectedModel } : {}) };
}
