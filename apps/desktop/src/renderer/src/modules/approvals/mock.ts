// Browser-preview data for owner approvals (approvals page, live request after 15 s; dev/mockTypes.ts).
import type { MockCore, ModuleMock } from "../../dev/mockTypes";

const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
type MockApproval = import("../../../../shared/ipc").ApprovalRecord;
// browser_claim (an agent asks for one of the owner's tabs): the card in Eva's conversation + 审批.
const claimDigest = "7c".repeat(32);
const browserClaim = (approvalId: string, session: string, name: string, reason: string, urlHint: string, secondsAgo: number): MockApproval => ({
  approvalId, kind: "browser_claim", reason: "browser_owner_tab_selection", requesterCutexSessionId: session, requesterName: name, projectId: null,
  summary: "Select an owner browser tab (shares its login state)", requestSha256: claimDigest, state: "pending", createdAt: iso(secondsAgo),
  details: { version: 1, cutexSessionId: session, agentName: name, requestId: `req-${approvalId}`, deviceId: "desktop-local", hostId: "local",
    connectionGeneration: "gen-1", threadId: `thr-${session}`, runtimeGeneration: 1, intentDigest: claimDigest, reason, urlHint, sharesOwnerLogin: true },
});
// ifm-ema-figures asked to keep its preview service (service_register lifetime persistent): the tool
// call in its conversation answered approval_required; the card sits in its dock (BrowserClaimOverlay).
const FIG_AGENT = "ifm-figures";
const figApprovalId = "apr-5e7a0c3f9b2d4e61a8c07f1d2b3e4a59";
const figSummary = "Keep service ifm-figs-preview persistently; run its command unrestricted as the owner";
const HOLD_ID = "apr-7f3a91c2";
const HOLD_MS = 95_000;
const mockApprovals: MockApproval[] = [
  {
    approvalId: figApprovalId, kind: "service_lifetime", reason: "persistent_service", requesterCutexSessionId: FIG_AGENT, requesterName: "ifm-ema-figures", projectId: "ifm-ema",
    summary: figSummary,
    details: { op: "register", slug: "ifm-figs-preview", lifetime: "persistent", managedExecution: true, command: "python -m http.server {port}", cwd: "D:\\Research\\ifm-ema\\figures", envKeys: [], grants: "persistent lifetime and unrestricted execution of this exact command/cwd/env" },
    requestSha256: "a51f…", state: "pending", createdAt: iso(70),
  },
  // workflows: Mika's run plan (modules/workflows/mock.ts run #8 waits for it).
  {
    approvalId: "apr-wf000008", kind: "workflow_run", reason: "workflow_run", requesterCutexSessionId: "mika", requesterName: "Mika", projectId: "desktop",
    summary: "Run workflow audit-i18n-catalogs: Check every locale catalog for missing or stale keys and propose fixes",
    details: { runId: "wr-5f10c9d2-bb02", seq: 8, name: "audit-i18n-catalogs", description: "Check every locale catalog for missing or stale keys and propose fixes",
      phases: [{ title: "Scan", detail: "one reader per locale" }, { title: "Fix", detail: "one patch per locale with gaps" }], stepProfiles: ["gamma", "Iota"], claudeProfiles: ["Iota"], models: [],
      defaultProfile: "gamma", maxAgents: 24, maxConcurrency: 4, maxTokens: 1_500_000, hardStop: false, cwd: "/home/sam/Projects/cutex-desktop", scriptSha256: "4e2a".repeat(16),
      args: { locales: 11 }, draftPath: "/home/sam/Projects/cutex-desktop/.cutex/workflow-drafts/audit-i18n-catalogs-1.js", resumedFrom: null },
    requestSha256: "e81c…", state: "pending", createdAt: iso(50),
  },
  browserClaim("apr-c1a1m001", "eva", "Eva", "核对收件箱里 CI 的失败通知，汇总到 PROGRESS.md", "https://mail.example.com/inbox", 20),
  browserClaim("apr-c1a1m002", "mika", "Mika", "看一下夜猫望月页面的排版", "cutex:service/yemao/", 45),
  // peers-v2: a delegation from an agent on the paired host "workstation-lab" (review = always).
  {
    approvalId: "apr-9e41c7d0", kind: "ask_delivery", reason: "target_capabilities_not_subset", requesterCutexSessionId: "peer:ci-7a3f01c2b4d5e6f708192a3b4c5d6e7f:cutex.9b2e4f", requesterName: "proj-research@workstation-lab", projectId: "desktop",
    summary: "委托 proj-research@workstation-lab → Helper: 复现 host-a 上的 ws 断线",
    details: { askId: "ask-pin-review", target: "helper", targetName: "Helper", title: "复现 host-a 上的 ws 断线", brief: "在 host-a 上跑一遍 ws 重连测试，记录断线时的日志。", differences: [{ field: "sandbox", requester: "read-only", target: "workspace-write" }], claimedCaps: { sandbox: "workspace-write", networkAccess: true, unrestrictedServices: false }, claimedCapsLabel: "对端声称（仅展示，不作为审批依据）" },
    requestSha256: "5d1e…", state: "pending", createdAt: iso(90),
  },
  // A local delegation to a wider target (modules/delegations/mock.ts ask-review, Lead → Alden): its
  // card in Lead's conversation, the row in Alden's queue and the side detail decide it too.
  {
    approvalId: "apr-5e1f0a7c", kind: "ask_delivery", reason: "target_capabilities_not_subset", requesterCutexSessionId: "lead", requesterName: "Lead", projectId: "desktop",
    summary: "委托 Lead → Alden: 构建 r208 release",
    details: { askId: "ask-review", target: "alden", targetName: "Alden", title: "构建 r208 release", brief: "构建 r208 release。完成后简短汇报。", differences: [{ field: "sandbox", requester: "workspace-write", target: "danger-full-access" }], grants: "delivery of this one ask, once, under the target's existing permissions; each action in its turn still follows the target's approval policy" },
    requestSha256: "77c1…", state: "pending", createdAt: iso(1500),
  },
  {
    approvalId: "apr-3b8d2e71", kind: "static_root", reason: "static_root_outside_workspace", requesterCutexSessionId: "scratch", requesterName: "scratch", projectId: null,
    summary: "register static service tokyo-notes: serve C:\\Users\\sam\\Documents\\tokyo (outside the agent's cwd / project workspace)",
    details: { op: "register", slug: "tokyo-notes", staticRoot: "C:\\Users\\sam\\Documents\\tokyo", allowedRoots: ["C:\\Users\\sam\\scratch"], grants: "serving every file under this exact root to the owner's browser" },
    requestSha256: "3b8d…", state: "pending", createdAt: iso(400),
  },
  // cutex approval-wait: Mika's service_register is holding for the owner right now (countdown card in
  // its dock; at 0 the call answers approval_required and the card leaves the conversation).
  {
    approvalId: HOLD_ID, kind: "managed_service", reason: "outside_caller_envelope", requesterCutexSessionId: "mika", requesterName: "Mika", projectId: "desktop",
    summary: "register managed service kks-preview: pnpm --filter kks dev --port {port}",
    details: { op: "register", slug: "kks-preview", runtime: "managed", command: "pnpm --filter kks dev --port {port}", cwd: "D:\\Apps\\kks", port: null, envKeys: ["KKS_TOKEN", "NODE_ENV"] },
    requestSha256: "9b1e…", state: "pending", createdAt: iso(25),
    wait: { id: "w-mock", startedAt: iso(25), until: new Date(Date.now() + HOLD_MS).toISOString(), threadId: "thread-mika", turnId: null },
  },
  {
    approvalId: "apr-2c84d0aa", kind: "agent_profile", reason: "profile_requires_approval", requesterCutexSessionId: "wave", requesterName: "Wave-Director", projectId: "waveline",
    summary: "create agent waveline-reviewer with profile gamma (workspace-write / on-request)",
    details: { operation: "create", name: "waveline-reviewer", profile: "gamma", model: "gpt-5.5", cwd: "D:\\Apps\\waveline", sandboxMode: "workspace-write", approvalPolicy: "on-request" },
    requestSha256: "41aa…", state: "pending", createdAt: iso(1500),
  },
  {
    approvalId: "apr-0d19e6b7", kind: "managed_service", reason: "outside_caller_envelope", requesterCutexSessionId: "alden", requesterName: "Alden", projectId: "desktop",
    summary: "update managed service host-a-image2-results: python serve.py --debug",
    details: { op: "update", slug: "host-a-image2-results", command: "python serve.py --debug" },
    requestSha256: "c03d…", state: "consumed", createdAt: iso(7200), decidedAt: iso(7000), consumedAt: iso(6950), note: "只这一次",
  },
  {
    approvalId: "apr-55e0b1f3", kind: "managed_service", reason: "outside_caller_envelope", requesterCutexSessionId: "scratch", requesterName: "scratch", projectId: null,
    summary: "register managed service tunnel: cloudflared tunnel run",
    details: { op: "register", slug: "tunnel", runtime: "managed", command: "cloudflared tunnel run" },
    requestSha256: "77f2…", state: "denied", createdAt: iso(86000), decidedAt: iso(85000),
  },
];
/** cutex/approvals/changed on the host event stream (session "cutex.host"). */
function emitApprovalChange(core: MockCore, reason: string, approval: MockApproval) {
  core.emitHost("cutex/approvals/changed", { reason, approval: structuredClone(approval) });
}
/** A new request arrives a little after start, so the live badge / notification can be seen. */
function startApprovalRequests(core: MockCore) {
  if (core.legacy) return;
  // The hold runs out: cutex ends it (wait.end = timeout) and publishes wait_ended.
  setTimeout(() => {
    const held = mockApprovals.find((a) => a.approvalId === HOLD_ID);
    if (!held?.wait || held.wait.end || held.state !== "pending") return;
    held.wait = { ...held.wait, end: "timeout", endedAt: new Date().toISOString() };
    emitApprovalChange(core, "wait_ended", held);
  }, HOLD_MS);
  setTimeout(() => {
    const a: MockApproval = {
      approvalId: "apr-b6d2f019", kind: "managed_service", reason: "outside_caller_envelope", requesterCutexSessionId: "alden", requesterName: "Alden", projectId: "desktop",
      summary: "register managed service cutex-docs: mdbook serve --port {port}",
      details: { op: "register", slug: "cutex-docs", runtime: "managed", command: ["mdbook", "serve", "--port", "{port}"], cwd: "D:\\Apps\\cutex-desktop\\upstream\\cutex\\docs" },
      requestSha256: "e1c9…", state: "pending", createdAt: new Date().toISOString(),
    };
    mockApprovals.unshift(a);
    emitApprovalChange(core, "requested", a);
  }, 15_000);
}

