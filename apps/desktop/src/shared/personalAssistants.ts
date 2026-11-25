// 个人助理 (Personal Assistants, cutex r295 `personal-assistants-local-v1`; updated recurring templates, qualified project
// refs and owner views): the owner's Management contract (cutex src/management/v2/personal_assistants.rs, contract v4).
// Shared by main (paths, request bodies checked before they leave the app, replies checked before the renderer sees
// them) and the renderer (types). The routes:
//   GET  /v2/personal-assistants                       list (cursor = last id, limit 1–100; updated rows carry availability)
//   POST /v2/personal-assistants                       create {actionId, config}
//   GET  /v2/personal-assistants/{id}                  detail view
//   PATCH /v2/personal-assistants/{id}                 {actionId, expectedRevision, change}
//   GET  /v2/personal-assistants/{id}/agenda           date, one cursor per source, limit
//   GET  /v2/personal-assistants/{id}/audit            newest first (cursor = seq)
//   GET  /v2/personal-assistants/{id}/requests[/{rid}] r295 oldest first; updated newest first, `state` (cursor = seq)
//   POST …/requests/{rid}/confirm | cancel
//   GET  /v2/personal-assistants/requests              updated owner query: instanceId+projectId and/or Director seat
//   GET  …/{id}/notes                                  updated coordination notes (q, cursor = last key)
//   GET|POST …/{id}/templates, GET|PUT …/templates/{k}  updated 定期任务 (create / re-confirm, resume, change)
//   POST …/templates/{k}/pause | cancel, GET …/templates/{k}/runs (newest first, cursor = sequence)
//   GET|PUT|DELETE …/{id}/calendar                     updated read-only calendar snapshot the owner imports
// updated announces each committed change as the host event `cutex/personalAssistant/changed` {assistantId, areas,
// requestId?}; r295 announces nothing (the renderer reads again on focus, reconnection and while a page is open).

/** cutex capability (features: `personalAssistantsLocalV1`). */
export const PERSONAL_ASSISTANTS_FEATURE = "personal-assistants-local-v1";
/** updated recurring Director templates (定期任务) and the calendar snapshot. */
export const PA_RECURRING_FEATURE = "personal-assistants-recurring-v1";
/** updated `projectRefs` / `scopedSettings` ({instanceId, projectId}). */
export const PA_QUALIFIED_REFS_FEATURE = "personal-assistants-qualified-project-refs-v1";
/** updated notes, list rows with availability, newest-first requests, the owner request query and change events. */
export const PA_OWNER_VIEWS_FEATURE = "personal-assistants-owner-views-v1";
/**
 * Projects of other hosts in an assistant's set. Not advertised yet: updated sends only the boolean map entry
 * `personalAssistantsCrossHostScopeV1: false`; this list name follows the other features (to be confirmed with cutex).
 */
export const PA_CROSS_HOST_FEATURE = "personal-assistants-cross-host-scope-v1";
/** updated host event after a committed change. */
export const PA_CHANGED_EVENT = "cutex/personalAssistant/changed";
export const PA_PATH = "/v2/personal-assistants";
/** cutex page bounds. */
export const PA_PAGE_MAX = 100;
export const PA_NAME_MAX = 80;
export const PA_PROJECTS_MAX = 256;
/** cutex refuses request bodies above this (`body_too_large`) … */
export const PA_BODY_MAX = 64 * 1024;
/** … except a calendar import (updated review addendum: up to 1 MiB and 1,000 events). */
export const PA_CALENDAR_BODY_MAX = 1024 * 1024;
export const PA_CALENDAR_EVENTS_MAX = 1000;
/** Byte limits of a snapshot's texts (cutex counts UTF-8 bytes). */
export const PA_CALENDAR_LIMITS = { source: 160, id: 100, title: 512 } as const;
export const PA_NOTE_QUERY_MAX = 256;

export type PaTier = "inbox" | "coordinator" | "projectAdmin" | "operational";
export const PA_TIERS: readonly PaTier[] = ["inbox", "coordinator", "projectAdmin", "operational"];
export type PaOperation = "liveServices" | "kitActivation" | "publishing" | "destructive";
export const PA_OPERATIONS: readonly PaOperation[] = ["liveServices", "kitActivation", "publishing", "destructive"];

