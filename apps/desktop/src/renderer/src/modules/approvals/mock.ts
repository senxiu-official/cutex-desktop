// Browser-preview data for owner approvals (approvals page, live request after 15 s; dev/mockTypes.ts).
import type { MockCore, ModuleMock } from "../../dev/mockTypes";
import { NOTIFICATION_PAGES_FEATURE } from "../../../../shared/notificationPaging";

const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
type MockApproval = import("../../../../shared/ipc").ApprovalRecord;
type MockRule = import("../../../../shared/ipc").ApprovalRule;
type MockRuleDraft = import("../../../../shared/ipc").ApprovalRuleDraft;
type MockAudit = import("../../../../shared/ipc").ApprovalRuleAudit;
type MockCatalogItem = import("../../../../shared/ipc").ApprovalRuleCatalogItem;
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
    summary: "委托 Lead → Alden: 构建 the next release",
    details: { askId: "ask-review", target: "alden", targetName: "Alden", title: "构建 the next release", brief: "构建 the next release。完成后简短汇报。", differences: [{ field: "sandbox", requester: "workspace-write", target: "danger-full-access" }], grants: "delivery of this one ask, once, under the target's existing permissions; each action in its turn still follows the target's approval policy" },
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
    approvalId: "apr-auto047", kind: "browser_open", reason: "browser_agent_open", requesterCutexSessionId: "eva", requesterName: "Eva", projectId: "desktop",
    summary: "open https://docs.example.test/release-notes in the agent browser", details: { url: "https://docs.example.test/release-notes" },
    requestSha256: "47ac…", state: "consumed", createdAt: iso(1800), decidedAt: iso(1800), consumedAt: iso(1800),
    risk: "medium", matchedRuleId: "aar-preview-browser", autoDecision: true, ruleRevision: 1,
    decidedBy: { by: "auto:rule/aar-preview-browser" },
  },
  {
    approvalId: "apr-55e0b1f3", kind: "managed_service", reason: "outside_caller_envelope", requesterCutexSessionId: "scratch", requesterName: "scratch", projectId: null,
    summary: "register managed service tunnel: cloudflared tunnel run",
    details: { op: "register", slug: "tunnel", runtime: "managed", command: "cloudflared tunnel run" },
    requestSha256: "77f2…", state: "denied", createdAt: iso(86000), decidedAt: iso(85000),
  },
];

