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
const mockApprovals: MockApproval[] = [
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
    details: { askId: "ask-0f3c9e2a1b4d5c6e7f8091a2b3c4d5e6", target: "helper", targetName: "Helper", title: "复现 host-a 上的 ws 断线", brief: "在 host-a 上跑一遍 ws 重连测试，记录断线时的日志。", differences: [{ field: "sandbox", requester: "read-only", target: "workspace-write" }], claimedCaps: { sandbox: "workspace-write", networkAccess: true, unrestrictedServices: false }, claimedCapsLabel: "对端声称（仅展示，不作为审批依据）" },
    requestSha256: "5d1e…", state: "pending", createdAt: iso(90),
  },
  {
    approvalId: "apr-7f3a91c2", kind: "managed_service", reason: "outside_caller_envelope", requesterCutexSessionId: "mika", requesterName: "Mika", projectId: "desktop",
    summary: "register managed service kks-preview: pnpm --filter kks dev --port {port}",
    details: { op: "register", slug: "kks-preview", runtime: "managed", command: "pnpm --filter kks dev --port {port}", cwd: "D:\\Apps\\kks", port: null, envKeys: ["KKS_TOKEN", "NODE_ENV"] },
    requestSha256: "9b1e…", state: "pending", createdAt: iso(240),
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

export const mock: ModuleMock = {
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
      // A workflow run plan: modules/workflows/mock.ts starts or rejects the run (cutex consumes the approval).
      if (a.kind === "workflow_run") (globalThis as { __cutexMockWorkflowDecision?: (id: string, approved: boolean) => void }).__cutexMockWorkflowDecision?.(a.approvalId, decision === "approve");
      return { ok: true, approval: structuredClone(a) };
    },
  }),
  start: startApprovalRequests,
};
