// Browser-preview data for delegations (委托): two agents, Lead (requester) and Helper (handler),
// with agent_delegate calls, ASK / ANSWER events with their views, the cutex asks API and a timed
// replay (progress → answered → closed, the next queued delegation starting). Between them the
// delegations cover every status row of the card table (DESIGN §4.21). Collected by dev/mockModules.ts (dev/mockTypes.ts).
import type { AskAnswerPage, AskCommandMethod, AskDetail, AskFilter, AskHold, AskSummary, DaemonApi, MutationResult } from "../../../../shared/ipc";
import type { MockAdmissionEntry, MockCore, ModuleMock } from "../../dev/mockTypes";
import type { UpgradeApprovalRead } from "../../../../shared/delegationUpgradePreview";


const ROUTING_SCENE = typeof location !== "undefined" && new URLSearchParams(location.search).has("routingReviews");
const digest = `sha256:${"a".repeat(64)}`;
const records = new Map<string, UpgradeApprovalRead>();
function routingRows(seed: AskSummary): AskSummary[] {
  const rows = [
    { id: "route-pending", title: "请 Kai 复核项目内委托的路由", state: "pending" as const },
    { id: "route-denied", title: "已拒绝：本次任务超出项目安排", state: "denied" as const },
    { id: "route-grant", title: "路由已批准，等待一次性审核授权", state: "approved" as const },
  ];
  return rows.map(row => {
    const approvalId = `routing-approval-${row.id}`, askId = `ask-${row.id}`;
    const ref = { kind: "routing" as const, approvalId, projectId: "desktop" };
    records.set(approvalId, { id: approvalId, projectId: "desktop", delegationRef: { hostId: "local", id: askId }, state: row.state,
      requestDigest: digest, revision: 1, policyRevision: 1, authorityEpoch: 1,
      requestedBy: { kind: "agent", hostId: "local", sessionId: "lead", name: "Lead", redacted: false },
      decidedBy: row.state === "pending" ? null : { kind: "owner", hostId: null, sessionId: null, name: null, redacted: false },
      decisionAuthority: row.state === "pending" ? null : "owner", decisionNote: row.state === "denied" ? "本次委托范围不符合当前项目安排。" : null,
      createdAt: seed.createdAt, decidedAt: row.state === "pending" ? null : seed.updatedAt, allowedActions: { approve: row.state === "pending", deny: row.state === "pending" } });
    return { ...seed, askId, title: row.title, target: "kai", targetName: "Kai", execution: "pendingReview", closed: row.state === "denied" ? "cancelled" : null,
      reviewRef: ref, reviewRefs: [ref], reviewDenialReason: row.state === "denied" ? "本次委托范围不符合当前项目安排。" : null };
  });
}
function routingMockApi(base: Partial<DaemonApi>, asks: AskSummary[], core: MockCore): Partial<DaemonApi> {
  const receipts = new Map<string, { input: string; result: UpgradeResult }>();
  return {
    ...base,
    async delegationRoutingApprovals(project) { return structuredClone([...records.values()].filter(record => record.projectId === project && record.state === "pending")); },
    async delegationUpgradeApproval(id) { return structuredClone(records.get(id) ?? await base.delegationUpgradeApproval!(id)); },
    async delegationUpgradeOperation(id) {
      const stored = receipts.get(id)?.result;
      return stored?.receipt ? { schema: "cutex.delegation-operation.v1", actionId: id, status: "found", outcomeUnknown: false, result: { receipt: structuredClone(stored.receipt) } } : base.delegationUpgradeOperation!(id);
    },
    async delegationUpgradeAction(project, action) {
      if (action.kind !== "decision" || !records.has(action.approvalId)) return base.delegationUpgradeAction!(project, action);
      const stored = receipts.get(action.actionId), input = JSON.stringify(action);
      if (stored) { if (stored.input !== input) throw Error("action_id_conflict"); return structuredClone(stored.result); }
      const record = records.get(action.approvalId)!;
      if (record.projectId !== project || record.state !== "pending" || !record.allowedActions[action.decision] || record.requestDigest !== action.expectedDigest || record.revision !== action.expectedRevision) throw Error("approval_revision_conflict");
      record.state = action.decision === "approve" ? "approved" : "denied"; record.revision++;
      record.allowedActions = { approve: false, deny: false }; record.decisionNote = action.decisionNote ?? null;
      record.decidedAt = new Date().toISOString(); record.decisionAuthority = "owner";
      record.decidedBy = { kind: "owner", hostId: null, sessionId: null, name: null, redacted: false };
      const ask = asks.find(row => row.askId === record.delegationRef.id)!;
      if (action.decision === "deny") { ask.closed = "cancelled"; ask.reviewDenialReason = action.decisionNote || "主人拒绝了本次项目路由。"; ask.revision++; }
      const result: UpgradeResult = { effectState: "committed", receipt: { schema: "cutex.delegation-operation.v1", actionId: action.actionId,
        operationId: `mock:${action.actionId}`, operation: "approval.decide", requestDigest: "b".repeat(64), status: "completed", effectState: "committed", outcomeUnknown: false, revision: 1, updatedAt: record.decidedAt } };
      receipts.set(action.actionId, { input, result });
      core.emitHost("cutex/delegation/routingApprovalChanged", { projectId: project, resourceId: record.id, revision: record.revision });
      core.emitCutex(["lead", "kai"], "cutex/ask/stateChanged", { ...ask });
      return structuredClone(result);
    },
  };
}

const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
const now = () => Date.now() / 1000;
const LEAD = { kind: "agent" as const, cutexSessionId: "lead", cutex_session_id: "lead", name: "Lead" };

type Party = [id: string, name: string];
const HELPER: Party = ["helper", "Helper"];
const MIKA: Party = ["mika", "Mika"];
const ALDEN: Party = ["alden", "Alden"];
const REI: Party = ["rei", "Rei"];
const SORA: Party = ["sora", "Sora"];
const EVA: Party = ["eva", "Eva"];

function ask(askId: string, title: string, target: Party, execution: AskSummary["execution"], over: Partial<AskSummary> & { ago?: number; ran?: number; owner?: boolean } = {}): AskSummary {
  const { ago = 900, ran, owner, ...rest } = over;
  const started = ran !== undefined ? iso(ran) : null;
  return {
    askId,
    title,
    requester: owner ? { kind: "owner" } : LEAD,
    target: target[0],
    targetName: target[1],
    projectId: "desktop",
    execution,
    hold: null,
    review: null,
    closed: null,
    queuePosition: null,
    attempts: started ? 1 : 0,
    answerId: null,
    openQuestions: 0,
    ownerQuestions: 0,
    createdAt: iso(ago),
    updatedAt: iso(Math.min(ago, 60)),
    revision: 3,
    attempt: started ? { n: 1, state: execution === "running" ? "running" : "answered", turnId: null, startedAt: started, endedAt: null, model: target[0] === "helper" ? "deepseek-v4-flash" : null, activity: { toolCalls: 0 } } : null,
    closedAt: null,
    ...rest,
  };
}

const ended = (startedAgo: number, endedAgo: number, extra: Partial<NonNullable<AskSummary["attempt"]>> = {}) => ({ n: 1, state: "answered", startedAt: iso(startedAgo), endedAt: iso(endedAgo), model: "deepseek-v4-flash", activity: { toolCalls: 12 }, ...extra });
const held = (hold: AskHold): Partial<AskSummary> => ({ hold });

// ---------- cross-host (peers-v2): mirrors of Lead's delegations to workstation-lab, and incoming ones ----------

/** Paired hosts of the peers mock (modules/peers/mock.ts uses the same ids / labels). */
const WORKSTATION_LAB = { peerId: "ci-7a3f01c2b4d5e6f708192a3b4c5d6e7f", label: "workstation-lab" };
const ALPHA = { peerId: "ci-ae3e47b1c2d3e4f5a6b7c8d9e0f1a2b3", label: "alpha-home" };
const GPU_BOX = { peerId: "ci-6b0c1d2e3f405162738495a6b7c8d9e0", label: "gpu-box" };
const LATE_ARTIFACT = "art-5c0ffee5c0ffee5c0ffee5c0ffee5c0ffee5c0ffee5c0ffee5c0ffee5c0ffee5";

function peerAsks(): AskSummary[] {
  const worker: Party = ["cutex.4be81f2a9c", "proj-worker"];
  const mirror = (peer: typeof WORKSTATION_LAB, target: Party, syncState: string, extra: Partial<AskSummary["remote"] & object> = {}) => ({ remote: { peerId: peer.peerId, label: peer.label, targetName: target[1], syncState, lastError: null, interruptReason: null, remoteState: null, ...extra } });
  const fromPeer = (peer: typeof WORKSTATION_LAB, name: string, caps = { sandbox: "workspace-write", networkAccess: true, unrestrictedServices: false }) => ({ requester: { kind: "peer" as const, peerId: peer.peerId, cutexSessionId: "cutex.9b2e4f1d77", name, label: peer.label, claimedCaps: caps } });
  return [
    ask("ask-px-run", "在 Workstation 上跑 DEMO 回归", worker, "running", { ago: 600, ran: 540, hops: 1, projectId: "desktop", ...mirror(WORKSTATION_LAB, worker, "synced", { remoteState: { execution: "running" } }) }),
    ask("ask-px-held", "在 gpu-box 上重跑 proj-r12 的评估", ["cutex.77aa01bc3d", "trainer"], "queued", { ago: 1900, hops: 1, hold: { reason: "peerUnreachable" }, ...mirror(GPU_BOX, ["cutex.77aa01bc3d", "trainer"], "peer_unreachable", { lastError: "connect to http://100.64.0.97:24270 timed out after 5 s" }) }),
    ask("ask-px-unknown", "核对 Workstation 的 asks 存储", worker, "queued", { ago: 2600, hops: 1, hold: { reason: "peerUnknown", raw: "execution=pausedByDirector" }, ...mirror(WORKSTATION_LAB, worker, "remoteStateUnknown", { lastError: "对端状态：execution=pausedByDirector（本机版本不认识）" }) }),
    ask("ask-px-removed", "整理 Alpha 的照片索引", ["cutex.a1b2c3d4e5", "photo-indexer"], "interrupted", { ago: 9000, hops: 1, closed: "stopped", closedAt: iso(8000), ...mirror(ALPHA, ["cutex.a1b2c3d4e5", "photo-indexer"], "removedByPeer", { interruptReason: "removedByPeer" }) }),
    // Waits for workstation-lab's owner to review it (the destination's snapshot says pendingReview).
    ask("ask-px-review", "在 Workstation 上用完整权限重建 CUDA 镜像", worker, "pendingReview", { ago: 240, hops: 1, ...mirror(WORKSTATION_LAB, worker, "synced", { remoteState: { execution: "pendingReview" } }) }),
    ask("ask-px-late", "统计 Workstation 上一周的 GPU 占用", worker, "interrupted", { ago: 200000, hops: 1, closed: "stopped", closedAt: iso(110000), ...mirror(WORKSTATION_LAB, worker, "outcomeUnknown", { interruptReason: "outcomeUnknown", remoteState: { execution: "answered" } }), lateAnswer: { artifactId: LATE_ARTIFACT, preview: "一周 GPU 平均占用 63%，峰值在周三晚上（训练任务 proj-r12）。", execution: "answered" } }),
    // Incoming: agents on workstation-lab / alpha-home delegating to agents here.
    ask("ask-pin-review", "复现 host-a 上的 ws 断线", HELPER, "pendingReview", { ago: 90, hops: 1, ...fromPeer(WORKSTATION_LAB, "proj-research") }),
    ask("ask-pin-queued", "给 r225 的回滚脚本做一次 dry-run", HELPER, "queued", { ago: 400, hops: 2, queuePosition: 3, hold: { reason: "targetBusy", position: 3 }, ...fromPeer(WORKSTATION_LAB, "proj-director", { sandbox: "read-only", networkAccess: false, unrestrictedServices: false }) }),
    ask("ask-pin-done", "导出 Waveline 的测试截图", MIKA, "answered", { ago: 7000, hops: 1, attempt: ended(6900, 6500), answerId: "ans-pin", answerPreview: "截图在 docs/shots/waveline-20261011/。", closed: "completed", closedAt: iso(6400), resultUndeliverable: true, ...fromPeer(ALPHA, "phone-qa") }),
  ];
}

