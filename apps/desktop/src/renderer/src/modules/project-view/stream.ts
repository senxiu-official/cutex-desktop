// Project 「动态」 model (pure, unit-tested in test/projectStream.test.ts; design 022, preview
// .claude/previews/preview-project-activity.html): the cutex project log's rows grouped into the type
// chips, the filters as `kinds=` prefixes, 只看需要你, merging live rows into a page, day groups, each
// row's words and where a click goes. The running-now list (正在进行) too: counts, open-by-default,
// elapsed time and the stop request of an item.
import type { BackgroundAgent, BackgroundItem, ProjectBackground, ProjectEvent } from "../../../../shared/projectEvents";
import { compareNames } from "../../lib/rosterOrder";

// ── Type chips ────────────────────────────────────────────────────────────────────────────────────

export type StreamGroup = "turn" | "ask" | "subagent" | "background" | "approval" | "artifact" | "other";
export const STREAM_GROUPS: readonly StreamGroup[] = ["turn", "ask", "subagent", "background", "approval", "artifact", "other"];

/** The route's `kinds=` prefixes behind each chip. */
export const GROUP_PREFIXES: Record<StreamGroup, readonly string[]> = {
  turn: ["turn"],
  ask: ["ask"],
  subagent: ["subagent"],
  background: ["background"],
  approval: ["approval"],
  artifact: ["artifact"],
  other: ["workflow", "ownerNotify", "job", "runtime", "member", "journal"],
};

/** 只看需要你 reads only these (then `needsAttention` keeps the rows that want the owner). */
export const ATTENTION_PREFIXES: readonly string[] = ["turn", "ask", "background", "approval", "ownerNotify"];

export const isStreamGroup = (g: unknown): g is StreamGroup => typeof g === "string" && (STREAM_GROUPS as readonly string[]).includes(g);

export function groupOf(kind: string): StreamGroup {
  const prefix = kind.split(".")[0] ?? "";
  for (const g of STREAM_GROUPS) if (GROUP_PREFIXES[g].includes(prefix)) return g;
  return "other";
}

/** `kinds=` for the chips (none on = everything = no parameter) or 只看需要你. */
export function queryKinds(groups: readonly StreamGroup[], needsOnly: boolean): string[] | undefined {
  if (needsOnly) return [...ATTENTION_PREFIXES];
  if (!groups.length || groups.length === STREAM_GROUPS.length) return undefined;
  return STREAM_GROUPS.filter((g) => groups.includes(g)).flatMap((g) => GROUP_PREFIXES[g]);
}

export function toggleGroup(groups: readonly StreamGroup[], g: StreamGroup): StreamGroup[] {
  return groups.includes(g) ? groups.filter((x) => x !== g) : STREAM_GROUPS.filter((x) => x === g || groups.includes(x));
}

/** Hide only a positively identified owner-started turn, never unknown/older-host rows or other events. */
export function withoutOwnerTurns(rows: readonly ProjectEvent[], includeOwnerTurns: boolean): ProjectEvent[] {
  const hide = (row: ProjectEvent) => row.kind.startsWith("turn.") && row.turnOrigin === "owner";
  return includeOwnerTurns || !rows.some(hide) ? rows as ProjectEvent[] : rows.filter((row) => !hide(row));
}

/** One feed per project + filter (the store keys pages and live watches by it). */
export function feedKey(hostId: string, projectId: string, kinds: readonly string[] | undefined, sessionId: string | null): string {
  return [hostId, projectId, kinds?.join(",") ?? "*", sessionId ?? "*"].join("\n");
}

// ── 只看需要你 ─────────────────────────────────────────────────────────────────────────────────────

const FAILED_BACKGROUND = new Set(["failed", "killed", "lost"]);

/**
 * Rows that want the owner: approvals still pending (no later `approval.decided` for the same approval
 * among the loaded rows), failed turns, failed delegations, failed background commands, messages to the owner.
 */
export function attentionRows(rows: readonly ProjectEvent[]): ProjectEvent[] {
  const decided = new Set(rows.filter((r) => r.kind === "approval.decided" && r.refs.approvalId).map((r) => r.refs.approvalId!));
  return rows.filter((r) => {
    switch (r.kind) {
      case "approval.requested":
        return !r.refs.approvalId || !decided.has(r.refs.approvalId);
      case "turn.failed":
      case "ask.failed":
      case "ownerNotify.created":
        return true;
      case "background.finished":
        return FAILED_BACKGROUND.has(r.status ?? "");
      default:
        return false;
    }
  });
}

// ── Pages + live rows ─────────────────────────────────────────────────────────────────────────────

export const seqOf = (cursor: string | null | undefined): number => {
  const m = /^pe:(\d+)$/.exec(cursor ?? "");
  return m ? Number(m[1]) : -1;
};

