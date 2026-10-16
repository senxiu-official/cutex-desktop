import { describe, expect, it } from "vitest";
import type { CommandExecutionApprovalDecision } from "@cutex-desktop/protocol/codex/v2";
import {
  answerFailureOf,
  approvalKeyAction,
  elicitationReply,
  formContent,
  formDefaults,
  formFields,
  formLimits,
  formProblems,
  questionsReply,
  toInteraction,
  type InteractionModel,
} from "../src/renderer/src/lib/interactions";
import { permissionModeOf, permissionPatch } from "../src/renderer/src/lib/permissionModes";

type Approval = Extract<InteractionModel, { kind: "approval" }>;

const commandApproval = (availableDecisions?: CommandExecutionApprovalDecision[]): Approval => {
  const m = toInteraction({ id: 9, method: "item/commandExecution/requestApproval", params: { kind: "command", command: "rm -rf build", availableDecisions } });
  if (m.kind !== "approval") throw new Error("expected approval");
  return m;
};

/** The reply Esc sends on this card (via the dock's key handling), or null when Esc does nothing. */
const escReply = (m: Approval): unknown => {
  const action = approvalKeyAction("Escape", false, m, 0);
  if (!action) return null;
  if (!("pick" in action)) throw new Error("Esc must answer or do nothing");
  return m.choices[action.pick]!.result;
};

describe("permission modes", () => {
  it("round-trips each mode through its settings patch", () => {
    for (const mode of ["full", "auto", "readOnly"] as const) {
      expect(permissionModeOf(permissionPatch(mode) as never)).toBe(mode);
    }
    expect(permissionModeOf({ approvalPolicy: "untrusted", sandboxPolicy: { type: "readOnly" } })).toBe("custom");
    expect(permissionModeOf(null)).toBeNull();
  });

  it("switching to auto keeps the thread's extra writable directories", () => {
    const current = { approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/repo/sibling", "/scratch"], networkAccess: false } };
    const patch = permissionPatch("auto", current as never) as { sandboxPolicy: { writableRoots: string[] } };
    expect(patch.sandboxPolicy.writableRoots).toEqual(["/repo/sibling", "/scratch"]);
    const fromFull = permissionPatch("auto", { approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } } as never) as { sandboxPolicy: { writableRoots: string[] } };
    expect(fromFull.sandboxPolicy.writableRoots).toEqual([]);
    expect((permissionPatch("auto") as { sandboxPolicy: { writableRoots: string[] } }).sandboxPolicy.writableRoots).toEqual([]);
  });
});

describe("interactions", () => {
  it("command approval honours availableDecisions and Esc maps to decline", () => {
    const m = toInteraction({
      id: 5,
      method: "item/commandExecution/requestApproval",
      params: { kind: "command", threadId: "t", turnId: "u", itemId: "i", startedAtMs: 0, environmentId: null, command: "rm -rf build", cwd: "/w", reason: "cleanup", availableDecisions: ["accept", "decline", "cancel"] },
    });
    expect(m.kind).toBe("approval");
    if (m.kind !== "approval") return;
    expect(m.subject).toBe("rm -rf build");
    expect(m.choices.map((c) => c.result)).toEqual([{ decision: "accept" }, { decision: "decline" }, { decision: "cancel" }]);
    expect(escReply(m)).toEqual({ decision: "decline" });
  });

  it("defaults command decisions when the server lists none", () => {
    const m = toInteraction({ id: 1, method: "item/commandExecution/requestApproval", params: { kind: "command", command: "ls" } });
    if (m.kind !== "approval") throw new Error("expected approval");
    expect(m.choices.map((c) => c.label)).toEqual(["accept", "acceptForSession", "decline"]);
  });

  it("permissions grant echoes the requested profile with scope", () => {
    const permissions = { network: { enabled: true } };
    const m = toInteraction({ id: 2, method: "item/permissions/requestApproval", params: { cwd: "/w", reason: null, permissions } });
    if (m.kind !== "approval") throw new Error("expected approval");
    expect(m.choices[1]!.result).toEqual({ permissions, scope: "session" });
    expect(escReply(m)).toEqual({ permissions: {}, scope: "turn" });
  });

  it("builds requestUserInput and elicitation replies", () => {
    expect(questionsReply({ q1: ["Yes"], q2: ["custom text"] })).toEqual({ answers: { q1: { answers: ["Yes"] }, q2: { answers: ["custom text"] } } });
    expect(elicitationReply("decline", { x: 1 })).toEqual({ action: "decline", content: null, _meta: null });
    expect(elicitationReply("accept", { x: 1 })).toEqual({ action: "accept", content: { x: 1 }, _meta: null });
  });

  it("flattens simple MCP form schemas", () => {
    const fields = formFields({
      type: "object",
      properties: { name: { type: "string", title: "Name" }, n: { type: "integer" }, ok: { type: "boolean" }, color: { type: "string", enum: ["red", "blue"] } },
      required: ["name"],
    });
    expect(fields.map((f) => [f.name, f.type, f.required])).toEqual([
      ["name", "string", true],
      ["n", "number", false],
      ["ok", "boolean", false],
      ["color", "enum", false],
    ]);
  });
});

