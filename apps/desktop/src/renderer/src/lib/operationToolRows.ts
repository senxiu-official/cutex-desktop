// Transcript projections only: never launch/retry/stop a task or resolve current host state.
import type { RawItem } from "./timeline";
import type { StandardToolModel } from "./standardToolRows";
import { taskRowOutcome, toolArgs, toolResult } from "./taskRows";
import { toolOutput } from "./workGroups";

const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const str = (v: unknown): string | null => typeof v === "string" && v.trim() ? v : null;
const fields = (v: Record<string, unknown>) => Object.entries(v).map(([name, value]) => ({ name, value: typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value) }));
const states = ["running", "completed", "failed", "awaitingApproval", "unknown", "notFound"] as const;

function resultOf(item: RawItem): Record<string, unknown> | null {
  const result = toolResult(item);
  if (result) return result;
  const output = toolOutput(item);
  if (!output) return null;
  try { return object(JSON.parse(output)); } catch { return null; }
}
export function operationToolRow(item: RawItem): StandardToolModel | null {
  const native = item.type === "dynamicToolCall" && item.namespace === "claude";
  const cutex = item.type === "mcpToolCall" && item.server === "cutex" || item.type === "dynamicToolCall" && (item.namespace === "cutex" || native);
  const tool = item.tool;
  if (!(native && tool === "TaskStop") && !(cutex && ["member_runtime", "artifact_read", "action_status"].includes(String(tool)))) return null;
  const a = toolArgs(item);
  const result = resultOf(item);
  const base = { fields: fields(a), agents: [], agentCount: null, outcome: taskRowOutcome(item) ?? (result ? taskRowOutcome({ ...item, result: { structuredContent: result } }) : null) };
  if (native && tool === "TaskStop") {
    const id = str(a.task_id) ?? str(a.shell_id);
    return id ? { ...base, kind: "taskStop", summary: id } : null;
  }
  if (tool === "member_runtime") {
    const id = str(a.cutex_session_id);
    const operation = a.change;
    if (!id || (operation !== "online" && operation !== "offline" && operation !== "restart")) return null;
    return { ...base, kind: "memberRuntime", summary: id, operation };
  }
  if (tool === "artifact_read") {
    const ref = str(a.ref);
    if (!ref) return null;
    const offset = typeof a.cursor === "number" && Number.isSafeInteger(a.cursor) && a.cursor >= 0 ? ` · cursor=${a.cursor}` : "";
    const metadata = result?.ok === true ? Object.fromEntries(["name", "ref", "version", "media_type", "bytes", "cursor", "next_cursor", "detail"].filter(k => k in result).map(k => [k, result[k]])) : {};
    return { ...base, kind: "artifactRead", summary: ref + offset, resultFields: fields(metadata), body: result?.ok === true && typeof result.text === "string" ? result.text : null };
  }
  const action = str(a.action_id), operation = str(a.tool);
  if (!action || !operation) return null;
  // A receipt's state is meaningful only for this exact query. Completion is of the tool call,
  // never proof that delegated work finished; unknown/notFound never proves no execution.
  const matching = result?.schema === "cutex.tool-action-receipt.v1" && result.ok === true && result.action_id === action && result.tool === operation;
  const state = matching ? states.find(s => s === result.status) : undefined;
  return { ...base, kind: "actionStatus", summary: `${operation} · ${action}`, state };
}