/** Every row of the status table, plus an owner-made one awaiting the owner's acceptance. */
const asks: AskSummary[] = [
  ask("ask-run", "重构 queue flush 的 CAS 校验", HELPER, "running", { ago: 70, ran: 45, attempts: 2, attempt: { n: 2, state: "running", turnId: "helper-t2", startedAt: iso(45), model: "deepseek-v4-flash", activity: { toolCalls: 7, line: "跑 user_input 的测试" }, progress: [{ text: "读完 dispatch_queue_flush，开始改", at: iso(30) }] } }),
  ask("ask-queue2", "补 flush 并发测试", HELPER, "queued", { ago: 300, queuePosition: 2, ...held({ reason: "targetBusy", position: 2 }) }),
  ask("ask-wait", "更新 queue 面板文案", MIKA, "queued", { ago: 420, queuePosition: 1, ...held({ reason: "targetBusy", position: 1 }) }),
  ask("ask-review", "构建 r208 release", ALDEN, "pendingReview", { ago: 1500 }),
  ask("ask-paused", "迁移脚本 dry-run", REI, "queued", { ago: 2000, ...held({ reason: "paused", by: "owner" }) }),
  ask("ask-plan", "评估 Claude adapter 的 thread/read 投影", SORA, "admitted", { ago: 640, ...held({ reason: "paused", by: "planMode" }) }),
  ask("ask-offline", "清理 Rei 的旧日志", REI, "queued", { ago: 5000, ...held({ reason: "blocked", by: "runtimeDown" }) }),
  ask("ask-blocked", "把 r207 的 manifest 对一遍", ALDEN, "queued", { ago: 3600, ...held({ reason: "profileSwitchPending" }) }),
  ask("ask-question", "确认队列面板要不要拖拽", MIKA, "running", { ago: 800, ran: 600, ownerQuestions: 1, openQuestions: 1, ...held({ reason: "waitingForInput" }) }),
  // Running while the target is offline (Rei): cutex settles the attempt once Rei is back.
  ask("ask-lost", "补 Rei 的迁移日志", REI, "running", { ago: 7300, ran: 7200 }),
  // Abandoned by Lead while running, target archived since (old4, offline): cutex keeps it open with
  // review abandoned until the turn's end is seen (Workstation 2026-10-11, proj-ceo-r1 → proj-glm-research-r1).
  ask("ask-abandoning", "独立复核 ws 重连方案", ["old4", "AUTO_spike-ws"], "running", { ago: 93700, ran: 93600, review: "abandoned", updatedAt: iso(92800) }),
  ask("ask-done", "找出所有 queue flush 调用点", HELPER, "answered", { ago: 2400, attempt: ended(2300, 2100), answerId: "ans-done", answerPreview: "共 3 处调用 flush：server.rs:3830（未校验 revision）、user_input.rs:212（已校验）、queue 面板「立即发送」（未校验）。建议在 dispatch_queue_flush 统一加 expectedRevision。", closed: "completed", closedAt: iso(2090) }),
  ask("ask-accept", "写 r208 发布说明", ALDEN, "answered", { ago: 1800, attempt: ended(1700, 1200), answerId: "ans-accept", answerPreview: "发布说明草稿在 docs/release/r208.md，列了 9 项改动。", review: "awaitingAcceptance" }),
  ask("ask-owner", "审一遍 delegation-views 的契约文档", EVA, "answered", { owner: true, ago: 3000, attempt: ended(2900, 2500), answerId: "ans-owner", answerPreview: "契约没问题，只有 results 批量的 16 KiB 上限需要在文档里写清楚。", review: "awaitingAcceptance" }),
  // Sidebar v2: needs-you in other projects (mockBridge ifm-ema / demo).
  ask("ask-figures", "重画 EMA 的 3 张图", ["ifm-figures", "ifm-ema-figures"], "answered", { owner: true, projectId: "ifm-ema", ago: 2200, attempt: ended(2100, 1300), answerId: "ans-fig", answerPreview: "三张图重画完了，在 figures/ema_v2/。", review: "awaitingAcceptance" }),
  ask("ask-demo", "demo 第二轮的样本量", ["demo-dir", "demo-director-r2"], "running", { owner: true, projectId: "demo", ago: 900, ran: 700, ownerQuestions: 1, openQuestions: 1, ...held({ reason: "waitingForInput" }) }),
  ask("ask-accepted", "核对 r207 的回滚脚本", ALDEN, "answered", { ago: 9000, attempt: ended(8900, 8000), answerId: "ans-a", answerPreview: "回滚脚本可用，已在 dev home 演练。", review: "accepted", closed: "accepted", closedAt: iso(7900) }),
  ask("ask-changes", "整理 i18n 缺的 key", MIKA, "answered", { ago: 8000, attempt: ended(7900, 7600), answerId: "ans-c", answerPreview: "缺 14 个 en key，已补。", review: "changesRequested", closed: "completed", closedAt: iso(7500) }),
  ask("ask-abandoned", "试试把 tray 图标换成 SVG", SORA, "interrupted", { ago: 12000, attempt: ended(11900, 11800, { interruptReason: "stopped" }), closed: "abandoned", closedAt: iso(11700) }),
  ask("ask-failed", "跑一遍 Linux 打包", ALDEN, "failed", { ago: 4000, attempt: ended(3900, 3700, { state: "failed", lastError: "runtime exited: electron-builder: ENOSPC (no space left on device)" }), closed: "completed", closedAt: iso(3690) }),
  ask("ask-rejected", "删除 7 天前的 rollout", REI, "rejected", { ago: 6000, closed: "cancelled", closedAt: iso(5900) }),
  ask("ask-cancelled", "预热 vite 缓存", MIKA, "cancelled", { ago: 7000, closed: "cancelled", closedAt: iso(6900) }),
  ask("ask-stopped", "测一下 SSH 隧道重连", ALDEN, "interrupted", { ago: 1300, attempt: ended(1200, 1000, { state: "interrupted", interruptReason: "stopped" }) }),
  ask("ask-ownerstop", "全量 cargo test", HELPER, "interrupted", { ago: 5000, attempt: ended(4900, 4500, { state: "interrupted", interruptReason: "ownerStopped" }) }),
  ask("ask-restart", "生成协议类型", ALDEN, "interrupted", { ago: 2600, attempt: ended(2500, 2400, { state: "interrupted", interruptReason: "runtimeRestart" }) }),
  ask("ask-unknown", "把 Workstation 的 r206 升到 r207", SORA, "interrupted", { ago: 3300, attempt: ended(3200, 3000, { state: "interrupted", interruptReason: "outcomeUnknown", lastError: "native exited while the turn was running; whether it finished is unknown" }) }),
  ...peerAsks(),
];
// `?projectview` (modules/project-view/mock.ts): the cutex-dev project's delegations (its Director and workers).
if (typeof location !== "undefined" && new URLSearchParams(location.search).has("projectview")) {
  const agent = (id: string, name: string) => ({ requester: { kind: "agent" as const, cutexSessionId: id, cutex_session_id: id, name } });
  const DIR = agent("pv-dir", "cutex-director");
  const pv = { projectId: "cutex-dev" };
  asks.push(
    ask("ask-pv-1", "Shelf 收起后接入 Shelf Rail", ["pv-shm", "shelf-model"], "running", { ...pv, ...DIR, ago: 2280, ran: 2200, attempt: { n: 1, state: "running", turnId: "pv-shm-t1", startedAt: iso(2200), model: null, activity: { toolCalls: 31 }, progress: [{ text: "Rail 收起状态写进布局 v2", at: iso(1200) }, { text: "在改迁移：旧的 toolsCollapsed → shelf.collapsed", at: iso(140) }] } }),
    ask("ask-pv-3", "审查设备令牌吊销", ["pv-sec", "security-review"], "running", { ...pv, ...DIR, ago: 1200, ran: 1150, attempt: { n: 1, state: "running", turnId: "pv-sec-t1", startedAt: iso(1150), model: null, activity: { toolCalls: 9 }, progress: [{ text: "读完 token.rs，开始找 revokeToken 的调用点", at: iso(420) }] } }),
    ask("ask-pv-4", "r251 发布说明", ["pv-rel", "release-bot"], "pendingReview", { ...pv, ...DIR, ago: 720 }),
    ask("ask-pv-2", "主人设备的全局提示", ["pv-set", "settings-ui"], "answered", { ...pv, owner: true, ago: 3600, attempt: ended(3500, 130), answerId: "ans-pv-2", answerPreview: "ownerDeviceAdded 提示做完了，测试通过。", review: "awaitingAcceptance" }),
    ask("ask-pv-5", "8 种语言 remote.token.* 改译", ["pv-tr", "翻译校对"], "running", { ...pv, ...agent("pv-set", "settings-ui"), ago: 1500, ran: 1400, ownerQuestions: 1, openQuestions: 1, holdSince: iso(360), ...held({ reason: "waitingForInput" }) }),
    ask("ask-pv-6", "顶栏拆分截图验收", ["pv-qa", "ui-tester"], "running", { ...pv, ...agent("pv-shl", "shell-layout"), ago: 720, ran: 700 }),
    ask("ask-pv-7", "/summary 加 needsYouCount", ["pv-rh", "remote-hosts"], "running", { ...pv, ...agent("pv-mob", "mobile-work"), ago: 1800, ran: 1700 }),
    ask("ask-pv-8", "整理 desktop-modules.md §24", ["pv-doc", "文档整理"], "answered", { ...pv, ...DIR, ago: 14000, attempt: ended(13900, 10900), answerId: "ans-pv-8", answerPreview: "§24 按 Shelf 改写完了。", closed: "completed", closedAt: iso(10800) }),
    ask("ask-pv-9", "检查更新通道", ["pv-upd", "updater"], "answered", { ...pv, ...DIR, ago: 5400, attempt: ended(5300, 3700), answerId: "ans-pv-9", answerPreview: "beta / stable 两个通道都正常。", review: "accepted", closed: "accepted", closedAt: iso(3600) }),
    // The Director's result waiting for its own acceptance (owner 2026-10-28: 放弃 from the detail must drop it from the card).
    ask("ask-pv-10", "复核 sidebar 的虚拟列表", ["pv-perf", "sidebar-perf"], "answered", { ...pv, ...DIR, ago: 4200, attempt: ended(4100, 2900), answerId: "ans-pv-10", answerPreview: "虚拟列表在 2000 行下保持 60 fps。", review: "awaitingAcceptance" }),
  );
}
if (ROUTING_SCENE) {
  const capability = asks.find(row => row.askId === "ask-review")!;
  capability.target = "kai"; capability.targetName = "Kai";
  capability.reviewRef = { kind: "capability", approvalId: "apr-5e1f0a7c", projectId: "desktop" };
  capability.reviewRefs = [capability.reviewRef];
  asks.push(...routingRows(capability));
}
const byId = new Map(asks.map((a) => [a.askId, a]));

