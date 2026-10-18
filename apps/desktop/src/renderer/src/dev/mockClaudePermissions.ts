// Browser-preview data for Claude agents' permission features (claude-r15 adapter + cutex
// `claude-permission-rules`): the persistent "always allow" rules per working directory, and a
// pending approval that offers one. Wired into the core mock bridge (dev/mockBridge.ts).
import type { ClaudePermissionRules } from "../../../shared/ipc";

/** Rules per workspace, as cutex keeps them (shared by the Claude agents of that directory). */
const rules = new Map<string, { revision: number; updatedAt: string | null; allow: string[] }>([
  ["D:\\Apps\\cutex-desktop", { revision: 2, updatedAt: new Date(Date.now() - 3_600_000).toISOString(), allow: ["Bash(git status:*)", "Bash(pnpm -s typecheck)", "Edit(apps/desktop/src/**)"] }],
]);

const RULE = /^[A-Za-z][A-Za-z0-9_.-]*(\(.+\))?$/;

export function mockClaudeRules(sessionId: string, cwd: string): ClaudePermissionRules {
  const entry = rules.get(cwd) ?? { revision: 0, updatedAt: null, allow: [] };
  return { cutexSessionId: sessionId, workspace: cwd, supported: true, ...entry };
}

export function mockSetClaudeRules(sessionId: string, cwd: string, allow: string[], expectedRevision?: number): ClaudePermissionRules {
  const current = rules.get(cwd) ?? { revision: 0, updatedAt: null, allow: [] };
  if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new Error("revision_conflict: the rules changed; reload and retry");
  const bad = allow.find((r) => !RULE.test(r.trim()));
  if (bad !== undefined) throw new Error(`invalid_rule: invalid Claude permission rule: "${bad}" (use Tool or Tool(specifier))`);
  rules.set(cwd, { revision: current.revision + 1, updatedAt: new Date().toISOString(), allow: [...new Set(allow.map((r) => r.trim()))] });
  return { ...mockClaudeRules(sessionId, cwd), sessions: [{ cutexSessionId: sessionId, status: "live" }] };
}

/** An approval answered "always allow in this project": cutex keeps the offered rules it chose. */
export function mockRememberClaudeRules(cwd: string, result: unknown): void {
  const chosen = (result as { decision?: { acceptWithClaudeRules?: { rules?: unknown } } } | null)?.decision?.acceptWithClaudeRules?.rules;
  if (!Array.isArray(chosen)) return;
  const current = rules.get(cwd) ?? { revision: 0, updatedAt: null, allow: [] };
  rules.set(cwd, { revision: current.revision + 1, updatedAt: new Date().toISOString(), allow: [...new Set([...current.allow, ...chosen.filter((r): r is string => typeof r === "string")])] });
}

/** Sora's (Claude) pending approval: a Bash command with Claude's suggested project rule. */
export function soraPendingApproval(cwd: string) {
  return {
    message: {
      id: 46,
      method: "item/commandExecution/requestApproval",
      params: {
        kind: "command", threadId: "thread-sora", turnId: "sora-t2", itemId: "sb1", startedAtMs: Date.now(), environmentId: null, approvalId: null,
        command: "git diff --stat HEAD~3", cwd, reason: "Claude wants to run git diff --stat HEAD~3", commandActions: null,
        availableDecisions: ["accept", "acceptForSession", { acceptWithClaudeRules: { rules: ["Bash(git diff:*)"] } }, "decline", "cancel"],
        claudePermissionRules: ["Bash(git diff:*)"],
      },
    },
  };
}
