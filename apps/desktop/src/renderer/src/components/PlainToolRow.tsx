// Core tool fallback: always available even when a specialized module is disabled.
import { openModifiers } from "../lib/openModifiers";
import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Bot, ChevronDown, ChevronRight, CircleQuestionMark, CircleStop, FilePen, Globe, Loader2, ShieldAlert, ShieldX, SquareTerminal, Wrench, X } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { contextMenu } from "../lib/contextMenu";
import { toolMenu } from "../lib/menus";
import type { RawItem } from "../lib/timeline";
import { approvalOutcome, diffCounts, isFailed, isRunning, toolDetail, toolLiveness, toolOutput } from "../lib/workGroups";
import { parseFileLink, rootFor, scopeFor } from "../lib/workspace";
import { agentState, useApp, viewOf } from "../store";
import { convSignal, useConvHost, useConvScope, useConvSession, useConvSidebar } from "../lib/conversationScope";
import { toolErrorText, type TaskRowOutcome } from "../lib/taskRows";
import { ToolErrorText } from "./ToolErrorText";
import { openPath } from "../lib/sideOpen";
import { useUserLayoutToggle } from "../lib/userLayoutToggle";

function formatMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function toolLabel(item: RawItem): { key: MessageKey; detail: string } {
  const key: MessageKey =
    item.type === "commandExecution" ? "tool.command" : item.type === "fileChange" ? "tool.fileChange" : item.type === "mcpToolCall" ? "tool.mcp" : item.type === "collabAgentToolCall" ? "tool.agent" : item.type === "webSearch" ? "tool.web" : item.type === "dynamicToolCall" ? "tool.mcp" : "tool.other";
  return { key, detail: toolDetail(item) };
}

const NO_ITEMS: string[] = [];

/** toolLiveness for a row of the conversation's timeline (lib/conversationScope; subagent rows: "running" as before). */
function useToolLiveness(item: RawItem) {
  const selectedId = useConvSession();
  const hostId = useConvHost();
  const turnRunning = useApp((s) => {
    const tl = selectedId ? viewOf(s, hostId, selectedId)?.timeline : undefined;
    const entry = tl?.entries.get(item.id);
    const turn = entry?.turnId ? tl!.turns.find((x) => x.id === entry.turnId) : undefined;
    return !turn || turn.status === "inProgress";
  });
  const background = useApp((s) => (selectedId ? agentState(s.backgroundItems, hostId, selectedId) : undefined) ?? NO_ITEMS);
  return toolLiveness(item, turnRunning, background);
}

/**
 * A tool call a runtime safety check stopped (claude-safety-grants: the row's safety-block notice).
 * Not an error: the row reads 已拦截（安全检查） with the check's reason, no red ✕ / 失败.
 */
export interface ToolSafetyBlock {
  reason: string | null;
}

function ToolIcon({ item, liveness, blocked, approval, icon, failed, uncertain }: { item: RawItem; liveness: ReturnType<typeof toolLiveness>; blocked: boolean; approval: ReturnType<typeof approvalOutcome>; icon?: LucideIcon; failed: boolean; uncertain: boolean }) {
  if (liveness === "background") return <SquareTerminal size={13} className="text-accent" />;
  if (liveness === "interrupted") return <CircleStop size={13} className="text-subtle" />;
  if (isRunning(item)) return <Loader2 size={13} className="animate-spin text-accent" />;
  if (blocked) return <ShieldAlert size={13} className="text-warn-text" />;
  if (approval === "required") return <ShieldAlert size={13} className="text-warn-text" />;
  if (approval === "denied") return <ShieldX size={13} className="text-subtle" />;
  if (uncertain) return <CircleQuestionMark size={13} className="text-warn-text" />;
  if (failed) return <X size={13} className="text-danger" />;
  const Icon = icon ?? (item.type === "commandExecution" ? SquareTerminal : item.type === "fileChange" ? FilePen : item.type === "collabAgentToolCall" ? Bot : item.type === "webSearch" ? Globe : Wrench);
  return <Icon size={13} className="text-subtle" />;
}

export interface ToolPresentation { kind: string; key: MessageKey; detail: string; icon: LucideIcon; details: ReactNode; outcome?: TaskRowOutcome | null }

