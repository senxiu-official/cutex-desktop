// Maps pending cute-codex server→client requests to UI models and builds their reply payloads.
// Reply shapes follow the generated v2 protocol types.
import type {
  CommandExecutionApprovalDecision,
  CommandExecutionRequestApprovalParams,
  FileChangeApprovalDecision,
  FileChangeRequestApprovalParams,
  McpServerElicitationRequestParams,
  McpServerElicitationRequestResponse,
  PermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse,
  ToolRequestUserInputParams,
  ToolRequestUserInputQuestion,
  ToolRequestUserInputResponse,
} from "@cutex-desktop/protocol/codex/v2";

export interface PendingRequest {
  id: string | number;
  method: string;
  params: unknown;
}

export type ChoiceTone = "primary" | "neutral" | "danger";

export interface Choice {
  /** i18n key suffix under `interaction.choice.*`, or a literal label when `literal` is set. */
  label: string;
  literal?: boolean;
  tone: ChoiceTone;
  result: unknown;
  /** Shown under the label (mono): e.g. the Claude permission rules an "always allow" choice keeps. */
  detail?: string;
}

export type InteractionModel =
  | {
      kind: "approval";
      request: PendingRequest;
      /** i18n key under `interaction.title.*` */
      title: "command" | "stdin" | "fileChange" | "permissions";
      reason: string | null;
      /** Main thing being approved (command line, root path, permission JSON). */
      subject: string | null;
      cwd: string | null;
      choices: Choice[];
      /** Index of the choice Esc picks: decline, else cancel; null = Esc does not answer (never an approving choice). */
      cancelIndex: number | null;
    }
  | { kind: "questions"; request: PendingRequest; questions: ToolRequestUserInputQuestion[]; blocking: boolean }
  | { kind: "elicitation"; request: PendingRequest; params: McpServerElicitationRequestParams }
  | { kind: "unknown"; request: PendingRequest };

const COMMAND_LABEL: Record<string, { label: string; tone: ChoiceTone }> = {
  accept: { label: "accept", tone: "primary" },
  acceptForSession: { label: "acceptForSession", tone: "neutral" },
  decline: { label: "decline", tone: "danger" },
  cancel: { label: "cancel", tone: "neutral" },
};

/**
 * Claude "always allow in this project" (cutex `claude-permission-rules`): the adapter offers Claude
 * permission rules (`claudePermissionRules`) and the decision `{acceptWithClaudeRules: {rules}}`; cutex
 * keeps the rules for the agent's workspace (never in the repo) and the session allows them at once.
 */
export const CLAUDE_RULE_DECISION = "acceptWithClaudeRules";

function claudeRulesOf(params: unknown): string[] {
  const rules = (params as { claudePermissionRules?: unknown } | null)?.claudePermissionRules;
  return Array.isArray(rules) ? rules.filter((r): r is string => typeof r === "string" && r.length > 0) : [];
}

function claudeRuleChoice(rules: string[]): Choice {
  return { label: "acceptForProject", tone: "neutral", detail: rules.join("\n"), result: { decision: { [CLAUDE_RULE_DECISION]: { rules } } } };
}

function decisionChoice(decision: CommandExecutionApprovalDecision | FileChangeApprovalDecision): Choice | null {
  if (typeof decision === "object" && decision !== null && CLAUDE_RULE_DECISION in decision) {
    const kept = claudeRulesOf({ claudePermissionRules: (decision as unknown as Record<string, { rules?: unknown }>)[CLAUDE_RULE_DECISION]?.rules });
    return kept.length ? claudeRuleChoice(kept) : null;
  }
  if (typeof decision === "string") {
    const meta = COMMAND_LABEL[decision];
    return meta ? { ...meta, result: { decision } } : null;
  }
  if ("acceptWithExecpolicyAmendment" in decision) {
    return { label: "acceptAndRemember", tone: "neutral", result: { decision } };
  }
  if ("applyNetworkPolicyAmendment" in decision) {
    return { label: "allowNetwork", tone: "neutral", result: { decision } };
  }
  return null;
}

