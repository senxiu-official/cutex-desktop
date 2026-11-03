// Browser-preview data for Project 视图 (dev/mockTypes.ts), only with `?projectview` so other previews keep
// their sidebar: the project cutex-dev with 14 agents (the Director and 13 workers; prototype
// .claude/preview-design-v1.html §4) — running ones with a current step, three that need you (a review,
// a question, an acceptance; their delegations are in modules/delegations/mock.ts), one in error, two
// waiting on delegations and two idle for hours (folded). Jobs, artifacts and a service of the project
// are in the jobs / artifacts / services mocks under the same flag. Here: the agents, the threads of
// security-review and shelf-model (one working sub-agent each) and plan updates on the host feed.
import type { DirectorHandover, DirectorStartReview, ProjectDirector } from "@cutex-desktop/cutex-client";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { DesktopApi, SidebarSnapshot } from "../../../../shared/ipc";
import type { BackgroundItem, ProjectBackground, ProjectEvent, ProjectEventPage, ProjectEventsMessage, ProjectEventsQuery, ProjectEventsWatch } from "../../../../shared/projectEvents";
import type { MockCore, ModuleMock } from "../../dev/mockTypes";

const on = typeof location !== "undefined" && new URLSearchParams(location.search).has("projectview");
const ownerActivityScene = on && new URLSearchParams(location.search).get("activity") === "owner";
const PROJECT = "cutex-dev";
// ?projectview&director=vacant exercises owner review while the seat is cleared.
const directorVacant = typeof location !== "undefined" && new URLSearchParams(location.search).get("director") === "vacant";
// Quiet/recent/expired handovers exercise presentation only; original records stay available.
const handoverScene = typeof location !== "undefined" ? new URLSearchParams(location.search).get("handover") : null;
const handoverEmpty = ["empty", "recent", "expired"].includes(handoverScene ?? "");

interface Agent {
  id: string;
  name: string;
  /** Minutes since the last activity. */
  idle: number;
  turn?: boolean;
  tool?: string;
  output?: string;
  offline?: boolean;
  error?: string;
}

const AGENTS: Agent[] = [
  { id: "pv-dir", name: "cutex-director", idle: 0, turn: true, tool: "$ git log --since=today --oneline" },
  { id: "pv-set", name: "settings-ui", idle: 2, output: "ownerDeviceAdded 提示做完了，测试通过，等你验收。" },
  { id: "pv-tr", name: "翻译校对", idle: 6, output: "ja 的「吊销」用「失効」还是「取り消し」？" },
  { id: "pv-rel", name: "release-bot", idle: 12, output: "r251 发布说明已写好，等 cutex-director 的委托过审。" },
  { id: "pv-net", name: "relay-net", idle: 4, error: "回合失败：ECONNRESET remote:24404（已重试 2 次）" },
  { id: "pv-shm", name: "shelf-model", idle: 0, turn: true, tool: "✎ lib/sideLayout.ts" },
  { id: "pv-sec", name: "security-review", idle: 0, turn: true, tool: "$ rg -n revokeToken src" },
  { id: "pv-qa", name: "ui-tester", idle: 0, turn: true, tool: "$ node scripts/qa-preview-matrix.mjs" },
  { id: "pv-rh", name: "remote-hosts", idle: 0, turn: true, tool: "$ cargo build --release -p cutex-server" },
  { id: "pv-perf", name: "sidebar-perf", idle: 1, turn: true, tool: "$ pnpm vitest run test/sidebar.test.ts" },
  { id: "pv-shl", name: "shell-layout", idle: 9, output: "顶栏拆分做完了，等 ui-tester 交回截图。" },
  { id: "pv-mob", name: "mobile-work", idle: 15, output: "等 remote-hosts 加 /summary 的接口。" },
  { id: "pv-upd", name: "updater", idle: 64, offline: true, output: "检查更新通道 · 已完成" },
  { id: "pv-doc", name: "文档整理", idle: 185, offline: true, output: "desktop-modules.md §24 按 Shelf 改写完了。" },
];

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function session(a: Agent): SessionResource {
  const at = ago(a.idle);
  const status = a.error ? "error" : a.offline ? "offline" : "online";
  return {
    contractVersion: 2,
    cutexSessionId: a.id,
    revision: 1,
    lifecycle: "active",
    retiredAt: null,
    hostId: "HOST-A",
    displayName: a.name,
    threadName: null,
    cwd: `/home/ema/cutex-dev/${a.name}`,
    profile: "omega",
    configuredProfile: "omega",
    launchedProfile: "omega",
    effectiveNextLaunch: { profile: "omega", source: "session_configured" },
    groups: [],
    registrationClass: null,
    visible: true,
    native: { threadId: `thread-${a.id}`, schema: null },
    runtime: {
      backend: "managed",
      status,
      appServerConnected: status === "online",
      runtimeGeneration: 3,
      runtimeAgentId: null,
      activeTurnId: a.turn ? `${a.id}-t1` : null,
      activeTurnObservedAt: a.turn ? ago(2 + (a.id.length % 7) * 1.6) : null,
      threadStatus: null,
      threadSettings: null,
      requiresVisibleTerminal: false,
      tuiAttached: false,
      lastEventAt: at,
      lastError: a.error ?? null,
    },
    runtimeDefaults: null,
    activity: {
      ...(a.output ? { lastOutput: { displayText: a.output, updatedAt: at } } : {}),
      ...(a.tool ? { lastToolCall: { displayText: a.tool, updatedAt: at } } : {}),
      lastConversationAt: at,
    },
    focus: null,
    management: null,
    createdAt: ago(3 * 1440),
    updatedAt: at,
  } as SessionResource;
}

