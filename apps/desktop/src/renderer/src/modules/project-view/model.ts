// Project 视图 model (pure, unit-tested in test/projectView.test.ts): which project the pane shows, how
// the project's agents are grouped and folded, and the recent-activity list derived from what the app
// already holds (delegation records, plan updates seen on the host feed, artifacts, services, the
// needs-you state). No backend of its own: there is no cutex event log, so every row is derived.
import type { AskSummary, ServiceView } from "../../../../shared/ipc";
import type { AgentSignal } from "../../lib/agentAttention";
import { delegationBucket, requesterName, requesterSession } from "../../lib/delegations";
import { isStreamGroup, type StreamGroup } from "./stream";
import { share } from "../../lib/structuralShare";
import { placeRoster, rosterTier } from "../../lib/rosterTiers";
import { compareRoster } from "../../lib/rosterOrder";

// ── State ─────────────────────────────────────────────────────────────────────────────────────────

export const KIND = "project-view.view";

/**
 * The view's split (owner 2026-10-28: a long 项目交接 + Director card + 最近活跃 left 动态 one row):
 * the header stays; 项目交接 and the agents share ONE scroll region sized to its content; 动态 takes
 * the rest but never less than half the view (at most 20rem), with its own scroll — so the feed's
 * new-rows pill, sticky days and paging keep working and nothing nests. Classes for both 动态 bodies.
 */
export const UPPER_CLASS = "min-h-0 flex-[0_1_auto] overflow-y-auto overscroll-contain";
export const ACTIVITY_CLASS = "flex min-h-[min(50%,20rem)] flex-1 flex-col border-t border-border";

export type ActivityKind = "delegate" | "complete" | "progress" | "publish" | "needsYou";
export const ACTIVITY_KINDS: readonly ActivityKind[] = ["delegate", "complete", "progress", "publish", "needsYou"];

/** Pane params: the project (absent = follow the focused conversation's project). */
export interface ViewParams {
  hostId?: string;
  projectId?: string;
}

/**
 * Pane state (≤ 4 KiB): the chosen project (null = follow), 只看需要你, the activity type chips, 空闲 unfolded;
 * with cutex `project-events` (「动态」, stream.ts): its type chips, its agent filter and 正在进行 open / closed
 * (null = not toggled: open when few things run).
 */
export interface ViewState {
  hostId: string | null;
  projectId: string | null;
  needsOnly: boolean;
  kinds: ActivityKind[];
  /** 「在线空闲 +N」 expanded. */
  idleOpen: boolean;
  /** 「离线 +N」 expanded. */
  offlineOpen: boolean;
  evKinds: StreamGroup[];
  evAgent: string | null;
  runOpen: boolean | null;
}

export const emptyState = (): ViewState => ({ hostId: null, projectId: null, needsOnly: false, kinds: [], idleOpen: false, offlineOpen: false, evKinds: [], evAgent: null, runOpen: null });

const isKind = (k: unknown): k is ActivityKind => typeof k === "string" && (ACTIVITY_KINDS as readonly string[]).includes(k);

export function parseParams(raw: unknown): ViewParams | null {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const hostId = typeof r.hostId === "string" && r.hostId ? r.hostId : undefined;
  const projectId = typeof r.projectId === "string" && r.projectId ? r.projectId : undefined;
  // A project needs its host (project ids are per host).
  if (projectId && !hostId) return null;
  return { ...(hostId && projectId ? { hostId, projectId } : {}) };
}

/** One tab per project; one 「follow」 tab. */
export const dedupeKey = (p: ViewParams): string => (p.projectId ? `${p.hostId}\n${p.projectId}` : "∅");

export function initState(p: ViewParams, previous: ViewState | null): ViewState {
  const base = previous ?? emptyState();
  return p.projectId ? { ...base, hostId: p.hostId ?? null, projectId: p.projectId } : base;
}

export function restoreState(raw: unknown): ViewState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const hostId = typeof r.hostId === "string" ? r.hostId : null;
  const projectId = typeof r.projectId === "string" && hostId ? r.projectId : null;
  return {
    hostId: projectId ? hostId : null,
    projectId,
    needsOnly: r.needsOnly === true,
    kinds: Array.isArray(r.kinds) ? [...new Set(r.kinds.filter(isKind))] : [],
    idleOpen: r.idleOpen === true,
    offlineOpen: r.offlineOpen === true,
    evKinds: Array.isArray(r.evKinds) ? [...new Set(r.evKinds.filter(isStreamGroup))] : [],
    evAgent: typeof r.evAgent === "string" && r.evAgent.length <= 200 ? r.evAgent : null,
    runOpen: typeof r.runOpen === "boolean" ? r.runOpen : null,
  };
}