export interface PaGrants {
  tier: PaTier;
  operations: PaOperation[];
  fullOwner: boolean;
}
/** A project of some host, the way an assistant refers to it. */
export interface PaProjectRef {
  instanceId: string;
  projectId: string;
}
export interface PaConfig {
  name: string;
  /** The Profile (or provider selector) chosen at creation; the session's current one is `activeProfile`. */
  profile: string;
  homeInstanceId: string;
  projectIds: string[];
  /** updated: the same set as {instance, project} (sent only to hosts with qualified refs; must match `projectIds`). */
  projectRefs?: PaProjectRef[];
}
export interface PaAssistant {
  id: string;
  revision: number;
  config: PaConfig;
  grants: PaGrants;
  coordinationProjectId: string;
  /** null while provisioning. */
  sessionId: string | null;
  enabled: boolean;
}
export interface PaOverlap {
  assistantId: string;
  name: string;
  projectId: string;
}
export type PaAvailability = "ready" | "provisioning" | "runtimeUnsupported" | "disabled" | "sessionMissing" | "sessionInactive";
export interface PaCapabilities {
  localDirectorRequests?: boolean;
  agenda?: boolean;
  requiresHandoffConfirmation?: boolean;
  ownerOperationDelegation?: boolean;
  recurringDirectorTemplates?: boolean;
  readOnlyCalendarSnapshot?: boolean;
  qualifiedProjectRefs?: boolean;
  crossHostProjectScope?: boolean;
}
/** Detail / create / update reply. */
export interface PaView {
  assistant: PaAssistant;
  overlaps: PaOverlap[];
  moreOverlaps: boolean;
  /** An availability this app does not know yet is kept as text. */
  availability: PaAvailability | string;
  activeProfile: string | null;
  capabilities: PaCapabilities;
  /** Renderer only: built from an updated list row (no overlaps; capabilities from the host's features) until the detail is read. */
  fromList?: boolean;
}
/** updated list rows also carry the availability and the session's current Profile. */
export interface PaRowStatus {
  availability: PaAvailability | string;
  activeProfile: string | null;
}
export interface PaList {
  homeInstanceId: string;
  items: PaAssistant[];
  /** id → status, only when the host's rows carry it (updated). */
  status: Record<string, PaRowStatus> | null;
  nextCursor: string | null;
}

export type PaRequestState = "awaitingOwner" | "queued" | "accepted" | "clarification" | "declined" | "completed" | "cancelled";
export const PA_REQUEST_STATES: readonly PaRequestState[] = ["awaitingOwner", "queued", "accepted", "clarification", "declined", "completed", "cancelled"];
export interface PaSeat {
  sessionId: string | null;
  epoch: number;
}
export interface PaOccurrence {
  scheduleId: string;
  templateRevision: number;
  scheduledAt: string;
  occurrenceKey: string;
}
export interface PaRequest {
  id: string;
  assistantId: string;
  projectId: string;
  outcome: string;
  constraints: string;
  /** Written by the assistant: an explanation only, never a proof of who asked. */
  sourceRef: string;
  director: PaSeat;
  assistantRevision: number;
  state: PaRequestState | string;
  revision: number;
  updatedAt: string;
  detail: string | null;
  /** updated. */
  projectRef?: PaProjectRef | null;
  /** updated: when it is due (a 定期任务 occurrence: its slot). */
  dueAt?: string | null;
  /** updated: made by a 定期任务 run. */
  occurrence?: PaOccurrence | null;
}
export interface PaRequestPage {
  items: PaRequest[];
  nextCursor: number | null;
}
export interface PaRequestDetail {
  request: PaRequest;
  /** null: the project has no readable seat now (`projectIssue` says why). */
  currentDirector: PaSeat | null;
  currentAssistantRevision: number;
  projectIssue: string | null;
  /** The seat, scope, assistant revision or state changed since it was prepared: review before sending. */
  needsReview: boolean;
}
export interface PaReminder {
  alarmId: string;
  at: string;
  message: string;
  state: string;
}
export interface PaSchedule {
  id?: string;
  scheduleId?: string;
  name?: string;
  title?: string;
  nextRunAt?: string | null;
  [key: string]: unknown;
}
/** updated agenda: one project of the set with its Director now, or why it could not be read. */
export interface PaAgendaProject {
  projectRef: PaProjectRef;
  director: PaSeat | null;
  lifecycle: string | null;
  issue: string | null;
}
export interface PaCalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}
export interface PaCalendarInfo {
  revision: number;
  status: "ready" | "disconnected" | string;
  source: string | null;
  observedAt: string | null;
}
export interface PaAgendaCalendar extends PaCalendarInfo {
  items: PaCalendarEvent[];
  nextCursor: string | null;
}
export interface PaAgenda {
  date: string;
  timezone: string;
  items: PaRequest[];
  nextCursor: number | null;
  reminders: PaReminder[];
  nextReminderCursor: string | null;
  schedules: PaSchedule[];
  nextScheduleCursor: string | null;
  /** updated (null: this host does not send them). */
  projects: PaAgendaProject[] | null;
  nextProjectCursor: string | null;
  dueRequests: PaRequest[] | null;
  nextDueCursor: string | null;
  calendar: PaAgendaCalendar | null;
}
export interface PaAuditRow {
  seq: number;
  actor: string;
  actionId: string;
  verb: string;
  at: string;
  detail: unknown;
}
export interface PaAuditPage {
  items: PaAuditRow[];
  nextCursor: number | null;
}

export type PaChange =
  | { kind: "settings"; name: string; projectIds: string[] }
  | { kind: "scopedSettings"; name: string; projectRefs: PaProjectRef[] }
  | { kind: "grants"; grants: PaGrants }
  | { kind: "enabled"; enabled: boolean };