/**
 * Esc answers with `decline`, else `cancel` (declines and ends the turn). The server's list may hold
 * neither (`["accept"]`, an execpolicy / network amendment only): then Esc must not answer at all —
 * falling back to some other choice could approve.
 */
function withCancel(choices: Choice[]): { choices: Choice[]; cancelIndex: number | null } {
  for (const safe of ["decline", "cancel"]) {
    const index = choices.findIndex((c) => (c.result as { decision?: unknown }).decision === safe);
    if (index >= 0) return { choices, cancelIndex: index };
  }
  return { choices, cancelIndex: null };
}

/** What a key does on an approval card: answer with a choice, move the highlight, or nothing (null). */
export type ApprovalKeyAction = { pick: number } | { select: number } | null;

export function approvalKeyAction(
  key: string,
  shift: boolean,
  model: { choices: readonly unknown[]; cancelIndex: number | null },
  selected: number,
): ApprovalKeyAction {
  const count = model.choices.length;
  if (count === 0) return null;
  const n = Number(key);
  if (Number.isInteger(n) && n >= 1 && n <= count) return { pick: n - 1 };
  if (key === "ArrowDown" || (key === "Tab" && !shift)) return { select: (selected + 1) % count };
  if (key === "ArrowUp" || (key === "Tab" && shift)) return { select: (selected - 1 + count) % count };
  if (key === "Enter") return { pick: selected };
  // Esc only ever declines / cancels; with neither on offer it does nothing (never approves).
  if (key === "Escape") return model.cancelIndex === null ? null : { pick: model.cancelIndex };
  return null;
}

export function toInteraction(request: PendingRequest): InteractionModel {
  switch (request.method) {
    case "item/commandExecution/requestApproval": {
      const p = request.params as CommandExecutionRequestApprovalParams;
      const decisions: CommandExecutionApprovalDecision[] = p.availableDecisions?.length
        ? p.availableDecisions
        : ["accept", "acceptForSession", "decline"];
      const choices = decisions.map(decisionChoice).filter((c): c is Choice => !!c);
      return {
        kind: "approval",
        request,
        title: p.kind === "writeStdin" ? "stdin" : "command",
        reason: p.reason ?? null,
        subject: p.command ?? null,
        cwd: p.cwd ?? null,
        ...withCancel(choices),
      };
    }
    case "item/fileChange/requestApproval": {
      const p = request.params as FileChangeRequestApprovalParams;
      const decisions: FileChangeApprovalDecision[] = ["accept", "acceptForSession", "decline"];
      const choices = decisions.map(decisionChoice).filter((c): c is Choice => !!c);
      // A Claude edit offers rules too (no availableDecisions on file changes): after "this session".
      const rules = claudeRulesOf(p);
      if (rules.length) choices.splice(2, 0, claudeRuleChoice(rules));
      return {
        kind: "approval",
        request,
        title: "fileChange",
        reason: p.reason ?? null,
        subject: p.grantRoot ?? null,
        cwd: null,
        ...withCancel(choices),
      };
    }
    case "item/permissions/requestApproval": {
      const p = request.params as PermissionsRequestApprovalParams;
      const grant = (scope: PermissionsRequestApprovalResponse["scope"]): PermissionsRequestApprovalResponse => ({
        // Granting exactly what was requested.
        permissions: p.permissions as unknown as PermissionsRequestApprovalResponse["permissions"],
        scope,
      });
      const deny: PermissionsRequestApprovalResponse = {
        permissions: {} as PermissionsRequestApprovalResponse["permissions"],
        scope: "turn",
      };
      const choices: Choice[] = [
        { label: "grantTurn", tone: "primary", result: grant("turn") },
        { label: "grantSession", tone: "neutral", result: grant("session") },
        { label: "decline", tone: "danger", result: deny },
      ];
      return {
        kind: "approval",
        request,
        title: "permissions",
        reason: p.reason,
        subject: JSON.stringify(p.permissions, null, 2),
        cwd: p.cwd,
        choices,
        // Esc grants nothing.
        cancelIndex: choices.findIndex((c) => c.result === deny),
      };
    }
    case "item/tool/requestUserInput": {
      const p = request.params as ToolRequestUserInputParams;
      return { kind: "questions", request, questions: p.questions, blocking: p.isBlocking };
    }
    case "mcpServer/elicitation/request":
      return { kind: "elicitation", request, params: request.params as McpServerElicitationRequestParams };
    default:
      return { kind: "unknown", request };
  }
}

