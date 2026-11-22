// 项目看板 — the pure model: per-host reads (what main already reads for the app) → one view per project.
// It only reorders and counts what cutex says: member states come from the session resource (activityStatus, runtime
// status, agentPause, activity.lastTurnError), problems only from cutex facts (host down, an errored agent, a stop
// cutex could not confirm, an unreachable service, a profile cutex reports at 0 %, and — once a host has G3 — cutex's
// own stalled flag). It never decides "stuck" itself.
//
// Project identity: projectIdentity() is the one place that says which per-host projects are the same project.
// Today that is the display name (owner 2026-11-17: cross-host projects come later); a real cross-host id replaces
// this function only.
import type { OwnerNotification, ProjectSummary, SessionResource } from "@cutex-desktop/protocol";
import { agentPauseOf } from "./agentPause";
import type { ApprovalRecord, AskSummary, ServiceView, SidebarSnapshot } from "./ipc";
import type { BoardActivity, BoardBackendParts, BoardHostState, BoardMemberState, BoardMemberView, BoardPrefs, BoardProblem, BoardProjectView } from "./board";
import { backendParts, goalOf, planOf, stalledOf, stepsOf, summaryProblem, type BoardSummaryProject } from "./boardBackend";

export interface BoardHostInput {
  hostId: string;
  label: string;
  state: BoardHostState;
  readAt: number | null;
  features: ReadonlySet<string> | null;
  /** The host's sidebar snapshot (sessions + projects + memberships); null: not read. */
  sidebar: SidebarSnapshot | null;
  /** `GET /v2/asks?state=open`; null: not readable. */
  openAsks: AskSummary[] | null;
  /** Recently closed delegations (`state=closed`, newest first); null: not readable. */
  closedAsks: AskSummary[] | null;
  /** Pending owner notices (`filter=pending`). */
  notifications: OwnerNotification[] | null;
  /** Pending approvals. */
  approvals: ApprovalRecord[] | null;
  services: ServiceView[] | null;
  /** Profiles cutex reports with a quota window at 0 % (quotaExhausted()). */
  quotaOut: readonly string[] | null;
  /** `openAsks` / `closedAsks` filled their page: the lists may not hold every delegation (main's read limits). */
  openAsksTruncated?: boolean;
  closedAsksTruncated?: boolean;
  /** G1 `GET /v2/board` (boardBackend parseBoardSummary), by projectId; null: the host has no board summary. When a
   *  project is in it, its counts / 今天完成 / 需要你 / problems / plan / goal come from it, not from the lists above. */
  summary?: ReadonlyMap<string, BoardSummaryProject> | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of this device's local calendar day (the fallback "today"; the board summary uses the host's day). */
export function localDayStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The cross-host key of a project. Today: its display name, case- and space-insensitive. */
export function projectIdentity(project: Pick<ProjectSummary, "project_id" | "presentation">): string {
  const name = (project.presentation?.display_name || project.project_id).trim().replace(/\s+/g, " ").toLowerCase();
  return `name:${name}`;
}

/** Profiles whose quota cutex reports exhausted: a fresh window gauge at 0 % (cutex's number, no threshold of ours). */
export function quotaExhausted(gauges: readonly { kind: string; remainingPercent: number | null; stale: boolean; error?: string | null }[] | null): boolean {
  return !!gauges?.some((g) => g.kind === "window" && g.remainingPercent === 0 && !g.stale && !g.error);
}

const ms = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) {
    const chars = [...parts[0]!];
    return (chars[0]!.toUpperCase() + (chars[1] ?? "")).slice(0, 2);
  }
  return ([...parts[0]!][0]! + [...parts[1]!][0]!).toUpperCase();
}

function turnErrorOf(s: SessionResource): string | null {
  const raw = (s.activity as Record<string, unknown> | null)?.lastTurnError;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.turnId !== "string" || !r.turnId) return null;
  return typeof r.message === "string" && r.message.trim() ? r.message.trim().slice(0, 200) : "";
}

function runtimeErrorOf(s: SessionResource): string | null {
  if (s.runtime?.status !== "error") return null;
  const e = s.runtime.lastError;
  return typeof e === "string" ? e.slice(0, 200) : e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string" ? ((e as { message: string }).message).slice(0, 200) : "";
}