const ANSWERS: Record<string, string> = {
  "ask-done": "## 结果\n\n共 **3** 处调用 flush：\n\n1. `server.rs:3830` — 未校验 revision\n2. `user_input.rs:212` — 已校验\n3. queue 面板「立即发送」— 未校验\n\n建议在 `dispatch_queue_flush` 统一加 `expectedRevision`。",
  "ask-run": "改好了：`dispatch_queue_flush` 现在做 CAS，并发 flush 返回 `revision_conflict`。\n\n- `cargo test --lib management::v2::user_input`：41 passed\n- 新增测试 `flush_rejects_stale_revision`",
};

/** Answers whose turn the owner steered into (「加入此委托」): the 主人插话过 badge. */
const OWNER_STEERED = new Set(["ask-done", "ask-run"]);

const BRIEFS: Record<string, string> = {
  "ask-done": "找出所有调用 queue flush 的地方，列出每处是否校验了 revision。只读，不要改代码。",
  "ask-run": "给 `dispatch_queue_flush` 加 CAS：带上 `expectedRevision`，不一致时拒绝并返回 `revision_conflict`。改完跑 `cargo test --lib management::v2::user_input`。",
  "ask-queue2": "为并发 flush 补一个测试：两个 flush 同时带同一个 revision，只能有一个成功。",
};

// ---------- transcripts ----------

/**
 * `agent_delegate` as the requester's transcript has it: the requester view, the id under
 * `delegation` (cutex prompt revision A8; `delegation_id` before). A delegation to a wider target
 * (pendingReview) answers with the review's approval id and no queue fields (r236 shape).
 */
function delegateCall(id: string, a: AskSummary): Record<string, unknown> {
  // An outgoing mirror is reviewed on the other host: its call says queued there.
  const reviewed = a.execution === "pendingReview" && !a.remote;
  return {
    type: "mcpToolCall",
    id,
    server: "cutex",
    tool: "agent_delegate",
    status: "completed",
    durationMs: 140,
    arguments: { target: a.targetName, title: a.title, text: BRIEFS[a.askId] ?? `${a.title}。完成后简短汇报。` },
    result: {
      content: [],
      structuredContent: reviewed
        ? { approval_id: "apr-5e1f0a7c", delegation: a.askId, detail: `${a.targetName} can do more than you, so the owner reviews each delegation to it before it runs (this one included). Nothing to do now: continue or end your turn.`, ok: true, state: "pendingReview", target: a.targetName }
        : { ok: true, created: true, delegation: a.askId, target: a.targetName, target_id: a.target, title: a.title, state: a.execution === "running" || a.remote ? "queued" : a.execution, hold: null, queue_position: 1, review: null, attempt: null, closed: null },
    },
  };
}

const askEvent = (id: string, a: AskSummary, attempt: number) => ({
  type: "functionCallOutput",
  id,
  name: "external_event",
  namespace: "external",
  output: JSON.stringify({ source: { kind: "agent", id: "lead" }, type: "ASK", text: `[delegation ${a.askId} · attempt ${attempt}] from Lead\n\n${BRIEFS[a.askId] ?? a.title}` }),
  externalInputView: { schema: "cutex.delegation-ask.v1", data: { askId: a.askId, attempt, requester: { kind: "agent", cutexSessionId: "lead", name: "Lead" }, title: a.title, gated: false } },
});

type ResultItem = { kind: "answer" | "question" | "state"; askId: string; status?: string; state?: string; questionId?: string; preview: string };
const resultsEvent = (id: string, items: ResultItem[]) => ({
  type: "functionCallOutput",
  id,
  name: "external_event",
  namespace: "external",
  output: JSON.stringify({
    source: { kind: "service", id: "cutex-asks" },
    type: items.some((i) => i.kind === "answer") ? "ANSWER" : "QUESTION",
    text: `[delegation results]\n\n${items.map((i) => `### ${byId.get(i.askId)?.title ?? i.askId} (${i.kind})\n\n${ANSWERS[i.askId] ?? i.preview}`).join("\n\n")}`,
  }),
  externalInputView: {
    schema: "cutex.delegation-results.v1",
    data: { items: items.map((i) => ({ ...i, title: byId.get(i.askId)?.title ?? "", target: { id: byId.get(i.askId)?.target, name: byId.get(i.askId)?.targetName } })) },
  },
});

/** A plain message from a cutex service (no view schema): renders as the core bus row, sender 委托系统 / Cutex 系统. */
const systemEvent = (id: string, sourceId: string, text: string) => ({
  type: "functionCallOutput",
  id,
  name: "external_event",
  namespace: "external",
  output: JSON.stringify({ source: { kind: "service", id: sourceId }, type: "MESSAGE", text }),
  externalInputView: null,
});

const a = (id: string) => byId.get(id)!;

function leadThread() {
  const t = now();
  return {
    thread: {
      id: "thread-lead",
      turns: [
        {
          id: "lead-t1",
          status: "completed",
          startedAt: t - 2500,
          completedAt: t - 2380,
          items: [
            { type: "userMessage", id: "lu1", content: [{ type: "text", text: "queue flush 的竞态分几个人查一下：先找调用点，构建和发布说明也排上。" }] },
            { type: "agentMessage", id: "la1", text: "好，我先让 Helper 只读找调用点，Alden 准备构建和发布说明。" },
            delegateCall("ld1", a("ask-done")),
            delegateCall("ld2", a("ask-review")),
            ...(ROUTING_SCENE ? [delegateCall("ld-route", a("ask-route-pending")), delegateCall("ld-denied", a("ask-route-denied")), delegateCall("ld-grant", a("ask-route-grant"))] : []),
            delegateCall("ld3", a("ask-accept")),
            { type: "mcpToolCall", id: "lw1", server: "cutex", tool: "delegation_wait", status: "completed", durationMs: 3300, arguments: { delegations: ["ask-done"] }, result: { content: [], structuredContent: { ok: true, reason: "result", results: [{ kind: "answer", delegation: "ask-done", title: a("ask-done").title, answer: a("ask-done").answerPreview, awaiting_acceptance: false }], delegations: [] } } },
            { type: "agentMessage", id: "la2", text: "Helper 找到 3 处调用，两处没校验 revision。接下来让它直接改。" },
          ],
        },
        {
          id: "lead-t2",
          status: "completed",
          startedAt: t - 2000,
          completedAt: t - 1900,
          items: [
            { type: "userMessage", id: "lu2", content: [{ type: "text", text: "再把剩下的杂事分出去，Rei / Sora 那边也排上。" }] },
            delegateCall("ld4", a("ask-paused")),
            delegateCall("ld5", a("ask-plan")),
            delegateCall("ld6", a("ask-offline")),
            delegateCall("ld7", a("ask-blocked")),
            delegateCall("ld8", a("ask-failed")),
            delegateCall("ld9", a("ask-stopped")),
            delegateCall("ld10", a("ask-restart")),
            delegateCall("ld11", a("ask-unknown")),
            delegateCall("ld12", a("ask-accepted")),
            delegateCall("ld13", a("ask-changes")),
            delegateCall("ld14", a("ask-abandoned")),
            delegateCall("ld15", a("ask-rejected")),
            delegateCall("ld16", a("ask-cancelled")),
            delegateCall("ld17", a("ask-ownerstop")),
            { type: "agentMessage", id: "la3", text: "都排上了。Rei 离线，那两个会等它上线。" },
          ],
        },
        {
          id: "lead-t3",
          status: "completed",
          startedAt: t - 900,
          completedAt: t - 840,
          items: [
            resultsEvent("lx1", [
              { kind: "answer", askId: "ask-failed", status: "failed", preview: "runtime exited: electron-builder: ENOSPC" },
              { kind: "question", askId: "ask-question", questionId: "q-1", preview: "队列面板要支持拖拽排序吗？cutex 目前还没有 reorder 接口。" },
              { kind: "state", askId: "ask-stopped", state: "interrupted", preview: "" },
            ]),
            systemEvent("lx1s", "cutex-asks", "委托 ask-review 已经 2 小时没有进展（状态 running）。需要的话追问或关闭它。"),
            systemEvent("lx1a", "Cutex Alarm", "Alarm fired: check the nightly build."),
            { type: "agentMessage", id: "la4", text: "Linux 打包失败是磁盘满了；Mika 的提问我转给你了。" },
          ],
        },
        {
          id: "lead-t4",
          status: "completed",
          startedAt: t - 300,
          completedAt: t - 240,
          items: [
            { type: "userMessage", id: "lu3", content: [{ type: "text", text: "让 Helper 把 CAS 改了，顺便补测试；Mika 改下面板文案。" }] },
            delegateCall("ld18", a("ask-run")),
            delegateCall("ld19", a("ask-queue2")),
            delegateCall("ld20", a("ask-wait")),
            delegateCall("ld21", a("ask-question")),
            delegateCall("ld22", a("ask-px-run")),
            delegateCall("ld23", a("ask-px-held")),
            delegateCall("ld24", a("ask-px-unknown")),
            delegateCall("ld25", a("ask-px-removed")),
            delegateCall("ld26", a("ask-px-late")),
            delegateCall("ld27", a("ask-px-review")),
            { type: "agentMessage", id: "la5", text: "三件都交出去了，结果回来我再汇总。" },
          ],
        },
        ...(stage >= 2
          ? [
              {
                id: "lead-t5",
                status: "completed",
                startedAt: t - 8,
                completedAt: t - 4,
                items: [resultsEvent("lx2", [{ kind: "answer", askId: "ask-run", status: "completed", preview: a("ask-run").answerPreview ?? "" }]), { type: "agentMessage", id: "la6", text: LEAD_T5 }],
              },
            ]
          : []),
      ],
    },
  };
}

