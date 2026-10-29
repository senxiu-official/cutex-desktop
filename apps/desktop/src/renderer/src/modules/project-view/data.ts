import { contextProject } from "./context";
import { locate } from "../../lib/sideLayout";
import { useShelfLayout } from "../../lib/shelfSource";
// Project 视图 data (hooks only): everything comes from stores the app already keeps — the merged sidebar
// and its attention (lib/scopedSidebarView), the delegation records (lib/delegationStore), jobs
// (lib/jobStore), the loaded conversation views (sub-agents, background terminals, plan, goal), the plan
// cache (lib/planCache), the host's services, the project's artifact list (one read, again after an
// artifact event) and the module's own feed log (live.ts). No backend of its own.
import { useEffect, useMemo, useRef, useState } from "react";
import { ARTIFACTS_FEATURE, type ArtifactSummary } from "../../../../shared/artifactStore";
import type { AskSummary, JobRow, ServiceView } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { runningSince, type NeedsYou } from "../../lib/agentAttention";
import { previewFromResource, previewLine, type PreviewLine } from "../../lib/activity";
import { signalLabel } from "../../lib/attentionView";
import { loadClosedDelegations, useHostDelegations } from "../../lib/delegationStore";
import { hostData } from "../../lib/hostScope";
import { isJobFinished } from "../../lib/jobs";
import { refreshHostJobs, useHostJobs } from "../../lib/jobStore";
import { useAllJobs } from "../../lib/jobsView";
import { getCachedPlan } from "../../lib/planCache";
import { useScopedAttention, useScopedSidebar } from "../../lib/scopedSidebarView";
import { rowKey, type AgentRow, type ProjectGroup } from "../../lib/sidebar";
import { activeSubAgents } from "../../lib/subagents";
import { useSubAgentMeta } from "../../lib/subagentMetaStore";
import type { TimelineState } from "../../lib/timeline";
import { agentState, featuresOf, sidebarOf, useApp, viewOf } from "../../store";
import { services } from "../app";
import type { SideTabProps } from "../slots";
import {
  countMembers,
  deriveActivity,
  groupMembers,
  isOpenAsk,
  openDelegationsOf,
  planSummary,
  projectAsks,
  shareActivity,
  type ActivityItem,
  type AgentNeed,
  type ArtifactEvent,
  type Counts,
  type Grouped,
  type MemberInput,
  type MemberLoad,
  type ViewState,
} from "./model";
import { hostLive, useProjectLive } from "./live";

type AppState = ReturnType<typeof useApp.getState>;

export interface ProjectRef {
  hostId: string;
  projectId: string;
}

export interface ProjectChoice extends ProjectRef {
  name: string;
  badge: string;
  color: string;
  agents: number;
}

export interface Member extends MemberInput {
  hostId: string;
  row: AgentRow;
  needs: NeedsYou | undefined;
  /** 需要你 · 审批 / 出错 …; null when nothing to say. */
  signalText: string | null;
  preview: PreviewLine | null;
  /** The running turn's start (ms). */
  since: number | null;
  plan: { done: number; total: number; step: string | null } | null;
  goal: string | null;
  error: string | null;
  load: MemberLoad;
  dlgIn: AskSummary[];
  dlgOut: AskSummary[];
  jobs: JobRow[];
  terminals: { itemId: string; command: string }[];
  subagents: { threadId: string; name: string; task: string | null; message: string | null }[];
}

export interface ProjectData {
  /** The project shown (null: nothing chosen and the focused conversation has none). */
  target: ProjectRef | null;
  /** Shown because it is the focused conversation's project (no explicit choice). */
  following: boolean;
  group: ProjectGroup | null;
  hostLabel: string | null;
  hostColor: string | null;
  hostOffline: boolean;
  members: Member[];
  grouped: Grouped<Member>;
  counts: Counts;
  totals: { delegations: number; jobs: number; subagents: number };
  activity: ActivityItem[];
  /** Session id → name (members first; delegation records for others). */
  nameOf(id: string | null, fallback?: string | null): string | null;
  choices: ProjectChoice[];
}

// ── The views the store holds: sub-agents, background terminals, plan, goal ───────────────────────

interface ViewFacts {
  subagents: Member["subagents"];
  terminals: Member["terminals"];
  plan: TimelineState["plan"];
  goal: string | null;
}

/** Per timeline object + version (timelines are mutated in place; `version` bumps on every change). */
const factsCache = new WeakMap<TimelineState, { version: number; key: string; facts: ViewFacts }>();