/** cutex's activity projection: the newer of the last tool call and the last output line. */
function doingOf(s: SessionResource): string | null {
  const a = s.activity as { lastOutput?: { displayText?: unknown; updatedAt?: unknown }; lastToolCall?: { displayText?: unknown; updatedAt?: unknown } } | null;
  const pick = [a?.lastToolCall, a?.lastOutput]
    .filter((x): x is { displayText: string; updatedAt?: unknown } => !!x && typeof x.displayText === "string" && !!x.displayText.trim())
    .sort((x, y) => ms(typeof y.updatedAt === "string" ? y.updatedAt : null) - ms(typeof x.updatedAt === "string" ? x.updatedAt : null))[0];
  return pick ? pick.displayText.replace(/\s+/g, " ").trim().slice(0, 200) : null;
}

function archived(s: SessionResource): boolean {
  return s.visible === false || s.lifecycle === "retired" || s.archiveKind === "soft" || s.archiveKind === "permanent";
}

/** The member's current state. 出错 is a live runtime error only; a failed previous turn of an idle member stays idle
 *  (cutex P6: soft lastTurnFailed, a separate amber line — lastTurnFailedOf). */
export function memberStateOf(s: SessionResource, hostConnected: boolean): { state: BoardMemberState; error: string | null } {
  if (!hostConnected) return { state: "offline", error: null };
  if (s.activityStatus === "busy") return { state: "busy", error: null };
  if (s.runtime?.status === "offline" || s.activityStatus === "offline") return { state: "offline", error: null };
  const error = runtimeErrorOf(s);
  if (error !== null) return { state: "error", error };
  if (agentPauseOf(s)) return { state: "paused", error: null };
  return { state: "idle", error: null };
}

function memberView(s: SessionResource, hostId: string, connected: boolean, director: boolean): BoardMemberView & { error: string | null; lastTurnFailed: string | null; profile: string | null; activityAt: number } {
  const { state, error } = memberStateOf(s, connected);
  // Like cutex's lastTurnFailed: only an idle member carries its previous turn's failure (soft).
  const lastTurnFailed = state === "idle" ? turnErrorOf(s) : null;
  const name = s.displayName || s.formalAgentName || s.cutexSessionId;
  return {
    hostId, sessionId: s.cutexSessionId, name, initials: initialsOf(name), director, state,
    doing: doingOf(s),
    since: state === "busy" ? (s.busySince ?? s.lastActivityAt ?? null) : (s.lastActivityAt ?? null),
    error, lastTurnFailed, profile: s.profile, activityAt: Math.max(ms(s.lastActivityAt), ms(s.busySince)),
  };
}

const STATE_RANK: Record<BoardMemberState, number> = { error: 0, busy: 1, paused: 2, idle: 3, offline: 4 };
/** Members in board order: errored, busy, paused, idle, offline; inside a state the most recent first. */
export function orderMembers<T extends BoardMemberView>(list: T[]): T[] {
  return [...list].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || ms(b.since) - ms(a.since) || a.name.localeCompare(b.name));
}

interface Acc {
  key: string;
  name: string;
  color: string;
  places: { hostId: string; projectId: string }[];
  director: (BoardMemberView & { activityAt: number }) | null;
  members: (BoardMemberView & { error: string | null; lastTurnFailed: string | null; profile: string | null; activityAt: number })[];
  openDelegations: number;
  today: { done: number; failed: number } | null;
  needsYou: number;
  problems: BoardProblem[];
  /** Problems a host counted but did not list (its summary's examples limit): hard / soft when its per-code counts
   *  say so, else of unknown severity. */
  hardUnlisted: number;
  softUnlisted: number;
  unsized: number;
  /** Sources some place could not read: the matching numbers are unknown, not zero. */
  unknown: { delegations: boolean; today: boolean; needsYou: boolean; problems: boolean };
  recent: BoardActivity[];
  plan: BoardProjectView["plan"];
  goal: string | null;
  goalUnknown: boolean;
}

/** One view per project across all hosts (hosts in the given order: the first host with a 主管 provides it, and the
 *  plan / goal shown are that 主管's own — never another host's). */