export interface PaCreateInput {
  actionId: string;
  config: PaConfig;
}
export interface PaUpdateInput {
  actionId: string;
  expectedRevision: number;
  change: PaChange;
}
export interface PaConfirmInput {
  actionId: string;
  expectedRevision: number;
  expectedAssistantRevision: number;
  director: PaSeat;
}
export interface PaCancelInput {
  actionId: string;
  expectedRevision: number;
}
export interface PaAgendaQuery {
  date?: string;
  cursor?: number;
  reminderCursor?: string;
  scheduleCursor?: string;
  projectCursor?: string;
  dueCursor?: string;
  calendarCursor?: string;
  limit?: number;
}
/** One assistant's requests (updated: newest first, optionally one state). */
export interface PaRequestsQuery {
  state?: string;
  cursor?: number | null;
  limit?: number;
}
/** updated owner query over every assistant of the host: a project and/or a Director (seat). */
export interface PaOwnerRequestsQuery {
  project?: PaProjectRef;
  directorSessionId?: string;
  /** Only with `directorSessionId`. */
  directorEpoch?: number;
  state?: string;
  cursor?: number | null;
  limit?: number;
}

// ---- updated notes ----
export interface PaNote {
  key: string;
  revision: number;
  content: string;
  /** Written by the assistant. */
  sourceRef: string;
}
export interface PaNotePage {
  items: PaNote[];
  nextCursor: string | null;
}
export interface PaNotesQuery {
  q?: string;
  cursor?: string | null;
  limit?: number;
}

// ---- updated recurring templates (定期任务) ----
export type PaTask = "projectStatus" | "dueRequests" | "calendarSummary";
export const PA_TASKS: readonly PaTask[] = ["projectStatus", "dueRequests", "calendarSummary"];
/** In host local time; weekday Mon=1 … Sun=7. */
export type PaRule = { kind: "daily"; time: string } | { kind: "weekly"; weekday: number; time: string } | { kind: "interval"; hours: number };
export interface PaConfirmedSeat {
  sessionId: string;
  epoch: number;
}
/** The confirmed template a schedule carries. */
export interface PaTemplateInfo {
  assistantId: string;
  assistantRevision: number;
  projectRef: PaProjectRef;
  templateRevision: number;
  confirmedSeat: PaSeat;
  task: PaTask | string;
}
export type PaRunOutcome = "pending" | "held" | "retrying" | "dispatching" | "handedOff" | "refused" | "cancelled";
export interface PaRun {
  id: string;
  sequence: number;
  scheduleRevision: number;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: PaRunOutcome | string;
  attempts: number;
  lastError: string | null;
  /** The request it made (handedOff). */
  requestId: string | null;
  /** Later slots folded into this open run, up to then (合并). */
  coalescedUntil: string | null;
  /** The slot in host local time with its offset (RFC 3339). */
  slotLocal: string | null;
}
export interface PaTemplate {
  id: string;
  revision: number;
  /** null: a rule this app does not know (shown as text from cutex's timezone only). */
  rule: PaRule | null;
  enabled: boolean;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  lastRun: PaRun | null;
  template: PaTemplateInfo | null;
}
export interface PaTemplatePage {
  items: PaTemplate[];
  nextCursor: string | null;
}
export interface PaRunPage {
  items: PaRun[];
  nextCursor: string | null;
}
/** Create (no `expectedRevision`) or re-confirm / resume / change (`expectedRevision` = the template's revision). */
export interface PaTemplateConfirmInput {
  actionId: string;
  expectedRevision?: number;
  expectedAssistantRevision: number;
  projectRef: PaProjectRef;
  confirmedSeat: PaConfirmedSeat;
  task: PaTask;
  rule: PaRule;
}
export interface PaTemplateStopInput {
  actionId: string;
  expectedRevision: number;
}

// ---- updated calendar snapshot ----
export interface PaCalendarSnapshot {
  source: string;
  observedAt: string;
  events: PaCalendarEvent[];
}
export interface PaCalendarImport {
  actionId: string;
  expectedRevision: number;
  snapshot: PaCalendarSnapshot;
}
export interface PaCalendarClear {
  actionId: string;
  expectedRevision: number;
}

// ---- checks (main runs them on what the renderer sends and what cutex answers) ----