describe("approval Esc never approves (D1)", () => {
  const execpolicy: CommandExecutionApprovalDecision = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["cargo", "build"] } };
  const network: CommandExecutionApprovalDecision = { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "crates.io", action: "allow" } } };

  it('["cancel","accept"]: Esc cancels the turn instead of accepting', () => {
    const m = commandApproval(["cancel", "accept"]);
    expect(m.cancelIndex).toBe(0);
    expect(escReply(m)).toEqual({ decision: "cancel" });
  });

  it("accept-only lists: Esc does nothing", () => {
    for (const decisions of [["accept"], ["accept", "acceptForSession"], [execpolicy], ["accept", network], [execpolicy, network, "acceptForSession"]] as CommandExecutionApprovalDecision[][]) {
      const m = commandApproval(decisions);
      expect(m.cancelIndex).toBeNull();
      expect(approvalKeyAction("Escape", false, m, 0)).toBeNull();
    }
  });

  it('["accept","acceptForSession","decline"] (and the default list): Esc declines', () => {
    expect(escReply(commandApproval(["accept", "acceptForSession", "decline"]))).toEqual({ decision: "decline" });
    expect(escReply(commandApproval())).toEqual({ decision: "decline" });
    expect(escReply(commandApproval(["accept", "cancel", "decline"]))).toEqual({ decision: "decline" });
  });

  it("file change approvals: Esc declines", () => {
    const m = toInteraction({ id: 3, method: "item/fileChange/requestApproval", params: { threadId: "t", turnId: "u", itemId: "i", startedAtMs: 0, grantRoot: "/w" } });
    if (m.kind !== "approval") throw new Error("expected approval");
    expect(escReply(m)).toEqual({ decision: "decline" });
  });

  it("any server list: Esc picks decline, else cancel, else nothing", () => {
    const all: CommandExecutionApprovalDecision[] = ["accept", "acceptForSession", execpolicy, network, "decline", "cancel"];
    for (let mask = 1; mask < 1 << all.length; mask++) {
      const subset = all.filter((_, i) => mask & (1 << i));
      for (const decisions of [subset, [...subset].reverse()]) {
        const expected = decisions.includes("decline") ? { decision: "decline" } : decisions.includes("cancel") ? { decision: "cancel" } : null;
        expect(escReply(commandApproval(decisions))).toEqual(expected);
      }
    }
  });

  it("other keys: digits answer, arrows / Tab move, Enter answers the highlighted choice", () => {
    const m = commandApproval(["cancel", "accept"]);
    expect(approvalKeyAction("2", false, m, 0)).toEqual({ pick: 1 });
    expect(approvalKeyAction("3", false, m, 0)).toBeNull();
    expect(approvalKeyAction("ArrowDown", false, m, 1)).toEqual({ select: 0 });
    expect(approvalKeyAction("Tab", true, m, 0)).toEqual({ select: 1 });
    expect(approvalKeyAction("Enter", false, m, 0)).toEqual({ pick: 0 });
    expect(approvalKeyAction("x", false, m, 0)).toBeNull();
    expect(approvalKeyAction("Escape", false, { choices: [], cancelIndex: null }, 0)).toBeNull();
  });
});

describe("failed answers (D2)", () => {
  it("reads the cutex code from the message, wrapped by the IPC hop or not", () => {
    const wrapped = (code: string) => new Error(`Error invoking remote method 'cutex-desktop:invoke': CutexApiError: ${code}: details`);
    expect(answerFailureOf(new Error("server_request_resolved: the native server request was already resolved"))).toBe("resolved");
    expect(answerFailureOf(wrapped("server_request_resolved"))).toBe("resolved");
    expect(answerFailureOf(new Error("server_request_not_found: the exact native server request is not pending"))).toBe("gone");
    expect(answerFailureOf(wrapped("stale_runtime_generation"))).toBe("stale");
  });

  it("anything else can be retried", () => {
    expect(answerFailureOf(new Error("cutex management API unreachable at http://127.0.0.1:24270"))).toBe("retry");
    expect(answerFailureOf(new Error("session_offline: the cutex session has no connected app-server"))).toBe("retry");
    expect(answerFailureOf(new Error("server_request_delivery_failed: the response was not written"))).toBe("retry");
    expect(answerFailureOf("boom")).toBe("retry");
  });
});