export function buildBoard(hosts: readonly BoardHostInput[], now: number): BoardProjectView[] {
  const byKey = new Map<string, Acc>();
  for (const h of hosts) {
    const projects = h.sidebar?.projects?.projects ?? [];
    if (!projects.length) continue;
    const connected = h.state === "connected";
    const parts = backendParts(h.features);
    const sessions = (h.sidebar?.active ?? []).filter((s) => !archived(s));
    const rows = h.sidebar?.hostRows ?? {};
    for (const p of projects) {
      if (p.lifecycle && p.lifecycle !== "active") continue;
      const key = projectIdentity(p);
      let acc = byKey.get(key);
      if (!acc) {
        acc = {
          key, name: p.presentation?.display_name || p.project_id, color: p.presentation?.color || "blue", places: [], director: null, members: [],
          openDelegations: 0, today: null, needsYou: 0, problems: [], hardUnlisted: 0, softUnlisted: 0, unsized: 0, unknown: { delegations: false, today: false, needsYou: false, problems: false }, recent: [], plan: null, goal: null, goalUnknown: false,
        };
        byKey.set(key, acc);
      }
      const sum = h.summary?.get(p.project_id) ?? null;
      acc.places.push({ hostId: h.hostId, projectId: p.project_id, ...(sum ? { projectKey: sum.projectKey } : {}) });
      if (!connected) acc.problems.push({ kind: "hostOffline", hostId: h.hostId, subject: h.label, detail: null, target: null });

      const mine = sessions.filter((s) => rows[s.cutexSessionId]?.projectId === p.project_id);
      const ids = new Set(mine.map((s) => s.cutexSessionId));
      for (const s of mine) {
        const isDirector = !!p.director_cutex_session_id && s.cutexSessionId === p.director_cutex_session_id;
        const m = memberView(s, h.hostId, connected, isDirector);
        if (isDirector && !acc.director) {
          acc.director = m;
          // The plan / goal of this 主管 only: the summary's when it names this session, else the project row's.
          const own = sum && parts.plan && (!sum.directorSessionId || sum.directorSessionId === m.sessionId) ? sum : null;
          acc.plan = own ? own.plan : sum ? null : planOf(p, parts);
          acc.goal = own ? own.goal : sum ? null : goalOf(p, parts);
          acc.goalUnknown = !!own && own.goal === null && own.goalUnknown;
        } else acc.members.push(m);
        if (sum) continue; // problems come from the summary
        if (m.state === "error") acc.problems.push({ kind: "agentError", hostId: h.hostId, subject: m.name, detail: m.error || null, target: { kind: "agent", hostId: h.hostId, sessionId: m.sessionId } });
        if (m.lastTurnFailed !== null) acc.problems.push({ kind: "lastTurnFailed", hostId: h.hostId, subject: m.name, detail: m.lastTurnFailed || null, target: { kind: "agent", hostId: h.hostId, sessionId: m.sessionId }, soft: true });
        if (m.state !== "offline" && m.profile && h.quotaOut?.includes(m.profile) && !acc.problems.some((x) => x.kind === "quotaOut" && x.subject === m.profile))
          acc.problems.push({ kind: "quotaOut", hostId: h.hostId, subject: m.profile, detail: m.name, target: { kind: "agent", hostId: h.hostId, sessionId: m.sessionId } });
      }

      const inProject = (a: AskSummary) => a.projectId === p.project_id || (!a.projectId && ids.has(a.target));
      const nameOf = (id: string) => {
        const s = sessions.find((x) => x.cutexSessionId === id);
        return s ? s.displayName || s.formalAgentName || null : null;
      };
      if (sum) {
        addSummary(acc, sum, h.hostId, parts, nameOf);
        continue;
      }
      if (!h.openAsks || h.openAsksTruncated) acc.unknown.delegations = acc.unknown.problems = acc.unknown.needsYou = true;
      if (!h.notifications || !h.approvals) acc.unknown.needsYou = true;
      if (!h.services || !h.quotaOut) acc.unknown.problems = true;
      for (const a of (h.openAsks ?? []).filter(inProject)) {
        acc.openDelegations += 1;
        const target = { kind: "delegation" as const, hostId: h.hostId, askId: a.askId };
        if (a.attempt?.stopUnconfirmed) acc.problems.push({ kind: "stopUnconfirmed", hostId: h.hostId, subject: a.title, detail: a.targetName ?? nameOf(a.target), target });
        else if (stalledOf(a, parts)) acc.problems.push({ kind: "stalled", hostId: h.hostId, subject: a.title, detail: a.targetName ?? nameOf(a.target), target });
        if (a.ownerQuestions) acc.needsYou += 1;
        const note = a.attempt?.progress?.at(-1);
        const who = a.targetName ?? nameOf(a.target) ?? "";
        const steps = stepsOf(a, parts);
        if (note) acc.recent.push({ kind: "progress", text: `${who}: ${note.text}${steps ? ` (${steps.done}/${steps.total})` : ""}`, at: note.at, target });
        else acc.recent.push({ kind: "started", text: `${who}: ${a.title}`, at: a.createdAt, target });
      }
      // A full page whose oldest row is still today may have cut off more of today's.
      const oldestClosed = h.closedAsks?.at(-1);
      if (!h.closedAsks || (h.closedAsksTruncated && oldestClosed && ms(oldestClosed.closedAt ?? oldestClosed.updatedAt) >= localDayStart(now))) acc.unknown.today = true;
      if (h.closedAsks) {
        acc.today ??= { done: 0, failed: 0 };
        for (const a of h.closedAsks.filter(inProject)) {
          const at = a.closedAt ?? a.updatedAt;
          const failed = a.execution === "failed";
          const done = a.closed === "completed" || a.closed === "accepted";
          // Like the board summary's finishedToday: every delegation closed today (any disposition); failed is a part of it.
          if (ms(at) >= localDayStart(now)) {
            acc.today.done += 1;
            if (failed) acc.today.failed += 1;
          }
          acc.recent.push({ kind: failed ? "failed" : done ? "done" : "stopped", text: `${a.targetName ?? nameOf(a.target) ?? ""}: ${a.title}`, at, target: { kind: "delegation", hostId: h.hostId, askId: a.askId } });
        }
      }
      acc.needsYou += (h.notifications ?? []).filter((n) => ids.has(n.agentId)).length;
      acc.needsYou += (h.approvals ?? []).filter((r) => r.projectId === p.project_id || (!r.projectId && ids.has(r.requesterCutexSessionId))).length;
      for (const svc of h.services ?? []) {
        const mineSvc = svc.projectId === p.project_id || (!svc.projectId && !!svc.ownerCutexSessionId && ids.has(svc.ownerCutexSessionId));
        if (mineSvc && (svc.health === "unreachable" || svc.health === "crashLooped"))
          acc.problems.push({ kind: "service", hostId: h.hostId, subject: svc.slug, detail: svc.health, target: svc.ownerCutexSessionId ? { kind: "agent", hostId: h.hostId, sessionId: svc.ownerCutexSessionId } : null });
      }
    }
  }
  return [...byKey.values()].map((acc) => finish(acc));
}