let rulesRevision = 2;
const mockRules: MockRule[] = [
  ...(["service_lifetime", "ask_delivery", "browser_open"] as const).map((kind, index): MockRule => ({
    ruleId: `aar-role-director-${kind}-${index}`, revision: 1, enabled: true,
    subject: { type: "agent", cutexSessionId: "eva", displayName: "Eva" }, projectId: "desktop",
    kinds: [kind], constraints: {}, expiry: { mode: "revoked", expiresAt: null, turn: null }, highRiskKindsExplicit: [],
    createdAt: iso(172800), updatedAt: iso(172800), createdBy: "system", source: "role", grantedBy: "role:director", lastMatchedAt: null, expired: false,
  })),
  {
    ruleId: "aar-preview-browser", revision: 1, enabled: true, subject: { type: "agent", cutexSessionId: "eva", displayName: "Eva" }, projectId: "desktop",
    kinds: ["browser_open"], constraints: {}, expiry: { mode: "today", expiresAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(), turn: null }, highRiskKindsExplicit: [],
    createdAt: iso(3600), updatedAt: iso(3600), createdBy: "owner", lastMatchedAt: iso(1800), expired: false,
  },
  {
    ruleId: "aar-preview-service", revision: 1, enabled: false, subject: { type: "agent", cutexSessionId: "mika", displayName: "Mika" }, projectId: null,
    kinds: ["managed_service"], constraints: {}, expiry: { mode: "revoked", expiresAt: null, turn: null }, highRiskKindsExplicit: ["managed_service"],
    createdAt: iso(86000), updatedAt: iso(4000), createdBy: "owner", lastMatchedAt: null, expired: false,
  },
  // Rules that cover several types (made before one switch per type): shown truthfully, never silently split.
  {
    ruleId: "aar-preview-legacy", revision: 1, enabled: true, subject: { type: "agent", cutexSessionId: "eva", displayName: "Eva" }, projectId: "desktop",
    kinds: ["static_root", "workflow_run"], constraints: {}, expiry: { mode: "hour", expiresAt: new Date(Date.now() + 40 * 60_000).toISOString(), turn: null }, highRiskKindsExplicit: ["static_root", "workflow_run"],
    createdAt: iso(1200), updatedAt: iso(1200), createdBy: "owner", lastMatchedAt: null, expired: false,
  },
  {
    ruleId: "aar-preview-sora-pair", revision: 1, enabled: true, subject: { type: "agent", cutexSessionId: "sora", displayName: "Sora" }, projectId: null,
    kinds: ["browser_claim", "ask_delivery"], constraints: {}, expiry: { mode: "revoked", expiresAt: null, turn: null }, highRiskKindsExplicit: ["browser_claim"],
    createdAt: iso(7200), updatedAt: iso(7200), createdBy: "owner", lastMatchedAt: null, expired: false,
  },
  {
    ruleId: "aar-preview-sora-open", revision: 1, enabled: true, subject: { type: "agent", cutexSessionId: "sora", displayName: "Sora" }, projectId: "desktop",
    kinds: ["browser_open"], constraints: {}, expiry: { mode: "today", expiresAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(), turn: null }, highRiskKindsExplicit: [],
    createdAt: iso(3000), updatedAt: iso(3000), createdBy: "owner", lastMatchedAt: null, expired: false,
  },
  {
    ruleId: "aar-preview-kai", revision: 1, enabled: true, subject: { type: "agent", cutexSessionId: "kai", displayName: "Kai" }, projectId: "desktop",
    kinds: ["service_lifetime"], constraints: {}, expiry: { mode: "hour", expiresAt: new Date(Date.now() + 50 * 60_000).toISOString(), turn: null }, highRiskKindsExplicit: [],
    createdAt: iso(600), updatedAt: iso(600), createdBy: "owner", lastMatchedAt: null, expired: false,
  },
];
const mockRuleAudit: MockAudit[] = [
  { auditId: "ara-preview-match", at: iso(1800), action: "matched", ruleId: "aar-preview-browser", ruleRevision: 1, actor: "auto:owner", requesterCutexSessionId: "eva", projectId: "desktop", kind: "browser_open", risk: "medium", requestSha256: "47ac…", approvalId: "apr-auto047", result: "approved", details: {} },
  { auditId: "ara-preview-pause", at: iso(4000), action: "updated", ruleId: "aar-preview-service", ruleRevision: 1, actor: "owner", result: "narrowed", details: {} },
  // `?settingslists`: more than the 协作 page shows.
  ...(typeof location !== "undefined" && new URLSearchParams(location.search).has("settingslists")
    ? Array.from({ length: 22 }, (_, i) => ({ auditId: `ara-preview-scale-${i}`, at: iso(5000 + i * 900), action: i % 3 ? "matched" : "updated", ruleId: i % 2 ? "aar-preview-browser" : "aar-preview-service", ruleRevision: 1, actor: "auto:owner", result: i % 3 ? "allowed" : "narrowed", details: {} }))
    : []),
];
const ruleCatalog: MockCatalogItem[] = [
  { kind: "managed_service", risk: "high", compositeRisk: false, constraints: [] }, { kind: "service_lifetime", risk: "dynamic", compositeRisk: true, constraints: [] },
  { kind: "static_root", risk: "high", compositeRisk: false, constraints: [] }, { kind: "agent_profile", risk: "dynamic", compositeRisk: true, constraints: ["profileIds"] },
  { kind: "ask_delivery", risk: "dynamic", compositeRisk: true, constraints: [] }, { kind: "browser_claim", risk: "high", compositeRisk: false, constraints: [] },
  { kind: "browser_open", risk: "medium", compositeRisk: false, constraints: [] }, { kind: "workflow_run", risk: "high", compositeRisk: false, constraints: ["maxAgents", "maxTokens"] },
];
const normalizedRule = (draft: MockRuleDraft): MockRuleDraft => {
  const now = new Date();
  const expiresAt = draft.expiry.mode === "hour" ? new Date(now.valueOf() + 3600_000).toISOString() : draft.expiry.mode === "today" ? new Date(new Date().setHours(24, 0, 0, 0)).toISOString() : null;
  return { ...structuredClone(draft), expiry: { ...draft.expiry, expiresAt, turn: draft.expiry.mode === "turn" ? draft.expiry.turn : null }, kinds: [...new Set(draft.kinds)], highRiskKindsExplicit: [...new Set(draft.highRiskKindsExplicit)].sort() };
};
const confirmationPhrase = (draft: MockRuleDraft) => `AUTO ${draft.subject.displayName || draft.subject.cutexSessionId} ${[...draft.highRiskKindsExplicit].sort().join(",")}`;
const confirmations = new Map<string, string>();
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

