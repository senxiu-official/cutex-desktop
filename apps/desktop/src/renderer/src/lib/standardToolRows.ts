// Read-only projections of common tool calls. Match structured identity/actions, never shell text.
import type { RawItem } from "./timeline";
import { operationToolRow } from "./operationToolRows";
import type { TaskRowOutcome } from "./taskRows";
import { toolArgs, toolResult } from "./taskRows";

export type StandardToolKind = "read" | "search" | "tools" | "agents" | "memberRuntime" | "taskStop" | "artifactRead" | "actionStatus";
export interface StandardToolModel {
  kind: StandardToolKind;
  operation?: "online" | "offline" | "restart";
  state?: "running" | "completed" | "failed" | "awaitingApproval" | "unknown" | "notFound";
  outcome?: TaskRowOutcome | null;
  body?: string | null;
  resultFields?: { name: string; value: string }[];
  summary: string;
  fields: { name: string; value: string }[];
  agentCount: number | null;
  agents: { id: string; name: string; status: string | null }[];
  /** Delegation notices waiting for this agent (`pending_notices` of a newer agent_list); absent on older hosts. */
  pendingNotices?: PendingNotices | null;
}
export type PendingNoticeKind = "answer" | "question" | "state";
export interface PendingNotices {
  total: number;
  counts: Record<PendingNoticeKind, number>;
  entries: { id: string; delegation: string; kind: PendingNoticeKind | null; title: string }[];
  more: boolean;
}
const record = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown): string | null => typeof v === "string" && v.trim() ? v : null;

export function standardToolRow(item: RawItem): StandardToolModel | null {
  const operation = operationToolRow(item);
  if (operation) return operation;
  const a = toolArgs(item);
  let kind: StandardToolKind;
  let summary: string | null = null;
  let fields: StandardToolModel["fields"] = [];
  if (item.type === "commandExecution") {
    // A mixed/unknown shell command stays generic; do not hide its other effects behind "Read".
    const actions = Array.isArray(item.commandActions) ? item.commandActions : [];
    const action = actions.length === 1 ? record(actions[0]) : null;
    if (!action || !["read", "search", "listFiles"].includes(String(action.type))) return null;
    kind = action.type === "read" ? "read" : "search";
    summary = kind === "read" ? text(action.path) ?? text(action.name) : text(action.query) ?? text(action.path);
    if (!summary) return null;
    if (kind === "search" && text(action.query) && text(action.path)) summary = `${action.query} · ${action.path}`;
    fields = [{ name: "command", value: text(item.command) ?? text(action.command) ?? "" }, ...["path", "query"].flatMap(name => text(action[name]) ? [{ name, value: action[name] as string }] : [])];
  } else if (item.type === "dynamicToolCall" && item.namespace === "claude" && ["Read", "Grep", "Glob", "ToolSearch"].includes(String(item.tool))) {
    kind = item.tool === "Read" ? "read" : item.tool === "ToolSearch" ? "tools" : "search";
    summary = text(a.file_path) ?? text(a.pattern) ?? text(a.query) ?? text(a.path);
    if (!summary) return null;
    if (kind === "search" && text(a.pattern) && text(a.path)) summary = `${a.pattern} · ${a.path}`;
    if (kind === "read" && typeof a.offset === "number" && Number.isFinite(a.offset)) summary += `:${a.offset}`;
    fields = Object.entries(a).map(([name, value]) => ({ name, value: typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value) }));
  } else if ((item.type === "mcpToolCall" && item.server === "cutex" || item.type === "dynamicToolCall" && (item.namespace === "cutex" || item.namespace === "claude")) && (item.tool === "agent_list" || item.tool === "cutex_agent_list")) {
    kind = "agents";
    summary = text(a.host);
    fields = ["host", "limit", "cursor", "include_offline"].flatMap(name => {
      const v = a[name];
      return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? [{ name, value: String(v) }] : [];
    });
  } else return null;
  const result = kind === "agents" ? toolResult(item) ?? dynamicResult(item) : null;
  const agents = Array.isArray(result?.agents) ? result.agents.flatMap(v => {
    const agent = record(v);
    const id = text(agent?.id);
    return agent && id ? [{ id, name: text(agent.name) ?? id, status: text(agent.status) }] : [];
  }) : [];
  return { kind, summary: summary ?? "", fields, agents, agentCount: Array.isArray(result?.agents) ? agents.length : null, pendingNotices: pendingNoticesOf(result) };
}

function pendingNoticesOf(result: Record<string, unknown> | null): PendingNotices | null {
  const p = record(result?.pending_notices);
  if (!p || typeof p.total !== "number" || p.total <= 0) return null;
  const counts = record(p.counts);
  const count = (k: PendingNoticeKind) => typeof counts?.[k] === "number" ? counts[k] as number : 0;
  const entries = Array.isArray(p.entries) ? p.entries.flatMap((v, i) => {
    const e = record(v);
    const delegation = text(e?.delegation);
    if (!e || !delegation) return [];
    const kind: PendingNoticeKind | null = e.kind === "answer" || e.kind === "question" || e.kind === "state" ? e.kind : null;
    return [{ id: text(e.delivery_id) ?? `${delegation}:${i}`, delegation, kind, title: text(e.title) ?? delegation }];
  }) : [];
  return { total: p.total, counts: { answer: count("answer"), question: count("question"), state: count("state") }, entries, more: p.more === true };
}

function dynamicResult(item: RawItem): Record<string, unknown> | null {
  if (!Array.isArray(item.contentItems)) return null;
  const texts = item.contentItems.filter(v => record(v)?.type === "inputText");
  if (texts.length !== 1) return null;
  try { return record(JSON.parse(String(record(texts[0])?.text))); } catch { return null; }
}