/** A project the host's board summary covers: its numbers as cutex counted them (null parts stay unknown). */
function addSummary(acc: Acc, sum: BoardSummaryProject, hostId: string, parts: BoardBackendParts, nameOf: (id: string) => string | null): void {
  if (sum.openDelegations !== null) acc.openDelegations += sum.openDelegations;
  else acc.unknown.delegations = true;
  if (sum.today) {
    acc.today ??= { done: 0, failed: 0 };
    acc.today.done += sum.today.done;
    acc.today.failed += sum.today.failed;
  } else acc.unknown.today = true;
  if (sum.needsYou !== null) acc.needsYou += sum.needsYou;
  else acc.unknown.needsYou = true;
  for (const p of sum.problems) acc.problems.push(summaryProblem(p, hostId, sum, nameOf));
  if (sum.problemCount === null) acc.unknown.problems = true;
  else {
    const unlisted = sum.problemCount - sum.problems.length;
    if (sum.softCount === null) acc.unsized += unlisted;
    else {
      // Per-code counts: the unlisted split is exact.
      const hard = Math.min(unlisted, Math.max(0, sum.problemCount - sum.softCount - sum.problems.filter((x) => !x.soft).length));
      acc.hardUnlisted += hard;
      acc.softUnlisted += unlisted - hard;
    }
  }
  for (const d of sum.delegations) {
    const who = (d.target ? nameOf(d.target) : null) ?? "";
    const steps = parts.steps ? d.steps : null;
    const target = { kind: "delegation" as const, hostId, askId: d.askId };
    const tool = d.toolSince ? { toolSince: d.toolSince } : {};
    if (d.note && d.at) acc.recent.push({ kind: "progress", text: `${who}: ${d.note}${steps ? ` (${steps.done}/${steps.total})` : ""}`, at: d.at, target, ...tool });
    else if (d.toolSince) acc.recent.push({ kind: "started", text: `${who}: ${d.title}`, at: d.toolSince, target, ...tool });
  }
}