function helperThread() {
  const t = now();
  return {
    thread: {
      id: "thread-helper",
      turns: [
        {
          id: "helper-t1",
          status: "completed",
          startedAt: t - 2300,
          completedAt: t - 2100,
          items: [
            askEvent("hx1", a("ask-done"), 1),
            { type: "commandExecution", id: "hc1", command: 'rg -n "flush" src/management', status: "completed", exitCode: 0, durationMs: 400 },
            { type: "commandExecution", id: "hc2", command: "sed -n 3830,3870p src/management/v2/server.rs", status: "completed", exitCode: 0, durationMs: 90 },
            { type: "agentMessage", id: "ha1", text: ANSWERS["ask-done"] },
          ],
        },
        {
          id: "helper-t2",
          status: stage >= 1 ? "completed" : "inProgress",
          startedAt: t - 45,
          completedAt: stage >= 1 ? t - 10 : null,
          items: [
            askEvent("hx2", a("ask-run"), 2),
            { type: "commandExecution", id: "hc3", command: "rg -n dispatch_queue_flush src", status: "completed", exitCode: 0, durationMs: 300 },
            { type: "fileChange", id: "hf1", status: "completed", changes: [{ path: "src/management/v2/server.rs" }] },
            { type: "commandExecution", id: "hc4", command: "cargo test --lib management::v2::user_input", status: stage >= 1 ? "completed" : "inProgress", exitCode: stage >= 1 ? 0 : undefined, aggregatedOutput: "test user_input::flush_respects_revision ... ok" },
            ...(stage >= 1 ? [{ type: "agentMessage", id: "ha2", text: ANSWERS["ask-run"] }] : []),
          ],
        },
        ...(stage >= 3
          ? [{ id: "helper-t3", status: "inProgress", startedAt: t - 5, completedAt: null, items: [askEvent("hx3", a("ask-queue2"), 1), { type: "commandExecution", id: "hc5", command: "cargo test --lib management::v2::user_input::flush", status: "inProgress" }] }]
          : []),
      ],
    },
  };
}

/** How far the replay got (reloaded threads match what was played). */
let stage = 0;

// ---------- API ----------

const clone = <T>(x: T): T => structuredClone(x);
const isOpen = (d: AskSummary) => !d.closed;
const requesterId = (d: AskSummary) => (d.requester.kind === "agent" ? (d.requester.cutexSessionId ?? null) : d.requester.kind === "peer" ? null : "owner");

type Emit = (sessionIds: string[], method: string, params: Record<string, unknown>) => void;
let emitAsk: Emit = () => {};

function parties(d: AskSummary): string[] {
  const r = requesterId(d);
  return r && r !== "owner" ? [r, d.target] : [d.target];
}

/**
 * `?askstale`: what the owner hit on remote 2026-10-28 — the host feed misses the events of an owner close
 * and the host's capped closed list (newest 1000 by creation) does not reach that delegation.
 */
const ASK_STALE = typeof location !== "undefined" && new URLSearchParams(location.search).has("askstale");
const missedCloses = new Set<string>();

function update(askId: string, patch: Partial<AskSummary>, missed = false) {
  const d = byId.get(askId);
  if (!d) return;
  if (missed) {
    missedCloses.add(askId);
    Object.assign(d, patch, { revision: d.revision + 1, updatedAt: new Date().toISOString() });
    return;
  }
  const before = { execution: d.execution, hold: d.hold, review: d.review, closed: d.closed };
  Object.assign(d, patch, { revision: d.revision + 1, updatedAt: new Date().toISOString() });
  if (before.execution !== d.execution || JSON.stringify(before.hold) !== JSON.stringify(d.hold) || before.review !== d.review)
    emitAsk(parties(d), "cutex/ask/stateChanged", { askId, execution: d.execution, hold: d.hold ?? null, review: d.review ?? null, revision: d.revision, ...(d.attempt ? { attempt: { n: d.attempt.n, turnId: d.attempt.turnId ?? null, state: d.attempt.state } } : {}) });
  if (!before.closed && d.closed) emitAsk(parties(d), "cutex/ask/closed", { askId, outcome: d.closed, revision: d.revision });
}

function mockDelegationApi() {
  return {
    async asks(filter: AskFilter): Promise<AskSummary[] | null> {
      const rows = [...byId.values()]
        .filter((d) => (filter.state === "open" ? isOpen(d) : filter.state === "closed" ? !isOpen(d) && !missedCloses.has(d.askId) : !filter.state || d.execution === filter.state))
        .filter((d) => !filter.requester || requesterId(d) === filter.requester)
        .filter((d) => !filter.target || d.target === filter.target)
        .filter((d) => !filter.involving || d.target === filter.involving || requesterId(d) === filter.involving)
        .filter((d) => !filter.project || d.projectId === filter.project)
        .sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));
      await new Promise((r) => setTimeout(r, 120));
      return clone(filter.limit ? rows.slice(0, filter.limit) : rows);
    },
    async ask(askId: string): Promise<AskDetail | null> {
      const d = byId.get(askId);
      if (!d) return null;
      return clone({
        ...d,
        targetCutexSessionId: d.target,
        body: { text: BRIEFS[askId] ?? d.title, textArtifact: askId === "ask-run" ? "art-brief-run" : null },
        attempts: d.attempt ? [{ ...d.attempt, attemptId: `${askId}#${d.attempt.n}` }] : [],
        answer: d.answerId ? { answerId: d.answerId, status: d.execution === "failed" ? "failed" : "completed", bytes: (ANSWERS[askId] ?? d.answerPreview ?? "").length * 3, metadata: OWNER_STEERED.has(askId) ? { ownerSteered: true } : null } : null,
        questions: askId === "ask-question" ? [{ questionId: "q-1", askId, attempt: 1, questions: [{ question: "队列面板要支持拖拽排序吗？cutex 目前还没有 reorder 接口。" }], route: "owner", routedToOwnerAt: iso(500), state: "open" }] : [],
      } as AskDetail);
    },
    async askAnswer(askId: string, cursor?: number): Promise<AskAnswerPage | null> {
      const d = byId.get(askId);
      if (!d?.answerId) return null;
      const text = ANSWERS[askId] ?? d.answerPreview ?? "";
      const start = cursor ?? 0;
      const page = text.slice(start, start + 120);
      const next = start + 120 < text.length ? start + 120 : null;
      return { askId, answerId: d.answerId, revision: 1, status: "completed", cursor: start, nextCursor: next, bytes: text.length, text: page, metadata: null };
    },
    async artifact(artifactId: string) {
      if (artifactId === LATE_ARTIFACT) return { artifact: { artifactId }, encoding: "utf8" as const, content: "## Workstation GPU 一周占用\n\n- 平均 **63%**\n- 峰值：周三 21:00–23:30（proj-r12 训练）\n- 空闲：周日全天\n\n（这是 workstation-lab 在本机已结束委托后才交回的结果。）" };
      if (artifactId !== "art-brief-run") return null;
      return { artifact: { artifactId }, encoding: "utf8" as const, content: `${BRIEFS["ask-run"]}\n\n## 背景\n\n两个 flush 并发时，如果没校验 revision，同一批消息会投递两次。完整的复现步骤见 docs/research/queue-flush.md。` };
    },
    async askCommand(_sessionId: string, method: AskCommandMethod, params: { askId: string; outcome?: "accepted" | "abandoned" }): Promise<MutationResult> {
      const d = byId.get(params.askId);
      if (!d) return { ok: false, error: { code: "ask_not_found", message: "no such delegation" } };
      if (d.closed) return { ok: false, error: { code: "ask_closed", message: "this delegation is already closed" } };
      if (method === "cutex/ask/stop") {
        if (d.execution === "running" || d.execution === "admitted") update(d.askId, { execution: "interrupted", hold: null, attempt: { ...(d.attempt ?? { n: 1 }), state: "interrupted", interruptReason: "ownerStopped", endedAt: new Date().toISOString() } });
        else update(d.askId, { execution: "cancelled", hold: null, closed: "cancelled", closedAt: new Date().toISOString() });
      } else if (method === "cutex/ask/retry") {
        update(d.askId, { execution: "queued", hold: { reason: "targetBusy", position: 1 }, attempts: d.attempts + 1, attempt: null });
      } else {
        update(d.askId, { review: params.outcome === "accepted" ? "accepted" : d.review === "awaitingAcceptance" ? "abandoned" : d.review, closed: params.outcome ?? "abandoned", closedAt: new Date().toISOString() }, ASK_STALE);
      }
      return { ok: true };
    },
  };
}

// The owner decided a delegation's review (modules/approvals/mock.ts decideApproval): cutex queues it
// for its target, or rejects it.
(globalThis as { __cutexMockAskReview?: (askId: string, approved: boolean) => void }).__cutexMockAskReview = (askId, approved) => {
  const d = byId.get(askId);
  if (!d || d.execution !== "pendingReview") return;
  if (approved) update(askId, { execution: "queued", hold: { reason: "targetBusy", position: 1 }, queuePosition: 1 });
  else update(askId, { execution: "rejected", hold: null, closed: "cancelled", closedAt: new Date().toISOString() });
};

// ---------- replay ----------

const LEAD_T5 = "Helper 的 CAS 改好了，测试全过。等它把并发测试补上就可以合并。";

/**
 * Timed replay on the host feed: Helper's running delegation posts progress, answers and closes; the
 * next queued one moves up and starts (a new Helper turn with its ASK row); Lead gets the ANSWER as
 * a new turn. `native(sessionId, method, params)` sends a native notification to both feeds.
 */