const hostRow = (id: string) => ({ id, name: id, kind: "Agent", hostId: "HOST-A", profile: "omega", projectId: PROJECT, cwd: null, state: "", generation: 3, nativeId: null });

function sidebar(snapshot: SidebarSnapshot): SidebarSnapshot {
  if (!on) return snapshot;
  return {
    ...snapshot,
    active: [...snapshot.active, ...AGENTS.map(session)],
    projects: snapshot.projects && {
      ...snapshot.projects,
      projects: [
        ...snapshot.projects.projects,
        { project_id: PROJECT, workspace_root: "/home/ema/cutex-dev", authority_epoch: directorVacant ? 9 : 8, director_cutex_session_id: directorVacant ? null : "pv-dir", presentation: { display_name: "cutex-dev", badge_label: "CX", color: "blue" }, active_member_count: AGENTS.length, lifecycle: "active" },
      ],
    },
    hostRows: { ...snapshot.hostRows, ...Object.fromEntries(AGENTS.map((a) => [a.id, hostRow(a.id)])) },
  };
}

/** A running turn with one working sub-agent (collabAgentToolCall spawnAgent). */
function threadWithSubagent(id: string, sub: string, task: string, command: string) {
  const t = Date.now() / 1000;
  return {
    thread: {
      id: `thread-${id}`,
      turns: [
        {
          id: `${id}-t1`,
          status: "inProgress",
          startedAt: t - 600,
          completedAt: null,
          items: [
            { type: "userMessage", id: `${id}-u1`, content: [{ type: "text", text: task }] },
            { type: "commandExecution", id: `${id}-c1`, command, status: "completed", exitCode: 0, durationMs: 300 },
            { type: "collabAgentToolCall", id: `${id}-s1`, tool: "spawnAgent", status: "completed", senderThreadId: `thread-${id}`, receiverThreadIds: [sub], prompt: task, model: null, reasoningEffort: null, agentsStates: { [sub]: { status: "running", message: null } } },
          ],
        },
      ],
    },
  };
}

const THREADS: Record<string, () => unknown> = {
  "pv-sec": () => threadWithSubagent("pv-sec", "thread-pv-sub-revoke", "找 revokeToken 的调用点", "sed -n 1,200p src/token.rs"),
  "pv-shm": () => threadWithSubagent("pv-shm", "thread-pv-sub-migrate", "核对布局 v1→v2 迁移用例", "rg -n toolsCollapsed apps/desktop/src"),
};

type Step = [string, "pending" | "inProgress" | "completed"];
const PLANS: Record<string, string[]> = {
  "pv-dir": ["读今天合并的提交", "汇总今天合并的提交", "给 release-bot 写 r251 的要点", "回复主人"],
  "pv-shm": ["读 §24.12", "Rail 收起状态写进布局 v2", "改旧存档的迁移", "补测试", "截图"],
  "pv-qa": ["启动预览", "截图 1–16", "截图 17–32", "写验收报告"],
  "pv-rh": ["加 needsYouCount 字段", "改 /summary", "编译 cutex-server", "跑接口测试"],
};