const sec = (secondsAgo: number) => Math.floor(Date.now() / 1000) - secondsAgo;
const figRefusal = {
  ok: false, status: "approval_required", code: "approval_required", approval_id: figApprovalId,
  detail: `Nothing was done yet: this needs the owner's approval (${figSummary}). The owner sees the request in the cutex desktop. When the owner decides you get a message from cutex; after an approval retry the same call (until then it answers approval_required). Do not poll in a loop: end your turn or continue with other work.`,
};
// An earlier request the owner declined (approval_denied): the row reads 未执行（已拒绝）, not 失败.
const figDenied = {
  ok: false, status: "approval_denied", code: "approval_denied", approval_id: "apr-1d0c9b8a7f6e5d4c",
  detail: "The owner declined this request (open http://127.0.0.1:8000 in the owner's browser). Do not retry it.",
};
function figuresThread() {
  return {
    thread: {
      id: `thread-${FIG_AGENT}`,
      turns: [{
        id: "ifm-fig-t0", status: "completed", startedAt: sec(400), completedAt: sec(380),
        items: [
          { type: "userMessage", id: "ifm-fig-u0", content: [{ type: "text", text: "图做好了给我看看。" }] },
          { type: "mcpToolCall", id: "ifm-fig-c0", server: "cutex", tool: "browser_open", status: "failed",
            arguments: { url: "http://127.0.0.1:8000" },
            result: { content: [{ type: "text", text: JSON.stringify(figDenied) }], isError: true }, error: null, durationMs: 80 },
          { type: "agentMessage", id: "ifm-fig-a0", text: "你没有同意在浏览器里打开。图在 [标注服务](cutex:service/denia-score-annotator/scores/index.html) 里，想看时点开。" },
        ],
      }, {
        id: "ifm-fig-t1", status: "completed", startedAt: sec(95), completedAt: sec(60),
        items: [
          { type: "userMessage", id: "ifm-fig-u1", content: [{ type: "text", text: "把三张图挂成一个预览服务，我明天还要看。" }] },
          { type: "mcpToolCall", id: "ifm-fig-c1", server: "cutex", tool: "service_register", status: "failed",
            arguments: { slug: "ifm-figs-preview", name: "IFM figures", runtime: "managed", command: "python -m http.server {port}", cwd: "D:\\Research\\ifm-ema\\figures", lifetime: "persistent" },
            result: { content: [{ type: "text", text: JSON.stringify(figRefusal) }], isError: true }, error: null, durationMs: 120 },
          { type: "agentMessage", id: "ifm-fig-a1", text: "常驻的预览服务需要你批准。我先结束这一轮；你决定后 cutex 会通知我，批准了我就原样重试。" },
        ],
      }],
    },
  };
}

