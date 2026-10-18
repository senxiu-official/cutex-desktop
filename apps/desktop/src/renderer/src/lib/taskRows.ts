// Task rows in the conversation (DESIGN §4.18): cutex task-service tool calls, delegation (委托)
// tool calls and task deliveries rendered as one mechanical line — verb, [avatar] counterpart,
// colored #N, title.
import { onHostSwitch } from "./hostSwitch";
import { findById, isSessionRef } from "./shortIds";
import type { ExternalMessage, RawItem } from "./timeline";

/** Removed task-service tools; still rendered for old transcripts. */
export const TASK_TOOLS = {
  director: "cutex_task_service_director",
  worker: "cutex_task_service",
  terminal: "cutex_task_service_terminal",
  read: "cutex_task_service_read",
} as const;

/**
 * Delegation / agent tools: current name → verb, plus the names older transcripts carry
 * (agent_ask, agent_wait, ask_close, ask_read, agent_reply, agent_respond, set_alarm,
 * cutex_agent_management, document_read). Close-type tools pick their verb from `outcome`.
 */
const AGENT_TOOL_VERB: Record<string, TaskVerb | "close" | "management"> = {
  agent_delegate: "delegate",
  agent_ask: "delegate",
  delegation_wait: "delegationWait",
  agent_wait: "delegationWait",
  delegation_stop: "delegationStop",
  delegation_close: "close",
  ask_close: "close",
  delegation_read: "delegationRead",
  ask_read: "delegationRead",
  read_overlength_content: "overlengthRead",
  document_read: "overlengthRead",
  delegation_progress: "delegationProgress",
  agent_reply: "delegationProgress",
  question_answer: "questionAnswer",
  agent_respond: "questionAnswer",
  agent_tell: "tell",
  alarm_set: "alarmSet",
  set_alarm: "alarmSet",
  agent_create: "agentCreate",
  agent_archive: "agentArchive",
  cutex_agent_management: "management",
};

/** i18n key suffix under `taskrow.` for each operation. */
export type TaskVerb =
  | "assign"
  | "createRevision"
  | "query"
  | "accept"
  | "requestChanges"
  | "fail"
  | "cancel"
  | "start"
  | "report"
  | "block"
  | "resume"
  | "submit"
  | "decline"
  | "abort"
  | "read"
  | "received"
  | "changesRequested"
  | "delegate"
  | "delegationWait"
  | "delegationStop"
  | "delegationClose"
  | "delegationAccept"
  | "delegationAbandon"
  | "delegationRead"
  | "overlengthRead"
  | "delegationProgress"
  | "questionAnswer"
  | "tell"
  | "alarmSet"
  | "agentCreate"
  | "agentArchive";

export interface TaskRowModel {
  verb: TaskVerb;
  /** The other party: assignee for Director actions, coordinator for deliveries. */
  counterpartId: string | null;
  counterpartName: string | null;
  taskId: string | null;
  assignmentId: string | null;
  /** Title / summary / decision text shown after the tag. */
  text: string | null;
  /** Shown only when the row is expanded (e.g. what a delegation wait received). */
  detail?: string | null;
  /** Set when the call did not simply succeed (refused, failed, uncertain, awaiting the owner). */
  outcome?: TaskRowOutcome | null;
}

/**
 * How a cutex tool call ended when it did not plainly succeed. cutex refusals come back as MCP
 * `isError` and/or a body with `ok: false`, `status` (no_write | response_uncertain |
 * approval_required | conflict), `code` and `detail`.
 */
export interface TaskRowOutcome {
  kind: "failed" | "uncertain" | "approval" | "declined";
  code: string | null;
  detail: string | null;
}

const DIRECTOR_VERB: Record<string, TaskVerb> = {
  create_and_assign: "assign",
  assign: "assign",
  create_revision: "createRevision",
  query: "query",
  accept_result: "accept",
  request_changes: "requestChanges",
  fail_result: "fail",
  cancel: "cancel",
};

const WORKER_VERB: Record<string, TaskVerb> = {
  start: "start",
  report_status: "report",
  block: "block",
  resume: "resume",
  submit: "submit",
  decline: "decline",
  abort_attempt: "abort",
};

const assignmentTasks = new Map<string, string>();
const assignmentAssignees = new Map<string, string>();
/** delegation id → its title (or brief), learned from the delegate call. */
const delegations = new Map<string, string>();
onHostSwitch(() => {
  assignmentTasks.clear();
  assignmentAssignees.clear();
  delegations.clear();
});