function startDelegationReplay(emit: Emit, native: (sessionId: string, method: string, params: unknown) => void): void {
  emitAsk = emit;
  const at = (s: number, run: () => void) => setTimeout(run, s * 1000);
  const run = a("ask-run");
  const progress = (text: string) => emit(parties(run), "cutex/ask/progress", { askId: run.askId, text, at: new Date().toISOString() });
  at(10, () => progress("CAS 改完，正在跑 user_input 测试"));
  at(20, () => progress("41/41 通过，补 flush_rejects_stale_revision"));
  at(30, () => {
    stage = 1;
    const answeredAt = new Date().toISOString();
    native("helper", "item/completed", { turnId: "helper-t2", item: { type: "agentMessage", id: "ha2", text: ANSWERS["ask-run"] } });
    native("helper", "turn/completed", { turn: { id: "helper-t2", status: "completed", completedAt: Date.now() / 1000 } });
    run.answerId = "ans-run";
    run.answerPreview = ANSWERS["ask-run"]!.slice(0, 300);
    update("ask-run", { execution: "answered", attempt: { ...run.attempt!, state: "answered", endedAt: answeredAt } });
    emit(parties(run), "cutex/ask/answered", { askId: run.askId, answerId: "ans-run", revision: 1, status: "completed", bytes: 420, metadata: null, preview: run.answerPreview });
  });
  at(33, () => {
    stage = 2;
    update("ask-run", { closed: "completed", closedAt: new Date().toISOString() });
    // Lead gets the result as a new turn (it did not wait).
    const t = Date.now() / 1000;
    native("lead", "turn/started", { turn: { id: "lead-t5", status: "inProgress", startedAt: t } });
    native("lead", "item/completed", { turnId: "lead-t5", item: resultsEvent("lx2", [{ kind: "answer", askId: "ask-run", status: "completed", preview: run.answerPreview! }]) });
    native("lead", "item/completed", { turnId: "lead-t5", item: { type: "agentMessage", id: "la6", text: LEAD_T5 } });
    native("lead", "turn/completed", { turn: { id: "lead-t5", status: "completed", completedAt: t + 4 } });
  });
  at(36, () => {
    stage = 3;
    // The next one moves up and starts on Helper.
    const next = a("ask-queue2");
    update("ask-queue2", { execution: "admitted", hold: null, queuePosition: null });
    update("ask-queue2", { execution: "running", attempts: 1, attempt: { n: 1, state: "running", turnId: "helper-t3", startedAt: new Date().toISOString(), model: "deepseek-v4-flash", activity: { toolCalls: 0 } } });
    const t = Date.now() / 1000;
    native("helper", "turn/started", { turn: { id: "helper-t3", status: "inProgress", startedAt: t } });
    native("helper", "item/completed", { turnId: "helper-t3", item: askEvent("hx3", next, 1) });
    native("helper", "item/started", { turnId: "helper-t3", item: { type: "commandExecution", id: "hc5", command: "cargo test --lib management::v2::user_input::flush" } });
  });
}

/** admission-order: delegations not started yet wait for their target in creation order (pendingReview ones wait for the owner, not in the list). */
function admissionOf(sessionId: string): MockAdmissionEntry[] {
  return asks
    .filter((d) => d.target === sessionId && !d.closed && !d.remote && (d.execution === "queued" || d.execution === "admitted"))
    .map((d) => ({ kind: "ask" as const, id: d.askId, key: Date.parse(d.createdAt), enqueuedAt: d.createdAt, state: d.hold?.reason === "paused" ? ("paused" as const) : d.hold && d.hold.reason !== "targetBusy" ? ("held" as const) : ("waiting" as const), hold: d.hold?.reason ?? null, ...(INCLUDED_NOTES[d.askId] ? { includedNotes: INCLUDED_NOTES[d.askId] } : {}) }));
}

/** Passive tells the scheduler submits with a delegation (turn groups: small rows under it). */
const INCLUDED_NOTES: Record<string, { label: string }[]> = { "ask-pin-queued": [{ label: "proj-director：回滚脚本在 scripts/rollback-r225.sh" }] };

/** The delegation running on this agent now (its turn takes no inserts). */
function currentTurnOf(sessionId: string) {
  const d = asks.find((x) => x.target === sessionId && !x.closed && !x.remote && x.execution === "running" && x.hold?.reason !== "waitingForInput");
  return d ? { kind: "ask" as const, askId: d.askId } : null;
}

export const mock: ModuleMock = {
  features: { new: ["delegation-tree-stop-v1", "delegation-routing-v1", "project-run-control-v1", "delegation-continuation-v1", "agent-activity-v1", "agent-archive-kind-v1", ...(ROUTING_SCENE ? ["delegation-review-refs"] : [])] },
  api: (core) => {
    const base = { ...mockDelegationApi(), ...(!core.legacy ? createUpgradeMock("local") : {}) };
    return ROUTING_SCENE ? routingMockApi(base, asks, core) : base;
  },
  remote: (hostId) => ({ ...mockDelegationApi(), ...createUpgradeMock(hostId) }),
  admission: (sessionId) => admissionOf(sessionId),
  currentTurn: (sessionId) => currentTurnOf(sessionId),
  thread: (sessionId) => (sessionId === "lead" ? leadThread() : sessionId === "helper" ? helperThread() : null),
  start(core: MockCore) {
    if (ROUTING_SCENE) return;
    if (core.legacy) return;
    // Helper's delegation turns count as busy, so sends while one runs queue / steer like a live agent.
    core.markBusy("helper", "helper-t2");
    startDelegationReplay(
      (sessionIds, method, params) => core.emitCutex(sessionIds, method, params),
      (sessionId, method, params) => {
        const turnId = (params as { turn?: { id?: string } }).turn?.id;
        if (method === "turn/started" && turnId) core.markBusy(sessionId, turnId);
        if (method === "turn/completed") core.markIdle(sessionId);
        core.nativeEvent(sessionId, method, params);
      },
    );
  },
};

import type {
  DelegationRef, PermanentRetirementExecute, PermanentRetirementReview, RedactedAncestor,
  UpgradeAction, UpgradeActor, UpgradeApproval, UpgradeOperationReceipt, UpgradeMember, UpgradeNode, UpgradeParty, UpgradeTreeParty,
  UpgradePreviewApi, UpgradeResult, UpgradePanelSnapshot as UpgradeSnapshot, UpgradeTreeNode,
} from "../../../../shared/delegationUpgradePreview";

// In-memory preview only: no daemon transport, owner impersonation, timers or remote receipts.
const OBSERVED_AT = "2026-10-26T01:00:00.000Z";
const PAGE_SIZE = 4;
const cloneUpgrade = <T>(value: T): T => structuredClone(value);
const fail = (code: string): never => { throw new Error(code); };
const requireAllowed = (allowed: boolean) => { if (!allowed) fail("action_not_allowed"); };
const checkRevision = (expected: number, actual: number) => {
  if (expected !== actual) fail("revision_conflict");
};
const refKey = (ref: DelegationRef) => JSON.stringify([ref.hostId, ref.id]);
const sameRef = (a: DelegationRef | UpgradeTreeParty | null, b: DelegationRef | UpgradeTreeParty) => a !== null && "id" in a && "id" in b && refKey(a) === refKey(b);
const upgradeNodes = (state: UpgradeSnapshot) => state.nodes.filter((n): n is UpgradeNode => n.kind === "delegation");
const opaque = () => crypto.randomUUID();
const ownerActor: UpgradeActor = { kind: "owner", hostId: null, sessionId: null, name: null, redacted: false };

export interface UpgradeMockOptions {
  /** Authenticated mock entry, never request/wire fields. Scope booleans are independent. */
  caller?: Partial<UpgradeSnapshot["caller"]> & {
    role?: "director" | "operator" | "member";
    actor?: UpgradeActor;
    canPauseMembers?: boolean;
    canStop?: boolean;
  };
  /** Explicit simulation controls; never interpreted as a backend receipt. */
  retirement?: {
    stage?: "committed" | "stopped_not_archived" | "uncertain";
    runtimeGeneration?: number;
    nativeThreadId?: string;
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  }
  return JSON.stringify(value) ?? "undefined";
}
function exactFields(value: object, fields: readonly string[]) {
  if (Object.keys(value).some(key => !fields.includes(key))) fail("invalid_request_fields");
}
const nodeActions = (manage: boolean): UpgradeNode["allowedActions"] => ({
  readAttempts: true, stop: manage, stopSelf: manage, stopJobs: false,
  declareContinuation: false, resumeContinuation: false,
});