export function PlainToolRow({ item, safetyBlock = null, presentation }: { item: RawItem; safetyBlock?: ToolSafetyBlock | null; presentation?: ToolPresentation }) {
  const { t } = useI18n();
  const userToggle = useUserLayoutToggle();
  const conv = useConvScope();
  const [open, setOpen] = useState(false);
  const sidebar = useConvSidebar();
  const selectedId = useConvSession();
  const { key, detail } = presentation ?? toolLabel(item);
  const output = toolOutput(item);
  const scope = scopeFor(sidebar, selectedId);
  const root = scope ? rootFor(sidebar, scope) : null;
  const files = item.type === "fileChange" ? ((item.changes as { path: string }[] | undefined) ?? []).map((c) => ({ raw: c.path, link: parseFileLink(c.path, root) })) : [];
  const linked = files.flatMap((f) => (f.link ? [{ path: f.link.path }] : []));
  const liveness = useToolLiveness(item);
  const running = liveness === "running";
  const blocked = safetyBlock !== null && !running;
  const outcome = !blocked && !running ? presentation?.outcome : null;
  const uncertain = outcome?.kind === "uncertain";
  const failed = !blocked && (isFailed(item) || outcome?.kind === "failed");
  // A gated cutex call that answered approval_required / approval_denied: not a failure. The row says
  // 需要审批 / 已拒绝; the approvals module's line under it carries the request (no raw refusal line).
  const approval = blocked || running ? null : outcome?.kind === "approval" ? "required" : outcome?.kind === "declined" ? "denied" : approvalOutcome(item);
  // A failed MCP / dynamic tool call: its error text on a muted line, in full when expanded. A
  // safety-stopped call shows the check's reason there instead.
  const error = blocked ? (safetyBlock.reason?.trim() || null) : (failed || uncertain) && (item.type === "mcpToolCall" || item.type === "dynamicToolCall") ? ([outcome?.code, outcome?.detail].filter(Boolean).join(": ") || toolErrorText(item)) : null;
  // One line from the first render to the last (owner 2026-10-24: a running Edit showed ~5 lines of its diff, then
  // collapsed to one when done — the rows above jumped). The live state is inline: the spinner, a file change's
  // +/- counts (the same once done), a running command's newest output line; the rest is one click away.
  const counts = diffCounts(item);
  const lastLine = running && item.type === "commandExecution" && output ? (output.trimEnd().split("\n").pop()?.trim() ?? "") || null : null;
  return (
    <div className="my-0.5 min-w-0 max-w-full text-xs" data-tool-row={item.type} data-tool-view={presentation?.kind} onContextMenu={contextMenu(() => toolMenu(item, linked, t))}>
      {/* Failed (UI review #13): only the ✕ and 「失败」 are red; the rest of the row stays muted. */}
      <div className="flex min-w-0 max-w-full items-center gap-1.5 text-muted">
        <button aria-expanded={open} onClick={() => userToggle(() => setOpen(!open))} className="flex shrink-0 items-center gap-1.5 hover:text-foreground">
          <ToolIcon item={item} liveness={liveness} blocked={blocked} approval={approval} icon={presentation?.icon} failed={failed} uncertain={uncertain} />
          <span className="font-medium">{t(key)}</span>
          {presentation && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
        </button>
        {failed && <span className="shrink-0 text-danger">· {t(item.status === "declined" ? "tool.declined" : "taskrow.outcome.failed")}</span>}
        {uncertain && <span className="shrink-0 text-warn-text">· {t("taskrow.outcome.uncertain")}</span>}
        {approval === "required" && <span data-tool-approval="required" className="shrink-0 text-warn-text">· {t("tool.approvalRequired")}</span>}
        {approval === "denied" && <span data-tool-approval="denied" className="shrink-0 text-muted">· {t("tool.declined")}</span>}
        {blocked && <span data-tool-blocked className="shrink-0 text-muted">· {t("tool.safetyBlocked")}</span>}
        {liveness === "background" && (
          <button onClick={() => convSignal(conv, "ps")} title={t("tool.backgroundHint")} className="shrink-0 rounded bg-accent/10 px-1 text-caption/[inherit] text-accent hover:underline">
            {t("tool.background")}
          </button>
        )}
        {liveness === "interrupted" && <span className="shrink-0 text-caption/[inherit] text-subtle">{t("tool.interrupted")}</span>}
        {files.length > 0 ? (
          <span className="flex min-w-0 gap-2 truncate">
            {files.map((f) =>
              f.link ? (
                <button key={f.raw} onClick={(e) => void openPath(f.link!.path, null, "link", openModifiers(e))} onAuxClick={(e) => e.button === 1 && void openPath(f.link!.path, null, "link", openModifiers(e))} className="truncate font-mono text-subtle hover:text-accent hover:underline" title={f.raw}>
                  {f.link.path}
                </button>
              ) : (
                <code key={f.raw} className="truncate font-mono text-subtle">{f.raw}</code>
              ),
            )}
          </span>
        ) : (
          <code className="min-w-0 truncate font-mono text-subtle" title={detail}>{detail}</code>
        )}
        {counts && (
          <span data-tool-counts="" className="shrink-0 font-mono text-caption/[inherit] tabular-nums">
            <span className="text-ok">+{counts.added}</span> <span className="text-danger/80">−{counts.removed}</span>
          </span>
        )}
        {lastLine && !open && (
          <span data-tool-live="" title={lastLine} className="min-w-0 flex-1 truncate font-mono text-caption/[inherit] text-subtle">
            · {lastLine}
          </span>
        )}
        {failed && typeof item.exitCode === "number" && <span className="shrink-0 font-mono text-caption/[inherit] text-subtle">exit {item.exitCode}</span>}
        {typeof item.durationMs === "number" && !running && <span className="ml-auto shrink-0 text-caption/[inherit] text-subtle">{formatMs(item.durationMs)}</span>}
      </div>
      {error && !open && (
        <button onClick={() => userToggle(() => setOpen(true))} title={error} className="mt-0.5 ml-5 block max-w-[calc(100%-1.25rem)] truncate text-left font-mono text-caption/[inherit] text-muted hover:text-foreground">
          {error.replace(/\s+/g, " ")}
        </button>
      )}
      {/* Expanded, a safety-stopped call shows what the agent was told (the reason and the hint). */}
      {open && error && !blocked && <ToolErrorText text={error} className="mt-1 ml-5" />}
      {open && presentation && !blocked && <div className="mt-1 ml-5 min-w-0">{presentation.details}</div>}
      {open && (!presentation || blocked) && (blocked || !(error && output)) && (
        <pre className="mt-1 ml-5 max-h-72 overflow-auto rounded-md bg-surface p-2 font-mono text-caption/[inherit] whitespace-pre-wrap text-muted">{output ?? (approval ? toolErrorText(item) : null) ?? JSON.stringify(item, null, 2)}</pre>
      )}
    </div>
  );
}