function viewFacts(s: AppState, hostId: string, sessionId: string, online: boolean, meta: ReturnType<typeof useSubAgentMeta>): ViewFacts | null {
  const view = viewOf(s, hostId, sessionId);
  if (!view) return null;
  const timeline = view.timeline;
  const items = agentState(s.backgroundItems, hostId, sessionId) ?? [];
  const key = `${online}|${items.join(",")}`;
  const cached = factsCache.get(timeline);
  if (cached && cached.version === view.version && cached.key === key) return cached.facts;
  const subagents = activeSubAgents(timeline, online, s.subAgentLive, meta).map((a) => ({ threadId: a.threadId, name: a.name, task: a.task, message: a.message }));
  const terminals = items.map((itemId) => {
    const item = (timeline.entries.get(itemId) as { item?: { command?: unknown } } | undefined)?.item;
    return { itemId, command: typeof item?.command === "string" ? item.command : "" };
  });
  const goal = timeline.goal && timeline.goal.status !== "complete" ? timeline.goal.objective : null;
  const facts = { subagents, terminals, plan: timeline.plan, goal };
  factsCache.set(timeline, { version: view.version, key, facts });
  return facts;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────────────────────────

/** A pinned Shelf page follows context; explicitly opened project tabs keep their project. */
export function useProjectViewState(id: string, state: ViewState): ViewState {
  const layout = useShelfLayout();
  const shared = locate(layout, id)?.page.shared;
  return useMemo(() => shared ? { ...state, hostId: null, projectId: null } : state, [shared, state]);
}

/** Current project, retaining the last valid project when the focused agent is standalone. */
export function useFocusedProject(): ProjectRef | null {
  const key = useApp((s) => {
    const target = contextProject(s);
    return target ? `${target.hostId}\n${target.projectId}` : "";
  });
  return useMemo(() => {
    if (!key) return null;
    const [hostId, projectId] = key.split("\n") as [string, string];
    return { hostId, projectId };
  }, [key]);
}

/** The project's artifacts (latest version each), read once per project and again after an artifact event on its host. */
function useProjectArtifacts(target: ProjectRef | null): ArtifactEvent[] {
  const hostId = target?.hostId ?? "";
  const projectId = target?.projectId ?? "";
  const capable = useApp((s) => !!hostId && featuresOf(s, hostId).has(ARTIFACTS_FEATURE));
  const epoch = useProjectLive((s) => hostLive(s.byHost, hostId).artifactEpoch);
  const [list, setList] = useState<{ key: string; items: ArtifactSummary[] }>({ key: "", items: [] });
  useEffect(() => {
    if (!capable || !projectId) return;
    let live = true;
    const key = `${hostId}\n${projectId}`;
    services
      .daemonFor(hostId)
      .artifactStoreList({ project: projectId, limit: 50 })
      .then((r) => live && setList({ key, items: r?.items ?? [] }))
      .catch(() => live && setList({ key, items: [] }));
    return () => {
      live = false;
    };
  }, [capable, hostId, projectId, epoch]);
  return useMemo(
    () =>
      list.key === `${hostId}\n${projectId}`
        ? list.items.map((a) => ({
            artifactId: a.artifactId,
            version: a.latestVersion,
            name: a.name,
            at: Date.parse(a.latest.createdAt) || Date.parse(a.updatedAt) || 0,
            sessionId: a.latest.producer.kind === "agent" ? a.latest.producer.sessionId : null,
            producerName: a.latest.producer.displayName,
          }))
        : [],
    [list, hostId, projectId],
  );
}

/** Open jobs of the host (the focus host: the 作业 store, polled; another host: its slice, polled here). */
function useOpenJobs(hostId: string | null): JobRow[] {
  const focus = useApp((s) => s.hosts?.active ?? "local");
  const own = !hostId || hostId === focus;
  const all = useAllJobs();
  const other = useHostJobs((s) => (hostId ? s.byHost[hostId]?.rows : undefined));
  const enabled = useApp((s) => !!hostId && !own && featuresOf(s, hostId).has("job-service"));
  useEffect(() => {
    if (!enabled || !hostId) return;
    void refreshHostJobs(hostId);
    const timer = setInterval(() => !document.hidden && void refreshHostJobs(hostId), 30_000);
    return () => clearInterval(timer);
  }, [enabled, hostId]);
  return useMemo(() => {
    const rows = own ? (all.enabled ? Object.values(all.byId) : []) : (other ?? []);
    return rows.filter((j) => !isJobFinished(j));
  }, [own, all.enabled, all.byId, other]);
}

export function useProjectData(state: ViewState, now: number): ProjectData {
  const { t } = useI18n();
  const scoped = useScopedSidebar();
  const attention = useScopedAttention(scoped.model, scoped.scope);
  const focused = useFocusedProject();
  const focusHost = scoped.scope.focus;
  const target: ProjectRef | null = state.projectId && state.hostId ? { hostId: state.hostId, projectId: state.projectId } : focused;
  const hostId = target?.hostId ?? null;

  const choices = useMemo<ProjectChoice[]>(
    () =>
      scoped.model.groups.flatMap((g) =>
        g.kind === "project" ? [{ hostId: g.hostId ?? focusHost, projectId: g.id, name: g.name, badge: g.badge, color: g.color, agents: g.online.length + g.offline.length }] : [],
      ),
    [scoped.model.groups, focusHost],
  );
  const group = useMemo(
    () => (target ? ((scoped.model.groups.find((g) => g.kind === "project" && g.id === target.projectId && (g.hostId ?? focusHost) === target.hostId) as ProjectGroup | undefined) ?? null) : null),
    [scoped.model.groups, target?.hostId, target?.projectId, focusHost], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const rows = useMemo(() => (group ? [...group.online, ...group.offline] : []), [group]);
  const ids = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const look = scoped.hosts.find((h) => h.look.id === hostId);
  const directorId = useApp((s) => (target ? (sidebarOf(s, target.hostId)?.projects?.projects.find((p) => p.project_id === target.projectId)?.director_cutex_session_id ?? null) : null));

  // Previews (the focus host's live activity map; others: the session resource's projection).
  const own = hostId === focusHost;
  const previewKey = useApp((s) =>
    own
      ? rows
          .map((r) => {
            const p = s.activity[r.id];
            return p ? `${r.id}\u0002${p.kind}\u0002${p.at}\u0002${p.text.slice(0, 300)}\u0002${p.message?.text.slice(0, 300) ?? ""}` : "";
          })
          .join("\u0001")
      : "",
  );

  // Delegations: the project's host's records (followed while shown); closed ones once (completion rows).
  const records = useHostDelegations(hostId ?? focusHost);
  useEffect(() => {
    if (own) void loadClosedDelegations();
  }, [own]);
  const asks = useMemo(() => (target ? projectAsks(Object.values(records), target.projectId, ids) : []), [records, target?.projectId, ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const jobs = useOpenJobs(hostId);
  const services_ = useApp((s) => (hostId ? (hostData(s, hostId)?.services ?? null) : null));
  const artifacts = useProjectArtifacts(target);
  const live = useProjectLive((s) => (hostId ? hostLive(s.byHost, hostId) : null));
  const meta = useSubAgentMeta();

  // Loaded views (sub-agents, terminals, plan, goal): a string key so streamed tokens do not re-render.
  const factsKey = useApp((s) => {
    if (!hostId) return "";
    return rows
      .map((r) => {
        const f = viewFacts(s, hostId, r.id, r.session.runtime.status === "online", meta);
        return f ? JSON.stringify([r.id, f.subagents, f.terminals, f.plan?.steps ?? null, f.goal]) : "";
      })
      .join("\u0001");
  });

  const members = useMemo<Member[]>(() => {
    if (!hostId) return [];
    const s = useApp.getState();
    const facts = new Map<string, ViewFacts | null>(rows.map((r) => [r.id, viewFacts(s, hostId, r.id, r.session.runtime.status === "online", meta)]));
    return rows.map((row) => {
      const key = rowKey(row);
      const signal = attention.signals.get(key) ?? "idle";
      const needs = attention.needs.get(key);
      const raw = own ? s.activity[row.id] : (previewFromResource(row.session) ?? undefined);
      const preview = previewLine(raw, signal === "running");
      const f = facts.get(row.id) ?? null;
      const plan = planSummary(f?.plan ?? getCachedPlan(hostId, row.id));
      const dlg = openDelegationsOf(asks, row.id);
      const myJobs = jobs.filter((j) => j.sessionId === row.id);
      const subagents = f?.subagents ?? [];
      const terminals = f?.terminals ?? [];
      const lastError = row.session.runtime.lastError;
      return {
        id: row.id,
        hostId,
        name: row.name,
        isDirector: row.isDirector,
        signal,
        online: row.status === "running" || row.status === "idle" || row.status === "needsInput",
        lastActivity: Math.max(row.lastActivity, raw?.at ?? 0),
        row,
        needs,
        signalText: signalLabel(t, signal, needs),
        preview,
        since: signal === "running" ? runningSince(row) : null,
        plan,
        goal: f?.goal ?? null,
        error: signal === "error" ? (typeof lastError === "string" && lastError ? lastError : null) : null,
        load: { delegationsIn: dlg.in.length, delegationsOut: dlg.out.length, jobs: myJobs.length, terminals: terminals.length, subagents: subagents.length },
        dlgIn: dlg.in,
        dlgOut: dlg.out,
        jobs: myJobs,
        terminals,
        subagents,
      };
    });
    // previewKey / factsKey: the parts of the store these rows read.
  }, [hostId, rows, attention, own, asks, jobs, meta, t, previewKey, factsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOf = useMemo(() => {
    const m = new Map(members.map((x) => [x.id, x.load]));
    return (id: string) => m.get(id)!;
  }, [members]);
  const grouped = useMemo(() => groupMembers(members, loadOf, now, { directorId, needsOnly: state.needsOnly }), [members, loadOf, now, directorId, state.needsOnly]);
  const counts = useMemo(() => countMembers(members), [members]);
  const totals = useMemo(
    () => ({
      delegations: asks.filter(isOpenAsk).length,
      jobs: members.reduce((n, m) => n + m.jobs.length + m.terminals.length, 0),
      subagents: members.reduce((n, m) => n + m.subagents.length, 0),
    }),
    [asks, members],
  );

  // Item objects kept while they read the same (model shareActivity): ActivityRow is memo on its item.
  const sharedActivity = useRef(new Map<string, ActivityItem>());
  const activity = useMemo(() => {
    if (!target) return [];
    const needs: AgentNeed[] = members.flatMap((m): AgentNeed[] => {
      if (m.signal === "error") return [{ sessionId: m.id, at: m.lastActivity, error: true, text: m.error }];
      // Needs that a delegation row already says (its ask ids) are not repeated.
      if (m.signal === "needsYou" && m.needs && m.needs.count > m.needs.askIds.length) return [{ sessionId: m.id, at: m.lastActivity, error: false, text: m.signalText }];
      return [];
    });
    const liveArtifacts = (live?.artifacts ?? []).filter((a) => a.projectId === target.projectId || (a.sessionId !== null && ids.has(a.sessionId)));
    const prev = sharedActivity.current;
    const items = deriveActivity({
      projectId: target.projectId,
      members: ids,
      asks,
      plans: live?.plans ?? [],
      artifacts: [...liveArtifacts, ...artifacts],
      services: (services_ ?? []) as ServiceView[],
      needs,
    });
    const shared = shareActivity(prev, items);
    sharedActivity.current = new Map(shared.map((item) => [item.id, item]));
    return shared;
  }, [target?.projectId, members, ids, asks, live, artifacts, services_]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = useMemo(() => {
    const names = new Map<string, string>();
    for (const g of scoped.model.groups) if ((g.hostId ?? focusHost) === hostId) for (const r of [...g.online, ...g.offline]) names.set(r.id, r.name);
    for (const r of rows) names.set(r.id, r.name);
    return (id: string | null, fallback?: string | null) => (id ? (names.get(id) ?? fallback ?? id) : (fallback ?? null));
  }, [scoped.model.groups, rows, hostId, focusHost]);

  return {
    target,
    following: !(state.projectId && state.hostId),
    group,
    hostLabel: look?.look.label ?? null,
    hostColor: look?.look.color ?? null,
    hostOffline: look ? look.state === "offline" : false,
    members,
    grouped,
    counts,
    totals,
    activity,
    nameOf,
    choices,
  };
}

/** The tab title: 「Project · <name>」, attention = the project's needs-you count. */
export function useViewTitle(props: SideTabProps<ViewState>): { title: string; tooltip?: string; attention?: number; busy?: boolean } {
  const { t } = useI18n();
  const focused = useFocusedProject();
  const s = useProjectViewState(props.instance.id, props.instance.state);
  const target = s.projectId && s.hostId ? { hostId: s.hostId, projectId: s.projectId } : focused;
  const name = useApp((st) => {
    if (!target) return null;
    const p = sidebarOf(st, target.hostId)?.projects?.projects.find((x) => x.project_id === target.projectId);
    const shown = (p?.presentation as { display_name?: unknown } | undefined)?.display_name;
    return typeof shown === "string" && shown ? shown : (target.projectId ?? null);
  });
  return name ? { title: t("project-view.tabTitle", { name }), tooltip: t("project-view.title") } : { title: t("project-view.title") };
}