function planOf(steps: string[], at: number): { step: string; status: Step[1] }[] {
  return steps.map((step, i) => ({ step, status: i < at ? "completed" : i === at ? "inProgress" : "pending" }));
}

function start(core: MockCore): void {
  if (!on) return;
  const progress: Record<string, number> = { "pv-dir": 1, "pv-shm": 2, "pv-qa": 1, "pv-rh": 2 };
  const send = (id: string) => core.nativeEvent(id, "turn/plan/updated", { threadId: `thread-${id}`, turnId: `${id}-t1`, explanation: null, plan: planOf(PLANS[id]!, progress[id]!) });
  // At start: every plan once (the 进度 rows, the plan bars); then one agent advances now and then.
  Object.keys(PLANS).forEach((id, i) => setTimeout(() => send(id), 600 + i * 250));
  const order = ["pv-qa", "pv-shm", "pv-rh", "pv-dir"];
  let n = 0;
  setInterval(() => {
    const id = order[n++ % order.length]!;
    if (progress[id]! < PLANS[id]!.length - 1) {
      progress[id]!++;
      send(id);
    }
  }, 45_000);
}

// ── 「动态」: the cutex project log (project-events, design 022) ─────────────────────────────────────
// Three days of rows (every kind, one journal gap) for cutex-dev, newest first in pages of the route's
// shape; a live row every 15 s to each watch (and the host hint); 正在进行 with Claude sub-agents /
// background commands, a Codex terminal, a job and an offline agent's unknown task. 停止 drops the item.

const STREAM_ID = "mock-pe-1";
const NAME = Object.fromEntries(AGENTS.map((a) => [a.id, a.name]));

type Tpl = [kind: string, agent: string | null, title: string | null, detail: string | null, extra?: Partial<ProjectEvent>];
const TEMPLATES: Tpl[] = [
  ["turn.completed", "pv-shm", "把 Rail 的收起状态写进布局 v2", "改好了，测试 412 通过。", { durationMs: 125_000, toolCalls: 14 }],
  ["background.finished", "pv-rh", "cargo build --release -p cutex-server", "exit 0", { status: "completed", durationMs: 72_000 }],
  ["ask.created", "pv-dir", "Shelf 窗格的拖放细节", "→ shelf-model", { status: "running" }],
  ["approval.requested", "pv-sec", "运行 git push remote feat/revoke", "命令", { status: "requested" }],
  ["turn.failed", "pv-net", "重连 remote 的中继", "ECONNRESET remote:24404（已重试 2 次）", { status: "failed", durationMs: 400_000, toolCalls: 9 }],
  ["subagent.started", "pv-sec", "找 revokeToken 的调用点", null],
  ["artifact.published", "pv-rel", "r251-release-notes.md", "文档", {}],
  ["ask.answered", "pv-set", "ownerDeviceAdded 提示", "已回答 · 做完了，测试通过，等你验收。", { status: "answered" }],
  ["background.finished", "pv-perf", "pnpm vitest run test/sidebar.test.ts", "2 failed", { status: "failed", durationMs: 48_000 }],
  ["turn.completed", "pv-dir", "汇总今天合并的提交", "写好了，发到状态板。", { durationMs: 48_000, toolCalls: 3 }],
  ["approval.decided", "pv-qa", "运行 node scripts/qa-preview-matrix.mjs", "命令", { status: "approved" }],
  ["subagent.finished", "pv-shm", "核对布局 v1→v2 迁移用例", null, { status: "completed" }],
  ["ownerNotify.created", "pv-tr", "ja 的「吊销」用「失効」还是「取り消し」？", null, { status: "question" }],
  ["turn.interrupted", "pv-mob", "等 remote-hosts 的 /summary 接口", null, { status: "interrupted", durationMs: 9_000, toolCalls: 1 }],
  ["background.finished", "pv-rh", "cargo test --release", "stopped", { status: "stopped" }],
  ["job.finished", "pv-qa", "job 7f3a", "exit 0", { status: "exited" }],
  ["runtime.offline", "pv-upd", null, "进程退出 (code 1)", { status: "offline" }],
  ["workflow.run", null, "nightly-build", null, { status: "completed" }],
  ["member.joined", "pv-doc", null, null],
  ["ask.failed", "pv-dir", "跑全量 e2e", "rate limited (429)", { status: "failed" }],
  ["turn.completed", "pv-qa", "截图 1–16", "16 张都截好了。", { durationMs: 320_000, toolCalls: 41 }],
  ["runtime.online", "pv-upd", null, null, { status: "online" }],
  ["ask.closed", "pv-dir", "核对 r250 部署", "accepted", { status: "accepted" }],
  ["background.started", "pv-rh", "cargo build --release -p cutex-server", null, { status: "running" }],
];

