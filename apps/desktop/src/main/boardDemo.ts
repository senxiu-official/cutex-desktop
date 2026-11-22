// 项目看板 dev demo (CUTEX_DESKTOP_DEMO_BOARD=1, never in a packaged build): sample projects on two hosts, so the real
// window can be looked at without a daemon. Built through shared/boardModel buildBoard() from session / delegation
// rows shaped like cutex's, so the demo also exercises the model.
import type { ProjectSummary, SessionResource } from "@cutex-desktop/protocol";
import type { AskSummary, ServiceView, SidebarSnapshot } from "../shared/ipc";
import type { BoardProjectView } from "../shared/board";
import { buildBoard, type BoardHostInput } from "../shared/boardModel";

const MIN = 60_000;
const H = 60 * MIN;

type Agent = { id: string; name: string; project: string; busy?: boolean; offline?: boolean; error?: string; paused?: boolean; doing?: string; ago: number; profile?: string };
type Ask = { id: string; project: string; to: string; title: string; open?: boolean; ago: number; note?: string; stopUnconfirmed?: boolean; closed?: "completed" | "accepted" | "stopped"; failed?: boolean };

function session(a: Agent, now: number): SessionResource {
  const at = new Date(now - a.ago).toISOString();
  return {
    contractVersion: 2, cutexSessionId: a.id, revision: 1, lifecycle: "active" as SessionResource["lifecycle"], retiredAt: null, hostId: "demo", displayName: a.name,
    threadName: null, cwd: null, profile: a.profile ?? "Ceobe", configuredProfile: null, launchedProfile: null, effectiveNextLaunch: { profile: null, source: "demo" },
    groups: [], registrationClass: null, visible: true, native: { threadId: null, schema: null },
    runtime: { backend: "demo", status: a.offline ? "offline" : a.error ? "error" : "online", appServerConnected: !a.offline, runtimeGeneration: 1, runtimeAgentId: null, activeTurnId: null, activeTurnObservedAt: null, threadStatus: null, threadSettings: null, requiresVisibleTerminal: false, tuiAttached: false, lastEventAt: null, lastError: a.error ?? null },
    runtimeDefaults: null, focus: null, management: null, createdAt: at, updatedAt: at,
    activityStatus: a.offline ? "offline" : a.busy ? "busy" : "idle", busySince: a.busy ? at : null, lastActivityAt: at,
    activity: {
      ...(a.doing ? { lastToolCall: { displayText: a.doing, updatedAt: at } } : {}),
    },
    ...(a.paused ? { agentPause: { phase: "paused", cutexSessionId: a.id, requestedAt: at, by: "owner", at: "turnEnd" } } : {}),
  } as SessionResource;
}

function ask(a: Ask, from: string, now: number): AskSummary {
  const at = new Date(now - a.ago).toISOString();
  return {
    askId: a.id, title: a.title, requester: { kind: "agent", cutexSessionId: from, name: from } as unknown as AskSummary["requester"], target: a.to, projectId: a.project,
    execution: a.failed ? "failed" : a.open ? "running" : "answered", attempts: 1, createdAt: at, updatedAt: at, revision: 1,
    closed: a.open ? null : a.closed ?? null, closedAt: a.open ? null : at,
    attempt: { n: 1, ...(a.note ? { progress: [{ text: a.note, at: new Date(now - Math.min(a.ago, 4 * MIN)).toISOString() }] } : {}), ...(a.stopUnconfirmed ? { stopUnconfirmed: true } : {}) },
  } as AskSummary;
}

function project(id: string, name: string, color: string, director: string): ProjectSummary {
  return { project_id: id, authority_epoch: 1, director_cutex_session_id: director, presentation: { display_name: name, badge_label: name.slice(0, 2), color }, active_member_count: 0, lifecycle: "active" };
}

