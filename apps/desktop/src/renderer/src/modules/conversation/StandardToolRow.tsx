// Dedicated summaries share the core row's status, failure, context menu and layout toggles.
import { BookOpen, CircleStop, FileText, Search, ServerCog, ScanLine, Users, Wrench } from "lucide-react";
import type { RawItem } from "../../lib/timeline";
import { standardToolRow, type StandardToolModel } from "../../lib/standardToolRows";
import { toolOutput } from "../../lib/workGroups";
import { toolResult } from "../../lib/taskRows";
import { PlainToolRow } from "../../components/PlainToolRow";
import { ItemMedia } from "../../components/ItemMedia";
import { useConvHost } from "../../lib/conversationScope";
import { useI18n } from "../../i18n";
import { approvalSubject, useLiveApproval } from "../../lib/liveApproval";
import { TimelineRowFallback } from "../TimelineRowFallback";

const statusKeys = { busy: "status.running", idle: "status.idle", offline: "status.offline", error: "status.error" } as const;
const icons = { read: BookOpen, search: Search, tools: Wrench, agents: Users, memberRuntime: ServerCog, taskStop: CircleStop, artifactRead: FileText, actionStatus: ScanLine };
function Details({ item, model }: { item: RawItem; model: StandardToolModel }) {
  const { t } = useI18n();
  const output = toolOutput(item) ?? JSON.stringify(toolResult(item) ?? item.result ?? item, null, 2);
  return <div className="max-h-72 overflow-auto rounded-md bg-surface p-2 text-caption/[inherit] text-muted">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono">
      {model.fields.map(f => <div key={f.name} className="contents"><dt className="text-subtle">{f.name}</dt><dd className="whitespace-pre-wrap break-all">{f.value}</dd></div>)}
    </dl>
    {model.resultFields && <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono">
      {model.resultFields.map(f => <div key={f.name} className="contents"><dt className="text-subtle">{f.name}</dt><dd className="whitespace-pre-wrap break-all">{f.value}</dd></div>)}
    </dl>}
    {model.kind === "actionStatus" && <p className="mt-2">{t("conversation.tools.actionStatus.hint")}</p>}
    {model.body !== undefined && model.body !== null && <pre className="mt-2 font-mono whitespace-pre-wrap break-words">{model.body}</pre>}
    {model.agents.length > 0 && <ul className="my-2 space-y-1" aria-label={t("conversation.tools.agents")}>
      {model.agents.map((agent, i) => <li key={`${agent.id}:${i}`} className="flex min-w-0 gap-2"><span className="min-w-0 break-all">{agent.name}</span><code className="min-w-0 break-all text-subtle">{agent.id}</code>{agent.status && <span className="ml-auto shrink-0 text-subtle">{agent.status in statusKeys ? t(statusKeys[agent.status as keyof typeof statusKeys]) : agent.status}</span>}</li>)}
    </ul>}
    {(model.kind === "agents" && model.agentCount !== null || model.kind === "artifactRead") ? <details className="mt-2">
      <summary className="cursor-pointer text-subtle">{t("conversation.tools.rawResult")}</summary>
      <pre className="mt-1 font-mono whitespace-pre-wrap break-words">{output}</pre>
    </details> : <pre className="mt-2 font-mono whitespace-pre-wrap break-words">{output}</pre>}
  </div>;
}
export function StandardToolRow({ item }: { item: RawItem; sessionId: string }) {
  const hostId = useConvHost();
  const { t } = useI18n();
  const model = standardToolRow(item);
  // An action_status answer "awaiting approval" says what the owner decided since (lib/liveApproval), so repeated
  // checks don't stack rows that still read 调用等待审批 after the approval.
  const waiting = model?.kind === "actionStatus" && model.state === "awaitingApproval";
  const live = useLiveApproval(hostId, waiting ? approvalSubject(item) : null);
  if (!model) return <TimelineRowFallback />;
  const decided = waiting && live !== null && live !== "pending";
  const detail = model.kind === "agents" && model.agentCount !== null ? [t("conversation.tools.agentCount", { n: model.agentCount }), model.summary].filter(Boolean).join(" · ") : model.summary;
  const key = model.kind === "memberRuntime" && model.operation ? `conversation.tools.memberRuntime.${model.operation}` as const : `conversation.tools.${model.kind}` as const;
  const state = decided ? t(`conversation.tools.actionStatus.approval.${live}`) : model.state ? t(`conversation.tools.actionStatus.${model.state}`) : null;
  const summary = [detail, state].filter(Boolean).join(" · ");
  return <><PlainToolRow item={item} presentation={{ kind: model.kind, key, detail: summary, outcome: decided ? null : model.outcome, icon: icons[model.kind], details: <Details item={item} model={model} /> }} /><ItemMedia item={item} hostId={hostId} /></>;
}