const ID = /^[A-Za-z0-9._:-]{1,200}$/;
export function paId(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value) || value === "." || value === "..") throw new Error("invalid personal assistant id");
  return value;
}
function text(value: unknown, max: number, what: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`invalid ${what}`);
  return value;
}
function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("invalid revision");
  return value;
}
function limit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > PA_PAGE_MAX) throw new Error("invalid limit");
  return value;
}
function seqCursor(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("invalid cursor");
  return String(value);
}
function textCursor(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error("invalid cursor");
  return value;
}
function projectIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > PA_PROJECTS_MAX) throw new Error("invalid project set");
  return [...new Set(value.map((id) => paId(id)))];
}
function projectRef(value: unknown): PaProjectRef {
  const r = value as Partial<PaProjectRef> | null;
  if (!r || typeof r !== "object") throw new Error("invalid project ref");
  return { instanceId: text(r.instanceId, 100, "project ref"), projectId: paId(r.projectId) };
}
function projectRefs(value: unknown): PaProjectRef[] {
  if (!Array.isArray(value) || value.length > PA_PROJECTS_MAX) throw new Error("invalid project set");
  const seen = new Set<string>();
  const out: PaProjectRef[] = [];
  for (const v of value) {
    const r = projectRef(v);
    const key = `${r.instanceId}\n${r.projectId}`;
    if (!seen.has(key)) (seen.add(key), out.push(r));
  }
  return out;
}
function grants(value: unknown): PaGrants {
  const g = value as Partial<PaGrants> | null;
  if (!g || !PA_TIERS.includes(g.tier as PaTier)) throw new Error("invalid grants");
  if (!Array.isArray(g.operations) || g.operations.some((op) => !PA_OPERATIONS.includes(op))) throw new Error("invalid grants");
  if (typeof g.fullOwner !== "boolean") throw new Error("invalid grants");
  return { tier: g.tier as PaTier, operations: [...new Set(g.operations)], fullOwner: g.fullOwner };
}
function seat(value: unknown): PaSeat {
  const s = value as Partial<PaSeat> | null;
  if (!s || (s.sessionId !== null && typeof s.sessionId !== "string") || typeof s.epoch !== "number" || !Number.isSafeInteger(s.epoch) || s.epoch < 0) throw new Error("invalid director seat");
  return { sessionId: s.sessionId === null ? null : paId(s.sessionId), epoch: s.epoch };
}
function state(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!PA_REQUEST_STATES.includes(value as PaRequestState)) throw new Error("invalid request state");
  return value as string;
}