/** Build the requestUserInput reply from per-question answers. */
export function questionsReply(answers: Record<string, string[]>): ToolRequestUserInputResponse {
  const out: ToolRequestUserInputResponse = { answers: {} };
  for (const [id, values] of Object.entries(answers)) out.answers[id] = { answers: values };
  return out;
}

export function elicitationReply(action: McpServerElicitationRequestResponse["action"], content: unknown = null): McpServerElicitationRequestResponse {
  return { action, content: action === "accept" ? (content as McpServerElicitationRequestResponse["content"]) : null, _meta: null };
}

/**
 * What a failed answer to a server request means. The cutex code (Management v2) survives the IPC
 * hop inside the message (`<code>: <text>`, CutexApiError; see bridge.cleanIpcMessage).
 * - `resolved`: another client answered first (409 server_request_resolved)
 * - `gone`: no longer pending — answered, its turn ended, or the runtime restarted (404 server_request_not_found)
 * - `stale`: the runtime restarted since this view was loaded (412 stale_runtime_generation)
 * - `retry`: anything else (unreachable, offline, 5xx): the request stays for another try
 */
export type AnswerFailure = "resolved" | "gone" | "stale" | "retry";

export function answerFailureOf(error: unknown): AnswerFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (/\bserver_request_resolved\b/.test(message)) return "resolved";
  if (/\bserver_request_not_found\b/.test(message)) return "gone";
  if (/\bstale_runtime_generation\b/.test(message)) return "stale";
  return "retry";
}

/** Form value: text / number inputs and single selects (string), checkbox (boolean), multi-select (string[]). */
export type FormValue = string | boolean | string[];
export type FormValues = Record<string, FormValue>;

/** One field of an MCP form (`requestedSchema`: a flat object of string / number / boolean / enum properties). */
export interface FormField {
  name: string;
  title: string;
  description: string | null;
  /** `number` covers `integer` too (see `integer`); `multi` = multi-select enum (array of strings). */
  type: "string" | "number" | "boolean" | "enum" | "multi";
  /** Enum choices: `value` goes into the reply, `label` is shown (titled oneOf / anyOf, legacy enumNames). */
  options: { value: string; label: string }[];
  required: boolean;
  integer: boolean;
  /** Schema limits: minimum / maximum (number), minLength / maxLength (string), minItems / maxItems (multi). */
  min: number | null;
  max: number | null;
  /** Starting value: the schema `default`, else false (boolean), [] (multi) or "" (empty). */
  initial: FormValue;
}

type Schema = Record<string, unknown>;

function limit(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Choices of an enum schema: `enum` (+ legacy `enumNames`) or titled `oneOf` / `anyOf` ({const, title}); null if none. */
function enumOptions(schema: Schema): FormField["options"] | null {
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? (schema.enumNames as unknown[]) : [];
    return schema.enum.map((v, i) => {
      const name = names[i];
      return { value: String(v), label: typeof name === "string" ? name : String(v) };
    });
  }
  const titled = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null;
  if (!titled) return null;
  return (titled as unknown[])
    .filter((o): o is Schema => !!o && typeof o === "object" && "const" in o)
    .map((o) => ({ value: String(o.const), label: typeof o.title === "string" ? o.title : String(o.const) }));
}

function initialValue(type: FormField["type"], value: unknown, options: FormField["options"]): FormValue {
  const known = (v: unknown) => options.some((o) => o.value === String(v));
  switch (type) {
    case "boolean":
      return value === true;
    case "multi":
      return Array.isArray(value) ? value.filter(known).map(String) : [];
    case "enum":
      return value !== undefined && value !== null && known(value) ? String(value) : "";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
    default:
      return typeof value === "string" ? value : "";
  }
}

