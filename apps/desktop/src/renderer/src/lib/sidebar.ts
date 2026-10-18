import type { HostSessionRow, ProjectSummary, SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../../../shared/ipc";
import { hostKey, type HostKey } from "./hostKeys";
import { initialOf, initialStem, projectInitials } from "./agentInitials";

/**
 * `unknown`: not confirmed yet — the row comes from a stale snapshot (host / app reconnecting, its first
 * current snapshot not here yet) and nothing live this run says otherwise. Shown as 「连接中」, never as
 * the cached online / running (a reboot may have stopped it) nor as offline (it may be running).
 */
export type AgentStatus = "needsInput" | "running" | "idle" | "offline" | "error" | "unknown";

export interface AgentRow {
  id: string;
  name: string;
  subtitle: string;
  status: AgentStatus;
  isDirector: boolean;
  pinned: boolean;
  lastActivity: number;
  profile: string | null;
  /** Avatar color hint (profile appearance if known). */
  color: string | null;
  session: SessionResource;
  /** The desktop host id the agent lives on (multi-host; absent in hand-built rows = the focus host). */
  hostId?: string;
  /** `hostKey(hostId, id)`: unique across hosts (React keys, selection, attention). */
  key?: HostKey;
  /** Generated avatar initial without the project's shared prefix / revision suffix (lib/agentInitials). */
  initial?: string;
}

export interface ProjectGroup {
  kind: "project";
  id: string;
  /** The desktop host id (multi-host; absent = the focus host). */
  hostId?: string;
  /** `hostKey(hostId, projectId)` (prefs: order, stars, folds). */
  key?: HostKey;
  name: string;
  badge: string;
  color: string;
  online: AgentRow[];
  offline: AgentRow[];
}

export interface IndependentGroup {
  kind: "independent";
  id: "__independent__";
  hostId?: string;
  key?: HostKey;
  online: AgentRow[];
  offline: AgentRow[];
}

export type SidebarGroup = ProjectGroup | IndependentGroup;

export interface SidebarOptions {
  pinned?: ReadonlySet<string>;
  /** Session ids with a pending server request (approval / question). */
  needsInput?: ReadonlySet<string>;
  /** Split quick chats into their own list (cutex human-create-session); otherwise they stay agents. */
  chats?: boolean;
  /** The desktop host id the snapshot is from: rows and groups carry it and their host keys. */
  hostId?: string;
  /**
   * A stale snapshot (host reconnecting, its first snapshot not here yet): agents show `unknown`
   * unless `liveStatus` has their status; each stays in the online / offline list it had.
   */
  statusUnknown?: boolean;
  /** Statuses known live this run (lib/sidebar `liveStatusOf` of the open session views); used while `statusUnknown`. */
  liveStatus?: ReadonlyMap<string, AgentStatus>;
}

/** Rows equal field by field (the session resource by identity): a rebuilt model's unchanged row. */
export function sameAgentRow(a: { row: AgentRow }, b: { row: AgentRow }): boolean {
  if (a.row === b.row) return true;
  const keys = Object.keys(a.row) as (keyof AgentRow)[];
  return keys.length === Object.keys(b.row).length && keys.every((k) => a.row[k] === b.row[k]);
}

/**
 * The sidebar's own group ids (not daemon ids) that host-keyed prefs store: 独立智能体, the 快速会话
 * list, 其他项目. Every host's snapshot claims them (store `snapshotIds`, lib/hostKeys).
 */
export const SIDEBAR_GROUP_IDS: readonly string[] = ["__independent__", "__chats__", "__other__"];

/** A row's / group's key across hosts (hand-built ones without a host: their bare id). */
export const rowKey = (row: Pick<AgentRow, "id" | "key">): string => row.key ?? row.id;
export const groupKey = (group: Pick<SidebarGroup, "id" | "key">): string => group.key ?? group.id;

/**
 * Quick chat: a plain owned session (`POST /v2/human/sessions`, `cutex new`, TUI "New session") —
 * local-only registration and no formal agent identity. Host rows call these kind "Session".
 */
export function isQuickChat(session: SessionResource, host?: HostSessionRow): boolean {
  if (session.formalAgentName) return false;
  if (session.registrationClass === "local_only") return true;
  return session.registrationClass == null && host?.kind === "Session";
}

/** cutex's placeholder name for an owned session until the native thread has a title. */
const PLACEHOLDER_CHAT_NAME = /^Session [0-9a-f]{8}$/;

/** Quick chat still carrying cutex's "Session 01a110ec" placeholder → the given label ("新会话"). */
export function untitledChatName(session: SessionResource, label: string): string | null {
  return isQuickChat(session) && PLACEHOLDER_CHAT_NAME.test(session.displayName) ? label : null;
}

/** Pinned first (menu 置顶), then newest first: last activity, then creation time, then id for a stable order. */
export function compareChats(a: AgentRow, b: AgentRow): number {
  return Number(b.pinned) - Number(a.pinned) || b.lastActivity - a.lastActivity ||timestamp(b.session.createdAt) - timestamp(a.session.createdAt) || a.id.localeCompare(b.id);
}

type PendingViews = Record<string, { timeline: { pending: { size: number } } }>;

/** Agents waiting for the user (pending approval / question / elicitation) — the ⚠ rows. */
export function needsInputIds(sessions: PendingViews): Set<string> {
  return new Set(Object.entries(sessions).filter(([, v]) => v.timeline.pending.size > 0).map(([id]) => id));
}

type MethodViews = Record<string, { timeline: { pending: ReadonlyMap<string, { method: string }> } }>;

/**
 * Pending native requests per agent (agent → methods): the loaded timelines' (`views`), then the host
 * feed's (`feed`, store `hostWaiting`) for agents whose view has none — not open here, so its feed is
 * not subscribed (or a cached view went stale) — a new approval of any agent shows at once.
 */
export function pendingByAgent(views: MethodViews, feed?: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, v] of Object.entries(views)) if (v.timeline.pending.size > 0) out[id] = [...v.timeline.pending.values()].map((p) => p.method);
  for (const [id, methods] of Object.entries(feed ?? {})) if (!out[id] && methods.length) out[id] = [...methods];
  return out;
}