const nullRefs = (): ProjectEvent["refs"] => ({ askId: null, jobId: null, artifactId: null, workflowRunId: null, approvalId: null, notificationId: null });

function makeRow(seq: number, at: number, [kind, agent, title, detail, extra]: Tpl): ProjectEvent {
  const refs = nullRefs();
  if (kind.startsWith("ask.")) refs.askId = `ask-mock-${seq % 7}`;
  if (kind.startsWith("approval.")) refs.approvalId = `appr-mock-${seq % 5}`;
  if (kind === "artifact.published") refs.artifactId = "art-mock-notes";
  if (kind === "ownerNotify.created") refs.notificationId = `on-mock-${seq}`;
  return {
    cursor: `pe:${seq}`,
    at: new Date(at).toISOString(),
    projectId: PROJECT,
    cutexSessionId: agent,
    agentName: agent ? (NAME[agent] ?? agent) : null,
    kind,
    status: null,
    title,
    detail,
    parent: { turnId: kind.startsWith("turn.") && agent ? `${agent}-t${seq}` : null, taskId: null, threadId: null },
    refs,
    source: { method: null, eventCursor: null },
    ...extra,
  };
}

/** Newest first. */
let rows: ProjectEvent[] = [];
let seq = 0;
function seedRows(): void {
  if (rows.length) return;
  const now = Date.now();
  const out: ProjectEvent[] = [];
  // Oldest first while building: every ~25 min back over three days, a gap two days ago.
  const count = 170;
  for (let i = 0; i < count; i++) {
    const at = now - (count - i) * 25 * 60_000 - (i % 3) * 60_000;
    if (i === 40) out.push(makeRow(++seq, at - 60_000, ["journal.gap", null, null, null]));
    out.push(makeRow(++seq, at, TEMPLATES[i % TEMPLATES.length]!));
  }
  if (ownerActivityScene) {
    out.push(makeRow(++seq, now - 180_000, ["turn.completed", "pv-shm", "完成委托中的布局迁移检查", "检查完成，报告已发布。", { turnOrigin: "external", durationMs: 83_000, toolCalls: 12 }]));
    out.push(makeRow(++seq, now - 120_000, ["turn.completed", "pv-dir", "整理项目说明", "项目说明已经更新。", { durationMs: 28_000, toolCalls: 4 }]));
    out.push(makeRow(++seq, now - 60_000, ["turn.completed", "pv-dir", "这一版的布局有什么变化？", "布局变更已整理在对话中。", { turnOrigin: "owner", durationMs: 18_000, toolCalls: 2 }]));
    out.push(makeRow(++seq, now - 30_000, ["artifact.published", "pv-shm", "布局迁移检查报告", "文档"]));
  }
  rows = out.reverse();
}

const matches = (r: ProjectEvent, kinds: readonly string[] | undefined, sessionId: string | null | undefined) =>
  (!kinds?.length || kinds.includes(r.kind.split(".")[0]!)) && (!sessionId || r.cutexSessionId === sessionId || r.cutexSessionId === null);
const seqOf = (c: string | null | undefined) => Number(/^pe:(\d+)$/.exec(c ?? "")?.[1] ?? NaN);

function page(projectId: string, q: ProjectEventsQuery): ProjectEventPage {
  seedRows();
  const limit = Math.min(500, Math.max(1, q.limit ?? 100));
  const own = projectId === PROJECT ? rows.filter((r) => matches(r, q.kinds, q.sessionId)) : [];
  let events: ProjectEvent[];
  let hasMore: boolean;
  if (q.after) {
    const newer = own.filter((r) => seqOf(r.cursor) > seqOf(q.after)).reverse();
    events = newer.slice(0, limit);
    hasMore = newer.length > limit;
  } else {
    const older = q.before ? own.filter((r) => seqOf(r.cursor) < seqOf(q.before)) : own;
    events = older.slice(0, limit);
    hasMore = older.length > limit;
  }
  return { projectId, streamId: STREAM_ID, cursor: `pe:${seq}`, earliestCursor: `pe:${seqOf(rows[rows.length - 1]?.cursor)}`, order: q.after ? "oldestFirst" : "newestFirst", hasMore, events };
}