/** Newest first, one row per cursor (a row seen twice — page + live — stays once). */
export function mergeRows(existing: readonly ProjectEvent[], incoming: readonly ProjectEvent[]): ProjectEvent[] {
  if (!incoming.length) return existing as ProjectEvent[];
  const byCursor = new Map<string, ProjectEvent>();
  for (const r of existing) byCursor.set(r.cursor, r);
  for (const r of incoming) byCursor.set(r.cursor, r);
  return [...byCursor.values()].sort((a, b) => seqOf(b.cursor) - seqOf(a.cursor));
}

/** Rows newer than `seenSeq` (the 「↑ N 条新动态」 count while scrolled down). */
export function newerThan(rows: readonly ProjectEvent[], seenSeq: number): number {
  let n = 0;
  for (const r of rows) {
    if (seqOf(r.cursor) > seenSeq) n++;
    else break;
  }
  return n;
}

// ── Day groups ────────────────────────────────────────────────────────────────────────────────────

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "today" / "yesterday" / a local `YYYY-MM-DD` (the view formats it). */
export function dayOf(at: string, now: number): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "unknown";
  const today = startOfDay(now);
  const day = startOfDay(t);
  if (day >= today) return "today";
  // The day before today's midnight (DST-safe: not today − 24 h).
  return day === startOfDay(today - 1) ? "yesterday" : isoDay(t);
}

const isoDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function groupByDay(rows: readonly ProjectEvent[], now: number): { day: string; rows: ProjectEvent[] }[] {
  const out: { day: string; rows: ProjectEvent[] }[] = [];
  for (const r of rows) {
    const day = dayOf(r.at, now);
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, rows: [r] });
  }
  return out;
}

// ── One row ───────────────────────────────────────────────────────────────────────────────────────

export type RowTone = "default" | "ok" | "danger" | "muted" | "warn";
/** The small badge on the avatar. */
export type RowBadge = "turn" | "ask" | "subagent" | "background" | "approval" | "artifact" | "ok" | "fail" | "other";

export interface RowView {
  group: StreamGroup;
  badge: RowBadge;
  tone: RowTone;
  /** i18n key `project-view.ev.<text>` and its params. */
  text: string;
  /** The status word key (`project-view.evStatus.<status>`) when the row names one. */
  status: string | null;
  /** Monospace title (commands). */
  mono: boolean;
  /** Grey second line parts: the detail and facts (duration, tool calls). */
  detail: string | null;
  durationMs: number | null;
  toolCalls: number | null;
}

const STOPPED_BG = new Set(["stopped", "cancelled"]);

export function describeRow(e: ProjectEvent): RowView {
  const group = groupOf(e.kind);
  const base: RowView = { group, badge: group, tone: "default", text: "other", status: null, mono: false, detail: e.detail, durationMs: e.durationMs ?? null, toolCalls: e.toolCalls ?? null };
  switch (e.kind) {
    case "turn.completed":
      return { ...base, text: "turn" };
    case "turn.failed":
      return { ...base, badge: "fail", tone: "danger", text: "turnFailed" };
    case "turn.interrupted":
      return { ...base, tone: "muted", text: "turnInterrupted" };
    case "ask.created":
      return { ...base, text: "askCreated", status: e.status };
    case "ask.answered":
      return { ...base, badge: "ok", text: "askAnswered" };
    case "ask.failed":
      return { ...base, badge: "fail", tone: "danger", text: "askFailed" };
    case "ask.closed":
      return { ...base, text: "askClosed", status: e.status };
    case "subagent.started":
      return { ...base, text: "subagentStarted" };
    case "subagent.finished":
      return { ...base, text: e.status === "interrupted" ? "subagentInterrupted" : "subagentFinished", tone: e.status === "interrupted" ? "muted" : "default" };
    case "background.started":
      return { ...base, text: "backgroundStarted", mono: true };
    case "background.finished": {
      const s = e.status ?? "";
      if (FAILED_BACKGROUND.has(s)) return { ...base, badge: "fail", tone: "danger", text: "backgroundFailed", mono: true, status: s };
      if (STOPPED_BG.has(s)) return { ...base, tone: "muted", text: "backgroundStopped", mono: true };
      return { ...base, badge: "ok", text: "backgroundFinished", mono: true };
    }
    case "approval.requested":
      return { ...base, tone: "warn", text: "approvalRequested" };
    case "approval.decided":
      return { ...base, badge: e.status === "denied" ? "fail" : "ok", text: e.status === "denied" ? "approvalDenied" : "approvalApproved" };
    case "artifact.published":
      return { ...base, text: "artifact" };
    case "workflow.run":
      return { ...base, badge: e.status === "completed" ? "ok" : "fail", tone: e.status === "completed" ? "default" : "danger", text: "workflow", status: e.status };
    case "ownerNotify.created":
      return { ...base, tone: "warn", text: "ownerNotify" };
    case "job.finished":
      return { ...base, text: "job", mono: true, status: e.status };
    case "runtime.online":
      return { ...base, text: "runtimeOnline", tone: "muted" };
    case "runtime.offline":
      return { ...base, text: "runtimeOffline", tone: "muted" };
    case "member.joined":
      return { ...base, text: "memberJoined", tone: "muted" };
    case "member.left":
      return { ...base, text: "memberLeft", tone: "muted" };
    case "journal.gap":
      return { ...base, text: "gap", tone: "muted" };
    default:
      return base;
  }
}