/** Tray / taskbar attention count; same rule as the sidebar's ⚠ rows. */
export function waitingAgentCount(sessions: PendingViews): number {
  let count = 0;
  for (const view of Object.values(sessions)) if (view.timeline.pending.size > 0) count++;
  return count;
}

/** The parts of a session view (store `SessionView`) that tell its live runtime state. */
export interface LiveViewLike {
  loading: boolean;
  connection: "connecting" | "live" | "retrying";
  historySource: "live" | "offline" | "archived";
  timeline: { pending: { size: number }; activeTurnId: string | null };
}

/**
 * What a session view connected this run knows about its agent (null: nothing current — not loaded,
 * its feed (re)connecting, or an archived read-only view). A turn in progress = running, a view of
 * stored history = offline (re-bootstrapped once the runtime comes online).
 */
export function liveStatusOf(view: LiveViewLike | undefined): AgentStatus | null {
  if (!view || view.loading || view.connection !== "live" || view.historySource === "archived") return null;
  if (view.timeline.pending.size > 0) return "needsInput";
  if (view.historySource === "offline") return "offline";
  return view.timeline.activeTurnId ? "running" : "idle";
}

/** Live statuses of session views by id (only those that know one). */
export function liveStatuses(views: Record<string, LiveViewLike>): Map<string, AgentStatus> {
  const out = new Map<string, AgentStatus>();
  for (const [id, view] of Object.entries(views)) {
    const status = liveStatusOf(view);
    if (status) out.set(id, status);
  }
  return out;
}

/** Agents of a group confirmed online (「N 在线」): rows not yet confirmed (`unknown`) don't count. */
export function onlineCount(group: Pick<SidebarGroup, "online">): number {
  return group.online.filter((r) => r.status !== "unknown").length;
}

export function agentStatus(session: SessionResource, needsInput: boolean): AgentStatus {
  if (session.lifecycle === "retired") return "offline";
  if (needsInput) return "needsInput";
  if (session.runtime.status === "error") return "error";
  if (session.runtime.status !== "online") return "offline";
  return session.runtime.activeTurnId ? "running" : "idle";
}

