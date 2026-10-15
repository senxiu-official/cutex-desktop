import type { Json } from "../types";
import type { SideOpenInput } from "../../../../shared/sideChat";

export type SideParams = { text?: string; turnId?: string; lastTurnId?: string; model?: string };
// One-shot prompts stay in memory, not in the container's persisted 4 KiB state.
export type SideState = { chatId?: string; start?: string; request?: string };
const starts = new Map<string, SideParams>();
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(v) && v !== "." && v !== "..";
export function parseSideParams(raw: Json): SideParams | null {
  if (!record(raw)) return null;
  const result: SideParams = {};
  for (const name of ["turnId", "lastTurnId"] as const) {
    if (raw[name] !== undefined) { if (!id(raw[name])) return null; result[name] = raw[name] as string; }
  }
  if (raw.text !== undefined) {
    if (typeof raw.text !== "string" || new TextEncoder().encode(raw.text).length > 65_536) return null;
    result.text = raw.text;
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
export function forkInput(params: SideParams, scope: string, model: string): SideOpenInput {
  return { ...(params.turnId ? { anchorTurnId: params.turnId } : {}),
    ...(params.lastTurnId ? { lastTurnId: params.lastTurnId } : scope === "through" && params.turnId ? { lastTurnId: params.turnId } : {}),
    ...(params.model || model.trim() ? { model: params.model ?? model.trim() } : {}) };
}