function host(hostId: string, label: string, projects: ProjectSummary[], agents: Agent[], asks: Ask[], extra: Partial<BoardHostInput>, now: number): BoardHostInput {
  const active = agents.map((a) => session(a, now));
  const hostRows = Object.fromEntries(agents.map((a) => [a.id, { id: a.id, name: a.name, kind: "agent", hostId, profile: null, projectId: a.project, cwd: null, state: "", generation: 1, nativeId: null }]));
  const sidebar: SidebarSnapshot = { active, retired: [], projects: { schema: "demo", projects }, hostRows };
  const directorOf = (p: string) => projects.find((x) => x.project_id === p)?.director_cutex_session_id ?? "";
  return {
    hostId, label, state: "connected", readAt: now, features: null, sidebar,
    openAsks: asks.filter((a) => a.open).map((a) => ask(a, directorOf(a.project), now)),
    closedAsks: asks.filter((a) => !a.open).map((a) => ask(a, directorOf(a.project), now)),
    notifications: [], approvals: [], services: [], quotaOut: [], ...extra,
  };
}

export function demoBoardProjects(now = Date.now()): BoardProjectView[] {
  const eva = host("demo-eva", "host-a",
    [project("p-demo-dev", "cutex-desktop", "blue", "alice"), project("p-wv", "Waveline", "green", "wv-dir"), project("p-demo", "demo-study", "red", "d2"), project("p-storm", "STORM II 美术", "cyan", "st-dir")],
    [
      { id: "alice", name: "project-lead", project: "p-demo-dev", busy: true, doing: "合并 feat/board-window，等全量测试", ago: 12 * MIN },
      { id: "aria", name: "deputy-Aria", project: "p-demo-dev", doing: "整理 TODO 队列（the next release 之后）", ago: 38 * MIN },
      { id: "fpl", name: "file-page-large", project: "p-demo-dev", busy: true, doing: "$ vitest run（1203 个文件）", ago: 4 * MIN, profile: "profile-a" },
      { id: "audit", name: "peer-review", project: "p-demo-dev", busy: true, doing: "复审 board 窗口的 IPC", ago: 21 * MIN },
      { id: "ui", name: "ui-lead", project: "p-demo-dev", paused: true, doing: "设置页 R1–R9 审查", ago: 2 * H },
      { id: "jas", name: "Jasmine", project: "p-demo-dev", doing: "交回：托盘通知中心分页", ago: 3 * H },
      { id: "moth", name: "Moth", project: "p-demo-dev", offline: true, ago: 26 * H },
      { id: "wv-dir", name: "wvln-dir", project: "p-wv", doing: "等 wvln-backend 的推送修复", ago: 18 * MIN },
      { id: "wv-m", name: "wvln-mobile", project: "p-wv", busy: true, doing: "相册上传进度条：压缩前后对比", ago: 52 * MIN },
      { id: "d2", name: "director-r2", project: "p-demo", busy: true, doing: "$ python analyze.py --all（第 2 批）", ago: 24 * MIN },
      { id: "sam", name: "sampler", project: "p-demo", busy: true, doing: "抽样 12k 条，去重中", ago: 3 * MIN },
      { id: "wr", name: "writer", project: "p-demo", doing: "交回：方法一节初稿", ago: 3 * MIN },
      { id: "st-dir", name: "storm-dir", project: "p-storm", offline: true, ago: 3 * 24 * H },
      { id: "gr", name: "grader", project: "p-storm", offline: true, ago: 3 * 24 * H },
    ],
    [
      { id: "a1", project: "p-demo-dev", to: "audit", title: "复审 board 窗口 IPC", open: true, ago: 21 * MIN, note: "preload 只开放 4 个方法，已核对" },
      { id: "a2", project: "p-demo-dev", to: "fpl", title: "项目看板窗口（真实版）", open: true, ago: 2 * H, note: "全量测试跑到 900/1203" },
      { id: "a3", project: "p-demo-dev", to: "ui", title: "设置页 R1–R9 布局审查", open: true, ago: 5 * H, stopUnconfirmed: true },
      { id: "a4", project: "p-demo-dev", to: "fpl", title: "竖屏 Rail 圆角修复", ago: 65 * MIN, closed: "accepted" },
      { id: "a5", project: "p-demo-dev", to: "jas", title: "托盘通知中心分页", ago: 3 * H, closed: "completed" },
      { id: "a6", project: "p-demo-dev", to: "fpl", title: "git status possiblyStale 重读", ago: 6 * H, closed: "accepted" },
      { id: "a7", project: "p-wv", to: "wv-m", title: "图片缩略图缓存", open: true, ago: 52 * MIN, note: "问：缓存上限 200 MB 还是按张数？" },
      { id: "a8", project: "p-wv", to: "wv-m", title: "聊天图片预览", ago: 4 * H, closed: "accepted" },
      { id: "a9", project: "p-demo", to: "sam", title: "第 2 批样本", open: true, ago: 1 * H, note: "抽样完成，去重中" },
      { id: "a10", project: "p-demo", to: "wr", title: "方法一节", ago: 3 * MIN, closed: "completed" },
    ],
    {
      notifications: [{ notificationId: "ntf-d1", agentId: "alice" }, { notificationId: "ntf-d2", agentId: "wv-dir" }] as unknown as BoardHostInput["notifications"],
      services: [{ slug: "relay-probe", projectId: "p-wv", ownerCutexSessionId: "wv-dir", health: "unreachable" }] as unknown as ServiceView[],
    }, now);
  const remote = host("demo-remote", "remote",
    [project("t-demo-research", "cutex 后端", "yellow", "kitti"), project("t-wv", "Waveline", "green", "wv-be-dir"), project("t-ifm", "ifm-ema", "magenta", "ifm-dir")],
    [
      { id: "kitti", name: "Kittiwake", project: "t-demo-research", busy: true, doing: "the next release 门禁：全量 lib 5561 通过，查 2 个 ratchet", ago: 34 * MIN },
      { id: "dsm", name: "disposal-source-map", project: "t-demo-research", busy: true, doing: "$ cargo test --lib board_summary", ago: 1 * H, profile: "profile-b" },
      { id: "sol", name: "Sol", project: "t-demo-research", busy: true, doing: "G3：ask stalled 标记", ago: 80 * MIN },
      { id: "guin", name: "researcher II", project: "t-demo-research", doing: "交回：Gemini 叙述省略缓存", ago: 30 * MIN },
      { id: "n61", name: "native-r61", project: "t-demo-research", error: "运行时启动失败（exit 101）", ago: 47 * MIN },
      { id: "wv-be", name: "wvln-backend", project: "t-wv", busy: true, doing: "$ go test ./push/... -run Dedupe", ago: 2 * H },
      { id: "wv-qa", name: "wvln-qa", project: "t-wv", offline: true, ago: 2 * 24 * H },
      { id: "ifm-dir", name: "director", project: "t-ifm", doing: "图表的任务已经交给 figures", ago: 50 * MIN },
      { id: "fig", name: "figures", project: "t-ifm", busy: true, doing: "三张图重画：误差带改成 95%", ago: 6 * MIN },
      { id: "plots", name: "plots", project: "t-ifm", doing: "交回：bootstrap 重跑", ago: 1 * H },
    ],
    [
      { id: "b1", project: "t-demo-research", to: "dsm", title: "G1 看板摘要接口", open: true, ago: 3 * H, note: "路由和 schema 已写，跑门禁" },
      { id: "b2", project: "t-demo-research", to: "sol", title: "G3 ask stalled 标记", open: true, ago: 80 * MIN, note: "阈值放在 cutex 配置里" },
      { id: "b3", project: "t-demo-research", to: "guin", title: "Gemini 原生线缓存复核", open: true, ago: 3 * H, note: "97.88% 证据覆盖，等验收" },
      { id: "b4", project: "t-demo-research", to: "sol", title: "WP-B1 yielded 停止收口", ago: 150 * MIN, closed: "accepted" },
      { id: "b5", project: "t-demo-research", to: "n61", title: "r60 冒烟测试", ago: 7 * H, failed: true },
      { id: "b6", project: "t-wv", to: "wv-be", title: "推送重复投递修复", open: true, ago: 165 * MIN, note: "去重键改成 (device, seq)，跑集成测试" },
      { id: "b7", project: "t-ifm", to: "fig", title: "第 4 章图表重画", open: true, ago: 35 * MIN, note: "3/5 张已换新配色" },
      { id: "b8", project: "t-ifm", to: "plots", title: "bootstrap 重跑", ago: 1 * H, closed: "completed" },
    ],
    { approvals: [{ approvalId: "apr-d1", requesterCutexSessionId: "plots", projectId: "t-ifm" }] as unknown as BoardHostInput["approvals"], quotaOut: ["profile-b"] }, now);
  return buildBoard([eva, remote], now);
}