/** Remember assignment → task so worker rows (which only carry assignment_id) get the task's #N. */
export function rememberAssignment(assignmentId: string | null | undefined, taskId: string | null | undefined): void {
  if (assignmentId && taskId) assignmentTasks.set(assignmentId, taskId);
}

export function taskIdForAssignment(assignmentId: string | null): string | null {
  return assignmentId ? (assignmentTasks.get(assignmentId) ?? null) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function args(item: RawItem): Record<string, unknown> {
  const raw = item.arguments;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // not JSON
    }
  }
  return {};
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The tool's JSON result object (structuredContent, else the single text block), if any. */
function result(item: RawItem): Record<string, unknown> | null {
  const r = obj(item.result);
  if (!r) return null;
  const structured = obj(r.structuredContent);
  if (structured) return structured;
  const first = Array.isArray(r.content) ? obj(r.content[0]) : null;
  if (typeof first?.text !== "string") return null;
  try {
    return obj(JSON.parse(first.text));
  } catch {
    return null;
  }
}

/**
 * An agent reference is a cutex session id or a unique name. The id may be the short form tool
 * results carry since cutex task 06 (`cutex.…3f9a1c`); `<Who>` resolves it against the sidebar.
 */
function party(ref: string | null): { id: string | null; name: string | null } {
  if (!ref) return { id: null, name: null };
  return isSessionRef(ref) ? { id: ref, name: null } : { id: null, name: ref };
}

/**
 * The delegation id a tool result object carries: `delegation` since cutex prompt revision A8
 * (117b2c8, value `delegation-<hex>`), `delegation_id` before, `ask_id` on the oldest daemons.
 */
export function resultDelegationId(r: Record<string, unknown> | null | undefined): string | null {
  return r ? (str(r.delegation) ?? str(r.delegation_id) ?? str(r.ask_id)) : null;
}

function delegationId(a: Record<string, unknown>, r: Record<string, unknown> | null): string | null {
  return str(a.delegation) ?? str(a.delegation_id) ?? str(a.ask) ?? str(a.ask_id) ?? resultDelegationId(r);
}

/** The delegation's title; `id` may be full or short (the delegate result and later calls can differ). */
function delegationLabel(id: string | null): string | null {
  return id ? (findById(delegations, id) ?? id) : null;
}

function row(verb: TaskVerb, who: { id: string | null; name: string | null }, text: string | null): TaskRowModel {
  return { verb, counterpartId: who.id, counterpartName: who.name, taskId: null, assignmentId: null, text };
}