// ── Agents: grouping and folding ──────────────────────────────────────────────────────────────────

export interface MemberInput {
  /** Session id. */
  id: string;
  name: string;
  isDirector: boolean;
  signal: AgentSignal;
  /** The runtime is online (sidebar status not offline / unknown). */
  online: boolean;
  /** ms; the latest of the row's activity and its preview. */
  lastActivity: number;
}

/** What the agent has going on besides its own turn: open delegations both ways, jobs, terminals, sub-agents. */
export interface MemberLoad {
  delegationsIn: number;
  delegationsOut: number;
  jobs: number;
  terminals: number;
  subagents: number;
}
export const NO_LOAD: MemberLoad = { delegationsIn: 0, delegationsOut: 0, jobs: 0, terminals: 0, subagents: 0 };
const loadTotal = (l: MemberLoad) => l.delegationsIn + l.delegationsOut + l.jobs + l.terminals + l.subagents;

export type Tier = "needsYou" | "running" | "recent" | "idle";

/**
 * The sidebar's tier (lib/rosterTiers rosterTier, the same 7-day window): its first tier splits into needsYou
 * (waits for the owner, or failed) and running; recent = worked lately; idle = not listed. Online or offline
 * does not matter here (placeRoster folds by it). The Director has its own card (groupMembers), not a tier.
 */
export function tierOf(m: MemberInput, load: MemberLoad, now: number): Tier {
  const tier = rosterTier({ signal: m.signal, busy: loadTotal(load) > 0, lastActivity: m.lastActivity }, now);
  if (tier === "now") return m.signal === "needsYou" || m.signal === "error" ? "needsYou" : "running";
  return tier === "recent" ? "recent" : "idle";
}

export interface Grouped<M extends MemberInput> {
  director: M | null;
  needsYou: M[];
  running: M[];
  /** Recently worked: at most RECENT_CAP, the newest (lib/rosterTiers placeRoster). */
  recent: M[];
  /** 「在线空闲 +N」: online members not listed (past the cap too). */
  idle: M[];
  /** 「离线 +N」: offline members not listed. */
  offline: M[];
}

/** The sidebar's order (lib/rosterOrder): online before offline, then name (the name order setting), then id. */
const byRoster = compareRoster<MemberInput>((m) => m.online);

/**
 * The sidebar's rule (lib/rosterTiers placeRoster, design 060 §5): the Director goes to its own card (first
 * director row; `directorId` from the project summary wins); listed without labels: needs-you / error,
 * running, then at most RECENT_CAP recently worked; everyone else folds into idle (online) or offline. Each
 * list in the sidebar's order (online first, then name). `needsOnly` keeps only the needs-you group.
 */
export function groupMembers<M extends MemberInput>(members: readonly M[], loadOf: (id: string) => MemberLoad, now: number, opts: { directorId?: string | null; needsOnly?: boolean } = {}): Grouped<M> {
  const director = (opts.directorId ? members.find((m) => m.id === opts.directorId) : undefined) ?? members.find((m) => m.isDirector) ?? null;
  const tiers = new Map<M, Tier>();
  for (const m of members) if (m !== director) tiers.set(m, tierOf(m, loadOf(m.id), now));
  const others = [...tiers.keys()].filter((m) => !opts.needsOnly || tiers.get(m) === "needsYou");
  const placed = placeRoster<M>(others, (m) => { const tier = tiers.get(m)!; return tier === "needsYou" || tier === "running" ? "now" : tier === "recent" ? "recent" : "rest"; }, { online: (m) => m.online, lastOf: (m) => m.lastActivity, order: byRoster as (a: M, b: M) => number });
  return { director, needsYou: placed.now.filter((m) => tiers.get(m) === "needsYou"), running: placed.now.filter((m) => tiers.get(m) === "running"), recent: placed.recent, idle: placed.idle, offline: placed.offline };
}

export interface Counts {
  total: number;
  online: number;
  running: number;
  /** Needs-you plus errors. */
  needsYou: number;
}

export function countMembers(members: readonly MemberInput[]): Counts {
  let online = 0;
  let running = 0;
  let needsYou = 0;
  for (const m of members) {
    if (m.online) online++;
    if (m.signal === "running") running++;
    if (m.signal === "needsYou" || m.signal === "error") needsYou++;
  }
  return { total: members.length, online, running, needsYou };
}

// ── Delegations of an agent ────────────────────────────────────────────────────────────────────────

/** Open delegations an agent sent (out) and received (in), newest first. */
/** Not closed and not finished (answered and accepted, failed, cancelled, …). */
export const isOpenAsk = (a: AskSummary): boolean => !a.closed && delegationBucket(a) !== "done";