const watches = new Map<string, ProjectEventsWatch & { projectId: string }>();
let watchN = 0;
const stopped = new Set<string>();

const claude = (session: string, kind: BackgroundItem["kind"], id: string, title: string, startedMin: number): BackgroundItem => ({
  kind,
  source: "claude",
  id,
  title,
  detail: null,
  turnId: `${session}-t1`,
  threadId: `thread-${session}`,
  startedAt: ago(startedMin),
  state: "running",
  stop: { kind: "native", cutexSessionId: session, method: "claude/tasks/stop", params: { threadId: `thread-${session}`, taskId: id } },
});
const BG_STARTED = Date.now();

function background(projectId: string): ProjectBackground {
  const since = (Date.now() - BG_STARTED) / 60_000;
  const agents: ProjectBackground["agents"] = projectId !== PROJECT ? [] : [
    { cutexSessionId: "pv-sec", agentName: NAME["pv-sec"]!, backend: "claude", runtime: "online", complete: true, items: [claude("pv-sec", "subagent", "a1b2", "找 revokeToken 的调用点", 4 + since), claude("pv-sec", "background", "bash-7", "cargo test --lib -p cutex", 11 + since)] },
    { cutexSessionId: "pv-shm", agentName: NAME["pv-shm"]!, backend: "claude", runtime: "online", complete: true, items: [claude("pv-shm", "subagent", "c3d4", "核对布局 v1→v2 迁移用例", 1.6 + since)] },
    { cutexSessionId: "pv-rh", agentName: NAME["pv-rh"]!, backend: "claude", runtime: "online", complete: true, items: [{ kind: "job", source: "job", id: "job_1deb0000a7c94e2b8f6d4153b0e9c2d7a1f3", title: "cargo build --release --locked -p codex-cli", detail: null, turnId: null, threadId: null, startedAt: ago(6.5 + since), state: "running", stop: { kind: "job", jobId: "job_1deb0000a7c94e2b8f6d4153b0e9c2d7a1f3", expectedRevision: 2 } }] },
    { cutexSessionId: "pv-perf", agentName: NAME["pv-perf"]!, backend: "codex", runtime: "online", complete: true, items: [{ kind: "background", source: "codex", id: "4021", title: "pnpm vitest run test/sidebar.test.ts", detail: null, turnId: "pv-perf-t1", threadId: "thread-pv-perf", startedAt: null, state: "running", stop: { kind: "native", cutexSessionId: "pv-perf", method: "thread/backgroundTerminals/terminate", params: { threadId: "thread-pv-perf", processId: "4021" } } }] },
    { cutexSessionId: "pv-upd", agentName: NAME["pv-upd"]!, backend: "claude", runtime: "offline", complete: false, items: [{ ...claude("pv-upd", "subagent", "e5f6", "检查更新通道", 70), state: "unknown", stop: null }] },
  ];
  for (const a of agents) a.items = a.items.filter((i) => !stopped.has(`${a.cutexSessionId}:${i.id}`));
  return { projectId, generatedAt: new Date().toISOString(), jobsAvailable: true, agents };
}

function streamApi(core: MockCore): Partial<DesktopApi> {
  const finish = (sessionId: string, item: BackgroundItem) => {
    stopped.add(`${sessionId}:${item.id}`);
    pushLive(core, item.kind === "subagent" ? ["subagent.finished", sessionId, item.title, null, { status: "interrupted" }] : ["background.finished", sessionId, item.title, "stopped", { status: "stopped" }]);
  };
  return {
    async projectEvents(projectId, query) {
      return { ok: true, value: page(projectId, query) };
    },
    async projectBackground(projectId) {
      return { ok: true, value: background(projectId) };
    },
    async watchProjectEvents(projectId, watch) {
      const watchId = `mock-pw-${++watchN}`;
      watches.set(watchId, { ...watch, projectId });
      setTimeout(() => emitWatch(core, { watchId, kind: "status", status: "live" }), 150);
      return watchId;
    },
    async unwatchProjectEvents(watchId) {
      watches.delete(watchId);
    },
    async stopClaudeTask(sessionId, _threadId, taskId) {
      const item = background(PROJECT).agents.flatMap((a) => a.items.map((i) => ({ a, i }))).find(({ a, i }) => a.cutexSessionId === sessionId && i.id === taskId);
      if (item) setTimeout(() => finish(sessionId, item.i), 1500);
    },
  };
}