// Opt-in history fixture: enough decisions to cross two 100-row UI boundaries, without
// changing the pending inbox or the default preview scene.
const pagedFixture: MockApproval[] = Array.from({ length: 225 }, (_, i) => ({
  approvalId: `apr-s10-${String(i).padStart(4, "0")}`, kind: "managed_service", reason: "outside_caller_envelope",
  requesterCutexSessionId: FIG_AGENT, requesterName: "ifm-ema-figures", projectId: "ifm-ema",
  summary: `History fixture ${i + 1}`, requestSha256: "s10-fixture", state: i % 2 ? "denied" : "consumed",
  createdAt: iso(1000 + i * 2), decidedAt: iso(999 + i * 2), details: null,
}));
function approvalRows(state: "pending" | "all"): MockApproval[] {
  const query = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const routingScene = query.has("routingReviews");
  const rows = query.has("s10pages") && state === "all" ? [...mockApprovals, ...pagedFixture] : mockApprovals;
  return structuredClone(rows.filter(a => (!routingScene || a.details?.askId === "ask-review") && (state === "all" || a.state === "pending"))
    .map(a => routingScene ? { ...a, summary: a.summary.replace("Alden", "Kai"), details: { ...a.details, target: "kai", targetName: "Kai" } } : a));
}

export const mock: ModuleMock = {
  features: { new: ["approvals-live", "approval-decision-notice", "approval-wait", "approval-auto-rules", NOTIFICATION_PAGES_FEATURE] },
  thread: (sessionId) => (sessionId === FIG_AGENT ? figuresThread() : null),
  api: (core) => ({
    async approvalRules() {
      if (core.legacy) return null;
      return { contractVersion: 1, hostId: "local", revision: rulesRevision, catalog: structuredClone(ruleCatalog), rules: structuredClone(mockRules) };
    },
    async confirmApprovalRule(rule, typedPhrase) {
      const normalized = normalizedRule(rule);
      const requiredPhrase = confirmationPhrase(normalized);
      if (!normalized.highRiskKindsExplicit.length || typedPhrase !== requiredPhrase) throw new Error(`typed confirmation is required: ${requiredPhrase}`);
      const confirmationToken = `arc-${crypto.randomUUID()}`;
      confirmations.set(confirmationToken, JSON.stringify(normalized));
      return { confirmationToken, requiredPhrase, expiresInSeconds: 300 };
    },
    async createApprovalRule(expectedRevision, rule, confirmationToken) {
      if (expectedRevision !== rulesRevision) throw new Error("approval rules changed; refresh and retry");
      const normalized = normalizedRule(rule);
      if (normalized.highRiskKindsExplicit.length && confirmations.get(confirmationToken ?? "") !== JSON.stringify(normalized)) throw new Error(`typed confirmation is required: ${confirmationPhrase(normalized)}`);
      if (confirmationToken) confirmations.delete(confirmationToken);
      const now = new Date().toISOString();
      const created: MockRule = { ...normalized, ruleId: `aar-${crypto.randomUUID().replaceAll("-", "")}`, revision: 1, createdAt: now, updatedAt: now, createdBy: "owner", lastMatchedAt: null, expired: false };
      mockRules.push(created); rulesRevision += 1;
      mockRuleAudit.unshift({ auditId: `ara-${crypto.randomUUID()}`, at: now, action: "created", ruleId: created.ruleId, ruleRevision: 1, actor: "owner", result: "allowed", details: {} });
      core.emitHost("cutex/approvalRules/changed", { action: "created", ruleId: created.ruleId, revision: rulesRevision });
      return { revision: rulesRevision, rule: structuredClone(created) };
    },
    async patchApprovalRule(ruleId, expectedRevision, rule, confirmationToken) {
      if (expectedRevision !== rulesRevision) throw new Error("approval rules changed; refresh and retry");
      const index = mockRules.findIndex((item) => item.ruleId === ruleId);
      if (index < 0) throw new Error("no approval rule has this id");
      const normalized = normalizedRule(rule);
      if (confirmationToken && confirmations.get(confirmationToken) !== JSON.stringify(normalized)) throw new Error("typed confirmation expired");
      if (confirmationToken) confirmations.delete(confirmationToken);
      const old = mockRules[index]!;
      const updated: MockRule = { ...normalized, ruleId, revision: old.revision + 1, createdAt: old.createdAt, updatedAt: new Date().toISOString(), createdBy: old.createdBy, source: old.source, grantedBy: old.grantedBy, lastMatchedAt: old.lastMatchedAt, expired: false };
      mockRules[index] = updated; rulesRevision += 1;
      mockRuleAudit.unshift({ auditId: `ara-${crypto.randomUUID()}`, at: updated.updatedAt, action: "updated", ruleId, ruleRevision: updated.revision, actor: "owner", result: "narrowed", details: {} });
      core.emitHost("cutex/approvalRules/changed", { action: "updated", ruleId, revision: rulesRevision });
      return { revision: rulesRevision, rule: structuredClone(updated) };
    },
    async deleteApprovalRule(ruleId, expectedRevision) {
      if (expectedRevision !== rulesRevision) throw new Error("approval rules changed; refresh and retry");
      const index = mockRules.findIndex((item) => item.ruleId === ruleId);
      if (index < 0) throw new Error("no approval rule has this id");
      mockRules.splice(index, 1); rulesRevision += 1;
      const at = new Date().toISOString();
      mockRuleAudit.unshift({ auditId: `ara-${crypto.randomUUID()}`, at, action: "revoked", ruleId, actor: "owner", result: "revoked", details: {} });
      core.emitHost("cutex/approvalRules/changed", { action: "revoked", ruleId, revision: rulesRevision });
      return { revision: rulesRevision, revoked: true, ruleId };
    },
    async approvalRuleAudit(cursor = 0, limit = 100) {
      const audit = mockRuleAudit.slice(cursor, cursor + limit);
      return { audit: structuredClone(audit), nextCursor: cursor + audit.length < mockRuleAudit.length ? cursor + audit.length : null };
    },
    async approvals(state) {
      if (core.legacy) return null;
      return approvalRows(state);
    },
    async approvalsPage(state, query = {}) {
      if (core.legacy) return null;
      const prefix = `mock-approvals-${state}-`;
      if (query.cursor && !query.cursor.startsWith(prefix)) throw new Error("409 resync_required");
      const offset = query.cursor ? Number(query.cursor.slice(prefix.length)) : 0;
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("400 invalid_cursor");
      const limit = Math.max(1, Math.min(500, query.limit ?? 100));
      const rows = approvalRows(state);
      const approvals = rows.slice(offset, offset + limit);
      return { approvals, nextCursor: offset + approvals.length < rows.length ? `${prefix}${offset + approvals.length}` : null };
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