export function paListQuery(q: { cursor?: string | null; limit?: number } = {}): Record<string, string | number | undefined> {
  return { cursor: textCursor(q.cursor, 160), limit: limit(q.limit) };
}
export function paCreateBody(input: PaCreateInput): PaCreateInput {
  const c = input?.config;
  const config: PaConfig = { name: text(c?.name, PA_NAME_MAX * 4, "name"), profile: text(c?.profile, 256, "profile"), homeInstanceId: text(c?.homeInstanceId, 100, "home"), projectIds: projectIds(c?.projectIds) };
  if (c?.projectRefs !== undefined) {
    const refs = projectRefs(c.projectRefs);
    // cutex requires both to name the same home projects; refs of other hosts are cutex's to accept (cross-host scope).
    const home = refs.filter((r) => r.instanceId === config.homeInstanceId).map((r) => r.projectId);
    if (home.length !== config.projectIds.length || home.some((p) => !config.projectIds.includes(p))) throw new Error("invalid project set");
    config.projectRefs = refs;
  }
  return { actionId: text(input?.actionId, 128, "action id"), config };
}
export function paChange(change: PaChange): PaChange {
  switch (change?.kind) {
    case "settings":
      return { kind: "settings", name: text(change.name, PA_NAME_MAX * 4, "name"), projectIds: projectIds(change.projectIds) };
    case "scopedSettings":
      return { kind: "scopedSettings", name: text(change.name, PA_NAME_MAX * 4, "name"), projectRefs: projectRefs(change.projectRefs) };
    case "grants":
      return { kind: "grants", grants: grants(change.grants) };
    case "enabled":
      if (typeof change.enabled !== "boolean") throw new Error("invalid change");
      return { kind: "enabled", enabled: change.enabled };
    default:
      throw new Error("invalid change");
  }
}
export function paUpdateBody(input: PaUpdateInput): PaUpdateInput {
  return { actionId: text(input?.actionId, 128, "action id"), expectedRevision: revision(input?.expectedRevision), change: paChange(input?.change) };
}
export function paConfirmBody(input: PaConfirmInput): PaConfirmInput {
  return { actionId: text(input?.actionId, 128, "action id"), expectedRevision: revision(input?.expectedRevision), expectedAssistantRevision: revision(input?.expectedAssistantRevision), director: seat(input?.director) };
}
export function paCancelBody(input: PaCancelInput): PaCancelInput {
  return { actionId: text(input?.actionId, 128, "action id"), expectedRevision: revision(input?.expectedRevision) };
}
export function paAgendaQuery(q: PaAgendaQuery = {}): Record<string, string | number | undefined> {
  if (q.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(q.date)) throw new Error("invalid date");
  return {
    date: q.date,
    cursor: seqCursor(q.cursor),
    reminderCursor: textCursor(q.reminderCursor, 160),
    scheduleCursor: textCursor(q.scheduleCursor, 100),
    projectCursor: textCursor(q.projectCursor, 160),
    dueCursor: textCursor(q.dueCursor, 160),
    calendarCursor: textCursor(q.calendarCursor, 160),
    limit: limit(q.limit),
  };
}
export function paSeqQuery(q: { cursor?: number | null; limit?: number } = {}): Record<string, string | number | undefined> {
  return { cursor: seqCursor(q.cursor), limit: limit(q.limit) };
}
/** One assistant's requests; `state` only goes to hosts with owner views (r295 ignores it). */
export function paRequestsQuery(q: PaRequestsQuery = {}): Record<string, string | number | undefined> {
  const s = state(q.state);
  return { cursor: seqCursor(q.cursor), limit: limit(q.limit), ...(s ? { state: s } : {}) };
}
export function paOwnerRequestsQuery(q: PaOwnerRequestsQuery): Record<string, string | number | undefined> {
  const project = q?.project ? projectRef(q.project) : undefined;
  const director = q?.directorSessionId !== undefined ? paId(q.directorSessionId) : undefined;
  if (q?.directorEpoch !== undefined && (director === undefined || !Number.isSafeInteger(q.directorEpoch) || q.directorEpoch < 0)) throw new Error("invalid director seat");
  if (!project && !director) throw new Error("invalid request scope");
  return {
    instanceId: project?.instanceId,
    projectId: project?.projectId,
    directorSessionId: director,
    directorEpoch: q.directorEpoch,
    state: state(q.state),
    cursor: seqCursor(q.cursor),
    limit: limit(q.limit),
  };
}
export function paNotesQuery(q: PaNotesQuery = {}): Record<string, string | number | undefined> {
  if (q.q !== undefined && (typeof q.q !== "string" || new TextEncoder().encode(q.q).length > PA_NOTE_QUERY_MAX)) throw new Error("invalid note query");
  return { q: q.q || undefined, cursor: textCursor(q.cursor, 400), limit: limit(q.limit) };
}
export function paTemplatesQuery(q: { cursor?: string | null; limit?: number } = {}): Record<string, string | number | undefined> {
  return { cursor: textCursor(q.cursor, 200), limit: limit(q.limit) };
}
export function paRunsQuery(q: { cursor?: string | null; limit?: number } = {}): Record<string, string | number | undefined> {
  if (q.cursor != null && q.cursor !== "" && !/^\d{1,19}$/.test(q.cursor)) throw new Error("invalid cursor");
  return { cursor: q.cursor || undefined, limit: limit(q.limit) };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export function paRule(value: unknown): PaRule {
  const r = value as Record<string, unknown> | null;
  switch (r?.kind) {
    case "daily":
      if (typeof r.time !== "string" || !TIME.test(r.time)) throw new Error("invalid rule");
      return { kind: "daily", time: r.time };
    case "weekly":
      if (typeof r.time !== "string" || !TIME.test(r.time) || typeof r.weekday !== "number" || !Number.isInteger(r.weekday) || r.weekday < 1 || r.weekday > 7) throw new Error("invalid rule");
      return { kind: "weekly", weekday: r.weekday, time: r.time };
    case "interval":
      if (typeof r.hours !== "number" || !Number.isInteger(r.hours) || r.hours < 1 || r.hours > 24 * 366) throw new Error("invalid rule");
      return { kind: "interval", hours: r.hours };
    default:
      throw new Error("invalid rule");
  }
}
export function paTemplateBody(input: PaTemplateConfirmInput, update: boolean): PaTemplateConfirmInput {
  if (!PA_TASKS.includes(input?.task)) throw new Error("invalid task");
  const s = seat(input?.confirmedSeat);
  if (!s.sessionId) throw new Error("invalid director seat");
  const body: PaTemplateConfirmInput = {
    actionId: text(input?.actionId, 128, "action id"),
    expectedAssistantRevision: revision(input?.expectedAssistantRevision),
    projectRef: projectRef(input?.projectRef),
    confirmedSeat: { sessionId: s.sessionId, epoch: s.epoch },
    task: input.task,
    rule: paRule(input?.rule),
  };
  // cutex: a new template has no revision; a re-confirmation names the template's current one.
  if (update) return { ...body, expectedRevision: revision(input?.expectedRevision) };
  if (input?.expectedRevision !== undefined) throw new Error("invalid revision");
  return body;
}
export function paTemplateStopBody(input: PaTemplateStopInput): PaTemplateStopInput {
  return { actionId: text(input?.actionId, 128, "action id"), expectedRevision: revision(input?.expectedRevision) };
}

/** UTF-8 bytes of a text (cutex's limits count bytes). */
export const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
/** Cuts a text to at most `max` UTF-8 bytes (whole characters). */
export function cutBytes(text: string, max: number): string {
  if (utf8Bytes(text) <= max) return text;
  let out = "";
  for (const ch of text) {
    if (utf8Bytes(out + ch) > max) break;
    out += ch;
  }
  return out;
}
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const instant = (value: unknown): number => (typeof value === "string" && RFC3339.test(value) ? Date.parse(value) : NaN);
/** Why a snapshot is refused (`code` + the event's index when one event is at fault); null when it fits. */
export interface PaCalendarProblem {
  code: "source" | "observedAt" | "tooMany" | "eventId" | "eventTitle" | "eventTime" | "duplicateId" | "tooLarge" | "shape";
  index?: number;
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === "string" && !!value.trim() && utf8Bytes(value) <= max;
}
/** The snapshot as cutex checks it (texts, counts, times, unique ids). */
export function paCalendarProblem(snapshot: unknown): PaCalendarProblem | null {
  const s = snapshot as Partial<PaCalendarSnapshot> | null;
  if (!s || typeof s !== "object" || !Array.isArray(s.events)) return { code: "shape" };
  if (!bounded(s.source, PA_CALENDAR_LIMITS.source)) return { code: "source" };
  if (!Number.isFinite(instant(s.observedAt))) return { code: "observedAt" };
  if (s.events.length > PA_CALENDAR_EVENTS_MAX) return { code: "tooMany" };
  const ids = new Set<string>();
  for (let index = 0; index < s.events.length; index++) {
    const e = s.events[index] as Partial<PaCalendarEvent> | null;
    if (!e || typeof e !== "object") return { code: "shape", index };
    if (!bounded(e.id, PA_CALENDAR_LIMITS.id)) return { code: "eventId", index };
    if (!bounded(e.title, PA_CALENDAR_LIMITS.title)) return { code: "eventTitle", index };
    const start = instant(e.startsAt);
    const end = instant(e.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { code: "eventTime", index };
    if (ids.has(e.id)) return { code: "duplicateId", index };
    ids.add(e.id);
  }
  return null;
}
/** The import body as sent: checked fields only, and within cutex's body limit. */
export function paCalendarBody(input: PaCalendarImport): PaCalendarImport {
  const problem = paCalendarProblem(input?.snapshot);
  if (problem) throw new Error(`invalid calendar (${problem.code}${problem.index !== undefined ? ` #${problem.index + 1}` : ""})`);
  const s = input.snapshot;
  const body: PaCalendarImport = {
    actionId: text(input?.actionId, 128, "action id"),
    expectedRevision: revision(input?.expectedRevision),
    snapshot: { source: s.source, observedAt: s.observedAt, events: s.events.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt })) },
  };
  if (utf8Bytes(JSON.stringify(body)) > PA_CALENDAR_BODY_MAX) throw new Error("invalid calendar (tooLarge)");
  return body;
}
export function paCalendarClearBody(input: PaCalendarClear): PaCalendarClear {
  return { actionId: text(input?.actionId, 128, "action id"), expectedRevision: revision(input?.expectedRevision) };
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function bad(what: string): never {
  throw new Error(`unexpected personal assistant reply (${what})`);
}
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const readRef = (v: unknown): PaProjectRef | null => (obj(v) && typeof v.instanceId === "string" && typeof v.projectId === "string" ? { instanceId: v.instanceId, projectId: v.projectId } : null);
const readSeat = (v: unknown): PaSeat | null => (obj(v) ? { sessionId: str(v.sessionId), epoch: typeof v.epoch === "number" ? v.epoch : 0 } : null);
function readAssistant(v: unknown): PaAssistant {
  if (!obj(v) || typeof v.id !== "string" || typeof v.revision !== "number" || !obj(v.config) || !obj(v.grants) || typeof v.enabled !== "boolean") bad("assistant");
  const c = v.config as Record<string, unknown>;
  const g = v.grants as Record<string, unknown>;
  const refs = Array.isArray(c.projectRefs) ? c.projectRefs.map(readRef).filter((r): r is PaProjectRef => !!r) : null;
  return {
    id: v.id,
    revision: v.revision,
    config: { name: String(c.name ?? ""), profile: String(c.profile ?? ""), homeInstanceId: String(c.homeInstanceId ?? ""), projectIds: Array.isArray(c.projectIds) ? c.projectIds.map(String) : [], ...(refs ? { projectRefs: refs } : {}) },
    grants: { tier: (PA_TIERS.includes(g.tier as PaTier) ? g.tier : "coordinator") as PaTier, operations: Array.isArray(g.operations) ? (g.operations.filter((op) => PA_OPERATIONS.includes(op as PaOperation)) as PaOperation[]) : [], fullOwner: g.fullOwner === true },
    coordinationProjectId: String(v.coordinationProjectId ?? ""),
    sessionId: typeof v.sessionId === "string" ? v.sessionId : null,
    enabled: v.enabled,
  };
}
export function readPaList(v: unknown): PaList {
  if (!obj(v) || !Array.isArray(v.items)) bad("list");
  const items = v.items.map(readAssistant);
  // updated rows are the assistant's fields plus availability / activeProfile.
  const rows = v.items as Record<string, unknown>[];
  const status = rows.some((r) => typeof r.availability === "string")
    ? Object.fromEntries(items.map((a, i) => [a.id, { availability: str(rows[i]!.availability) ?? "provisioning", activeProfile: str(rows[i]!.activeProfile) }]))
    : null;
  return { homeInstanceId: String(v.homeInstanceId ?? ""), items, status, nextCursor: typeof v.nextCursor === "string" ? v.nextCursor : null };
}
export function readPaView(v: unknown): PaView {
  if (!obj(v)) bad("view");
  return {
    assistant: readAssistant(v.assistant),
    overlaps: Array.isArray(v.overlaps) ? v.overlaps.filter(obj).map((o) => ({ assistantId: String(o.assistantId), name: String(o.name ?? ""), projectId: String(o.projectId) })) : [],
    moreOverlaps: v.moreOverlaps === true,
    availability: typeof v.availability === "string" ? v.availability : "provisioning",
    activeProfile: typeof v.activeProfile === "string" ? v.activeProfile : null,
    capabilities: obj(v.capabilities) ? (v.capabilities as PaCapabilities) : {},
  };
}
function readOccurrence(v: unknown): PaOccurrence | null {
  if (!obj(v) || typeof v.scheduleId !== "string") return null;
  return { scheduleId: v.scheduleId, templateRevision: Number(v.templateRevision ?? 0), scheduledAt: String(v.scheduledAt ?? ""), occurrenceKey: String(v.occurrenceKey ?? "") };
}
function readRequest(v: unknown): PaRequest {
  if (!obj(v) || typeof v.id !== "string" || typeof v.revision !== "number" || typeof v.state !== "string") bad("request");
  const d = obj(v.director) ? v.director : {};
  return {
    id: v.id,
    assistantId: String(v.assistantId ?? ""),
    projectId: String(v.projectId ?? ""),
    outcome: String(v.outcome ?? ""),
    constraints: String(v.constraints ?? ""),
    sourceRef: String(v.sourceRef ?? ""),
    director: { sessionId: typeof d.sessionId === "string" ? d.sessionId : null, epoch: typeof d.epoch === "number" ? d.epoch : 0 },
    assistantRevision: typeof v.assistantRevision === "number" ? v.assistantRevision : 0,
    state: v.state,
    revision: v.revision,
    updatedAt: String(v.updatedAt ?? ""),
    detail: typeof v.detail === "string" ? v.detail : null,
    ...(v.projectRef !== undefined ? { projectRef: readRef(v.projectRef) } : {}),
    ...(v.dueAt !== undefined ? { dueAt: str(v.dueAt) } : {}),
    ...(v.occurrence !== undefined ? { occurrence: readOccurrence(v.occurrence) } : {}),
  };
}
const seqOrNull = (v: unknown) => (typeof v === "number" ? v : null);
export function readPaRequestPage(v: unknown): PaRequestPage {
  if (!obj(v) || !Array.isArray(v.items)) bad("requests");
  return { items: v.items.map(readRequest), nextCursor: seqOrNull(v.nextCursor) };
}
export function readPaRequestDetail(v: unknown): PaRequestDetail {
  if (!obj(v)) bad("request detail");
  const cur = obj(v.currentDirector) ? v.currentDirector : null;
  return {
    request: readRequest(v.request),
    currentDirector: cur ? { sessionId: typeof cur.sessionId === "string" ? cur.sessionId : null, epoch: typeof cur.epoch === "number" ? cur.epoch : 0 } : null,
    currentAssistantRevision: typeof v.currentAssistantRevision === "number" ? v.currentAssistantRevision : 0,
    projectIssue: typeof v.projectIssue === "string" ? v.projectIssue : null,
    needsReview: v.needsReview === true,
  };
}
export function readPaRequestReply(v: unknown): PaRequest {
  if (!obj(v)) bad("request reply");
  return readRequest(v.request);
}
function readCalendarInfo(v: Record<string, unknown>): PaCalendarInfo {
  return { revision: typeof v.revision === "number" ? v.revision : 0, status: str(v.status) ?? "disconnected", source: str(v.source), observedAt: str(v.observedAt) };
}
const readEvent = (e: Record<string, unknown>): PaCalendarEvent => ({ id: String(e.id ?? ""), title: String(e.title ?? ""), startsAt: String(e.startsAt ?? ""), endsAt: String(e.endsAt ?? "") });
export function readPaCalendar(v: unknown): PaCalendarInfo {
  if (!obj(v) || typeof v.revision !== "number") bad("calendar");
  return readCalendarInfo(v);
}
function readAgendaProject(v: Record<string, unknown>): PaAgendaProject | null {
  const ref = readRef(v.projectRef);
  if (!ref) return null;
  return { projectRef: ref, director: readSeat(v.director), lifecycle: str(v.lifecycle), issue: str(v.issue) };
}
export function readPaAgenda(v: unknown): PaAgenda {
  if (!obj(v)) bad("agenda");
  const cal = obj(v.calendar) ? v.calendar : null;
  return {
    date: String(v.date ?? ""),
    timezone: String(v.timezone ?? "host"),
    items: Array.isArray(v.items) ? v.items.map(readRequest) : [],
    nextCursor: seqOrNull(v.nextCursor),
    reminders: Array.isArray(v.reminders) ? v.reminders.filter(obj).map((r) => ({ alarmId: String(r.alarmId), at: String(r.at ?? ""), message: String(r.message ?? ""), state: String(r.state ?? "") })) : [],
    nextReminderCursor: typeof v.nextReminderCursor === "string" ? v.nextReminderCursor : null,
    schedules: Array.isArray(v.schedules) ? (v.schedules.filter(obj) as PaSchedule[]) : [],
    nextScheduleCursor: typeof v.nextScheduleCursor === "string" ? v.nextScheduleCursor : null,
    projects: Array.isArray(v.projects) ? v.projects.filter(obj).map(readAgendaProject).filter((p): p is PaAgendaProject => !!p) : null,
    nextProjectCursor: str(v.nextProjectCursor),
    dueRequests: Array.isArray(v.dueRequests) ? v.dueRequests.map(readRequest) : null,
    nextDueCursor: str(v.nextDueCursor),
    calendar: cal ? { ...readCalendarInfo(cal), items: Array.isArray(cal.items) ? cal.items.filter(obj).map(readEvent) : [], nextCursor: str(cal.nextCursor) } : null,
  };
}
export function readPaAudit(v: unknown): PaAuditPage {
  if (!obj(v) || !Array.isArray(v.items)) bad("audit");
  return {
    items: v.items.filter(obj).map((r) => ({ seq: Number(r.seq), actor: String(r.actor ?? ""), actionId: String(r.actionId ?? ""), verb: String(r.verb ?? ""), at: String(r.at ?? ""), detail: r.detail ?? null })),
    nextCursor: seqOrNull(v.nextCursor),
  };
}
export function readPaNotes(v: unknown): PaNotePage {
  if (!obj(v) || !Array.isArray(v.items)) bad("notes");
  return {
    items: v.items.filter(obj).map((n) => ({ key: String(n.key ?? ""), revision: Number(n.revision ?? 0), content: String(n.content ?? ""), sourceRef: String(n.sourceRef ?? "") })),
    nextCursor: str(v.nextCursor),
  };
}
function readTemplateInfo(v: unknown): PaTemplateInfo | null {
  if (!obj(v)) return null;
  const ref = readRef(v.projectRef);
  if (!ref || typeof v.assistantId !== "string") return null;
  return {
    assistantId: v.assistantId,
    assistantRevision: Number(v.assistantRevision ?? 0),
    projectRef: ref,
    templateRevision: Number(v.templateRevision ?? 0),
    confirmedSeat: readSeat(v.confirmedSeat) ?? { sessionId: null, epoch: 0 },
    task: String(v.task ?? ""),
  };
}
function readRun(v: unknown): PaRun {
  if (!obj(v) || typeof v.id !== "string" || typeof v.outcome !== "string") bad("run");
  return {
    id: v.id,
    sequence: Number(v.sequence ?? 0),
    scheduleRevision: Number(v.scheduleRevision ?? 0),
    scheduledAt: String(v.scheduledAt ?? ""),
    startedAt: str(v.startedAt),
    finishedAt: str(v.finishedAt),
    outcome: v.outcome,
    attempts: Number(v.attempts ?? 0),
    lastError: str(v.lastError),
    requestId: str(v.requestId),
    coalescedUntil: str(v.coalescedUntil),
    slotLocal: str(v.slotLocal),
  };
}
function readTemplate(v: unknown): PaTemplate {
  if (!obj(v) || typeof v.id !== "string" || typeof v.revision !== "number" || typeof v.enabled !== "boolean") bad("template");
  let rule: PaRule | null;
  try {
    rule = paRule(v.rule);
  } catch {
    rule = null;
  }
  return {
    id: v.id,
    revision: v.revision,
    rule,
    enabled: v.enabled,
    nextRunAt: str(v.nextRunAt),
    createdAt: String(v.createdAt ?? ""),
    updatedAt: String(v.updatedAt ?? ""),
    deletedAt: str(v.deletedAt),
    lastRun: obj(v.lastRun) ? readRun(v.lastRun) : null,
    template: readTemplateInfo(v.assistantTemplate),
  };
}
export function readPaTemplates(v: unknown): PaTemplatePage {
  if (!obj(v) || !Array.isArray(v.items)) bad("templates");
  return { items: v.items.map(readTemplate), nextCursor: str(v.nextCursor) };
}
export function readPaTemplateReply(v: unknown): PaTemplate {
  if (!obj(v)) bad("template reply");
  return readTemplate(v.schedule);
}
export function readPaRuns(v: unknown): PaRunPage {
  if (!obj(v) || !Array.isArray(v.items)) bad("runs");
  return { items: v.items.map(readRun), nextCursor: str(v.nextCursor) };
}
