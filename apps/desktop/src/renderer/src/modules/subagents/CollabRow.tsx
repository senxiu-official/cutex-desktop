// Native collaboration rows retain the baseline layout and sub-agent navigation.
import { useState, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, Bot, ChevronDown, ChevronRight, CircleStop, Hourglass, Loader2 } from "lucide-react";
import { canOpenSubAgent, isClaudeTaskRef } from "../../lib/claudeTasks";
import { useAgentFeatures } from "../../lib/agentFeaturesView";
import { subAgentName, subAgentTooltip, useSubAgents } from "../../lib/subagents";
import { useSubAgentMeta } from "../../lib/subagentMetaStore";
import { useI18n, type MessageKey } from "../../i18n";
import { isRunning } from "../../lib/workGroups";
import type { RawItem } from "../../lib/timeline";
import { ScriptText } from "../../components/ScriptText";
import { openSubagentThread } from "../../lib/sideOpen";

const COLLAB_VERB: Record<string, MessageKey> = {
  spawnAgent: "subagents.timeline.spawn",
  sendInput: "subagents.timeline.send",
  sendMessage: "subagents.timeline.send",
  followupTask: "subagents.timeline.followup",
  wait: "subagents.timeline.wait",
  interruptAgent: "subagents.timeline.interrupt",
  closeAgent: "subagents.timeline.close",
  resumeAgent: "subagents.timeline.resume",
  listAgents: "subagents.timeline.list",
};

/**
 * A row that toggles on click / Enter / Space. A div (role="button"), not a <button>: it contains the
 * sub-agent chip buttons, and a <button> inside a <button> is invalid HTML (React warns). Same look.
 */
function ToggleRow({ onToggle, children }: { onToggle: () => void; children: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onToggle();
      }}
      className="flex w-full max-w-full cursor-default items-center gap-1.5 text-left text-muted select-none hover:text-foreground"
    >
      {children}
    </div>
  );
}

function SubAgentChip({ threadId }: { threadId: string }) {
  const { t } = useI18n();
  const { agents, open } = useSubAgents();
  const meta = useSubAgentMeta();
  // A Claude task lives inside this session: plain text with a tooltip, never an open.
  if (isClaudeTaskRef(threadId))
    return (
      <span title={t("sub.claudeTask")} className="flex shrink-0 items-center gap-1 px-0.5 font-medium text-foreground">
        <Bot size={13} className="text-subtle" />
        {agents.get(threadId)?.name ?? threadId.slice(threadId.lastIndexOf(":") + 1)}
      </span>
    );
  return (
    <button
      title={subAgentTooltip(threadId, agents.get(threadId))}
      onClick={(e) => {
        e.stopPropagation();
        open(threadId);
      }}
      className="flex shrink-0 items-center gap-1 rounded px-0.5 font-medium text-foreground hover:bg-surface-2 hover:text-accent"
    >
      <Bot size={13} className="text-subtle" />
      {subAgentName(threadId, agents, meta)}
    </button>
  );
}

/**
 * Sub-agent operation (cute-codex collabAgentToolCall), styled like agent-bus rows (§4.15):
 * `↗ 派出 🤖 name  task preview ›`, and for finished agents an extra `↙ 🤖 name 完成  result ›`.
 */
export function CollabRow({ item }: { item: RawItem }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const tool = String(item.tool ?? "");
  const receivers = (item.receiverThreadIds as string[] | undefined) ?? [];
  const states = (item.agentsStates ?? {}) as Record<string, { status: string; message: string | null } | undefined>;
  const prompt = (item.prompt as string | null | undefined) ?? null;
  const running = isRunning(item);
  const Icon = tool === "wait" ? Hourglass : tool === "interruptAgent" || tool === "closeAgent" ? CircleStop : ArrowUpRight;
  const finished = receivers.filter((id) => ["completed", "errored", "interrupted", "shutdown"].includes(states[id]?.status ?? ""));
  return (
    <div className="my-0.5 text-xs">
      <ToggleRow onToggle={() => prompt && setOpen(!open)}>
        {running ? <Loader2 size={13} className="shrink-0 animate-spin text-accent" /> : <Icon size={13} className="shrink-0 text-subtle" />}
        <span className="shrink-0">{t(COLLAB_VERB[tool] ?? "subagents.timeline.other")}</span>
        {receivers.map((id) => (
          <SubAgentChip key={id} threadId={id} />
        ))}
        {prompt && !open && <span className="min-w-0 truncate text-subtle"><ScriptText text={prompt.replace(/\s+/g, " ")} /></span>}
        {prompt && (open ? <ChevronDown size={13} className="ml-auto shrink-0" /> : <ChevronRight size={13} className="ml-auto shrink-0" />)}
      </ToggleRow>
      {open && prompt && <div className="font-chat-context mt-1 ml-5 max-w-[75%] rounded-xl border border-dashed border-border px-3 py-1.5 whitespace-pre-wrap text-muted"><ScriptText text={prompt} /></div>}
      {finished.map((id) => (
        <SubAgentResult key={id} threadId={id} status={states[id]!.status} message={states[id]!.message} />
      ))}
    </div>
  );
}