/**
 * Director first, then manual pins, then name. Deliberately stable: status (running / needs input)
 * and activity change constantly and would make rows jump under the cursor; status is shown by the
 * dot and the second line instead.
 */
export function compareRows(a: AgentRow, b: AgentRow): number {
  return Number(b.isDirector) - Number(a.isDirector) || Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name);
}

function timestamp(value: string | null | undefined): number {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * When the agent last had real conversation activity (ms): cutex's `activity.lastConversationAt`
 * (capability session-conversation-activity: turns started / ended, output, tool calls, file changes).
 * Older cutex: the newest of the activity projection's turn / item times. Never the runtime's
 * `lastEventAt` (a restart or reconnect) nor `updatedAt` (rename, profile, settings, lifecycle);
 * an agent without any activity yet: its creation time.
 */
export function conversationActivity(session: SessionResource): number {
  const a = session.activity as Record<string, unknown> | null;
  if (a && typeof a.lastConversationAt === "string") return timestamp(a.lastConversationAt) || timestamp(session.createdAt);
  const at = (v: unknown) => (typeof v === "string" ? timestamp(v) : 0);
  const nested = (v: unknown) => (v && typeof v === "object" ? at((v as { updatedAt?: unknown }).updatedAt) : 0);
  const legacy = a ? Math.max(at(a.lastTurnStartedAt), at(a.lastOutputAt), at(a.lastOutputCompletedAt), at(a.lastTurnCompletedAt), at(a.lastFileChangeAt), nested(a.lastOutput), nested(a.lastToolCall)) : 0;
  return legacy || timestamp(session.createdAt);
}

function rowStatus(session: SessionResource, options: SidebarOptions): AgentStatus {
  const id = session.cutexSessionId;
  if (!options.statusUnknown || session.lifecycle === "retired") return agentStatus(session, options.needsInput?.has(id) ?? false);
  return options.liveStatus?.get(id) ?? (options.needsInput?.has(id) ? "needsInput" : "unknown");
}

/** Whether a row goes to its group's offline list: offline, or unconfirmed and offline in its snapshot. */
function listedOffline(row: AgentRow): boolean {
  return row.status === "offline" || (row.status === "unknown" && agentStatus(row.session, false) === "offline");
}

function rowFor(
  session: SessionResource,
  host: HostSessionRow | undefined,
  directors: ReadonlySet<string>,
  options: SidebarOptions,
): AgentRow {
  const style = host?.profileStyle as { color?: unknown } | null | undefined;
  return {
    id: session.cutexSessionId,
    name: session.displayName,
    subtitle: session.threadName && session.threadName !== session.displayName ? session.threadName : session.cwd ?? "",
    status: rowStatus(session, options),
    isDirector: directors.has(session.cutexSessionId),
    pinned: options.pinned?.has(session.cutexSessionId) ?? false,
    lastActivity: conversationActivity(session),
    profile: session.launchedProfile ?? session.configuredProfile,
    color: typeof style?.color === "string" ? style.color : null,
    session,
    ...(options.hostId !== undefined ? { hostId: options.hostId, key: hostKey(options.hostId, session.cutexSessionId) } : {}),
  };
}

export interface SidebarModel {
  groups: SidebarGroup[];
  /** Quick chats (newest first); empty unless `options.chats`. Never part of `groups`. */
  chats: AgentRow[];
  /** Retired agents; shown in Settings → Archive, not in the sidebar. */
  archived: AgentRow[];
}

/** Groups agents IM-style: project → online / offline; agents without a project last. */
export function buildSidebar(snapshot: SidebarSnapshot, options: SidebarOptions = {}): SidebarModel {
  const summaries: ProjectSummary[] = snapshot.projects?.projects ?? [];
  const directors = new Set(summaries.map((p) => p.director_cutex_session_id).filter((id): id is string => !!id));
  const projects = new Map<string, ProjectGroup>();
  const host = options.hostId;
  const keyed = (id: string) => (host !== undefined ? { hostId: host, key: hostKey(host, id) } : {});
  const project = (id: string, name: string, badge: string, color: string): ProjectGroup => {
    const group: ProjectGroup = { kind: "project", id, ...keyed(id), name, badge, color, online: [], offline: [] };
    projects.set(id, group);
    return group;
  };
  for (const p of summaries) {
    project(p.project_id, p.presentation.display_name || p.project_id, p.presentation.badge_label, p.presentation.color);
  }
  const independent: IndependentGroup = { kind: "independent", id: "__independent__", ...keyed("__independent__"), online: [], offline: [] };
  const chats: AgentRow[] = [];

  for (const session of snapshot.active) {
    const host = snapshot.hostRows[session.cutexSessionId];
    const row = rowFor(session, host, directors, options);
    if (options.chats && !host?.projectId && isQuickChat(session, host)) {
      chats.push(row);
      continue;
    }
    const projectId = host?.projectId ?? null;
    let group: ProjectGroup | IndependentGroup = independent;
    if (projectId) {
      // Unknown project id (e.g. archived project): still group by it if we know its name.
      group = projects.get(projectId) ?? (host?.projectName ? project(projectId, host.projectName, "", "blue") : independent);
    }
    (listedOffline(row) ? group.offline : group.online).push(row);
  }
  const archived = snapshot.retired
    .map((s) => rowFor(s, snapshot.hostRows[s.cutexSessionId], directors, options))
    .sort((a, b) => b.lastActivity - a.lastActivity);

  const size = (g: SidebarGroup) => g.online.length + g.offline.length;
  const groups: SidebarGroup[] = [...projects.values()].filter((g) => size(g) > 0);
  for (const g of [...groups, independent]) {
    g.online.sort(compareRows);
    g.offline.sort(compareRows);
    const members = [...g.online, ...g.offline];
    // Independent agents share no project prefix: only their revision suffix is skipped.
    const initials = g.kind === "project" ? projectInitials(members.map((r) => r.name), [g.id, g.name]) : null;
    for (const r of members) r.initial = initials?.get(r.name) ?? initialOf(initialStem(r.name));
  }
  // Projects with live agents first, then by name.
  groups.sort(compareProjects);
  if (size(independent) > 0) groups.push(independent);
  chats.sort(compareChats);
  return { groups, chats, archived };
}

/** Projects with live agents first, then by name. */
export function compareProjects(a: SidebarGroup, b: SidebarGroup): number {
  return b.online.length - a.online.length || (a as ProjectGroup).name.localeCompare((b as ProjectGroup).name);
}

/** Apply the owner's dragged project order: listed projects first in that order, the rest keep the
 *  automatic order after them; the no-project groups stay last. `order` lists group keys (groupKey). */
export function orderGroups(groups: SidebarGroup[], order: readonly string[]): SidebarGroup[] {
  if (order.length === 0) return groups;
  const rank = new Map(order.map((id, i) => [id, i]));
  const at = (g: SidebarGroup) => (g.kind === "independent" ? Infinity : (rank.get(groupKey(g)) ?? order.length));
  // Array.prototype.sort is stable, so unlisted projects keep their automatic order.
  return [...groups].sort((a, b) => at(a) - at(b));
}

/** The order after dropping `dragged` before (or after) `target`, over the projects shown now. */
export function moveProject(shown: readonly string[], dragged: string, target: string, after: boolean): string[] {
  if (dragged === target) return [...shown];
  const rest = shown.filter((id) => id !== dragged);
  const i = rest.indexOf(target);
  if (i < 0) return [...shown];
  rest.splice(after ? i + 1 : i, 0, dragged);
  return rest;
}

/** Map cutex project color names to CSS colors. */
export function projectColor(color: string): string {
  const named: Record<string, string> = {
    cyan: "#22b8cf",
    blue: "#4c8dff",
    green: "#40c057",
    magenta: "#d6336c",
    yellow: "#fab005",
    red: "#fa5252",
  };
  return named[color] ?? (/^#[0-9a-f]{6}$/i.test(color) ? color : "#868e96");
}
