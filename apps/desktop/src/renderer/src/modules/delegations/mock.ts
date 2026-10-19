// Browser-preview data for delegations (委托): two agents, Lead (requester) and Helper (handler),
// with agent_delegate calls, ASK / ANSWER events with their views, the cutex asks API and a timed
// replay (progress → answered → closed, the next queued delegation starting). Between them the
// delegations cover every status row of the card table (DESIGN §4.21). Collected by dev/mockModules.ts (dev/mockTypes.ts).
import type { AskAnswerPage, AskCommandMethod, AskDetail, AskFilter, AskHold, AskSummary, MutationResult } from "../../../../shared/ipc";
import type { MockAdmissionEntry, MockCore, ModuleMock } from "../../dev/mockTypes";

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

function update(askId: string, patch: Partial<AskSummary>) {
  const d = byId.get(askId);
  if (!d) return;
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
        .filter((d) => (filter.state === "open" ? isOpen(d) : filter.state === "closed" ? !isOpen(d) : !filter.state || d.execution === filter.state))
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
        update(d.askId, { review: params.outcome === "accepted" ? "accepted" : d.review === "awaitingAcceptance" ? "abandoned" : d.review, closed: params.outcome ?? "abandoned", closedAt: new Date().toISOString() });
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
  api: () => mockDelegationApi(),
  admission: (sessionId) => admissionOf(sessionId),
  currentTurn: (sessionId) => currentTurnOf(sessionId),
  thread: (sessionId) => (sessionId === "lead" ? leadThread() : sessionId === "helper" ? helperThread() : null),
  start(core: MockCore) {
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