export function formFields(schema: unknown): FormField[] {
  const s = schema as { properties?: Record<string, unknown>; required?: unknown } | null;
  if (!s?.properties || typeof s.properties !== "object") return [];
  const required = Array.isArray(s.required) ? (s.required as unknown[]) : [];
  return Object.entries(s.properties).flatMap(([name, raw]): FormField[] => {
    if (!raw || typeof raw !== "object") return [];
    const prop = raw as Schema;
    const multi = prop.type === "array";
    const items = multi && prop.items && typeof prop.items === "object" ? (prop.items as Schema) : {};
    const enumChoices = enumOptions(multi ? items : prop);
    const type: FormField["type"] = multi ? "multi" : enumChoices ? "enum" : prop.type === "boolean" ? "boolean" : prop.type === "number" || prop.type === "integer" ? "number" : "string";
    const options = enumChoices ?? [];
    const [min, max] =
      type === "number" ? [prop.minimum, prop.maximum] : type === "string" ? [prop.minLength, prop.maxLength] : type === "multi" ? [prop.minItems, prop.maxItems] : [null, null];
    return [
      {
        name,
        title: String(prop.title ?? name),
        description: typeof prop.description === "string" ? prop.description : null,
        type,
        options,
        required: required.includes(name),
        integer: prop.type === "integer",
        min: limit(min),
        max: limit(max),
        initial: initialValue(type, prop.default, options),
      },
    ];
  });
}

/** The values a form starts with (schema defaults; an untouched checkbox is false). */
export function formDefaults(fields: readonly FormField[]): FormValues {
  return Object.fromEntries(fields.map((f) => [f.name, Array.isArray(f.initial) ? [...f.initial] : f.initial]));
}

/** Why a field keeps the form from being sent: `required` and left empty, or a value the schema rejects. */
export type FieldProblem = "required" | "invalid";

const isBlank = (v: FormValue | undefined) => v === undefined || (typeof v === "string" ? v.trim() === "" : Array.isArray(v) && v.length === 0);

function fieldProblem(f: FormField, v: FormValue | undefined): FieldProblem | null {
  if (f.type === "boolean") return null; // always answered: true or false
  if (isBlank(v)) return f.required ? "required" : null;
  const outside = (n: number) => (f.min !== null && n < f.min) || (f.max !== null && n > f.max);
  if (f.type === "multi") return !Array.isArray(v) || outside(v.length) ? "invalid" : null;
  if (typeof v !== "string") return "invalid";
  if (f.type === "number") {
    const n = Number(v);
    return !Number.isFinite(n) || (f.integer && !Number.isInteger(n)) || outside(n) ? "invalid" : null;
  }
  if (f.type === "enum") return f.options.some((o) => o.value === v) ? null : "invalid";
  return outside([...v].length) ? "invalid" : null; // minLength / maxLength count code points
}

/** A field's limits for display ("1–10", "≥ 1", "≤ 10"); null without any. */
export function formLimits(f: Pick<FormField, "min" | "max">): string | null {
  if (f.min !== null && f.max !== null) return `${f.min}–${f.max}`;
  if (f.min !== null) return `≥ ${f.min}`;
  return f.max !== null ? `≤ ${f.max}` : null;
}

/** Fields that block sending (empty object: the form can be accepted). */
export function formProblems(fields: readonly FormField[], values: FormValues): Record<string, FieldProblem> {
  const problems: Record<string, FieldProblem> = {};
  for (const f of fields) {
    const problem = fieldProblem(f, values[f.name]);
    if (problem) problems[f.name] = problem;
  }
  return problems;
}

/**
 * Form values → elicitation `content` (null without a form). Booleans are always sent (untouched =
 * false); other fields only when filled in, numbers as numbers. Send only when `formProblems` is empty.
 */
export function formContent(fields: readonly FormField[], values: FormValues): Record<string, unknown> | null {
  if (!fields.length) return null;
  const content: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === "boolean") content[f.name] = v === true;
    else if (isBlank(v)) continue;
    else if (f.type === "multi") content[f.name] = Array.isArray(v) ? [...v] : [];
    else content[f.name] = f.type === "number" ? Number(v) : v;
  }
  return content;
}