export type StreamTarget =
  | { kind: "turn"; sessionId: string; turnId: string; threadId: string | null; agentName: string | null; snippet: string | null }
  | { kind: "agent"; sessionId: string }
  | { kind: "delegation"; askId: string; title: string }
  | { kind: "artifact"; ref: string; name: string }
  | { kind: "approvals" };

/** Where a click goes: the turn, the delegation, the artifact, the approvals page, else the agent; null = nowhere. */
export function rowTarget(e: ProjectEvent): StreamTarget | null {
  const group = groupOf(e.kind);
  if (group === "turn" && e.cutexSessionId && e.parent.turnId)
    return { kind: "turn", sessionId: e.cutexSessionId, turnId: e.parent.turnId, threadId: e.parent.threadId, agentName: e.agentName, snippet: e.title };
  if (group === "ask" && e.refs.askId) return { kind: "delegation", askId: e.refs.askId, title: e.title ?? "" };
  if (e.kind === "artifact.published" && e.refs.artifactId) return { kind: "artifact", ref: `${e.refs.artifactId}@latest`, name: e.title ?? e.refs.artifactId };
  if (group === "approval" && e.refs.approvalId) return { kind: "approvals" };
  if (e.kind === "journal.gap" || e.kind === "workflow.run") return null;
  return e.cutexSessionId ? { kind: "agent", sessionId: e.cutexSessionId } : null;
}

/** `42500` → `42s`, `400000` → `6m 40s`, `5400000` → `1h 30m` (language-neutral units). */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** Local `HH:MM`. */
export function clockOf(at: string): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── 正在进行 ──────────────────────────────────────────────────────────────────────────────────────

/** Open by default when this many things or fewer run (owner 2026-10-23). */
export const RUNNING_OPEN_MAX = 3;

export type RunningKind = "subagent" | "background" | "job";
export const runningKind = (i: BackgroundItem): RunningKind => (i.kind === "job" ? "job" : i.kind === "subagent" ? "subagent" : "background");

export interface RunningSummary {
  total: number;
  byKind: Record<RunningKind, number>;
  agents: BackgroundAgent[];
}

/** Agents with something running (or an incomplete answer worth a note), sub-agents first within each. */
export function runningSummary(bg: ProjectBackground | null): RunningSummary {
  const byKind: Record<RunningKind, number> = { subagent: 0, background: 0, job: 0 };
  const agents: BackgroundAgent[] = [];
  for (const a of bg?.agents ?? []) {
    if (!a.items.length && a.complete) continue;
    const order = (i: BackgroundItem) => ["subagent", "background", "job"].indexOf(runningKind(i));
    const items = [...a.items].sort((x, y) => order(x) - order(y) || (Date.parse(x.startedAt ?? "") || 0) - (Date.parse(y.startedAt ?? "") || 0));
    for (const i of items) byKind[runningKind(i)]++;
    agents.push({ ...a, items });
  }
  agents.sort((x, y) => y.items.length - x.items.length || compareNames(x.agentName ?? x.cutexSessionId, y.agentName ?? y.cutexSessionId));
  return { total: byKind.subagent + byKind.background + byKind.job, byKind, agents };
}

/** null = the owner has not toggled it: open when RUNNING_OPEN_MAX or fewer things run. */
export const runningOpen = (choice: boolean | null, total: number): boolean => choice ?? total <= RUNNING_OPEN_MAX;

/** Stable key of one running item (stop state per item). */
export const itemKey = (sessionId: string, i: BackgroundItem): string => `${sessionId}\n${i.kind}\n${i.id}`;

/** A stop request the desktop can send (only the requests the contract names); null = not stoppable. */
export type StopCall =
  | { kind: "claudeTask"; sessionId: string; threadId: string; taskId: string }
  | { kind: "terminal"; sessionId: string; threadId: string; processId: string }
  | { kind: "job"; jobId: string; expectedRevision: number };

export function stopCall(i: BackgroundItem): StopCall | null {
  const s = i.stop;
  if (!s || i.state === "unknown") return null;
  if (s.kind === "job") return typeof s.expectedRevision === "number" ? { kind: "job", jobId: s.jobId, expectedRevision: s.expectedRevision } : null;
  const p = s.params;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  if (s.method === "claude/tasks/stop") {
    const threadId = str(p.threadId);
    const taskId = str(p.taskId);
    return threadId && taskId ? { kind: "claudeTask", sessionId: s.cutexSessionId, threadId, taskId } : null;
  }
  if (s.method === "thread/backgroundTerminals/terminate") {
    const threadId = str(p.threadId);
    const processId = str(p.processId) ?? (typeof p.processId === "number" ? String(p.processId) : null);
    return threadId && processId ? { kind: "terminal", sessionId: s.cutexSessionId, threadId, processId } : null;
  }
  return null;
}
