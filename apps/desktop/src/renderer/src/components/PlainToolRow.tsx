// Core tool fallback: always available even when a specialized module is disabled.
import { openModifiers } from "../lib/openModifiers";
import { useState } from "react";
import { Bot, ChevronDown, ChevronRight, CircleStop, FilePen, Globe, Loader2, SquareTerminal, Wrench, X } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { contextMenu } from "../lib/contextMenu";
import { toolMenu } from "../lib/menus";
import type { RawItem } from "../lib/timeline";
import { isFailed, isRunning, toolDetail, toolLiveness, toolOutput } from "../lib/workGroups";
import { parseFileLink, rootFor, scopeFor } from "../lib/workspace";
import { selectedSidebar, useApp } from "../store";
import { toolErrorText } from "../lib/taskRows";
import { ToolErrorText } from "./ToolErrorText";
import { openFile } from "../lib/sideOpen";

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

/** toolLiveness for a row of the selected agent's timeline (subagent rows: "running" as before). */
function useToolLiveness(item: RawItem) {
  const selectedId = useApp((s) => s.selectedId);
  const turnRunning = useApp((s) => {
    const tl = selectedId ? s.sessions[selectedId]?.timeline : undefined;
    const entry = tl?.entries.get(item.id);
    const turn = entry?.turnId ? tl!.turns.find((x) => x.id === entry.turnId) : undefined;
    return !turn || turn.status === "inProgress";
  });
  const background = useApp((s) => (selectedId ? s.backgroundItems[selectedId] : undefined) ?? NO_ITEMS);
  return toolLiveness(item, turnRunning, background);
}

function ToolIcon({ item, liveness }: { item: RawItem; liveness: ReturnType<typeof toolLiveness> }) {
  if (liveness === "background") return <SquareTerminal size={13} className="text-accent" />;
  if (liveness === "interrupted") return <CircleStop size={13} className="text-subtle" />;
  if (isRunning(item)) return <Loader2 size={13} className="animate-spin text-accent" />;
  if (isFailed(item)) return <X size={13} className="text-danger" />;
  const Icon = item.type === "commandExecution" ? SquareTerminal : item.type === "fileChange" ? FilePen : item.type === "collabAgentToolCall" ? Bot : item.type === "webSearch" ? Globe : Wrench;
  return <Icon size={13} className="text-subtle" />;
}

export function PlainToolRow({ item }: { item: RawItem }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const sidebar = useApp(selectedSidebar);
  const selectedId = useApp((s) => s.selectedId);
  const { key, detail } = toolLabel(item);
  const output = toolOutput(item);
  const scope = scopeFor(sidebar, selectedId);
  const root = scope ? rootFor(sidebar, scope) : null;
  const files = item.type === "fileChange" ? ((item.changes as { path: string }[] | undefined) ?? []).map((c) => ({ raw: c.path, link: parseFileLink(c.path, root) })) : [];
  const linked = files.flatMap((f) => (f.link ? [{ path: f.link.path }] : []));
  const liveness = useToolLiveness(item);
  const running = liveness === "running";
  const failed = isFailed(item);
  // A failed MCP / dynamic tool call: its error text on a muted line, in full when expanded.
  const error = failed && (item.type === "mcpToolCall" || item.type === "dynamicToolCall") ? toolErrorText(item) : null;
  // A running command shows its newest output lines without expanding.
  const tail = running && output ? output.trimEnd().split("\n").slice(-3).join("\n") : null;
  return (
    <div className="my-0.5 text-xs" onContextMenu={contextMenu(() => toolMenu(item, linked, t))}>
      {/* Failed (UI review #13): only the ✕ and 「失败」 are red; the rest of the row stays muted. */}
      <div className="flex max-w-full items-center gap-1.5 text-muted">
        <button onClick={() => setOpen(!open)} className="flex shrink-0 items-center gap-1.5 hover:text-foreground">
          <ToolIcon item={item} liveness={liveness} />
          <span className="font-medium">{t(key)}</span>
        </button>
        {failed && <span className="shrink-0 text-danger">· {t("taskrow.outcome.failed")}</span>}
        {liveness === "background" && (
          <button onClick={() => useApp.getState().signal("ps")} title={t("tool.backgroundHint")} className="shrink-0 rounded bg-accent/10 px-1 text-[11px] text-accent hover:underline">
            {t("tool.background")}
          </button>
        )}
        {liveness === "interrupted" && <span className="shrink-0 text-[11px] text-subtle">{t("tool.interrupted")}</span>}
        {files.length > 0 ? (
          <span className="flex min-w-0 gap-2 truncate">
            {files.map((f) =>
              f.link ? (
                <button key={f.raw} onClick={(e) => void openFile(f.link!.path, null, "link", openModifiers(e))} onAuxClick={(e) => e.button === 1 && void openFile(f.link!.path, null, "link", openModifiers(e))} className="truncate font-mono text-subtle hover:text-accent hover:underline" title={f.raw}>
                  {f.link.path}
                </button>
              ) : (
                <code key={f.raw} className="truncate font-mono text-subtle">{f.raw}</code>
              ),
            )}
          </span>
        ) : (
          <code className="min-w-0 truncate font-mono text-subtle">{detail}</code>
        )}
        {failed && typeof item.exitCode === "number" && <span className="shrink-0 font-mono text-[11px] text-subtle">exit {item.exitCode}</span>}
        {typeof item.durationMs === "number" && !running && <span className="ml-auto shrink-0 text-[11px] text-subtle">{formatMs(item.durationMs)}</span>}
      </div>
      {tail && !open && <pre className="mt-0.5 ml-5 overflow-hidden font-mono text-[11px] whitespace-pre-wrap text-subtle">{tail}</pre>}
      {error && !open && (
        <button onClick={() => setOpen(true)} title={error} className="mt-0.5 ml-5 block max-w-[calc(100%-1.25rem)] truncate text-left font-mono text-[11px] text-muted hover:text-foreground">
          {error.replace(/\s+/g, " ")}
        </button>
      )}
      {open && error && <ToolErrorText text={error} className="mt-1 ml-5" />}
      {open && !(error && output) && (
        <pre className="mt-1 ml-5 max-h-72 overflow-auto rounded-md bg-surface p-2 font-mono text-[11px] whitespace-pre-wrap text-muted">{output ?? JSON.stringify(item, null, 2)}</pre>
      )}
    </div>
  );
}

