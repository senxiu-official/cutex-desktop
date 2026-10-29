// Which component is asking (approval / question cards): Codex's own sandbox approvals, cutex's
// approvals (managed services, browser, profiles, workflows), a question from the model, or an MCP
// server. 「自动」 only changes the first: the others never go to the automatic reviewer.
import type { AgentRuntime } from "../lib/agentFeatures";
import { Bot, Cpu, Plug, ShieldHalf } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { Tag } from "./Tag";

export type ApprovalSourceKind = "native" | "cutex" | "model" | "mcp";

const ICON = { native: ShieldHalf, cutex: Cpu, model: Bot, mcp: Plug } as const;

/** ACP runtimes' own approvals (r265 DSH, r266 Kimi Code: no OS sandbox, its approval rules only). */
const RUNTIME_APPROVAL: Partial<Record<AgentRuntime, { label: MessageKey; hint: MessageKey }>> = {
  dsh: { label: "dsh.approvalSource", hint: "dsh.approvalSource.hint" },
  kimi: { label: "kimi.approvalSource", hint: "kimi.approvalSource.hint" },
};

/** The runtime's own approvals are named after it: a DSH agent's sandbox is DSH's, not Codex's (r265). */
export function approvalSourceKeys(source: ApprovalSourceKind, runtime?: AgentRuntime): { label: MessageKey; hint: MessageKey } {
  const own = source === "native" && runtime ? RUNTIME_APPROVAL[runtime] : undefined;
  if (own) return own;
  return { label: `approvalSource.${source}` as MessageKey, hint: `approvalSource.${source}.hint` as MessageKey };
}

export function ApprovalSource({ source, runtime, className = "" }: { source: ApprovalSourceKind; runtime?: AgentRuntime; className?: string }) {
  const { t } = useI18n();
  const Icon = ICON[source];
  const keys = approvalSourceKeys(source, runtime);
  return (
    <Tag title={t(keys.hint)} className={className}>
      <Icon size={11} strokeWidth={1.75} />
      {t(keys.label)}
    </Tag>
  );
}