/** Delegation, note, alarm and agent-lifecycle calls (new and old tool names). */
function agentToolRow(item: RawItem, tool: string, a: Record<string, unknown>): TaskRowModel | null {
  const kind = AGENT_TOOL_VERB[tool];
  const r = result(item);
  const none = { id: null, name: null };
  switch (kind) {
    case "delegate": {
      const target = party(str(a.target));
      const who = { id: str(r?.target_id) ?? target.id, name: str(r?.target) ?? target.name };
      const title = str(a.title) ?? str(r?.title);
      const brief = str(a.text);
      const id = resultDelegationId(r);
      const label = title ?? brief;
      if (id && label) delegations.set(id, label);
      return row("delegate", who, [title, brief].filter(Boolean).join("\n\n") || null);
    }
    case "delegationWait": {
      const list = a.delegations ?? a.asks;
      const ids = Array.isArray(list) ? list.map(str).filter((x): x is string => !!x) : [];
      // Answers that arrived in this wait are the row's text (expand to read them).
      const results = r?.results;
      const answers = (Array.isArray(results) ? results : []).flatMap((entry) => {
        const e = obj(entry);
        const answer = str(e?.answer);
        if (!e || !answer) return [];
        const label = str(e.title) ?? delegationLabel(resultDelegationId(e));
        return [label ? `${label}: ${answer}` : answer];
      });
      // The line only says it waited (the delegation card shows the result); expanding shows what came.
      return { ...row("delegationWait", none, null), detail: answers.join("\n\n") || ids.map(delegationLabel).join(", ") || null };
    }
    case "close": {
      const outcome = str(a.outcome);
      const verb: TaskVerb = outcome === "stop" ? "delegationStop" : outcome === "accepted" ? "delegationAccept" : outcome === "abandoned" ? "delegationAbandon" : "delegationClose";
      return row(verb, none, delegationLabel(delegationId(a, r)));
    }
    case "delegationStop":
      return row(kind, none, delegationLabel(delegationId(a, r)));
    case "overlengthRead":
      // The full text of an overlength message (doc- id; r214 name document_read).
      return row(kind, none, str(r?.text) ?? str(a.id) ?? str(a.document_id));
    case "delegationRead":
      return row(kind, none, str(r?.text) ?? delegationLabel(delegationId(a, r)));
    case "delegationProgress":
      return row(kind, none, str(a.text) ?? delegationLabel(delegationId(a, r)));
    case "questionAnswer": {
      const answers = Object.values(obj(a.answers) ?? {}).flatMap((entry) => {
        const list = obj(entry)?.answers;
        return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
      });
      return row(kind, none, answers.join("; ") || null);
    }
    case "tell": {
      const to = party(str(a.to));
      const sent = party(str(r?.to));
      return row(kind, { id: sent.id ?? to.id, name: str(r?.name) ?? to.name }, str(a.text));
    }
    case "alarmSet": {
      const at = str(a.at);
      const message = str(a.message);
      return row(kind, party(str(a.to)), at && message ? `${at} · ${message}` : message);
    }
    case "agentCreate": {
      const name = str(a.name) ?? str(obj(a.spec)?.name);
      // Management receipt: outcome.receipt.result.agent (older bodies: a flat cutex_session_id).
      const created = obj(obj(obj(r?.outcome)?.receipt)?.result);
      const agent = obj(created?.agent);
      // agent-create-task-delegation: the task went to the new agent as a delegation; remember its id
      // so later delegation_* rows show the task instead of a bare id.
      const task = str(a.task);
      const delegation = str(obj(created?.delegation)?.delegation);
      if (delegation && task) delegations.set(delegation, task);
      return row(kind, { id: str(agent?.cutex_session_id) ?? str(r?.cutex_session_id), name }, task);
    }
    case "agentArchive":
      return row(kind, party(str(a.agent) ?? str(a.cutex_session_id) ?? str(a.target) ?? str(a.name)), null);
    case "management": {
      const op = str(a.operation);
      if (op === "create") return row("agentCreate", { id: null, name: str(obj(a.spec)?.name) }, null);
      if (op === "close") return row("agentArchive", party(str(a.cutex_session_id)), null);
      return null;
    }
    default:
      return null;
  }
}

/**
 * The refusal / failure / uncertainty a cutex tool result reports, or null when it succeeded.
 * Bus tools answer `{ok: false, status, code, detail}`. The Management tools (agent_create,
 * agent_archive, member_runtime, member_replace, director_rotate) answer their own envelope:
 * `{schema, action_id, outcome}` with outcome `{status: "no_write", code, detail}`,
 * `{status: "owner_action_required", failure: {code, detail, …}}` or `{status: "complete", receipt}`.
 */
export function taskRowOutcome(item: RawItem): TaskRowOutcome | null {
  const raw = obj(item.result);
  const r = result(item);
  const envelope = obj(r?.outcome);
  const failure = obj(envelope?.failure);
  const error = r?.error;
  const status = str(envelope?.status) ?? str(r?.status);
  const state = str(r?.state);
  const code = str(failure?.code) ?? str(envelope?.code) ?? str(r?.code) ?? str(obj(error)?.code);
  // A plain-text (non-JSON) error body is the detail itself.
  const first = Array.isArray(raw?.content) ? obj(raw.content[0]) : null;
  const plain = !r && typeof first?.text === "string" ? str(first.text) : null;
  // The item-level error comes last: the Claude adapter's is always "Cutex tool returned an error".
  const detail =
    str(failure?.detail) ?? str(envelope?.detail) ?? str(r?.detail) ?? str(r?.message) ?? str(error) ?? str(obj(error)?.message) ?? plain ?? str(obj(item.error)?.message);
  if (status === "approval_required" || state === "pendingReview") return { kind: "approval", code, detail };
  // The owner turned the request down: declined, not a failure of the call.
  if (status === "approval_denied" || code === "approval_denied") return { kind: "declined", code, detail };
  // Management reports an unknown outcome as no_write with code response_uncertain.
  if (status === "response_uncertain" || (envelope && code === "response_uncertain")) return { kind: "uncertain", code, detail };
  const itemStatus = item.status;
  const refused = status === "no_write" || status === "owner_action_required";
  if (refused || r?.ok === false || raw?.isError === true || itemStatus === "failed" || itemStatus === "errored" || itemStatus === "declined") return { kind: "failed", code, detail };
  return null;
}

