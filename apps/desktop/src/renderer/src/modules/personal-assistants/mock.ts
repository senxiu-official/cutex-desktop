// Mock 个人助理 (cutex r295 personal-assistants-local-v1 + r296 recurring / qualified refs / owner views) for the renderer
// preview. This PC has two assistants: 生活助理 (ready; cutex-desktop + waveline) and 研究助理 (Native runtime →
// runtimeUnsupported; waveline + proto, so waveline overlaps), with requests in every state, today's reminders / a
// schedule, a short history, coordination notes, an imported calendar and 定期任务: a daily 项目状态 that ran (sent,
// merged, refused, cancelled runs), a weekly 到期请求 whose Director changed (needs 重新确认), a paused one and a
// cancelled one. Other hosts have none. `?pa=empty`: no assistants anywhere (the empty desk); `?pa=vacant`: proto has no
// Director; `?pa=r295`: the host advertises r295 only (no 定期任务 / notes / owner views; polled); `?pa=r296`: an r296
// host without r299 readiness (no create-options, capability details, agenda zones or source states). Otherwise the
// host is r299: create-options (claude usable, the others with the host's reasons), evaluated `capabilityDetails` and
// the agenda in the asked zone with per-source states (研究助理's projects can't be read); `?pa=agendaFail`: after
// the first read, every agenda read fails (today keeps what it read, marked old).
// r299 also runs assistants as normal agents (`personal-assistants-agent-v1`: 生活助理 自动, 研究助理 still the old
// restricted kind) and the phase-1 calls (shared/personalAssistantsPhase1.ts) (范围规则, 简报 times, adding a reminder;
// 记一下 is in the 备忘 mock): 生活助理 has a project rule and a 08:30 brief, 研究助理 has no brief (off).
// `?pa=noPhase1`: an host with grant support without the phase-1 features.
// Writes behave like cutex: action ids replay, revisions are checked (409 revision_conflict), confirm moves a request to
// queued and re-reads the project's current seat, a template confirms only the current seat; each committed write
// announces `cutex/personalAssistant/changed` like r296. Each host reports its own instance id in the list
// (`homeInstanceId`): the page pairs projects by it, never by a project's name or id.
import type { DesktopApi } from "../../../../shared/ipc";
import type {
  PaAssistant, PaAuditRow, PaCalendarEvent, PaChange, PaConfig, PaNote, PaRequest, PaRule, PaRun, PaSeat, PaTemplate, PaView,
} from "../../../../shared/personalAssistants";
import type { PaPermissionMode, PaProjectRef, PaReminder, PaRuntime, PaRuntimePolicy } from "../../../../shared/personalAssistants";
import { PA_BRIEF_FEATURE, PA_REMINDERS_WRITE_FEATURE, PA_SCOPE_RULES_FEATURE, type PaBriefView, type PaScope, type PaScopeRule } from "../../../../shared/personalAssistantsPhase1";
import { PA_AGENT_FEATURE, PA_CHANGED_EVENT, PA_OWNER_VIEWS_FEATURE, PA_QUALIFIED_REFS_FEATURE, PA_READINESS_FEATURE, PA_RECURRING_FEATURE, PERSONAL_ASSISTANTS_FEATURE, type PaCapabilityDetails } from "../../../../shared/personalAssistants";
import type { MockCore, ModuleMock } from "../../dev/mockTypes";

const QUERY = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const MODE = QUERY.get("pa") ?? "";
/** r299 readiness (every mode but the older hosts). */
const READINESS = MODE !== "r295" && MODE !== "r296";
const HOST_ZONE = "UTC";
/** Phase 1 (shared/personalAssistantsPhase1.ts): 范围规则, 简报, adding a reminder. */
const PHASE1 = READINESS && MODE !== "noPhase1";
/** Like the host would: the most specific scope wins; same rank → the more careful role; none → 协调. */
function effectiveRoles(rules: readonly PaScopeRule[], refs: readonly PaProjectRef[]) {
  const rank = { all: 0, group: 1, host: 2, project: 3 } as const;
  const care = { observe: 0, coordinate: 1, confirmForYou: 2 } as const;
  const same = (a: PaProjectRef, b: PaProjectRef) => a.instanceId === b.instanceId && a.projectId === b.projectId;
  const covers = (s: PaScope, r: PaProjectRef) => s.kind === "all" || (s.kind === "group" && s.members.some((m) => same(m, r))) || (s.kind === "host" && s.instanceId === r.instanceId) || (s.kind === "project" && same(s.ref, r));
  return refs.map((ref) => {
    let best: PaScopeRule | null = null;
    for (const r of rules) if (covers(r.scope, ref) && (!best || rank[r.scope.kind] > rank[best.scope.kind] || (rank[r.scope.kind] === rank[best.scope.kind] && care[r.role] < care[best.role]))) best = r;
    return { ref, role: best?.role ?? "coordinate", ruleId: best?.id ?? null };
  });
}
const assistantRefs = (a: PaAssistant): PaProjectRef[] => a.config.projectRefs ?? a.config.projectIds.map((projectId) => ({ instanceId: a.config.homeInstanceId, projectId }));
/** r299 create-options of the mock Profiles: only the Claude subscription one has the assistant tools. */
const CREATE_OPTIONS = [
  { id: "p-claude", name: "claude", runtime: "claude", eligible: true, reason: null, runtimePin: "claude-r58" },
  { id: "p-claude-work", name: "claude-work", runtime: "claude", eligible: false, reason: "assistant_account_unavailable", runtimePin: null },
  { id: "p-gamma", name: "gamma", runtime: "codex", eligible: false, reason: "assistant_profile_runtime_unsupported", runtimePin: null },
  { id: "p-omega", name: "omega", runtime: "codex", eligible: false, reason: "assistant_profile_runtime_unsupported", runtimePin: null },
  { id: "p-relay", name: "relay", runtime: "codex", eligible: false, reason: "assistant_profile_runtime_unsupported", runtimePin: null },
  { id: "p-glm", name: "GLM", runtime: "codex", eligible: false, reason: "assistant_profile_runtime_unsupported", runtimePin: null },
  { id: "p-gemini", name: "Gemini", runtime: "codex", eligible: false, reason: "assistant_profile_runtime_unsupported", runtimePin: null },
];
const DETAIL_KEYS = ["agenda", "notes", "reminders", "readOnlyCalendarSnapshot", "qualifiedProjectRefs", "localDirectorRequests", "recurringDirectorTemplates", "crossHostProjectScope", "projectAdmin", "liveServices", "kitActivation", "publishing", "destructive", "fullOwner"] as const;
/** Executors this host does not have (cross-host scope, project admin, owner operations, full owner). */
const UNSUPPORTED = new Set(["crossHostProjectScope", "projectAdmin", "liveServices", "kitActivation", "publishing", "destructive", "fullOwner"]);
const BINDING_REASON: Record<string, string> = { disabled: "assistant_disabled", provisioning: "provisioning_in_progress", runtimeUnsupported: "assistant_runtime_unsupported" };
/** r299 `capabilityDetails`: configured from the saved grants, effective only with a ready binding and a host executor. */
function capabilityDetails(a: PaAssistant, availability: string): PaCapabilityDetails {
  const ops = ["liveServices", "kitActivation", "publishing", "destructive"];
  const configured = (key: string) => key === "fullOwner" ? a.grants.fullOwner
    : key === "projectAdmin" ? a.grants.tier === "projectAdmin" || a.grants.tier === "operational"
    : ops.includes(key) ? a.grants.tier === "operational" && (a.grants.operations as string[]).includes(key)
    : true;
  return Object.fromEntries(DETAIL_KEYS.map((key) => {
    const c = configured(key);
    const unsupported = UNSUPPORTED.has(key);
    const reason = unsupported ? "host_unsupported" : availability !== "ready" ? (BINDING_REASON[availability] ?? "session_inactive") : !c ? "not_granted" : null;
    return [key, { configured: c, effective: reason === null, unsupported, reason }];
  }));
}