export function openDelegationsOf(asks: readonly AskSummary[], id: string): { out: AskSummary[]; in: AskSummary[] } {
  const open = asks.filter(isOpenAsk);
  const newest = (a: AskSummary, b: AskSummary) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.askId.localeCompare(b.askId);
  return { out: open.filter((a) => requesterSession(a.requester) === id).sort(newest), in: open.filter((a) => a.target === id).sort(newest) };
}

/** Delegations that belong to the project: its id, or one party is a member. */
export function projectAsks(asks: readonly AskSummary[], projectId: string, members: ReadonlySet<string>): AskSummary[] {
  return asks.filter((a) => a.projectId === projectId || members.has(a.target) || members.has(requesterSession(a.requester) ?? ""));
}

// ── Recent activity ───────────────────────────────────────────────────────────────────────────────

export type ActivityTarget =
  | { kind: "agent"; sessionId: string }
  | { kind: "delegation"; askId: string; title: string }
  | { kind: "artifact"; ref: string; name: string }
  | { kind: "service"; slug: string; name: string };

/** Why the owner is wanted (the row's text picks a phrase). */
export type NeedsReason = "review" | "question" | "acceptance" | "unknown" | "other";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  /** ms */
  at: number;
  /** Who did it (session id); null = the owner, or a party outside this host (`actorName`). */
  actor: string | null;
  actorName?: string | null;
  open: ActivityTarget;
} & (
  | { what: "delegate"; to: string; toName: string | null; title: string }
  | { what: "complete"; from: string | null; fromName: string | null; title: string; failed: boolean }
  | { what: "note"; text: string }
  | { what: "plan"; done: number; total: number; step: string | null }
  | { what: "artifact"; name: string }
  | { what: "service"; name: string }
  | { what: "needsDelegation"; title: string; reason: NeedsReason }
  | { what: "needsAgent"; error: boolean; text: string | null }
);

/** A plan update seen on the host feed (live.ts). */
export interface PlanEvent {
  sessionId: string;
  at: number;
  done: number;
  total: number;
  /** The step in progress (else the next pending one); null when all are done. */
  step: string | null;
}

/** A published artifact version (the project's artifact list, or a live publish event). */
export interface ArtifactEvent {
  artifactId: string;
  version: number;
  name: string;
  at: number;
  sessionId: string | null;
  producerName: string | null;
}

/** An agent that waits for the owner without a delegation saying why (an approval, a question), or failed. */
export interface AgentNeed {
  sessionId: string;
  at: number;
  error: boolean;
  /** The error / the reason text shown after the name. */
  text: string | null;
}

export interface ActivityInput {
  projectId: string;
  members: ReadonlySet<string>;
  asks: readonly AskSummary[];
  plans: readonly PlanEvent[];
  artifacts: readonly ArtifactEvent[];
  services: readonly ServiceView[];
  needs: readonly AgentNeed[];
}

export const ACTIVITY_LIMIT = 200;

const ms = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

function needsReason(a: AskSummary): NeedsReason {
  if (a.execution === "pendingReview") return "review";
  if ((a.ownerQuestions ?? 0) > 0) return "question";
  if (a.execution === "answered" && a.review === "awaitingAcceptance") return "acceptance";
  if (a.execution === "interrupted") return "unknown";
  return "other";
}

/**
 * The project's recent activity, newest first (ties: kind order, then id), at most ACTIVITY_LIMIT rows:
 * - 委托: each delegation's creation (requester → target);
 * - 完成: a delegation answered / closed as completed or accepted (failed ones too, marked);
 * - 进度: the progress notes of delegation attempts, and plan updates seen live;
 * - 发布: artifact versions and registered services of members / the project;
 * - 需要你: delegations that wait for the owner, and agents that wait (approval, question) or failed.
 */