/**
 * The full text a failed tool call returned (its text content blocks, else the item-level error
 * message), for the expanded row and copying; null when the call didn't fail or said nothing.
 */
export function toolErrorText(item: RawItem): string | null {
  const raw = obj(item.result);
  const blocks = Array.isArray(raw?.content) ? raw.content.map(obj).filter((b) => typeof b?.text === "string").map((b) => b!.text as string) : [];
  const structured = obj(raw?.structuredContent);
  // Dynamic tool calls (Claude agents' other tools) carry their text in contentItems.
  const items = Array.isArray(item.contentItems) ? item.contentItems.map(obj).filter((c) => typeof c?.text === "string").map((c) => c!.text as string) : [];
  const body = blocks.join("\n").trim() || (structured ? JSON.stringify(structured) : "") || items.join("\n").trim();
  // The item-level message only when the body is empty (the Claude adapter's is generic).
  const text = body || str(obj(item.error)?.message) || str(item.error);
  return text ? prettyJson(text) : null;
}

/** A pretty-printed JSON body (one line in → indented out); other text unchanged. */
function prettyJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}

/** Cheap and pure renderer matching: parsing a row can populate transcript lookup caches. */
export function isTaskServiceTool(item: RawItem): boolean {
  return item.type === "mcpToolCall" && item.server === "cutex" && Object.values(TASK_TOOLS).some((name) => name === item.tool);
}

export function isAgentTaskTool(item: RawItem): boolean {
  return item.type === "mcpToolCall" && item.server === "cutex" && typeof item.tool === "string" && Object.prototype.hasOwnProperty.call(AGENT_TOOL_VERB, item.tool);
}

/** A cutex task-service or delegation tool call, or null for any other item. */
export function taskToolRow(item: RawItem): TaskRowModel | null {
  const model = taskToolRowBase(item);
  return model ? { ...model, outcome: taskRowOutcome(item) } : null;
}

function taskToolRowBase(item: RawItem): TaskRowModel | null {
  if (item.type !== "mcpToolCall" || item.server !== "cutex") return null;
  const tool = String(item.tool ?? "");
  const a = args(item);
  if (Object.prototype.hasOwnProperty.call(AGENT_TOOL_VERB, tool)) return agentToolRow(item, tool, a);
  const op = str(a.operation) ?? "";
  const assignmentId = str(a.assignment_id) ?? str((a.selector as Record<string, unknown> | undefined)?.assignment_id);
  let verb: TaskVerb | undefined;
  if (tool === TASK_TOOLS.director || tool === TASK_TOOLS.terminal) verb = DIRECTOR_VERB[op];
  else if (tool === TASK_TOOLS.worker) verb = WORKER_VERB[op];
  else if (tool === TASK_TOOLS.read) verb = "read";
  if (!verb) return null;
  const taskId = str(a.task_id) ?? str((a.selector as Record<string, unknown> | undefined)?.task_id) ?? taskIdForAssignment(assignmentId);
  rememberAssignment(assignmentId, taskId);
  const assignee = str(a.assignee_cutex_session_id);
  if (assignmentId && assignee) assignmentAssignees.set(assignmentId, assignee);
  return {
    verb,
    // Decisions carry only the assignment id; reuse the assignee seen when it was assigned.
    counterpartId: assignee ?? (assignmentId ? (assignmentAssignees.get(assignmentId) ?? null) : null),
    counterpartName: null,
    taskId,
    assignmentId,
    text: str(a.summary) ?? str(a.decision_reference) ?? str(a.result_reference),
  };
}

/** A tool call's arguments / JSON result object (shared with lib/delegations). */
export { args as toolArgs, result as toolResult };

/** A task assignment / follow-up delivered to this agent (cutex.task-*.v1 views), or null. */
export function taskDeliveryRow(message: ExternalMessage): TaskRowModel | null {
  if (message.schema !== "cutex.task-assignment.v1" && message.schema !== "cutex.task-followup.v1") return null;
  const d = message.data;
  const assignmentId = str(d.assignmentId);
  const taskId = str(d.taskId);
  rememberAssignment(assignmentId, taskId);
  return {
    verb: message.schema === "cutex.task-assignment.v1" ? "received" : "changesRequested",
    counterpartId: str(d.coordinatorCutexSessionId),
    counterpartName: str(d.coordinatorName),
    taskId,
    assignmentId,
    text: str(d.title) ?? str(d.decisionReference),
  };
}