describe("MCP elicitation form (D3)", () => {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string", title: "Name", minLength: 2, maxLength: 5 },
      agree: { type: "boolean", title: "Agree" },
      notify: { type: "boolean", default: true },
      count: { type: "integer", minimum: 1, maximum: 10, default: 3 },
      ratio: { type: "number" },
      color: { type: "string", oneOf: [{ const: "r", title: "Red" }, { const: "b", title: "Blue" }], default: "b" },
      size: { type: "string", enum: ["s", "m"], enumNames: ["Small", "Medium"] },
      tags: { type: "array", items: { type: "string", enum: ["x", "y", "z"] }, minItems: 1, maxItems: 2, default: ["y"] },
      langs: { type: "array", items: { anyOf: [{ const: "rs", title: "Rust" }, { const: "ts", title: "TypeScript" }] } },
    },
    required: ["name", "agree", "color", "tags"],
  };
  const fields = formFields(schema);
  const field = (name: string) => fields.find((f) => f.name === name)!;

  it("reads types, titled options, limits and defaults from the schema", () => {
    expect(fields.map((f) => [f.name, f.type])).toEqual([
      ["name", "string"],
      ["agree", "boolean"],
      ["notify", "boolean"],
      ["count", "number"],
      ["ratio", "number"],
      ["color", "enum"],
      ["size", "enum"],
      ["tags", "multi"],
      ["langs", "multi"],
    ]);
    expect(field("color").options).toEqual([{ value: "r", label: "Red" }, { value: "b", label: "Blue" }]);
    expect(field("size").options).toEqual([{ value: "s", label: "Small" }, { value: "m", label: "Medium" }]);
    expect(field("langs").options.map((o) => o.label)).toEqual(["Rust", "TypeScript"]);
    expect(field("count")).toMatchObject({ integer: true, min: 1, max: 10 });
    expect(formLimits(field("count"))).toBe("1–10");
    expect(formLimits(field("ratio"))).toBeNull();
    expect(formDefaults(fields)).toEqual({ name: "", agree: false, notify: true, count: "3", ratio: "", color: "b", size: "", tags: ["y"], langs: [] });
  });

  it("untouched booleans are sent as false, defaults as given, empty optional fields left out", () => {
    const values = { ...formDefaults(fields), name: "Ada" };
    expect(formProblems(fields, values)).toEqual({});
    expect(formContent(fields, values)).toEqual({ name: "Ada", agree: false, notify: true, count: 3, color: "b", tags: ["y"] });
  });

  it("blocks required fields left empty (a required boolean is always answered)", () => {
    const values = { ...formDefaults(fields), color: "", tags: [] };
    expect(formProblems(fields, values)).toEqual({ name: "required", color: "required", tags: "required" });
    expect(formProblems(fields, { ...values, name: "   " }).name).toBe("required");
  });

  it("blocks values the schema rejects", () => {
    const ok = { ...formDefaults(fields), name: "Ada" };
    expect(formProblems(fields, { ...ok, name: "A" })).toEqual({ name: "invalid" });
    expect(formProblems(fields, { ...ok, name: "Ada Lovelace" })).toEqual({ name: "invalid" });
    expect(formProblems(fields, { ...ok, count: "2.5" })).toEqual({ count: "invalid" });
    expect(formProblems(fields, { ...ok, count: "11" })).toEqual({ count: "invalid" });
    expect(formProblems(fields, { ...ok, ratio: "abc" })).toEqual({ ratio: "invalid" });
    expect(formProblems(fields, { ...ok, tags: ["x", "y", "z"] })).toEqual({ tags: "invalid" });
    expect(formProblems(fields, { ...ok, ratio: "0.5", langs: ["ts"] })).toEqual({});
    expect(formContent(fields, { ...ok, ratio: "0.5", langs: ["ts"] })).toMatchObject({ ratio: 0.5, langs: ["ts"] });
  });

  it("forms without fields send no content", () => {
    expect(formFields(null)).toEqual([]);
    expect(formContent([], {})).toBeNull();
    expect(formProblems([], {})).toEqual({});
  });
});