export function deriveActivity(input: ActivityInput): ActivityItem[] {
  const { members } = input;
  const out = new Map<string, ActivityItem>();
  const add = (item: ActivityItem) => {
    if (item.at > 0 && !out.has(item.id)) out.set(item.id, item);
  };
  for (const a of projectAsks(input.asks, input.projectId, members)) {
    const from = requesterSession(a.requester);
    const fromName = requesterName(a.requester);
    const dlg: ActivityTarget = { kind: "delegation", askId: a.askId, title: a.title };
    add({ id: `delegate:${a.askId}`, kind: "delegate", what: "delegate", at: ms(a.createdAt), actor: from, actorName: fromName, to: a.target, toName: a.targetName ?? null, title: a.title, open: dlg });
    const failed = a.execution === "failed";
    const answered = a.execution === "answered" || failed || a.closed === "completed" || a.closed === "accepted";
    if (answered && a.closed !== "cancelled" && a.closed !== "abandoned") {
      const at = ms(a.attempt?.endedAt ?? null) || ms(a.closedAt) || ms(a.updatedAt);
      add({ id: `complete:${a.askId}`, kind: "complete", what: "complete", at, actor: a.target, actorName: a.targetName ?? null, from, fromName, title: a.title, failed, open: dlg });
    }
    for (const note of a.attempt?.progress ?? []) {
      add({ id: `note:${a.askId}:${note.at}`, kind: "progress", what: "note", at: ms(note.at), actor: a.target, actorName: a.targetName ?? null, text: note.text, open: dlg });
    }
    if (delegationBucket(a) === "needsYou") {
      const reason = needsReason(a);
      const actor = reason === "review" ? from : a.target;
      const at = ms(a.holdSince ?? null) || ms(a.attempt?.endedAt ?? null) || ms(a.updatedAt);
      add({ id: `needs:${a.askId}`, kind: "needsYou", what: "needsDelegation", at, actor, actorName: reason === "review" ? fromName : (a.targetName ?? null), title: a.title, reason, open: dlg });
    }
  }
  for (const p of input.plans) {
    if (!members.has(p.sessionId)) continue;
    add({ id: `plan:${p.sessionId}:${p.at}`, kind: "progress", what: "plan", at: p.at, actor: p.sessionId, done: p.done, total: p.total, step: p.step, open: { kind: "agent", sessionId: p.sessionId } });
  }
  for (const v of input.artifacts) {
    add({ id: `artifact:${v.artifactId}:${v.version}`, kind: "publish", what: "artifact", at: v.at, actor: v.sessionId, actorName: v.producerName, name: v.name, open: { kind: "artifact", ref: `${v.artifactId}@latest`, name: v.name } });
  }
  for (const s of input.services) {
    if (s.projectId !== input.projectId && !members.has(s.ownerCutexSessionId ?? "")) continue;
    add({ id: `service:${s.slug}`, kind: "publish", what: "service", at: ms(s.createdAt), actor: s.ownerCutexSessionId, name: s.displayName || s.slug, open: { kind: "service", slug: s.slug, name: s.displayName || s.slug } });
  }
  for (const n of input.needs) {
    if (!members.has(n.sessionId)) continue;
    add({ id: `needs:agent:${n.sessionId}`, kind: "needsYou", what: "needsAgent", at: n.at, actor: n.sessionId, error: n.error, text: n.text, open: { kind: "agent", sessionId: n.sessionId } });
  }
  const order = (k: ActivityKind) => ACTIVITY_KINDS.indexOf(k);
  return [...out.values()].sort((a, b) => b.at - a.at || order(a.kind) - order(b.kind) || a.id.localeCompare(b.id)).slice(0, ACTIVITY_LIMIT);
}

/** The type chips (none on = all) and 只看需要你 (= the 需要你 type only). */
/**
 * The same item objects while an item reads the same, matched by id (lib/structuralShare): the list is derived again on
 * every member change (a sidebar refresh), and ActivityRow (memo on its item) rendered every row again with it.
 */
export function shareActivity(prev: ReadonlyMap<string, ActivityItem>, next: readonly ActivityItem[]): ActivityItem[] {
  return next.map((item) => share(prev.get(item.id), item));
}

export function filterActivity(items: readonly ActivityItem[], kinds: readonly ActivityKind[], needsOnly: boolean): ActivityItem[] {
  if (needsOnly) return items.filter((i) => i.kind === "needsYou");
  if (!kinds.length) return [...items];
  const on = new Set(kinds);
  return items.filter((i) => on.has(i.kind));
}

/** Toggles a type chip. */
export function toggleKind(kinds: readonly ActivityKind[], kind: ActivityKind): ActivityKind[] {
  return kinds.includes(kind) ? kinds.filter((k) => k !== kind) : ACTIVITY_KINDS.filter((k) => k === kind || kinds.includes(k));
}

/** How many rows of each type (the chips' counts). */
export function kindCounts(items: readonly ActivityItem[]): Record<ActivityKind, number> {
  const out: Record<ActivityKind, number> = { delegate: 0, complete: 0, progress: 0, publish: 0, needsYou: 0 };
  for (const i of items) out[i.kind]++;
  return out;
}

// ── Plans ─────────────────────────────────────────────────────────────────────────────────────────

export interface PlanLike {
  steps: readonly { step: string; status: string }[];
}

/** Done / total and the current step of a plan snapshot (null: no steps). */
export function planSummary(plan: PlanLike | null | undefined): { done: number; total: number; step: string | null } | null {
  if (!plan || plan.steps.length === 0) return null;
  const done = plan.steps.filter((s) => s.status === "completed").length;
  const current = plan.steps.find((s) => s.status === "inProgress") ?? plan.steps.find((s) => s.status !== "completed");
  return { done, total: plan.steps.length, step: current?.step ?? null };
}