const emitWatch = (core: MockCore, m: ProjectEventsMessage) => core.emit("projectEvents", m);

function pushLive(core: MockCore, tpl: Tpl): void {
  seedRows();
  const row = makeRow(++seq, Date.now(), tpl);
  rows = [row, ...rows];
  for (const [watchId, w] of watches) if (w.projectId === PROJECT && matches(row, w.kinds, w.sessionId)) emitWatch(core, { watchId, kind: "event", event: row });
  core.emitHost("cutex/projectEvents/appended", { projectId: PROJECT, cursor: row.cursor });
}

function startStream(core: MockCore): void {
  if (!on) return;
  let n = 0;
  const LIVE: Tpl[] = [
    ["turn.completed", "pv-perf", "修 sidebar.test.ts 的 2 个失败", "都过了：58 passed。", { durationMs: 96_000, toolCalls: 12 }],
    ["subagent.finished", "pv-sec", "找 revokeToken 的调用点", null, { status: "completed" }],
    ["ask.created", "pv-dir", "r251 发布说明过审", "→ release-bot", { status: "queued" }],
    ["artifact.published", "pv-qa", "qa-matrix-1-16.png", "图片", {}],
  ];
  setInterval(() => pushLive(core, LIVE[n++ % LIVE.length]!), 15_000);
}
export const mock: ModuleMock = {
  sidebar,
  thread: (sessionId) => (on && THREADS[sessionId] ? THREADS[sessionId]!() : null),
  start: (core) => {
    start(core);
    startStream(core);
  },
  api: (core) => ({ ...streamApi(core), ...directorMock(core) }),
  // 「动态」 (cutex project-events) only in this preview; ?legacy keeps the derived 最近动态.
  ...(on ? { features: { new: ["project-events", "director-address", "director-change-notices", "director-handover", "management-start-adoption"] } } : {}),
};