function seed(hostId: string, projectId: string, caller: UpgradeSnapshot["caller"], route: boolean, pauseMembers: boolean, stop: boolean): UpgradeSnapshot {
  const seededAt = new Date().toISOString();
  const remoteHost = hostId + ":preview-remote";
  const ref = (id: string, host = hostId): DelegationRef => ({ id, hostId: host });
  const party = (id: string, name: string, host = hostId): UpgradeParty => ({ ...ref(id, host), name });
  const director = party("director", "小侦探");
  const worker = party("worker", "Alden");
  const actor: UpgradeActor = { kind: "agent", hostId, sessionId: worker.id, name: worker.name, redacted: false };
  const node = (id: string, title: string, overrides: Partial<UpgradeNode> = {}): UpgradeNode => ({
    kind: "delegation", id, hostId, projectId, ref: ref(id),
    parent: ref("root"), parentState: "visible", redactedParentRef: null,
    root: ref("root"), rootState: "visible", redactedRootRef: null,
    followUp: null, followUpState: "none", parentId: "root", rootId: "root", followUpOf: null,
    parentAttemptId: "root#1", lineageState: "verified", redactedParent: false,
    requester: director, target: worker, title, execution: "queued", closed: null,
    lastActivityAt: seededAt, resumeEvidence: { kind: "none" }, continuation: null, routingApproval: null,
    allowedActions: nodeActions(stop), revision: 1, ...overrides,
  });
  const approval = (id: string, overrides: Partial<UpgradeApproval> = {}): UpgradeApproval => ({
    id, state: "pending", requestDigest: "mock-routing-digest-1", policyRevision: 1, authorityEpoch: 1, revision: 1,
    requestedBy: actor, decidedBy: null, decisionAuthority: null, decisionNote: null,
    createdAt: seededAt, decidedAt: null, allowedActions: { approve: route, deny: route }, ...overrides,
  });
  const member = (id: string, name: string, overrides: Partial<UpgradeMember> = {}): UpgradeMember => ({
    id, hostId, name, director: false, lastActivityAt: OBSERVED_AT, observedAt: OBSERVED_AT,
    activityStatus: "idle", archiveKind: "active", restorable: false, restoreBlockers: ["not_archived"],
    allowedActions: ["start", "send", "archive", "permanentRetire"], ...overrides,
  });
  const parentPlaceholder = opaque(), rootPlaceholder = opaque();
  const placeholder = (placeholderId: string): RedactedAncestor => ({
    kind: "redactedAncestor", placeholderId, labelKey: "delegation.ancestorRestricted",
    reason: "notVisible", expandable: false, allowedActions: {},
  });
  return {
    projectId, revision: "1", nextCursor: null, coverage: "partial",
    unresolvedEdges: [
      { from: ref("legacy"), relation: "parent", reason: "legacyUnknown" },
      { from: ref("legacy"), relation: "root", reason: "legacyUnknown" },
      { from: ref("redacted"), relation: "parent", reason: "redacted" },
      { from: ref("redacted"), relation: "root", reason: "redacted" },
      { from: ref("remote", remoteHost), relation: "parent", reason: "unavailable" },
    ],
    nodes: [
      node("root", "重做委托树面板的外观", { parent: null, parentState: "none", parentId: null, parentAttemptId: null, execution: "running" }),
      node("child", "审计间距、字号和圆角"),
      node("grandchild", "补齐深浅色截图", { parent: ref("child"), parentId: "child", parentAttemptId: "child#1", execution: "running", requester: worker }),
      node("deep", "深色主题下重拍确认对话框", { parent: ref("grandchild"), parentId: "grandchild", parentAttemptId: "grandchild#1", requester: worker }),
      node("failed", "对比旧版 Shelf 的页头", { parent: ref("child"), parentId: "child", parentAttemptId: "child#1", requester: worker,
        execution: "interrupted", closed: "failed", allowedActions: nodeActions(false) }),
      node("remote", "在 remote 上跑完整测试", {
        hostId: remoteHost, ref: ref("remote", remoteHost), parent: ref("child"), parentId: null, rootId: null,
        parentAttemptId: "child#1", target: party("remote-worker", "trainer", remoteHost), execution: "running",
      }),
      node("legacy", "旧版：整理委托卡片文案", {
        parent: null, parentState: "unknown", parentId: null, parentAttemptId: null, root: null, rootState: "unknown", rootId: null,
        lineageState: "legacyUnknown", execution: "answered", closed: "completed", allowedActions: nodeActions(false),
      }),
      node("redacted", "核对受限父任务的交接", {
        parent: null, parentState: "redacted", parentId: null, parentAttemptId: null, root: null, rootState: "redacted", rootId: null,
        redactedParentRef: { placeholderId: parentPlaceholder }, redactedRootRef: { placeholderId: rootPlaceholder },
        requester: null, redactedParent: true,
      }),
      node("limited", "夜间长跑：回放 30 轮滚动", {
        execution: "interrupted", revision: 2, resumeEvidence: { kind: "restartRecovery" },
        continuation: { state: "limited", roundNumber: 32, maxRounds: 32, maxElapsedSeconds: 86400,
          waitingFor: null, nextWakeAt: null, limitReason: "max_rounds", revision: 1 },
        allowedActions: { ...nodeActions(stop), resumeContinuation: caller.isOwner },
      }),
      node("approval", "请 Mika 复核对话框按钮顺序", { routingApproval: approval("approval-1") }),
      node("history", "清点旧的确认对话框", {
        execution: "answered", closed: "completed", followUp: ref("legacy"), followUpState: "visible", followUpOf: "legacy", allowedActions: nodeActions(false),
      }),
      node("director-work", "拆分 r265 委托合同的界面工作", {
        parent: null, parentState: "none", parentId: null, parentAttemptId: null, root: ref("director-work"), rootId: "director-work", target: director, execution: "running",
      }),
      node("redactedActor", "整理审批记录的显示", {
        execution: "answered", closed: "completed", allowedActions: nodeActions(false),
        routingApproval: approval("approval-redacted", { state: "approved", decidedBy: { kind: "agent", hostId: null, sessionId: null, name: null, redacted: true },
          decisionAuthority: "director", decidedAt: seededAt, allowedActions: { approve: false, deny: false } }),
      }),
      node("approved", "修复归档确认的焦点顺序", {
        execution: "answered", closed: "completed", allowedActions: nodeActions(false),
        routingApproval: approval("approval-approved", { state: "approved", decidedBy: ownerActor, decisionAuthority: "owner",
          decidedAt: seededAt, allowedActions: { approve: false, deny: false } }),
      }),
      node("unknown-audit", "统一状态图标", {
        execution: "answered", closed: "completed", allowedActions: nodeActions(false),
        routingApproval: approval("approval-unknown", { state: "approved", allowedActions: { approve: false, deny: false } }),
      }),
      node("same-id", "更新 PROGRESS.md"),
      node("same-id", "同步 remote 上的预览截图", { hostId: remoteHost, ref: ref("same-id", remoteHost), rootId: null, parentId: null,
        target: party("remote-worker", "trainer", remoteHost) }),
      placeholder(parentPlaceholder), placeholder(rootPlaceholder),
    ],
    members: [
      member("director", director.name, { director: true, activityStatus: "busy", allowedActions: ["start", "send"] }),
      member("worker", worker.name, { activityStatus: "busy" }),
      member("idle", "Mika", { lastActivityAt: new Date(Date.parse(OBSERVED_AT) - 3 * 60 * 60 * 1000).toISOString() }),
      member("unknown", "Kai", { activityStatus: "unknown", lastActivityAt: null }),
      member("soft", "Rei", { activityStatus: "offline", archiveKind: "soft", restorable: true,
        restoreBlockers: [], allowedActions: ["restore", "permanentRetire"] }),
      member("blocked", "Sora", { activityStatus: "offline", archiveKind: "soft", restorable: true,
        restoreBlockers: ["runtime_not_offline"], allowedActions: ["permanentRetire"] }),
      member("permanent", "old-reviewer", { activityStatus: "offline", archiveKind: "permanent",
        restoreBlockers: ["permanently_closed"], allowedActions: [] }),
      member("offline", "Helper", { activityStatus: "offline" }),
      member("remote-worker", "trainer", { hostId: remoteHost, activityStatus: "busy" }),
    ],
    parties: [],
    approvals: [],
    policy: { revision: 1, memberMode: "approvalRequired", allowedActions: { update: route } },
    runControl: { epoch: 1, phase: "running", pauseId: null, mode: "afterTurn", scope: "members",
      allowedActions: { pause: pauseMembers, pauseAll: caller.isOwner && caller.canManageMembers, resume: false } },
    grants: { items: [], allowedActions: { create: route } }, interruptedDelegations: [], caller: cloneUpgrade(caller),
  };
}