function finish(acc: Acc): BoardProjectView {
  const all = [...(acc.director ? [acc.director] : []), ...acc.members];
  const n = (s: BoardMemberState) => all.filter((m) => m.state === s).length;
  const recent = acc.recent.sort((a, b) => ms(b.at) - ms(a.at)).slice(0, 5);
  const lastActivityAt = Math.max(0, ...all.map((m) => m.activityAt), ...recent.map((r) => ms(r.at))) || null;
  const strip = <T extends BoardMemberView>(m: T): BoardMemberView => ({ hostId: m.hostId, sessionId: m.sessionId, name: m.name, initials: m.initials, director: m.director, state: m.state, doing: m.doing, since: m.since });
  return {
    key: acc.key, name: acc.name, color: acc.color, places: acc.places,
    director: acc.director ? strip(acc.director) : null,
    members: orderMembers(acc.members.map(strip)),
    counts: { busy: n("busy"), idle: n("idle"), paused: n("paused"), error: n("error"), offline: n("offline"), openDelegations: acc.unknown.delegations ? null : acc.openDelegations },
    today: acc.unknown.today ? null : acc.today, needsYou: acc.unknown.needsYou ? null : acc.needsYou,
    // Hard problems first; soft ones (lastTurnFailed) after them.
    problems: [...acc.problems.filter((x) => !x.soft), ...acc.problems.filter((x) => x.soft)],
    problemCount: acc.problems.length + acc.hardUnlisted + acc.softUnlisted + acc.unsized,
    hardProblems: acc.problems.filter((x) => !x.soft).length + acc.hardUnlisted, unsizedProblems: acc.unsized,
    problemsUnknown: acc.unknown.problems, recent, lastActivityAt,
    plan: acc.plan, goal: acc.goal, goalUnknown: acc.goalUnknown,
  };
}

/** Projects in board order: pinned (in the owner's order), then the owner's order, then the most recently active; hidden left out. */
export function orderProjects(projects: readonly BoardProjectView[], prefs: Pick<BoardPrefs, "order" | "pinned" | "hidden">): BoardProjectView[] {
  const hidden = new Set(prefs.hidden), pinned = new Set(prefs.pinned);
  const pos = new Map(prefs.order.map((k, i) => [k, i] as const));
  const rank = (p: BoardProjectView) => (pinned.has(p.key) ? 0 : 1);
  return projects.filter((p) => !hidden.has(p.key)).sort((a, b) =>
    rank(a) - rank(b)
    || (pos.get(a.key) ?? Infinity) - (pos.get(b.key) ?? Infinity)
    || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
    || a.name.localeCompare(b.name));
}

/** 正常 / 出问题 / 情况不明 / 安静 (display rule: problems first; then unknown — a source of problems could not be read,
 *  so it is never shown as 正常; quiet = nobody online and nothing for a day). */
export type BoardHealth = "ok" | "problem" | "unknown" | "quiet";
export function healthOf(p: BoardProjectView, now: number): BoardHealth {
  // Only known-hard problems are 出问题. Soft ones (an idle member's failed last turn) show on the card; unlisted ones
  // of unknown severity make it 情况不明, never 出问题 or 正常.
  if (p.hardProblems > 0) return "problem";
  if (p.problemsUnknown || p.unsizedProblems > 0) return "unknown";
  const online = p.counts.busy + p.counts.idle + p.counts.paused + p.counts.error;
  if (online === 0 && (!p.lastActivityAt || now - p.lastActivityAt > DAY_MS)) return "quiet";
  return "ok";
}

/** Which parts are on across the given hosts (any host providing it). */
export function mergedBackendParts(hosts: readonly Pick<BoardHostInput, "features">[]): BoardBackendParts {
  const parts = hosts.map((h) => backendParts(h.features));
  return { summary: parts.some((p) => p.summary), steps: parts.some((p) => p.steps), stalled: parts.some((p) => p.stalled), plan: parts.some((p) => p.plan) };
}