class Refusal extends Error {
  constructor(code: string, message = code) {
    super(`${code}: ${message}`);
  }
}

const iso = (agoMinutes: number) => new Date(Date.now() - agoMinutes * 60_000).toISOString();
const todayAt = (h: number, m: number, dayOffset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
/** RFC 3339 with this device's offset (the mock host's local time). */
const localIso = (utc: string) => {
  const d = new Date(utc);
  const off = -d.getTimezoneOffset();
  const p = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const wall = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19);
  return `${wall}${off >= 0 ? "+" : "-"}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
};
/** The next slot of a rule after now (the mock host's local time is this device's). */
function nextRun(rule: PaRule, from = new Date()): string {
  if (rule.kind === "interval") return new Date(from.getTime() + rule.hours * 3_600_000).toISOString();
  const [h, m] = rule.time.split(":").map(Number) as [number, number];
  for (let day = 0; day <= 8; day++) {
    const d = new Date(from);
    d.setDate(d.getDate() + day);
    d.setHours(h, m, 0, 0);
    if (rule.kind === "weekly" && ((d.getDay() + 6) % 7) + 1 !== rule.weekday) continue;
    if (d > from) return d.toISOString();
  }
  return from.toISOString();
}

interface Calendar {
  revision: number;
  source: string | null;
  observedAt: string | null;
  events: PaCalendarEvent[];
}
interface HostState {
  instance: string;
  assistants: PaAssistant[];
  /** Creation order (the position is cutex's sequence). */
  requests: PaRequest[];
  audit: Map<string, PaAuditRow[]>;
  actions: Map<string, string>;
  seq: number;
  /** Profile of each session (activeProfile). */
  profiles: Record<string, string>;
  /** Native-runtime sessions (runtimeUnsupported). */
  native: Set<string>;
  notes: Map<string, PaNote[]>;
  calendars: Map<string, Calendar>;
  templates: PaTemplate[];
  /** Per template, newest first. */
  runs: Map<string, PaRun[]>;
}

function seats(core: MockCore | null): Record<string, PaSeat> {
  const projects = core?.projectRecords().projects?.projects ?? [];
  const out: Record<string, PaSeat> = {};
  for (const p of projects) out[p.project_id] = { sessionId: MODE === "vacant" && p.project_id === "proto" ? null : (p.director_cutex_session_id ?? null), epoch: p.authority_epoch ?? 1 };
  return out;
}

const emptyState = (instance: string): HostState => ({ instance, assistants: [], requests: [], audit: new Map(), actions: new Map(), seq: 0, profiles: {}, native: new Set(), notes: new Map(), calendars: new Map(), templates: [], runs: new Map() });

function localState(core: MockCore): HostState {
  const instance = "ci-mock-pa-local";
  const s = emptyState(instance);
  if (MODE === "empty") return s;
  const seat = seats(core);
  // The life assistant's agent is a sidebar agent of the preview (Kai, a Claude agent), so its role chip shows there.
  const LIFE_SESSION = core?.projectRecords().active.some((r) => r.cutexSessionId === "kai") ? "kai" : "pa-life-session";
  const life: PaAssistant = {
    id: "pa-5c1f0e7a9b2d4c8e8f61a3b0d2c4e6f8", revision: 4,
    config: { name: "生活助理", profile: "claude", homeInstanceId: instance, projectIds: ["desktop", "waveline"], projectRefs: [{ instanceId: instance, projectId: "desktop" }, { instanceId: instance, projectId: "waveline" }] },
    grants: { tier: "coordinator", operations: [], fullOwner: false },
    coordinationProjectId: "pa-life", sessionId: LIFE_SESSION, enabled: true,
  };
  const research: PaAssistant = {
    id: "pa-9e3b7d1c5a4f4e2b9c8d7a6b5c4d3e2f", revision: 2,
    config: { name: "研究助理", profile: "codex", homeInstanceId: instance, projectIds: ["proto", "waveline"], projectRefs: [{ instanceId: instance, projectId: "proto" }, { instanceId: instance, projectId: "waveline" }] },
    grants: { tier: "operational", operations: ["liveServices"], fullOwner: false },
    coordinationProjectId: "pa-research", sessionId: "pa-research-session", enabled: true,
  };
  s.assistants = [life, research];
  s.profiles = { [LIFE_SESSION]: "claude", "pa-research-session": "codex" };
  s.native.add("pa-research-session");
  const daily = "sch-daily-desktop-status";
  const req = (id: string, a: PaAssistant, projectId: string, state: string, outcome: string, constraints: string, ago: number, over: Partial<PaRequest> = {}): PaRequest => ({
    id, assistantId: a.id, projectId, outcome, constraints, sourceRef: "对话 · 今天上午你说的", director: seat[projectId] ?? { sessionId: null, epoch: 1 },
    assistantRevision: a.revision, state, revision: 1, updatedAt: iso(ago), detail: null, projectRef: { instanceId: instance, projectId }, dueAt: null, occurrence: null, ...over,
  });
  // Oldest first (creation order).
  s.requests = [
    req("dr-7b8c9d0e1f2a47e8596ab1c2d3e4f5a6", life, "desktop", "cancelled", "给托盘加一个助理按钮", "", 60 * 50, { revision: 2 }),
    req("dr-6a7b8c9d0e1f46d74859a0b1c2d3e4f5", research, "proto", "declined", "重新训练基线模型", "", 60 * 30, { revision: 3, detail: "本周 GPU 已排满，下周再说。" }),
    req("dr-5f6a7b8c9d0e45c63748f9a0b1c2d3e4", life, "waveline", "completed", "把 iPad 网关的证书续期提醒加到议程", "", 60 * 26, { revision: 5, detail: "已加到每月 1 日的提醒。" }),
    req("dr-4e5f6a7b8c9d44b52637e8f9a0b1c2d3", research, "proto", "clarification", "汇总上周三个实验的结果", "只用已有数据", 300, { revision: 3, detail: "要汇总哪三个实验？请给出实验编号。" }),
    req("dr-3d4e5f6a7b8c43a41526d7e8f9a0b1c2", life, "desktop", "accepted", "复核个人助理的权限页文案", "按 GLOSSARY 用词", 180, { revision: 3 }),
    req(`dr-${daily}-r3`, life, "desktop", "queued", "汇报 cutex-desktop 当前的状态", "", 90, {
      sourceRef: "定期任务 · 项目状态", dueAt: todayAt(9, 0), occurrence: { scheduleId: daily, templateRevision: 2, scheduledAt: todayAt(9, 0), occurrenceKey: `${daily}-r3` },
    }),
    req("dr-1b2c3d4e5f6a41829304b5c6d7e8f9a0", life, "waveline", "awaitingOwner", "检查 Waveline 的推送提醒在 iPad 上是否重复", "只读排查，先报告再改", 40, { director: { sessionId: "wave-old", epoch: 1 }, revision: 2 }),
    req("dr-0a1b2c3d4e5f40718293a4b5c6d7e8f9", life, "desktop", "awaitingOwner", "给个人助理页面补上中文和英文的截图，放进 previews 目录", "不改动正在运行的应用；只用模拟预览", 12, { sourceRef: "对话 · 10:42 你说「截图放 previews」", dueAt: todayAt(17, 0) }),
  ];
  const log = (a: PaAssistant, actor: string, verb: string, ago: number, detail: unknown) => {
    const rows = s.audit.get(a.id) ?? [];
    rows.unshift({ seq: ++s.seq, actor, actionId: `act-${s.seq}`, verb, at: iso(ago), detail });
    s.audit.set(a.id, rows);
  };
  log(life, "owner", "create", 60 * 72, { state: "provisioning" });
  log(life, "system", "bind", 60 * 72 - 1, { sessionId: LIFE_SESSION });
  log(life, "owner", "configure", 60 * 48, { before: { projectIds: ["desktop"] }, after: { projectIds: ["desktop", "waveline"] } });
  log(life, LIFE_SESSION, "memoryWrite", 60 * 5, { key: "weekly-plan", revision: 3 });
  log(life, LIFE_SESSION, "prepare", 40, { requestId: "dr-1b2c3d4e5f6a41829304b5c6d7e8f9a0" });
  log(life, "eva", "directorResponse", 170, { requestId: "dr-3d4e5f6a7b8c43a41526d7e8f9a0b1c2", response: "accept" });
  log(research, "owner", "create", 60 * 40, { state: "provisioning" });
  log(research, "owner", "configure", 60 * 39, { before: { tier: "coordinator", operations: [] }, after: { tier: "operational", operations: ["liveServices"] } });
  s.notes.set(life.id, [
    { key: "owner-preferences", revision: 2, content: "截图和预览只用模拟预览；不碰正在运行的应用。\n文案先中文，再英文。", sourceRef: "对话 · 11-23" },
    { key: "waveline-push", revision: 1, content: "iPad 上推送重复的问题：先等 Waveline 主管的只读排查结果，再决定要不要改。", sourceRef: "对话 · 今天 10:15" },
    { key: "weekly-plan", revision: 3, content: "本周：个人助理第二阶段（定期任务、今日议程、笔记）；周五前整理发布说明。", sourceRef: "对话 · 周一" },
  ]);
  s.notes.set(research.id, [{ key: "experiments", revision: 1, content: "实验编号待你确认：E-11、E-12、E-14？", sourceRef: "对话 · 昨天" }]);
  s.calendars.set(life.id, {
    revision: 2, source: "Outlook", observedAt: iso(60 * 3),
    events: [
      { id: "ev-standup", title: "组会", startsAt: todayAt(10, 0), endsAt: todayAt(10, 30) },
      { id: "ev-lunch", title: "和 Hostc 吃午饭", startsAt: todayAt(12, 30), endsAt: todayAt(13, 30) },
      { id: "ev-review", title: "发布说明复核", startsAt: todayAt(16, 0), endsAt: todayAt(17, 0) },
      { id: "ev-tomorrow", title: "课程答疑", startsAt: todayAt(14, 0, 1), endsAt: todayAt(15, 0, 1) },
    ],
  });
  s.calendars.set(research.id, { revision: 0, source: null, observedAt: null, events: [] });
  const tpl = (id: string, a: PaAssistant, projectId: string, task: string, rule: PaRule, over: Partial<PaTemplate>, confirmed: PaSeat, revision = 2): PaTemplate => ({
    id, revision, rule, enabled: true, nextRunAt: nextRun(rule), createdAt: iso(60 * 24 * 6), updatedAt: iso(60 * 24 * 2), deletedAt: null, lastRun: null,
    template: { assistantId: a.id, assistantRevision: a.revision, projectRef: { instanceId: instance, projectId }, templateRevision: revision, confirmedSeat: confirmed, task },
    ...over,
  });
  const run = (tplId: string, sequence: number, scheduledAt: string, outcome: string, over: Partial<PaRun> = {}): PaRun => ({
    id: `${tplId}-r${sequence}`, sequence, scheduleRevision: 2, scheduledAt, startedAt: scheduledAt, finishedAt: outcome === "pending" ? null : scheduledAt, outcome,
    attempts: 1, lastError: null, requestId: null, coalescedUntil: null, slotLocal: localIso(scheduledAt), ...over,
  });
  const dailyRuns = [
    run(daily, 3, todayAt(9, 0), "handedOff", { requestId: `dr-${daily}-r3` }),
    run(daily, 2, todayAt(9, 0, -1), "handedOff", { requestId: "dr-3d4e5f6a7b8c43a41526d7e8f9a0b1c2", coalescedUntil: todayAt(9, 0, -1) }),
    run(daily, 1, todayAt(9, 0, -3), "refused", { lastError: "director_missing", scheduleRevision: 1 }),
    run(daily, 0, todayAt(9, 0, -4), "cancelled", { lastError: "schedule cancelled, paused, or superseded before admission", scheduleRevision: 1 }),
  ];
  const weekly = "sch-weekly-waveline-due";
  const weeklyRuns = [run(weekly, 1, todayAt(10, 0, -1), "refused", { lastError: "director_changed" })];
  const friday = "sch-friday-desktop-due";
  const fridayRuns = [run(friday, 1, todayAt(17, 0, -5), "handedOff", { requestId: "dr-7b8c9d0e1f2a47e8596ab1c2d3e4f5a6" })];
  const cancelled = "sch-interval-desktop-calendar";
  s.templates = [
    tpl(daily, life, "desktop", "projectStatus", { kind: "daily", time: "09:00" }, { lastRun: dailyRuns[0]! }, seat.desktop ?? { sessionId: null, epoch: 1 }),
    tpl(weekly, life, "waveline", "dueRequests", { kind: "weekly", weekday: 1, time: "10:00" }, { lastRun: weeklyRuns[0]! }, { sessionId: "wave-old", epoch: 1 }),
    tpl(friday, life, "desktop", "dueRequests", { kind: "weekly", weekday: 5, time: "17:00" }, { enabled: false, nextRunAt: null, lastRun: fridayRuns[0]! }, seat.desktop ?? { sessionId: null, epoch: 1 }, 3),
    tpl(cancelled, life, "desktop", "calendarSummary", { kind: "interval", hours: 6 }, { enabled: false, nextRunAt: null, deletedAt: iso(60 * 24 * 3) }, seat.desktop ?? { sessionId: null, epoch: 1 }, 3),
  ];
  s.runs.set(daily, dailyRuns);
  s.runs.set(weekly, weeklyRuns);
  s.runs.set(friday, fridayRuns);
  s.runs.set(cancelled, []);
  return s;
}

function remoteState(hostId: string): HostState {
  return emptyState(`ci-mock-pa-${hostId}`);
}

const PAGE = 50;
/** A newest-first page of rows keyed by a numeric sequence (cursor = the last sequence shown, exclusive). */
function seqPage<T>(rows: readonly { seq: number; row: T }[], cursor: number | null | undefined, limit = PAGE): { items: T[]; nextCursor: number | null } {
  const from = rows.filter((r) => cursor == null || r.seq < cursor).sort((a, b) => b.seq - a.seq);
  const page = from.slice(0, limit);
  return { items: page.map((r) => structuredClone(r.row)), nextCursor: from.length > page.length ? page[page.length - 1]!.seq : null };
}

function mockPaApi(state: HostState, core: MockCore | null): Partial<DesktopApi> {
  const delay = () => new Promise((r) => setTimeout(r, 120));
  const find = (id: string) => {
    const a = state.assistants.find((x) => x.id === id);
    if (!a) throw new Refusal("assistant_not_found");
    return a;
  };
  // r299 normal-agent runtime: the first assistant (or one created here) runs as an agent; the others are the old kind.
  const runtimes = new Map<string, PaRuntime>();
  const agentRuntime = (a: PaAssistant, mode: PaPermissionMode, policy?: PaRuntimePolicy): PaRuntime => ({
    behavior: "agent", permissionMode: mode, workspace: `~/.cutex/personal-assistants/${a.coordinationProjectId}`,
    policy: policy ?? { version: 1, initialPermissionMode: mode, checkInFullAccess: false, authorizedWriteProjects: [] },
  });
  const runtimeOf = (a: PaAssistant): PaRuntime => {
    const known = runtimes.get(a.id);
    if (known) return structuredClone(known);
    const r: PaRuntime = a.id === state.assistants[0]?.id ? agentRuntime(a, "auto") : { behavior: "legacyRestricted", permissionMode: null, policy: null, workspace: null };
    runtimes.set(a.id, r);
    return structuredClone(r);
  };
  // Phase 1: rules, brief times, reminders added here.
  const rules = new Map<string, { revision: number; rules: PaScopeRule[] }>();
  const rulesOf = (a: PaAssistant) => {
    let r = rules.get(a.id);
    if (!r) {
      const wave = a.id === state.assistants[0]?.id && a.config.projectIds.includes("waveline");
      r = { revision: 1, rules: wave ? [{ id: "rule-wave", scope: { kind: "project", ref: { instanceId: a.config.homeInstanceId, projectId: "waveline" } }, role: "observe", note: "只看进度，先不替我发请求" }] : [] };
      rules.set(a.id, r);
    }
    return r;
  };
  const ruleSet = (a: PaAssistant) => {
    const r = rulesOf(a);
    return { revision: r.revision, rules: structuredClone(r.rules), effective: effectiveRoles(r.rules, assistantRefs(a)) };
  };
  const briefs = new Map<string, PaBriefView>();
  const briefOf = (a: PaAssistant): PaBriefView => {
    let b = briefs.get(a.id);
    if (!b) {
      const first = a.id === state.assistants[0]?.id;
      b = first
        ? { revision: 1, times: ["08:30", "17:30"], timezone: null, latest: { at: todayAt(8, 30), text: "早上好。今天有 2 件等你确认：Waveline 推送排查要不要交给主管、cutex-desktop 的发布说明。\n在办 3 件，其中设置页拆分已被主管接手。17:00 提醒你确认本周发布说明。", sources: ["requests", "reminders", "calendar"] }, pending: null, stale: false }
        : { revision: 0, times: [], timezone: null, latest: null, pending: null, stale: false };
      // `?pa=briefWriting`: the 17:30 run is being written, done a few seconds later (announced as `brief`);
      // `?pa=briefStale`: the 12:00 run was replaced by 17:30 unwritten (the 08:30 brief stays).
      if (first && MODE === "briefWriting") {
        b.pending = { runId: "brief-run-1730", scheduledAt: todayAt(17, 30), queued: true };
        setTimeout(() => {
          const cur = briefs.get(a.id);
          if (!cur?.pending) return;
          briefs.set(a.id, { ...cur, revision: cur.revision + 1, pending: null, stale: false, latest: { at: new Date().toISOString(), text: "下午好。等你确认的都处理完了；Waveline 推送排查已交给主管。明早 08:30 再写一份。", sources: ["requests", "reminders"] } });
          changed(a.id, "brief");
        }, 8000);
      }
      if (first && MODE === "briefStale") b.stale = true;
      briefs.set(a.id, b);
    }
    return structuredClone(b);
  };
  const added = new Map<string, PaReminder[]>();
  const availability = (a: PaAssistant) => (!a.enabled ? "disabled" : !a.sessionId ? "provisioning" : state.native.has(a.sessionId) ? "runtimeUnsupported" : "ready");
  const activeProfile = (a: PaAssistant) => (a.sessionId ? (state.profiles[a.sessionId] ?? a.config.profile) : null);
  const view = (a: PaAssistant): PaView => {
    const overlaps = state.assistants
      .filter((o) => o.id !== a.id && o.enabled)
      .flatMap((o) => o.config.projectIds.filter((p) => a.config.projectIds.includes(p)).map((projectId) => ({ assistantId: o.id, name: o.config.name, projectId })));
    return {
      assistant: structuredClone(a), overlaps, moreOverlaps: false, availability: availability(a), activeProfile: activeProfile(a),
      capabilities: { localDirectorRequests: true, agenda: true, requiresHandoffConfirmation: true, ownerOperationDelegation: false, recurringDirectorTemplates: MODE !== "r295", readOnlyCalendarSnapshot: MODE !== "r295", qualifiedProjectRefs: MODE !== "r295", crossHostProjectScope: false },
      ...(READINESS ? { capabilityDetails: capabilityDetails(a, availability(a)), runtime: runtimeOf(a) } : {}),
    };
  };
  const audit = (a: PaAssistant, verb: string, actionId: string, detail: unknown) => {
    const rows = state.audit.get(a.id) ?? [];
    rows.unshift({ seq: ++state.seq, actor: "owner", actionId, verb, at: new Date().toISOString(), detail });
    state.audit.set(a.id, rows);
  };
  /** r296: a committed change is announced (r295 announces nothing). */
  const changed = (assistantId: string, area: string, requestId?: string) => {
    if (MODE === "r295" || !core) return;
    setTimeout(() => core.emitHost(PA_CHANGED_EVENT, { assistantId, areas: [area, "audit"], ...(requestId ? { requestId } : {}) }), 30);
  };
  /** cutex action replay: the same id with the same input answers the same; another input conflicts. */
  const once = <T>(actionId: string, input: unknown, run: () => T): T => {
    const digest = JSON.stringify(input);
    const prior = state.actions.get(actionId);
    if (prior !== undefined) {
      const [d, reply] = JSON.parse(prior) as [string, T];
      if (d !== digest) throw new Refusal("action_conflict");
      return reply;
    }
    const reply = run();
    state.actions.set(actionId, JSON.stringify([digest, reply]));
    return reply;
  };
  const request = (assistantId: string, id: string) => {
    const r = state.requests.find((x) => x.id === id && x.assistantId === assistantId);
    if (!r) throw new Refusal("request_not_found");
    return r;
  };
  const template = (assistantId: string, key: string) => {
    const t = state.templates.find((x) => x.id === key && x.template?.assistantId === assistantId);
    if (!t) throw new Refusal("template_not_found");
    return t;
  };
  const withSeq = (rows: readonly PaRequest[]) => rows.map((row) => ({ seq: state.requests.indexOf(row) + 1, row }));
  const today = (iso: string | null | undefined) => !!iso && new Date(iso).toDateString() === new Date().toDateString();
  /** `?pa=agendaFail`: agenda reads so far per assistant (the first one succeeds). */
  const agendaReads = new Map<string, number>();
  return {
    ...(READINESS ? {
      async paCreateOptions() {
        await delay();
        return { permissionModes: ["auto", "fullAccess"], defaultPermissionMode: "auto", homeInstanceId: state.instance, profiles: structuredClone(CREATE_OPTIONS), capabilities: { localDirectorRequests: true, agenda: true, requiresHandoffConfirmation: true, ownerOperationDelegation: false, recurringDirectorTemplates: true, readOnlyCalendarSnapshot: true, qualifiedProjectRefs: true, crossHostProjectScope: false }, observedAt: new Date().toISOString(), hostTimezone: HOST_ZONE };
      },
    } : {}),
    ...(PHASE1 ? {
      async paScopeRules(id: string) {
        await delay();
        return ruleSet(find(id));
      },
      async paScopeRulesSave(id: string, body: { actionId: string; expectedRevision: number; rules: PaScopeRule[] }) {
        await delay();
        return structuredClone(once(body.actionId, [id, body.expectedRevision, body.rules], () => {
          const a = find(id);
          const r = rulesOf(a);
          if (r.revision !== body.expectedRevision) throw new Refusal("revision_conflict");
          rules.set(id, { revision: r.revision + 1, rules: structuredClone(body.rules) });
          audit(a, "configure", body.actionId, { scopeRules: body.rules.length });
          changed(id, "assistant");
          return ruleSet(a);
        }));
      },
      async paBrief(id: string) {
        await delay();
        return briefOf(find(id));
      },
      async paBriefSchedule(id: string, body: { actionId: string; expectedRevision: number; times: string[]; timezone: string | null }) {
        await delay();
        return structuredClone(once(body.actionId, [id, body.expectedRevision, body.times, body.timezone], () => {
          const a = find(id);
          const b = briefOf(a);
          if (b.revision !== body.expectedRevision) throw new Refusal("revision_conflict");
          // A schedule reset clears `stale` (cutex r299).
          const next = { ...b, revision: b.revision + 1, times: [...new Set(body.times)].sort(), timezone: body.timezone, stale: false };
          briefs.set(id, next);
          changed(id, "brief");
          return next;
        }));
      },
      async paReminderCreate(id: string, body: { actionId: string; at: string; message: string }) {
        await delay();
        return structuredClone(once(body.actionId, [id, body.at, body.message], () => {
          find(id);
          const r: PaReminder = { alarmId: `al-${body.actionId.slice(-8)}`, at: body.at, message: body.message, state: "pending" };
          added.set(id, [...(added.get(id) ?? []), r]);
          changed(id, "assistant");
          return r;
        }));
      },
    } : {}),
    async paList() {
      await delay();
      const status = MODE === "r295" ? null : Object.fromEntries(state.assistants.map((a) => [a.id, { availability: availability(a), activeProfile: activeProfile(a), ...(READINESS ? { capabilityDetails: capabilityDetails(a, availability(a)), runtime: runtimeOf(a) } : {}) }]));
      return { homeInstanceId: state.instance, items: structuredClone(state.assistants), status, nextCursor: null };
    },
    async paGet(id) {
      await delay();
      return view(find(id));
    },
    async paCreate({ actionId, config, permissionMode }) {
      await delay();
      const reply = once(actionId, [config, permissionMode ?? null], () => {
        if (config.homeInstanceId !== state.instance) throw new Refusal("home_instance_mismatch");
        const id = `pa-${Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32)}`;
        const session = `${id}-session`;
        const a: PaAssistant = { id, revision: 2, config: structuredClone(config as PaConfig), grants: { tier: "coordinator", operations: [], fullOwner: false }, coordinationProjectId: `pa-${id.slice(3, 9)}`, sessionId: session, enabled: true };
        state.assistants.push(a);
        state.profiles[session] = config.profile;
        if (config.profile === "codex") state.native.add(session);
        state.calendars.set(id, { revision: 0, source: null, observedAt: null, events: [] });
        if (READINESS) runtimes.set(id, agentRuntime(a, permissionMode ?? "auto"));
        audit(a, "create", actionId, { state: "provisioning" });
        changed(id, "assistant");
        return view(a);
      });
      return structuredClone(reply);
    },
    async paUpdate(id, { actionId, expectedRevision, change }) {
      await delay();
      return structuredClone(
        once(actionId, [id, expectedRevision, change], () => {
          const a = find(id);
          if (a.revision !== expectedRevision) throw new Refusal("revision_conflict");
          if (change.kind === "grants" && change.grants.fullOwner && !a.grants.fullOwner) throw new Refusal("full_owner_native_confirmation_required", "Granting full owner access requires native owner confirmation, which this host does not support yet.");
          if (change.kind === "scopedSettings" && change.projectRefs.some((r) => r.instanceId !== state.instance)) throw new Refusal("destination_scope_required");
          if (change.kind === "runtime" && !READINESS) throw new Refusal("unsupported_change");
          const before = structuredClone(a);
          const beforeRuntime = runtimeOf(a);
          if (change.kind === "runtime") runtimes.set(id, agentRuntime(a, change.policy.initialPermissionMode, change.policy));
          else apply(a, change);
          a.revision += 1;
          audit(a, "configure", actionId, change.kind === "runtime" ? { before: beforeRuntime.policy, after: change.policy } : { before: pick(before, change), after: pick(a, change) });
          changed(id, "assistant");
          return view(a);
        }),
      );
    },
    async paAgenda(id, q = {}) {
      await delay();
      const a = find(id);
      const reads = (agendaReads.get(id) ?? 0) + 1;
      agendaReads.set(id, reads);
      if (MODE === "agendaFail" && reads > 1) throw new Refusal("host_unreachable", "The host did not answer.");
      const now = new Date().toISOString();
      const src = (status: string, reason: string | null = null, observedAt: string | null = now, timezone: string | null = HOST_ZONE) => ({ instanceId: state.instance, timezone, observedAt, status, reason });
      const zones = READINESS ? {
        displayTimezone: q.displayTimezone ?? HOST_ZONE, hostTimezone: HOST_ZONE, observedAt: now,
        sources: {
          requests: src("ready"), reminders: src("ready"), schedules: src("ready"), dueRequests: src("ready"),
          projects: a.id === state.assistants[0]?.id ? src("ready") : src("unknown", "directory_unavailable", null),
          calendar: (state.calendars.get(id)?.source ? src("snapshot", "imported_snapshot", state.calendars.get(id)!.observedAt, "UTC") : src("disconnected", "calendar_disconnected", null, "UTC")),
        },
      } : {};
      const items = state.requests.filter((r) => r.assistantId === id && a.config.projectIds.includes(r.projectId) && !["completed", "declined", "cancelled"].includes(r.state));
      const own = a.id === state.assistants[0]?.id;
      const seat = seats(core);
      const cal = state.calendars.get(id) ?? { revision: 0, source: null, observedAt: null, events: [] };
      const r296 = MODE !== "r295";
      return {
        date: q.date ?? new Date().toISOString().slice(0, 10), timezone: READINESS ? (q.displayTimezone ?? HOST_ZONE) : "host", ...zones, items: structuredClone(items), nextCursor: null,
        reminders: [
          ...(own ? [
            { alarmId: "al-1", at: todayAt(9, 30), message: "看一下 Waveline 推送排查的进展", state: "delivered" },
            { alarmId: "al-2", at: todayAt(17, 0), message: "提醒你确认本周发布说明", state: "pending" },
          ] : []),
          ...structuredClone(added.get(id) ?? []),
        ].sort((x, y) => x.at.localeCompare(y.at)),
        nextReminderCursor: null,
        schedules: own ? [{ id: "sch-1", name: "每日议程整理", nextRunAt: todayAt(21, 0) }] : [],
        nextScheduleCursor: null,
        projects: r296 ? a.config.projectIds.map((projectId) => (seat[projectId] ? { projectRef: { instanceId: state.instance, projectId }, director: seat[projectId]!, lifecycle: "active", issue: null } : { projectRef: { instanceId: state.instance, projectId }, director: null, lifecycle: null, issue: "project_not_found" })) : null,
        nextProjectCursor: null,
        dueRequests: r296 ? structuredClone(state.requests.filter((r) => r.assistantId === id && today(r.dueAt))) : null,
        nextDueCursor: null,
        calendar: r296 ? { revision: cal.revision, status: cal.source ? "ready" : "disconnected", source: cal.source, observedAt: cal.observedAt, items: structuredClone(cal.events.filter((e) => today(e.startsAt) || (new Date(e.startsAt) < new Date() && new Date(e.endsAt) > new Date()))), nextCursor: null } : null,
      };
    },
    async paAudit(id, q = {}) {
      await delay();
      find(id);
      const rows = (state.audit.get(id) ?? []).filter((r) => q.cursor == null || r.seq < q.cursor);
      const page = rows.slice(0, q.limit ?? 50);
      return { items: structuredClone(page), nextCursor: page.length && rows.length > page.length ? page[page.length - 1]!.seq : null };
    },
    async paRequests(id, q = {}) {
      await delay();
      find(id);
      return seqPage(withSeq(state.requests.filter((r) => r.assistantId === id && (!q.state || r.state === q.state))), q.cursor, q.limit);
    },
    async paOwnerRequests(q) {
      await delay();
      if (q.project && q.project.instanceId !== state.instance) throw new Refusal("destination_scope_required");
      return seqPage(
        withSeq(state.requests.filter((r) => (!q.project || r.projectId === q.project.projectId) && (!q.directorSessionId || r.director.sessionId === q.directorSessionId) && (q.directorEpoch === undefined || r.director.epoch === q.directorEpoch) && (!q.state || r.state === q.state))),
        q.cursor,
        q.limit,
      );
    },
    async paRequest(id, requestId) {
      await delay();
      const a = find(id);
      const r = request(id, requestId);
      const current = seats(core)[r.projectId] ?? null;
      const changedSeat = JSON.stringify(current) !== JSON.stringify(r.director);
      const open = r.state === "awaitingOwner" || r.state === "queued";
      return {
        request: structuredClone(r), currentDirector: current, currentAssistantRevision: a.revision,
        projectIssue: current ? null : "project_not_found",
        needsReview: open ? changedSeat || !a.enabled || !a.config.projectIds.includes(r.projectId) : (r.state === "accepted" || r.state === "clarification") && changedSeat,
      };
    },
    async paConfirm(id, requestId, { actionId, expectedRevision, director }) {
      await delay();
      return structuredClone(
        once(actionId, [id, requestId, expectedRevision, director], () => {
          const a = find(id);
          const r = request(id, requestId);
          if (r.revision !== expectedRevision) throw new Refusal("revision_conflict");
          if (r.state !== "awaitingOwner") throw new Refusal("invalid_transition");
          const current = seats(core)[r.projectId];
          if (!current?.sessionId) throw new Refusal("director_missing");
          if (JSON.stringify(current) !== JSON.stringify(director)) throw new Refusal("director_changed");
          Object.assign(r, { state: "queued", revision: r.revision + 1, director: current, assistantRevision: a.revision, updatedAt: new Date().toISOString() });
          audit(a, "confirm", actionId, { requestId, director: current });
          changed(id, "requests", requestId);
          return r;
        }),
      );
    },
    async paCancel(id, requestId, { actionId, expectedRevision }) {
      await delay();
      return structuredClone(
        once(actionId, [id, requestId, expectedRevision], () => {
          const a = find(id);
          const r = request(id, requestId);
          if (r.revision !== expectedRevision) throw new Refusal("revision_conflict");
          Object.assign(r, { state: "cancelled", revision: r.revision + 1, updatedAt: new Date().toISOString() });
          audit(a, "cancel", actionId, { requestId });
          changed(id, "requests", requestId);
          return r;
        }),
      );
    },
    async paNotes(id, q = {}) {
      await delay();
      find(id);
      const rows = (state.notes.get(id) ?? []).filter((n) => !q.q || n.key.includes(q.q) || n.content.includes(q.q)).sort((a, b) => a.key.localeCompare(b.key));
      const from = rows.filter((n) => !q.cursor || n.key > q.cursor);
      const page = from.slice(0, q.limit ?? PAGE);
      return { items: structuredClone(page), nextCursor: from.length > page.length ? page[page.length - 1]!.key : null };
    },
    async paTemplates(id) {
      await delay();
      find(id);
      return { items: structuredClone(state.templates.filter((t) => t.template?.assistantId === id).sort((a, b) => a.id.localeCompare(b.id))), nextCursor: null };
    },
    async paTemplateConfirm(id, key, input) {
      await delay();
      const out = structuredClone(
        once(input.actionId, [id, key, input], () => {
          const a = find(id);
          if (input.projectRef.instanceId !== state.instance) throw new Refusal("destination_scope_required");
          if (!a.config.projectIds.includes(input.projectRef.projectId)) throw new Refusal("project_out_of_scope");
          if (a.revision !== input.expectedAssistantRevision) throw new Refusal("confirmation_stale");
          const current = seats(core)[input.projectRef.projectId];
          if (!current?.sessionId) throw new Refusal("director_missing");
          if (current.sessionId !== input.confirmedSeat.sessionId || current.epoch !== input.confirmedSeat.epoch) throw new Refusal("director_changed");
          const now = new Date().toISOString();
          if (key === null) {
            const t: PaTemplate = {
              id: `sch-${Math.random().toString(16).slice(2, 14)}`, revision: 1, rule: input.rule, enabled: true, nextRunAt: nextRun(input.rule), createdAt: now, updatedAt: now, deletedAt: null, lastRun: null,
              template: { assistantId: id, assistantRevision: a.revision, projectRef: input.projectRef, templateRevision: 1, confirmedSeat: input.confirmedSeat, task: input.task },
            };
            state.templates.push(t);
            state.runs.set(t.id, []);
            return t;
          }
          const t = template(id, key);
          if (t.deletedAt) throw new Refusal("template_not_found");
          if (t.revision !== input.expectedRevision) throw new Refusal("revision_conflict");
          Object.assign(t, {
            revision: t.revision + 1, rule: input.rule, enabled: true, nextRunAt: nextRun(input.rule), updatedAt: now,
            template: { assistantId: id, assistantRevision: a.revision, projectRef: input.projectRef, templateRevision: t.revision + 1, confirmedSeat: input.confirmedSeat, task: input.task },
          });
          return t;
        }),
      );
      changed(id, "templates");
      return out;
    },
    async paTemplateStop(id, key, how, { actionId, expectedRevision }) {
      await delay();
      const out = structuredClone(
        once(actionId, [id, key, how, expectedRevision], () => {
          const t = template(id, key);
          if (t.revision !== expectedRevision) throw new Refusal("revision_conflict");
          Object.assign(t, { revision: t.revision + 1, enabled: false, nextRunAt: null, updatedAt: new Date().toISOString(), deletedAt: how === "cancel" ? new Date().toISOString() : null });
          return t;
        }),
      );
      changed(id, "templates");
      return out;
    },
    async paTemplateRuns(id, key, q = {}) {
      await delay();
      template(id, key);
      const rows = (state.runs.get(key) ?? []).filter((r) => !q.cursor || r.sequence < Number(q.cursor));
      const page = rows.slice(0, q.limit ?? PAGE);
      return { items: structuredClone(page), nextCursor: rows.length > page.length ? String(page[page.length - 1]!.sequence) : null };
    },
    async paCalendar(id) {
      await delay();
      find(id);
      const c = state.calendars.get(id) ?? { revision: 0, source: null, observedAt: null, events: [] };
      return { revision: c.revision, status: c.source ? "ready" : "disconnected", source: c.source, observedAt: c.observedAt };
    },
    async paCalendarImport(id, { actionId, expectedRevision, snapshot }) {
      await delay();
      return structuredClone(
        once(actionId, [id, expectedRevision, snapshot], () => {
          find(id);
          const c = state.calendars.get(id) ?? { revision: 0, source: null, observedAt: null, events: [] };
          if (c.revision !== expectedRevision) throw new Refusal("revision_conflict");
          const next = { revision: c.revision + 1, source: snapshot.source, observedAt: snapshot.observedAt, events: structuredClone(snapshot.events) };
          state.calendars.set(id, next);
          changed(id, "calendar");
          return { revision: next.revision, status: "ready", source: next.source, observedAt: next.observedAt };
        }),
      );
    },
    async paCalendarClear(id, { actionId, expectedRevision }) {
      await delay();
      return structuredClone(
        once(actionId, [id, expectedRevision, "clear"], () => {
          find(id);
          const c = state.calendars.get(id) ?? { revision: 0, source: null, observedAt: null, events: [] };
          if (c.revision !== expectedRevision) throw new Refusal("revision_conflict");
          state.calendars.set(id, { revision: c.revision + 1, source: null, observedAt: null, events: [] });
          changed(id, "calendar");
          return { revision: c.revision + 1, status: "disconnected", source: null, observedAt: null };
        }),
      );
    },
  };
}

function apply(a: PaAssistant, change: PaChange): void {
  if (change.kind === "settings") Object.assign(a.config, { name: change.name, projectIds: [...change.projectIds] });
  else if (change.kind === "scopedSettings") Object.assign(a.config, { name: change.name, projectIds: change.projectRefs.map((r) => r.projectId).sort(), projectRefs: structuredClone(change.projectRefs) });
  else if (change.kind === "grants") a.grants = structuredClone(change.grants);
  else if (change.kind === "enabled") a.enabled = change.enabled;
}
function pick(a: PaAssistant, change: PaChange): unknown {
  if (change.kind === "settings" || change.kind === "scopedSettings") return { name: a.config.name, projectIds: a.config.projectIds };
  if (change.kind === "grants") return a.grants;
  if (change.kind === "runtime") return change.policy;
  return { enabled: a.enabled };
}

export const mock: ModuleMock = {
  api: (core) => mockPaApi(localState(core), core),
  remote: (hostId) => mockPaApi(remoteState(hostId), null),
  features: { new: MODE === "r295" ? [PERSONAL_ASSISTANTS_FEATURE] : [PERSONAL_ASSISTANTS_FEATURE, PA_RECURRING_FEATURE, PA_QUALIFIED_REFS_FEATURE, PA_OWNER_VIEWS_FEATURE, ...(READINESS ? [PA_READINESS_FEATURE, PA_AGENT_FEATURE] : []), ...(PHASE1 ? [PA_SCOPE_RULES_FEATURE, PA_BRIEF_FEATURE, PA_REMINDERS_WRITE_FEATURE] : [])] },
};