export const mock: ModuleMock = {
  features: { new: ["approvals-live", "approval-decision-notice", "approval-wait"] },
  thread: (sessionId) => (sessionId === FIG_AGENT ? figuresThread() : null),
  api: (core) => ({
    async approvals(state) {
      if (core.legacy) return null;
      return structuredClone(mockApprovals.filter((a) => state === "all" || a.state === "pending"));
    },
    async decideApproval(approvalId, decision, note) {
      const a = mockApprovals.find((x) => x.approvalId === approvalId);
      if (!a) return { ok: false, error: { code: "approval_not_found", message: "no approval has this id" } };
      if (a.state !== "pending") return { ok: false, error: { code: "approval_not_pending", message: "the approval was already decided or expired" } };
      Object.assign(a, { state: decision === "approve" ? "approved" : "denied", decidedAt: new Date().toISOString(), note: note?.trim() || null });
      emitApprovalChange(core, decision === "approve" ? "approved" : "denied", a);
      // approval-wait: the holding call takes the decision itself (an approval is used at once, no notice).
      if (a.wait && !a.wait.end && Date.parse(a.wait.until) > Date.now()) {
        a.wait = { ...a.wait, end: decision === "approve" ? "approved" : "denied", endedAt: new Date().toISOString() };
        if (decision === "approve") {
          Object.assign(a, { state: "consumed", consumedAt: new Date().toISOString() });
          emitApprovalChange(core, "consumed", a);
        }
        return { ok: true, approval: structuredClone(a) };
      }
      // cutex approval-decision-notice: the requester is told (alarm scheduler, after_turn).
      if (!core.legacy && ["managed_service", "service_lifetime", "agent_profile", "browser_open"].includes(a.kind)) console.info(`[mock] approval notice → ${a.requesterCutexSessionId}: the owner ${decision === "approve" ? "approved" : "denied"} ${a.approvalId}`);
      // A workflow run plan: modules/workflows/mock.ts starts or rejects the run (cutex consumes the approval).
      if (a.kind === "workflow_run") (globalThis as { __cutexMockWorkflowDecision?: (id: string, approved: boolean) => void }).__cutexMockWorkflowDecision?.(a.approvalId, decision === "approve");
      // A delegation review: modules/delegations/mock.ts queues or rejects the delegation.
      if (a.kind === "ask_delivery" && typeof a.details?.askId === "string") (globalThis as { __cutexMockAskReview?: (askId: string, approved: boolean) => void }).__cutexMockAskReview?.(a.details.askId, decision === "approve");
      return { ok: true, approval: structuredClone(a) };
    },
  }),
  start: startApprovalRequests,
};
