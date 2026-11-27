// Fixed phase-1 owner routes; no arbitrary daemon request reaches the renderer.
import { paId, type PaProjectRef, type PaReminder } from "./personalAssistants";
import { asOwnerPin, type OwnerPin } from "./ownerPins";
export const PA_SCOPE_RULES_FEATURE = "personal-assistants-scope-rules-v1";
export const PA_BRIEF_FEATURE = "personal-assistants-brief-v1";
export const PA_REMINDERS_WRITE_FEATURE = "personal-assistants-reminders-write-v1";
export const OWNER_PINS_CREATE_FEATURE = "owner-pins-create-v1";
export type PaRole = "observe" | "coordinate" | "confirmForYou";
export type PaScope = { kind: "all" } | { kind: "group"; groupId: string; name: string; members: PaProjectRef[] } | { kind: "host"; instanceId: string } | { kind: "project"; ref: PaProjectRef };
export interface PaScopeRule { id: string; scope: PaScope; role: PaRole; note?: string | null }
export interface PaProjectRole { ref: PaProjectRef; role: PaRole; ruleId: string | null }
export interface PaScopeRuleSet { revision: number; rules: PaScopeRule[]; effective: PaProjectRole[] }
/** A brief run due or being written: `queued` = handed to the assistant now (r299 review fix). */
export interface PaBriefPending { runId: string; scheduledAt: string; queued: boolean }
/** `pending` / `stale`: older hosts send neither (read as null / false). `stale`: an older queued run was superseded by a newer slot without being written (cleared by a write or a schedule reset). */
export interface PaBriefView { revision: number; times: string[]; timezone: string | null; latest: { at: string; text: string; sources: string[] } | null; pending: PaBriefPending | null; stale: boolean }
export interface PaScopeSaveInput { actionId: string; expectedRevision: number; rules: PaScopeRule[] }
export interface PaBriefScheduleInput { actionId: string; expectedRevision: number; times: string[]; timezone: string | null }
export interface PaReminderCreateInput { actionId: string; at: string; message: string }
export interface OwnerPinCreateInput { actionId: string; kind: "note"; title: string; detail: string | null; agentId: string | null }
const bad = (): never => { throw new Error("invalid Personal Assistant phase-1 contract"); };
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : bad();
const text = (v: unknown, max: number): string => typeof v === "string" && v.trim() && v.length <= max ? v : bad();
const rev = (v: unknown): number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : bad();
const list = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : bad();
const nullable = (v: unknown, max: number): string | null => v === null ? null : text(v, max);
const role = (v: unknown): PaRole => v === "observe" || v === "coordinate" || v === "confirmForYou" ? v : bad();
const ref = (v: unknown): PaProjectRef => { const r = obj(v); return { instanceId: text(r.instanceId, 100), projectId: text(r.projectId, 256) }; };
function scope(v: unknown): PaScope {
  const s = obj(v);
  switch (s.kind) {
    case "all": return { kind: "all" };
    case "host": return { kind: "host", instanceId: text(s.instanceId, 100) };
    case "project": return { kind: "project", ref: ref(s.ref) };
    case "group": return { kind: "group", groupId: text(s.groupId, 100), name: text(s.name, 256), members: list(s.members, 256).map(ref) };
    default: return bad();
  }
}
function rule(v: unknown): PaScopeRule {
  const r = obj(v);
  return { id: text(r.id, 100), scope: scope(r.scope), role: role(r.role), ...(r.note === undefined ? {} : { note: r.note === "" ? "" : nullable(r.note, 4096) }) };
}
function rules(v: unknown): PaScopeRule[] {
  const r = list(v, 128).map(rule);
  if (new Set(r.map((r) => r.id)).size !== r.length) bad();
  return r;
}
const time = (v: unknown): string => typeof v === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : bad();
function zone(v: unknown): string | null {
  if (v === null) return null;
  const name = text(v, 128);
  try { new Intl.DateTimeFormat("en", { timeZone: name }); } catch { return bad(); }
  return name;
}
const date = (v: unknown): string => { const s = text(v, 80); return /T.*(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s)) ? s : bad(); };
export function paScopeRulesBody(v: PaScopeSaveInput): PaScopeSaveInput { const r = obj(v); return { actionId: text(r.actionId, 160), expectedRevision: rev(r.expectedRevision), rules: rules(r.rules) }; }
export function readPaScopeRules(v: unknown): PaScopeRuleSet {
  const r = obj(v);
  return { revision: rev(r.revision), rules: rules(r.rules), effective: list(r.effective, 256).map((v) => { const p = obj(v); return { ref: ref(p.ref), role: role(p.role), ruleId: nullable(p.ruleId, 100) }; }) };
}
export function paBriefScheduleBody(v: PaBriefScheduleInput): PaBriefScheduleInput { const r = obj(v); return { actionId: text(r.actionId, 160), expectedRevision: rev(r.expectedRevision), times: list(r.times, 24).map(time), timezone: zone(r.timezone) }; }
export function readPaBrief(v: unknown): PaBriefView {
  const r = obj(v), latest = r.latest === null ? null : obj(r.latest);
  const pending = r.pending === undefined || r.pending === null ? null : obj(r.pending);
  const stale = r.stale === undefined ? false : typeof r.stale === "boolean" ? r.stale : bad();
  return {
    revision: rev(r.revision), times: list(r.times, 24).map(time), timezone: zone(r.timezone),
    latest: latest && { at: date(latest.at), text: text(latest.text, 16 * 1024), sources: list(latest.sources, 32).map((s) => text(s, 1024)) },
    pending: pending && { runId: text(pending.runId, 200), scheduledAt: date(pending.scheduledAt), queued: typeof pending.queued === "boolean" ? pending.queued : bad() },
    stale,
  };
}
export function paReminderCreateBody(v: PaReminderCreateInput): PaReminderCreateInput { const r = obj(v); return { actionId: text(r.actionId, 160), at: date(r.at), message: text(r.message, 16 * 1024) }; }
export function readPaReminder(v: unknown): PaReminder { const r = obj(v); return { alarmId: text(r.alarmId, 200), at: date(r.at), message: text(r.message, 16 * 1024), state: text(r.state, 32) }; }
export function ownerPinCreateBody(v: OwnerPinCreateInput): OwnerPinCreateInput {
  const r = obj(v); if (r.kind !== "note") bad();
  return { actionId: text(r.actionId, 160), kind: "note", title: text(r.title, 120), detail: r.detail === "" ? null : nullable(r.detail, 2000), agentId: r.agentId === null ? null : text(r.agentId, 200) };
}
export function readCreatedOwnerPin(v: unknown): OwnerPin { const pin = asOwnerPin(v); return pin && pin.author === "owner" && pin.kind === "note" ? pin : bad(); }
export const phase1AssistantPath = (id: string) => `/v2/personal-assistants/${encodeURIComponent(paId(id))}`;