export function createUpgradeMock(hostId: string, options: UpgradeMockOptions = {}): UpgradePreviewApi {
  const isOwner = options.caller?.isOwner ?? true;
  const director = options.caller?.role === "director";
  const caller: UpgradeSnapshot["caller"] = {
    isOwner, canManageMembers: options.caller?.canManageMembers ?? (isOwner || director),
    canOfflineMembers: options.caller?.canOfflineMembers ?? (isOwner || director),
  };
  const canRoute = isOwner || director;
  const canPause = options.caller?.canPauseMembers ?? (isOwner || director);
  const canStop = options.caller?.canStop ?? (isOwner || director);
  const actor: UpgradeActor = isOwner ? ownerActor : options.caller?.actor ?? {
    kind: "agent", hostId, sessionId: director ? "director" : "mock-member",
    name: director ? "Preview Director" : "Preview Member", redacted: false,
  };
  if (!isOwner && actor.kind === "owner") fail("invalid_mock_caller");
  const projects = new Map<string, UpgradeSnapshot>();
  const queryIds = new Map<string, string>();
  const receipts = new Map<string, { payload: string; result?: UpgradeResult; error?: string }>();
  const occurrences = new Map<string, { revision: number; generation: number; thread: string }>();
  const reviews = new Map<string, {
    review: PermanentRetirementReview; projectId: string; thread: string; request?: string;
  }>();
  // A partial receipt may already have effects. The session stays fenced to its original action,
  // across project views and reviews, until an authoritative final receipt can resolve it.
  const pendingRetirements = new Map<string, string>();
  const retirementTargetKey = (id: string) => refKey({ hostId, id });
  const nowIso = () => new Date().toISOString();
  const stateFor = (projectId: string) => {
    let state = projects.get(projectId);
    if (!state) {
      state = seed(hostId, projectId, caller, canRoute, canPause, canStop);
      projects.set(projectId, state);
      queryIds.set(projectId, opaque());
    }
    return state;
  };
  const projectedSnapshot = (state: UpgradeSnapshot): UpgradeSnapshot => {
    const snapshot = cloneUpgrade(state);
    snapshot.parties = snapshot.members.filter(member => member.archiveKind === "active").map(({ hostId, id, name }) => ({ hostId, id, name }));
    snapshot.approvals = upgradeNodes(snapshot).flatMap(node => node.routingApproval && "allowedActions" in node.routingApproval
      ? [{ ...node.routingApproval, projectId: snapshot.projectId, delegationRef: node.ref }] : []);
    return snapshot;
  };
  const memberFor = (state: UpgradeSnapshot, id: string) =>
    state.members.find(m => m.id === id && m.hostId === hostId) ?? fail("member_not_found");
  const occurrenceFor = (state: UpgradeSnapshot, member: UpgradeMember) => {
    const key = canonical([state.projectId, member.hostId, member.id]);
    let occurrence = occurrences.get(key);
    if (!occurrence) {
      occurrence = { revision: 1, generation: 1, thread: "mock-thread:" + member.id };
      occurrences.set(key, occurrence);
    }
    return { occurrence, generation: options.retirement?.runtimeGeneration ?? occurrence.generation,
      thread: options.retirement?.nativeThreadId ?? occurrence.thread };
  };
  function ownerGate() {
    // Options are the authenticated preview entry, not request fields. Re-read them so a revoked
    // owner cannot retrieve a historical receipt merely because it was cached while authorized.
    if (!(options.caller?.isOwner ?? caller.isOwner)
      || !(options.caller?.canManageMembers ?? caller.canManageMembers)) fail("owner_required");
  }
  function rotatePlaceholders(state: UpgradeSnapshot) {
    const replacements = new Map<string, string>();
    for (const node of state.nodes) {
      if (node.kind !== "redactedAncestor") continue;
      const previous = node.placeholderId;
      node.placeholderId = opaque();
      replacements.set(previous, node.placeholderId);
    }
    for (const node of upgradeNodes(state)) {
      for (const boundary of [node.redactedParentRef, node.redactedRootRef]) {
        if (boundary) boundary.placeholderId = replacements.get(boundary.placeholderId) ?? fail("mock_placeholder_missing");
      }
    }
  }
  function refreshGrants(state: UpgradeSnapshot) {
    for (const grant of state.grants.items) {
      const root = upgradeNodes(state).find(n => sameRef(n.ref, grant.rootDelegationRef));
      if ((!root || root.closed !== null || grant.authorityEpoch !== 1) && grant.expiresAt === null) {
        grant.expiresAt = nowIso();
        grant.revision++;
      }
    }
  }
  function apply(state: UpgradeSnapshot, action: UpgradeAction): UpgradeResult {
    let effectState: UpgradeResult["effectState"] = "committed";
    let retirementStage: string | undefined;
    let message = "Mock preview only; no backend action was sent.";
    const findNode = (id: string, host: string) =>
      upgradeNodes(state).find(n => sameRef(n.ref, { id, hostId: host })) ?? fail("node_not_found");
    const recordInterrupted = (node: UpgradeNode) => {
      if (!state.interruptedDelegations.some(ref => sameRef(ref, node.ref))) state.interruptedDelegations.push({ ...node.ref });
    };
    const stopLocal = (node: UpgradeNode) => {
      node.execution = "interrupted"; node.closed = "stopped";
      node.allowedActions = nodeActions(false);
      if (node.continuation) {
        node.continuation.state = "cancelled"; node.continuation.nextWakeAt = null; node.continuation.waitingFor = null;
        node.continuation.revision++;
      }
      if (node.routingApproval?.state === "pending") {
        node.routingApproval.state = "cancelled";
        (node.routingApproval as UpgradeApproval).allowedActions = { approve: false, deny: false };
        node.routingApproval.revision++;
      }
      node.revision++;
      recordInterrupted(node);
    };
    switch (action.kind) {
      case "stop": {
        exactFields(action, ["kind", "actionId", "nodeId", "nodeHostId", "cascade", "stopJobs", "expectedRevision"]);
        if (action.stopJobs !== false || !["none", "descendants"].includes(action.cascade)) fail("invalid_stop_request");
        const target = findNode(action.nodeId, action.nodeHostId);
        checkRevision(action.expectedRevision, target.revision);
        requireAllowed(canStop && (action.cascade === "none" ? target.allowedActions.stopSelf : target.allowedActions.stop));
        const selected = new Set([refKey(target.ref)]);
        if (action.cascade === "descendants") {
          let grew = true;
          while (grew) {
            grew = false;
            for (const node of upgradeNodes(state)) {
              if (node.parentState !== "visible" || !node.parent || node.lineageState !== "verified") continue;
              if (selected.has(refKey(node.parent)) && !selected.has(refKey(node.ref))) {
                selected.add(refKey(node.ref)); grew = true;
              }
            }
          }
        }
        for (const node of upgradeNodes(state)) {
          if (!selected.has(refKey(node.ref)) || node.closed !== null) continue;
          const allowed = sameRef(node.ref, target.ref) && action.cascade === "descendants"
            ? node.allowedActions.stop : node.allowedActions.stopSelf;
          if (!allowed || node.hostId !== hostId) { effectState = "partial"; continue; }
          stopLocal(node);
        }
        if (action.cascade === "descendants" && state.coverage !== "complete") effectState = "partial";
        if (effectState === "partial") message += " Coverage incomplete or remote stop receipt pending.";
        break;
      }
      case "pause": {
        exactFields(action, ["kind", "actionId", "mode", "scope", "expectedEpoch"]);
        const control = state.runControl;
        if (action.expectedEpoch !== control.epoch) fail("epoch_conflict");
        requireAllowed(action.scope === "all"
          ? caller.isOwner && caller.canManageMembers && control.allowedActions.pauseAll
          : canPause && control.allowedActions.pause);
        requireAllowed(control.pauseId === null);
        let waiting = false;
        for (const node of upgradeNodes(state)) {
          if (node.closed !== null || !["running", "queued"].includes(node.execution)) continue;
          if (action.scope === "members" && state.members.some(m => m.director && sameRef(m, node.target))) continue;
          if (node.hostId !== hostId) { effectState = "partial"; continue; }
          if (action.mode === "interrupt" && node.execution === "running") {
            node.execution = "interrupted"; node.revision++; recordInterrupted(node);
          } else if (node.execution === "running") waiting = true;
        }
        control.epoch++; control.pauseId = "mock-pause-" + control.epoch;
        control.mode = action.mode; control.scope = action.scope;
        control.phase = effectState === "partial" ? "partial" : waiting ? "pausing" : "paused";
        control.allowedActions = { pause: false, pauseAll: false,
          resume: action.scope === "all" ? caller.isOwner && caller.canManageMembers : canPause };
        if (effectState === "partial") message += " Remote pause receipt pending.";
        break;
      }
      case "resume": {
        exactFields(action, ["kind", "actionId", "pauseId", "expectedEpoch"]);
        const control = state.runControl;
        if (action.expectedEpoch !== control.epoch) fail("epoch_conflict");
        if (action.pauseId !== control.pauseId) fail("pause_id_conflict");
        requireAllowed(control.allowedActions.resume && (control.scope === "all" ? caller.isOwner && caller.canManageMembers : canPause));
        // Admission only: never requeue interrupted work, start offline members or clear personal pauses.
        if (control.phase === "partial") { effectState = "partial"; message += " Remote resume receipt pending."; }
        control.epoch++; control.phase = effectState === "partial" ? "partial" : "running"; control.pauseId = null;
        control.allowedActions = { pause: canPause, pauseAll: caller.isOwner && caller.canManageMembers, resume: false };
        break;
      }
      case "decision": {
        exactFields(action, ["kind", "actionId", "approvalId", "decision", "expectedDigest", "expectedRevision", "decisionNote"]);
        requireAllowed(canRoute);
        const node = upgradeNodes(state).find(n => n.routingApproval?.id === action.approvalId) ?? fail("approval_not_found");
        const approval = node.routingApproval as UpgradeApproval;
        if (approval.state === "approved" || approval.state === "denied") fail("approval_already_decided");
        checkRevision(action.expectedRevision, approval.revision);
        if (action.expectedDigest !== approval.requestDigest) fail("digest_conflict");
        requireAllowed(approval.allowedActions[action.decision] && approval.state === "pending" && node.closed === null);
        requireAllowed(approval.authorityEpoch === 1 && approval.policyRevision === state.policy.revision);
        const note = action.decisionNote ?? null;
        if (note !== null && (typeof note !== "string" || /[\r\n\u2028\u2029]/u.test(note) || Array.from(note).length > 200)) fail("invalid_decision_note");
        approval.state = action.decision === "approve" ? "approved" : "denied";
        approval.decidedBy = cloneUpgrade(actor); approval.decisionAuthority = caller.isOwner ? "owner" : "director";
        approval.decidedAt = nowIso(); approval.decisionNote = note;
        approval.allowedActions = { approve: false, deny: false }; approval.revision++; node.revision++;
        if (action.decision === "deny") { node.closed = "routing_denied"; node.execution = "interrupted"; node.allowedActions = nodeActions(false); }
        break;
      }
      case "policy": {
        exactFields(action, ["kind", "actionId", "memberMode", "expectedRevision"]);
        checkRevision(action.expectedRevision, state.policy.revision);
        requireAllowed(canRoute && state.policy.allowedActions.update);
        state.policy.memberMode = action.memberMode; state.policy.revision++;
        for (const node of upgradeNodes(state)) {
          if (node.routingApproval?.state !== "pending") continue;
          node.routingApproval.state = "stale"; node.routingApproval.revision++;
          (node.routingApproval as UpgradeApproval).allowedActions = { approve: false, deny: false }; node.revision++;
        }
        break;
      }
      case "grant": {
        exactFields(action, ["kind", "actionId", "requesterRef", "targetRefs", "rootDelegationRef", "maxUses"]);
        requireAllowed(canRoute && state.grants.allowedActions.create);
        if (action.maxUses !== 1) fail("invalid_grant_uses");
        const requester = state.members.find(m => sameRef(m, action.requesterRef)) ?? fail("member_not_found");
        const targets = action.targetRefs.map(ref => state.members.find(m => sameRef(m, ref)) ?? fail("member_not_found"));
        requireAllowed(targets.length > 0 && new Set(targets.map(refKey)).size === targets.length
          && targets.every(target => !sameRef(target, requester) && target.archiveKind === "active") && requester.archiveKind === "active");
        const root = findNode(action.rootDelegationRef.id, action.rootDelegationRef.hostId);
        requireAllowed(root.closed === null && root.parentState === "none" && root.rootState === "visible"
          && sameRef(root.root, root.ref) && root.lineageState === "verified");
        if (root.hostId !== hostId) { effectState = "partial"; message += " Remote grant not acknowledged."; break; }
        state.grants.items.push({
          id: "mock-grant-" + (state.revision + 1), projectId: state.projectId,
          rootDelegationRef: { ...root.ref }, requesterRef: { ...action.requesterRef },
          targetRefs: action.targetRefs.map(ref => ({ ...ref })), purpose: "review", maxUses: 1, usedCount: 0,
          expiresAt: null, authorityEpoch: 1, revision: 1, revokedAt: null, allowedActions: { revoke: canRoute },
        });
        break;
      }
      case "revoke": {
        exactFields(action, ["kind", "actionId", "grantId", "expectedRevision"]);
        const grant = state.grants.items.find(g => g.id === action.grantId) ?? fail("grant_not_found");
        checkRevision(action.expectedRevision, grant.revision);
        requireAllowed(canRoute && grant.allowedActions.revoke);
        grant.revokedAt = nowIso(); grant.allowedActions.revoke = false; grant.revision++;
        break;
      }
      case "offline": case "archive": case "restore": {
        exactFields(action, ["kind", "actionId", "memberId"]);
        requireAllowed(action.kind === "offline" ? caller.canOfflineMembers : caller.canManageMembers);
        const member = memberFor(state, action.memberId);
        if (action.kind === "offline") {
          requireAllowed(!member.director && member.activityStatus === "idle" && member.archiveKind === "active");
          const idleMs = Date.parse(member.observedAt ?? "") - (member.lastActivityAt === null ? NaN : Date.parse(member.lastActivityAt ?? ""));
          requireAllowed(Number.isFinite(idleMs) && idleMs >= 7200 * 1000);
          member.activityStatus = "offline";
        } else if (action.kind === "restore") {
          if (member.archiveKind === "permanent") fail("permanent_retirement");
          if ((member.restoreBlockers?.length ?? 0)) fail("restore_blocked");
          requireAllowed(member.archiveKind === "soft" && member.restorable === true && member.allowedActions?.includes("restore") === true);
          member.archiveKind = "active"; member.restorable = false; member.activityStatus = "offline";
          member.restoreBlockers = ["not_archived"]; member.allowedActions = ["start", "send", "archive", "permanentRetire"];
        } else {
          requireAllowed(!member.director && member.archiveKind === "active" && member.allowedActions?.includes("archive") === true
            && (member.activityStatus === "idle" || member.activityStatus === "offline"));
          member.archiveKind = "soft"; member.restorable = true; member.activityStatus = "offline";
          member.restoreBlockers = []; member.allowedActions = ["restore", "permanentRetire"];
          for (const node of upgradeNodes(state)) if (sameRef(node.target, member) && node.closed === null) stopLocal(node);
        }
        occurrenceFor(state, member).occurrence.revision++;
        break;
      }
      case "retire": {
        exactFields(action, ["kind", "actionId", "payload"]);
        ownerGate();
        exactFields(action.payload, ["cutex_session_id", "confirmed_name", "confirmation_token", "expected_revision"]);
        const request: PermanentRetirementExecute = { ...action.payload, action_id: action.actionId };
        const targetKey = retirementTargetKey(request.cutex_session_id);
        if (pendingRetirements.has(targetKey)) fail("permanent_retirement_pending");
        const token = reviews.get(request.confirmation_token) ?? fail("archive_confirmation_invalid");
        if (token.projectId !== state.projectId || token.review.cutex_session_id !== request.cutex_session_id) fail("archive_confirmation_invalid");
        const requestIdentity = canonical(request);
        if (token.request && token.request !== requestIdentity) fail("archive_confirmation_already_used");
        if (Math.floor(Date.now() / 1000) >= token.review.expires_at_unix) fail("archive_confirmation_expired");
        const member = memberFor(state, request.cutex_session_id);
        const occurrence = occurrenceFor(state, member);
        if (!Number.isSafeInteger(request.expected_revision) || request.expected_revision < 0
          || request.expected_revision !== token.review.revision || request.expected_revision !== occurrence.occurrence.revision) fail("archive_confirmation_target_revision_mismatch");
        if (occurrence.generation !== token.review.runtime_generation || occurrence.thread !== token.thread) fail("archive_confirmation_occurrence_changed");
        if (member.name !== token.review.formal_name) fail("archive_confirmation_stale");
        if (request.confirmed_name !== member.name) fail("permanent_retirement_name_confirmation_required");
        requireAllowed(!member.director && member.allowedActions?.includes("permanentRetire") === true
          && (member.archiveKind === "active" || member.archiveKind === "soft"));
        token.request = requestIdentity;
        retirementStage = options.retirement?.stage ?? "committed";
        if (retirementStage !== "committed") pendingRetirements.set(targetKey, action.actionId);
        if (retirementStage === "uncertain") {
          effectState = "unknown"; message += " Retirement outcome uncertain; query this action instead of issuing a new one.";
        } else {
          member.activityStatus = "offline";
          for (const node of upgradeNodes(state)) if (sameRef(node.target, member) && node.closed === null) stopLocal(node);
          if (retirementStage === "stopped_not_archived") {
            effectState = "partial"; message += " Stopped, but permanent archival did not commit.";
          } else {
            member.archiveKind = "permanent"; member.restorable = false;
            member.restoreBlockers = ["permanently_closed"]; member.allowedActions = [];
            occurrence.occurrence.revision++;
          }
        }
        break;
      }
      case "resumeContinuation": {
        exactFields(action, ["kind", "actionId", "nodeId", "nodeHostId", "expectedRevision"]);
        requireAllowed(caller.isOwner);
        const node = findNode(action.nodeId, action.nodeHostId);
        const continuation = node.continuation ?? fail("action_not_allowed");
        checkRevision(action.expectedRevision, continuation.revision);
        const member = state.members.find(m => sameRef(m, node.target)) ?? fail("member_not_found");
        requireAllowed(node.allowedActions.resumeContinuation && node.closed === null && continuation.state === "limited"
          && member.archiveKind === "active" && member.activityStatus !== "offline" && state.runControl.phase === "running");
        if (node.hostId !== hostId) { effectState = "partial"; message += " Remote continuation receipt pending."; break; }
        continuation.state = "resuming"; continuation.roundNumber = 1;
        continuation.waitingFor = null; continuation.nextWakeAt = null; continuation.limitReason = null; continuation.revision++;
        node.execution = "queued"; node.resumeEvidence = { kind: "newAttempt" };
        node.allowedActions.resumeContinuation = false; node.revision++;
        break;
      }
      default: {
        const exhaustive: never = action;
        return fail("unsupported_action:" + String(exhaustive));
      }
    }
    refreshGrants(state);
    state.revision = String(Number(state.revision) + 1);
    rotatePlaceholders(state);
    return { snapshot: projectedSnapshot(state), effectState, message, ...(retirementStage ? { retirementStage } : {}) };
  }

  return {
    async delegationUpgradeSnapshot(projectId, cursor) {
      const state = stateFor(projectId);
      const visible = upgradeNodes(state);
      let offset = 0;
      const prefix = "mock:" + queryIds.get(projectId)! + ":" + state.revision + ":";
      if (cursor !== undefined) {
        if (!cursor.startsWith(prefix)) fail("invalid_or_stale_cursor");
        const suffix = cursor.slice(prefix.length);
        if (!/^[1-9]\d*$/.test(suffix)) fail("invalid_or_stale_cursor");
        offset = Number(suffix);
        if (!Number.isSafeInteger(offset) || offset % PAGE_SIZE !== 0 || offset >= visible.length) fail("invalid_or_stale_cursor");
      }
      const snapshot = projectedSnapshot(state);
      const page = visible.slice(offset, offset + PAGE_SIZE);
      const placeholders = new Set(page.flatMap(node => [node.redactedParentRef, node.redactedRootRef]
        .flatMap(boundary => boundary ? [boundary.placeholderId] : [])));
      snapshot.nodes = cloneUpgrade([...page, ...state.nodes.filter(n => n.kind === "redactedAncestor" && placeholders.has(n.placeholderId))]);
      snapshot.unresolvedEdges = snapshot.unresolvedEdges.filter(edge => page.some(n => sameRef(n.ref, edge.from)));
      snapshot.nextCursor = offset + PAGE_SIZE < visible.length ? prefix + (offset + PAGE_SIZE) : null;
      return snapshot;
    },
    async delegationUpgradeApproval(approvalId) {
      const state = [...projects.values()].find(state => upgradeNodes(state).some(node => node.routingApproval?.id === approvalId));
      if (!state) return fail("approval_not_found");
      const projectId = state.projectId;
      const node = upgradeNodes(state).find(node => node.routingApproval?.id === approvalId);
      if (!node || !node.routingApproval || !("allowedActions" in node.routingApproval)) return fail("approval_not_found");
      return cloneUpgrade({ ...node.routingApproval, projectId, delegationRef: node.ref });
    },
    async delegationUpgradeOperation(actionId) {
      const cached = receipts.get(actionId);
      const result = cached?.result;
      if (!result || !result.receipt) return { schema: "cutex.delegation-operation.v1", actionId, status: "notFound", outcomeUnknown: true, result: null };
      return { schema: "cutex.delegation-operation.v1", actionId, status: "found", outcomeUnknown: result.receipt.outcomeUnknown, result: { receipt: cloneUpgrade(result.receipt) } };
    },
    async delegationRetirementReview(projectId, request) {
      ownerGate();
      exactFields(request, ["cutex_session_id"]);
      if (pendingRetirements.has(retirementTargetKey(request.cutex_session_id))) fail("permanent_retirement_pending");
      const state = stateFor(projectId);
      const member = memberFor(state, request.cutex_session_id);
      requireAllowed(!member.director && member.allowedActions?.includes("permanentRetire") === true
        && (member.archiveKind === "active" || member.archiveKind === "soft"));
      const current = occurrenceFor(state, member);
      if (!Number.isSafeInteger(current.generation) || current.generation < 0) fail("archive_confirmation_occurrence_changed");
      const review: PermanentRetirementReview = {
        confirmation_token: opaque(), cutex_session_id: member.id, formal_name: member.name,
        revision: current.occurrence.revision, runtime_generation: current.generation,
        expires_at_unix: Math.floor(Date.now() / 1000) + 300,
      };
      reviews.set(review.confirmation_token, { review: cloneUpgrade(review), projectId, thread: current.thread });
      return review;
    },
    async delegationUpgradeAction(projectId, action) {
      if (action.kind === "retire") ownerGate();
      if (!action.actionId?.trim()) fail("action_id_required");
      const payload = canonical({ projectId, action });
      const cached = receipts.get(action.actionId);
      if (cached) {
        if (cached.payload !== payload) fail("action_id_payload_conflict");
        if (cached.error) fail(cached.error);
        // This remains execute POST, not a receipt GET. Unfinished retries revalidate the original
        // confirmation and occurrence before replay; they never execute the retirement again.
        if (action.kind === "retire" && cached.result?.retirementStage !== "committed") {
          const request: PermanentRetirementExecute = { ...action.payload, action_id: action.actionId };
          const token = reviews.get(request.confirmation_token) ?? fail("archive_confirmation_invalid");
          if (token.projectId !== projectId || token.review.cutex_session_id !== request.cutex_session_id) fail("archive_confirmation_invalid");
          if (token.request !== canonical(request)) fail("archive_confirmation_already_used");
          if (Math.floor(Date.now() / 1000) >= token.review.expires_at_unix) fail("archive_confirmation_expired");
          const state = stateFor(projectId);
          const member = memberFor(state, request.cutex_session_id);
          const current = occurrenceFor(state, member);
          if (!Number.isSafeInteger(request.expected_revision) || request.expected_revision < 0
            || request.expected_revision !== token.review.revision || current.occurrence.revision !== token.review.revision) fail("archive_confirmation_target_revision_mismatch");
          if (current.generation !== token.review.runtime_generation || current.thread !== token.thread) fail("archive_confirmation_occurrence_changed");
          if (member.name !== token.review.formal_name) fail("archive_confirmation_stale");
          if (request.confirmed_name !== member.name) fail("permanent_retirement_name_confirmation_required");
        }
        return cloneUpgrade(cached.result!);
      }
      try {
        const result = apply(stateFor(projectId), action);
        if (action.kind === "retire") result.retirementReceipt = {
          request: { reason: "owner_permanent_retirement", action_id: action.actionId, review: {
            cutex_session_id: action.payload.cutex_session_id, formal_name: action.payload.confirmed_name, operation: "permanentRetire",
            current_project_id: projectId, revision: action.payload.expected_revision, runtime_generation: 1,
          } }, request_sha256: "b".repeat(64), stage: result.retirementStage, result: null, error: null, committed_at: null,
        };
        const operations: Partial<Record<UpgradeAction["kind"], string>> = { stop: "delegation.stop", pause: "project.pause", resume: "project.resume", policy: "policy.update", decision: "approval.decide", grant: "grant.create", revoke: "grant.revoke", resumeContinuation: "continuation.resume" };
        if (operations[action.kind]) result.receipt = {
          schema: "cutex.delegation-operation.v1", actionId: action.actionId, operationId: "mock-operation:" + action.actionId,
          operation: operations[action.kind]!, requestDigest: "a".repeat(64),
          status: result.effectState === "partial" || result.effectState === "unknown" ? "pending" : "completed",
          effectState: result.effectState, outcomeUnknown: result.effectState === "unknown", revision: 1, updatedAt: new Date().toISOString(),
        } satisfies UpgradeOperationReceipt;
        receipts.set(action.actionId, { payload, result: cloneUpgrade(result) });
        return result;
      } catch (error) {
        const code = error instanceof Error ? error.message : "mock_action_failed";
        receipts.set(action.actionId, { payload, error: code });
        throw error;
      }
    },
  };
}
