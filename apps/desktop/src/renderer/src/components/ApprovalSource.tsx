// Which component is asking (approval / question cards): Codex's own sandbox approvals, cutex's
// approvals (managed services, browser, profiles, workflows), a question from the model, or an MCP
// server. 「自动」 only changes the first: the others never go to the automatic reviewer.
import { Bot, Cpu, Plug, ShieldHalf } from "lucide-react";
import { useI18n } from "../i18n";

export type ApprovalSourceKind = "native" | "cutex" | "model" | "mcp";

const ICON = { native: ShieldHalf, cutex: Cpu, model: Bot, mcp: Plug } as const;

export function ApprovalSource({ source, className = "" }: { source: ApprovalSourceKind; className?: string }) {
  const { t } = useI18n();
  const Icon = ICON[source];
  return (
    <span title={t(`approvalSource.${source}.hint`)} className={`inline-flex shrink-0 items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-normal text-subtle ${className}`}>
      <Icon size={11} strokeWidth={1.75} />
      {t(`approvalSource.${source}`)}
    </span>
  );
}