function SubAgentResult({ threadId, status, message }: { threadId: string; status: string; message: string | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const failed = status === "errored";
  return (
    <div className="mt-0.5">
      <ToggleRow onToggle={() => message && setOpen(!open)}>
        <ArrowDownLeft size={13} className={`shrink-0 ${failed ? "text-danger" : "text-accent"}`} />
        <SubAgentChip threadId={threadId} />
        <span className={`shrink-0 ${failed ? "text-danger" : ""}`}>{t(`sub.status.${status}` as MessageKey)}</span>
        {message && !open && <span className="min-w-0 truncate text-subtle"><ScriptText text={message.replace(/\s+/g, " ")} /></span>}
        {message && (open ? <ChevronDown size={13} className="ml-auto shrink-0" /> : <ChevronRight size={13} className="ml-auto shrink-0" />)}
      </ToggleRow>
      {open && message && <div className="font-chat-context mt-1 ml-5 max-w-[75%] rounded-xl border border-border bg-peer px-3 py-1.5 whitespace-pre-wrap"><ScriptText text={message} /></div>}
    </div>
  );
}


const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * A Claude agent's Agent / Task call (a foreground subagent): `↗ 派出 🤖 description · type  prompt ›`.
 * The name opens the subagent's transcript when the adapter keeps one (`agentThreadId`, lib/claudeTasks);
 * expanded: the prompt and the subagent's answer (the tool result).
 */
export function ClaudeAgentRow({ item, sessionId }: { item: RawItem; sessionId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const features = useAgentFeatures(sessionId);
  const args = (item.arguments && typeof item.arguments === "object" ? item.arguments : {}) as Record<string, unknown>;
  const role = str(args.subagent_type);
  const name = str(args.description) ?? role ?? t("subagents.claude.agent");
  const prompt = str(args.prompt);
  const ref = typeof item.agentThreadId === "string" ? item.agentThreadId : null;
  const openable = !!ref && canOpenSubAgent(ref, features);
  const running = isRunning(item);
  const failed = item.status === "failed";
  const contents = Array.isArray(item.contentItems) ? (item.contentItems as { text?: unknown }[]) : [];
  const result = contents.map((c) => (typeof c?.text === "string" ? c.text : "")).join("\n").trim() || null;
  const label = role && role !== name ? `${name} · ${role}` : name;
  const chip = (
    <>
      <Bot size={13} className="text-subtle" />
      <span className="truncate">{label}</span>
    </>
  );
  return (
    <div className="my-0.5 text-xs" data-claude-agent-row="">
      <ToggleRow onToggle={() => (prompt || result) && setOpen(!open)}>
        {running ? <Loader2 size={13} className="shrink-0 animate-spin text-accent" /> : <ArrowUpRight size={13} className={`shrink-0 ${failed ? "text-danger" : "text-subtle"}`} />}
        <span className="shrink-0">{t("subagents.timeline.spawn")}</span>
        {openable ? (
          <button
            title={t("subagents.claude.open")}
            onClick={(e) => {
              e.stopPropagation();
              void openSubagentThread(ref!, sessionId);
            }}
            className="flex max-w-[45%] min-w-0 shrink-0 items-center gap-1 rounded px-0.5 font-medium text-foreground hover:bg-surface-2 hover:text-accent"
          >
            {chip}
          </button>
        ) : (
          <span className="flex max-w-[45%] min-w-0 shrink-0 items-center gap-1 px-0.5 font-medium text-foreground">{chip}</span>
        )}
        {failed && <span className="shrink-0 text-danger">· {t("sub.status.errored")}</span>}
        {prompt && !open && <span className="min-w-0 truncate text-subtle"><ScriptText text={prompt.replace(/\s+/g, " ")} /></span>}
        {(prompt || result) && (open ? <ChevronDown size={13} className="ml-auto shrink-0" /> : <ChevronRight size={13} className="ml-auto shrink-0" />)}
      </ToggleRow>
      {open && prompt && <div className="font-chat-context mt-1 ml-5 max-w-[75%] rounded-xl border border-dashed border-border px-3 py-1.5 whitespace-pre-wrap text-muted"><ScriptText text={prompt} /></div>}
      {open && result && <div className="font-chat-context mt-1 ml-5 max-w-[75%] rounded-xl border border-border bg-peer px-3 py-1.5 whitespace-pre-wrap"><ScriptText text={result} /></div>}
    </div>
  );
}
