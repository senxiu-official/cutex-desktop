import { describe, expect, it } from "vitest";
import { APPROVAL_RULE_KINDS, approvalIdentityRole, approvalRuleDraft, availableApprovalKinds, declaredAgentCreate, declaredCutexTools, isDirectorRoleRule, ruleSaveAction } from "./approvalRuleKinds";

const features = new Set(["services", "agent-asks", "workflows"]);

describe("approval rule kind availability", () => {
  it("shows every kind while session capability facts are unknown", () => {
    expect(availableApprovalKinds({ formalAgent: null, hostFeatures: null, isDirector: null, browserTools: null, declaredTools: null, agentCreate: null })).toEqual(APPROVAL_RULE_KINDS);
  });

  it("shows a regular agent only the host and Profile capabilities it can trigger", () => {
    expect(availableApprovalKinds({ formalAgent: true, hostFeatures: features, isDirector: false, browserTools: false, declaredTools: null, agentCreate: null })).toEqual([
      "managed_service", "service_lifetime", "static_root", "ask_delivery", "workflow_run",
    ]);
  });

  it("adds Profile use for a Director or an explicit create capability", () => {
    const base = { formalAgent: true, hostFeatures: features, browserTools: false, declaredTools: null } as const;
    expect(availableApprovalKinds({ ...base, isDirector: true, agentCreate: null })).toContain("agent_profile");
    expect(availableApprovalKinds({ ...base, isDirector: false, agentCreate: true })).toContain("agent_profile");
  });

  it("limits quick chats to their enabled browser tools", () => {
    const base = { formalAgent: false, hostFeatures: features, isDirector: false, declaredTools: null, agentCreate: false } as const;
    expect(availableApprovalKinds({ ...base, browserTools: true })).toEqual(["browser_claim", "browser_open"]);
    expect(availableApprovalKinds({ ...base, browserTools: false })).toEqual([]);
  });

  it("treats an explicit role-filtered tool list as authoritative", () => {
    expect(availableApprovalKinds({ formalAgent: true, hostFeatures: features, isDirector: true, browserTools: true, declaredTools: ["workflow_start", "browser_open"], agentCreate: true })).toEqual(["browser_open", "workflow_run"]);
  });

  it("reads explicit tools and create capability without guessing malformed schemas", () => {
    const tools = { capabilities: { cutexTools: ["agent_create", "workflow_start"] } };
    expect(declaredCutexTools(tools)).toEqual(["agent_create", "workflow_start"]);
    expect(declaredAgentCreate(tools)).toBe(true);
    expect(declaredAgentCreate({ capabilities: { features: { agentCreate: false } } })).toBe(false);
    expect(declaredCutexTools({ capabilities: { cutexTools: ["agent_create", 7] } })).toBeNull();
    expect(declaredCutexTools({ capabilities: { tools: ["unrelated-native-method"] } })).toBeNull();
  });

  it("derives the identity line only from a canonical role projection", () => {
    expect(approvalIdentityRole(true, undefined, "director")).toBe("director");
    expect(approvalIdentityRole(false, ["operator"], "operator")).toBe("operator");
    expect(approvalIdentityRole(false, undefined, "operator")).toBeNull();
    expect(approvalIdentityRole(null, ["operator"], "operator")).toBe("operator");
  });
});

describe("approval rule confirmation", () => {
  it("saves low and medium rules on the first click and types only for explicit high risk", () => {
    expect(ruleSaveAction({ highRiskKindsExplicit: [] })).toBe("save");
    expect(ruleSaveAction({ highRiskKindsExplicit: ["managed_service"] })).toBe("confirm");
  });

  it("patches only draft fields and identifies Director role grants", () => {
    const rule = {
      ruleId: "aar-role",
      enabled: true,
      subject: { type: "agent" as const, cutexSessionId: "cutex.a" },
      projectId: "p",
      kinds: ["browser_open" as const],
      constraints: {},
      expiry: { mode: "revoked" as const },
      highRiskKindsExplicit: [],
      revision: 1,
      createdAt: "2026-10-24T00:00:00Z",
      updatedAt: "2026-10-24T00:00:00Z",
      createdBy: "system",
      source: "role" as const,
      grantedBy: "role:director" as const,
      expired: false,
    };
    expect(isDirectorRoleRule(rule)).toBe(true);
    expect(approvalRuleDraft(rule, false)).toEqual({
      enabled: false,
      subject: rule.subject,
      projectId: "p",
      kinds: ["browser_open"],
      constraints: {},
      expiry: { mode: "revoked" },
      highRiskKindsExplicit: [],
    });
  });
});