function directorMock(core: MockCore): Partial<DesktopApi> {
  const stamp = new Date().toISOString();
  const director: ProjectDirector = { projectId: "cutex-dev", directorSessionId: directorVacant ? null : "pv-dir", authorityEpoch: directorVacant ? 9 : 8, changes: [{ changeId: "change-008", projectId: "cutex-dev", oldDirector: "previous-director", newDirector: "pv-dir", oldEpoch: 7, newEpoch: 8, reason: "ownerAssigned", state: "finalized", preparedAt: stamp }] };
  director.changes.push({ changeId: "change-009-clear", projectId: PROJECT, oldDirector: "pv-dir", newDirector: null, oldEpoch: 8, newEpoch: 9, reason: "cleared", cleared: true, state: "finalized", preparedAt: stamp });
  if (!directorVacant) director.changes.push({ changeId: "change-010-assign", projectId: PROJECT, oldDirector: null, newDirector: "pv-dir", oldEpoch: 9, newEpoch: 10, reason: "ownerAssigned", state: "finalized", preparedAt: stamp });
  if (!directorVacant) director.authorityEpoch = 10;
  if (handoverScene === "recent" || handoverScene === "expired") {
    const preparedAt = new Date(Date.now() - (handoverScene === "expired" ? 8 : 3) * 86400_000).toISOString();
    director.changes = [{ ...director.changes[0]!, preparedAt, settledAt: preparedAt }];
  }
  const handovers: DirectorHandover[] = [
    { id: "handover:change-008:release", projectId: "cutex-dev", askId: "ask-release-notes", from: "previous-director", to: "pv-dir", changeId: "change-008", revision: 0, state: "pending", reason: "replacementEvidenceRequired", provenanceKnown: true, actor: null },
    { id: "handover:change-008:qa", projectId: "cutex-dev", askId: "ask-ui-check", from: "previous-director", to: "intermediate-director", resolvedTo: "pv-dir", changeId: "change-008", revision: 1, state: "accepted", reason: "trustedReplacement", provenanceKnown: true, actor: "trustedProvider" },
  ];
  handovers.push({ id: "handover:owner-resolution", projectId: PROJECT, askId: "ask-owner-held", from: "previous-director", to: directorVacant ? "" : "intermediate-director", changeId: "change-009-clear", revision: 2, state: "pending", reason: "discardedHandoverRequiresOwner", provenanceKnown: true, ownerOnly: true });
  handovers.push({ id: "handover:superseded", projectId: PROJECT, askId: "ask-prior-director", from: "previous-director", to: "intermediate-director", changeId: "change-008", revision: 3, state: "superseded", reason: "directorChanged", provenanceKnown: true });
  const starts: DirectorStartReview[] = ["open", "deliveryUnknown"].map((state, i) => ({ reviewId: `review-${i}`, projectId: "cutex-dev", sourceActionId: `action-${i}`, sourceMessageId: `message-${i}`, sourceOperation: "memberCreate", originalRequester: "previous-director", originalDirector: "previous-director", targetSession: i ? "pv-qa" : "pv-set", contentSha256: "73f1f9b05b2da3e2a42a2380d1e5cd871b93721c753b149b50373dd01ab3fc915", directorAtReview: "pv-dir", epochAtReview: director.authorityEpoch, revision: 0, state: state as DirectorStartReview["state"], createdAt: stamp, updatedAt: stamp }));
  if (handoverEmpty) {
    handovers.length = 0;
    starts.length = 0;
  }
  const ok = <T,>(value: T) => ({ ok: true as const, value: structuredClone(value) });
  const refuse = (code: string) => ({ ok: false as const, code, message: code });
  return {
    projectDirector: async (project) => ok({ ...director, projectId: project }),
    directorHandovers: async (project) => ok({ items: project === "cutex-dev" ? handovers : [] }),
    directorStartReviews: async (project) => ok({ items: project === "cutex-dev" ? starts : [] }),
    directorScopeCandidates: async () => ok({ items: [{ askId: "ask-legacy-layout", title: "旧版布局核对", requester: { kind: "agent" as const, cutexSessionId: "previous-director", name: "上任 Director" }, targetSession: "pv-shl", projectHint: null, provenanceKnown: false }, { askId: "ask-orphaned-stamped", title: "已确认项目来源的待交接任务", requester: { kind: "agent" as const, cutexSessionId: "previous-director" }, targetSession: "pv-shl", projectHint: PROJECT, provenanceKnown: true }] }),
    directorReviewContent: async (_project, id) => {
      const item = starts.find((s) => s.reviewId === id);
      return item ? ok({ reviewId: id, content: "检查项目设置页的布局，完成后交回截图和测试结果。", delivery: { message_id: item.sourceMessageId, state: "quarantined", outcome: item.state === "deliveryUnknown" ? "unknown" as const : "not_delivered" as const } }) : refuse("review_not_found");
    },
    decideDirectorItem: async (_project, kind, id, decision, fence) => {
      const item = kind === "handover" ? handovers.find((h) => h.id === id) : starts.find((s) => s.reviewId === id);
      if (!item) return refuse("review_not_found");
      if (fence.expectedEpoch !== director.authorityEpoch || fence.expectedRevision !== item.revision) return refuse("revision_conflict");
      if (decision === "accept" && !director.directorSessionId) return refuse("director_unassigned");
      if (kind === "handover" && decision === "accept") (item as DirectorHandover).resolvedTo = director.directorSessionId!;
      if (decision === "accept" && item.state === "deliveryUnknown") return refuse("delivery_unknown");
      item.state = decision === "discard" ? "discarded" : kind === "handover" ? "accepted" : "adopted";
      item.revision++;
      core.emitHost("cutex/project/handoverUpdated", { projectId: "cutex-dev" });
      return ok({});
    },
    approveDirectorScope: async (project, scope) => {
      if (!director.directorSessionId) return refuse("director_unassigned");
      if (scope.expectedEpoch !== director.authorityEpoch) return refuse("authority_conflict");
      for (const id of scope.askIds) handovers.push({ id: `scope:${scope.id}:${id}`, projectId: project, askId: id, from: "previous-director", to: "pv-dir", changeId: scope.id, revision: 0, state: "pending", reason: "ownerApprovedScope", provenanceKnown: false, actor: null });
      return ok({});
    },
  };
}
