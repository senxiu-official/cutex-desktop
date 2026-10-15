import { describe, expect, it } from "vitest";
import { taskDeliveryRow, taskToolRow, toolErrorText } from "../src/renderer/src/lib/taskRows";
import type { ExternalMessage } from "../src/renderer/src/lib/timeline";

const call = (tool: string, args: unknown) => ({ type: "mcpToolCall", id: "m1", server: "cutex", tool, status: "completed", arguments: args });

describe("taskToolRow", () => {
  it("maps Director assignment with assignee, ids and summary", () => {
    const row = taskToolRow(call("cutex_task_service_director", { operation: "create_and_assign", action_id: "a", task_id: "t-1", assignment_id: "as-1", assignee_cutex_session_id: "cutex.mika", summary: "修 queue 面板" }));
    expect(row).toMatchObject({ verb: "assign", counterpartId: "cutex.mika", taskId: "t-1", assignmentId: "as-1", text: "修 queue 面板" });
  });

  it("gives worker rows the task id learned from an earlier assignment", () => {
    taskToolRow(call("cutex_task_service_director", { operation: "assign", task_id: "t-2", assignment_id: "as-2" }));
    expect(taskToolRow(call("cutex_task_service", { operation: "submit", assignment_id: "as-2", result_reference: "PR 12" }))).toMatchObject({ verb: "submit", taskId: "t-2", text: "PR 12" });
  });

  it("names the assignee on later decisions", () => {
    taskToolRow(call("cutex_task_service_director", { operation: "assign", task_id: "t-4", assignment_id: "as-4", assignee_cutex_session_id: "cutex.alden" }));
    expect(taskToolRow(call("cutex_task_service_terminal", { operation: "request_changes", assignment_id: "as-4" }))?.counterpartId).toBe("cutex.alden");
  });

  it("accepts JSON-string arguments and terminal decisions", () => {
    expect(taskToolRow(call("cutex_task_service_terminal", JSON.stringify({ operation: "request_changes", assignment_id: "as-3", decision_reference: "测试没过" })))).toMatchObject({ verb: "requestChanges", text: "测试没过" });
  });

  it("ignores other tools, other servers and unknown operations", () => {
    expect(taskToolRow(call("send_message", {}))).toBeNull();
    expect(taskToolRow({ ...call("cutex_task_service", { operation: "start" }), server: "other" })).toBeNull();
    expect(taskToolRow(call("cutex_task_service", { operation: "dance" }))).toBeNull();
    expect(taskToolRow({ type: "commandExecution", id: "c" })).toBeNull();
  });
});

describe("delegation rows", () => {
  const done = (tool: string, args: unknown, result: unknown) => ({ ...call(tool, args), result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: null } });

  it("maps agent_delegate and the old agent_ask, learning the delegation title", () => {
    expect(taskToolRow(done("agent_delegate", { target: "Kimi", title: "Parser review", text: "Review the parser" }, { ok: true, delegation_id: "d-1", target: "Kimi", target_id: "cutex.kimi" }))).toMatchObject({
      verb: "delegate",
      counterpartId: "cutex.kimi",
      counterpartName: "Kimi",
      taskId: null,
      text: "Parser review\n\nReview the parser",
    });
    expect(taskToolRow(call("agent_ask", { target: "cutex.mika", text: "Run the tests" }))).toMatchObject({ verb: "delegate", counterpartId: "cutex.mika", counterpartName: null, text: "Run the tests" });
    expect(taskToolRow(call("delegation_stop", { delegation: "d-1" }))).toMatchObject({ verb: "delegationStop", text: "Parser review" });
    expect(taskToolRow(call("delegation_read", { delegation_id: "d-unknown" }))).toMatchObject({ verb: "delegationRead", text: "d-unknown" });
  });

  it("labels read_overlength_content (and its r214 name document_read)", () => {
    const id = "doc-0123456789abcdef0123456789abcdef";
    expect(taskToolRow(call("read_overlength_content", { id }))).toMatchObject({ verb: "overlengthRead", counterpartId: null, text: id });
    expect(taskToolRow(call("document_read", { document_id: id }))).toMatchObject({ verb: "overlengthRead", text: id });
  });

  it("picks close verbs from the outcome for delegation_close and ask_close", () => {
    expect(taskToolRow(call("delegation_close", { delegation: "d-1", outcome: "accepted" }))?.verb).toBe("delegationAccept");
    expect(taskToolRow(call("delegation_close", { delegation: "d-1", outcome: "abandoned" }))?.verb).toBe("delegationAbandon");
    expect(taskToolRow(call("ask_close", { ask: "a-1", outcome: "stop" }))).toMatchObject({ verb: "delegationStop", text: "a-1" });
    expect(taskToolRow(call("delegation_close", { delegation: "d-1" }))?.verb).toBe("delegationClose");
  });

  it("shows answers a wait received, else the awaited delegations", () => {
    // The collapsed line only says it waited; answers / awaited delegations show when expanded.
    expect(taskToolRow(done("delegation_wait", { delegations: ["d-1"] }, { ok: true, reason: "result", results: [{ kind: "answer", delegation_id: "d-1", title: "Parser review", answer: "LGTM" }] }))).toMatchObject({ text: null, detail: "Parser review: LGTM" });
    expect(taskToolRow(call("agent_wait", { asks: ["d-1", "a-9"] }))).toMatchObject({ verb: "delegationWait", text: null, detail: "Parser review, a-9" });
    expect(taskToolRow(call("delegation_wait", {}))?.detail).toBeNull();
  });

  it("maps progress, question answers, notes, alarms and agent lifecycle (new and old names)", () => {
    expect(taskToolRow(call("delegation_progress", { text: "halfway" }))).toMatchObject({ verb: "delegationProgress", text: "halfway" });
    expect(taskToolRow(call("agent_reply", { ask: "a-1", text: "halfway" }))?.verb).toBe("delegationProgress");
    expect(taskToolRow(call("question_answer", { question: "q-1", answers: { q0: { answers: ["sqlite", "wal"] } } }))).toMatchObject({ verb: "questionAnswer", text: "sqlite; wal" });
    expect(taskToolRow(call("agent_respond", { question: "q-1", answers: {} }))).toMatchObject({ verb: "questionAnswer", text: null });
    expect(taskToolRow(done("agent_tell", { to: "Kimi", text: "fyi" }, { ok: true, to: "cutex.kimi", name: "Kimi" }))).toMatchObject({ verb: "tell", counterpartId: "cutex.kimi", counterpartName: "Kimi", text: "fyi" });
    expect(taskToolRow(call("alarm_set", { alarm_id: "x", to: "Kimi", message: "check CI", at: "12:00" }))).toMatchObject({ verb: "alarmSet", counterpartName: "Kimi", text: "12:00 · check CI" });
    expect(taskToolRow(call("set_alarm", { alarm_id: "x", to: "cutex.kimi", message: "check CI", delay_seconds: 60 }))).toMatchObject({ verb: "alarmSet", counterpartId: "cutex.kimi", text: "check CI" });
    expect(taskToolRow(call("agent_create", { name: "worker" }))).toMatchObject({ verb: "agentCreate", counterpartName: "worker" });
    // agent-create-task-delegation: the task is the row text, and later delegation rows name it.
    const created = { outcome: { status: "complete", receipt: { result: { agent: { cutex_session_id: "cutex.worker" }, task_mode: "delegation", delegation: { ok: true, delegation: "delegation-abc123" } } } } };
    expect(taskToolRow(done("agent_create", { name: "worker", task: "Port the parser" }, created))).toMatchObject({ verb: "agentCreate", counterpartId: "cutex.worker", text: "Port the parser" });
    expect(taskToolRow(call("delegation_stop", { delegation: "delegation-abc123" }))?.text).toBe("Port the parser");
    expect(taskToolRow(call("agent_archive", { agent: "cutex.worker" }))).toMatchObject({ verb: "agentArchive", counterpartId: "cutex.worker" });
    expect(taskToolRow(call("cutex_agent_management", { operation: "create", spec: { name: "worker" } }))).toMatchObject({ verb: "agentCreate", counterpartName: "worker" });
    expect(taskToolRow(call("cutex_agent_management", { operation: "restart", cutex_session_id: "cutex.w" }))).toBeNull();
  });

  it("marks refused calls failed with code and detail (text body, isError, structuredContent)", () => {
    const busy = { ...done("agent_delegate", { target: "Kimi", text: "x" }, { ok: false, status: "no_write", code: "busy", detail: "Kimi is busy" }) };
    expect(taskToolRow(busy)).toMatchObject({ verb: "delegate", counterpartName: "Kimi", outcome: { kind: "failed", code: "busy", detail: "Kimi is busy" } });
    const removed = { ...call("agent_ask", { target: "Kimi", text: "x" }), status: "failed", result: { content: [{ type: "text", text: JSON.stringify({ ok: false, status: "no_write", code: "tool_removed", detail: "use agent_delegate" }) }], structuredContent: null, isError: true } };
    expect(taskToolRow(removed)?.outcome).toEqual({ kind: "failed", code: "tool_removed", detail: "use agent_delegate" });
    const plain = { ...call("delegation_stop", { delegation: "d-x" }), result: { content: [{ type: "text", text: "delegation_not_found: d-x" }], structuredContent: null, isError: true } };
    expect(taskToolRow(plain)?.outcome).toEqual({ kind: "failed", code: null, detail: "delegation_not_found: d-x" });
    const structured = { ...call("agent_archive", { agent: "cutex.w" }), result: { content: [], structuredContent: { ok: false, status: "conflict", code: "director_only", detail: "only the director may archive" } } };
    expect(taskToolRow(structured)?.outcome).toMatchObject({ kind: "failed", code: "director_only" });
    const errored = { ...call("cutex_task_service", { operation: "start", assignment_id: "as-x" }), status: "failed", error: { message: "boom" } };
    expect(taskToolRow(errored)?.outcome).toEqual({ kind: "failed", code: null, detail: "boom" });
  });

  it("reads response_uncertain as uncertain and approval_required / pendingReview as awaiting the owner", () => {
    expect(taskToolRow(done("agent_tell", { to: "Kimi", text: "fyi" }, { ok: false, status: "response_uncertain", code: "bus_timeout", detail: "maybe delivered" }))?.outcome).toEqual({ kind: "uncertain", code: "bus_timeout", detail: "maybe delivered" });
    expect(taskToolRow(done("agent_create", { name: "w" }, { ok: false, status: "approval_required", code: "approval_required", detail: "needs owner" }))?.outcome).toMatchObject({ kind: "approval" });
    expect(taskToolRow(done("agent_create", { name: "w" }, { ok: true, state: "pendingReview" }))?.outcome?.kind).toBe("approval");
  });

  it("leaves successful calls without an outcome", () => {
    expect(taskToolRow(done("agent_tell", { to: "Kimi", text: "fyi" }, { ok: true, to: "cutex.kimi" }))?.outcome).toBeNull();
    expect(taskToolRow(call("alarm_set", { to: "Kimi", message: "m" }))?.outcome).toBeNull();
  });

  describe("Management envelope (agent_create / agent_archive …)", () => {
    const envelope = (outcome: unknown) => ({ content: [{ type: "text", text: JSON.stringify({ schema: "cutex/agent-management/v1", action_id: "c1", outcome }) }], structuredContent: null, _meta: null });
    const args = { action_id: "c1", spec: { name: "demo-mouse" }, start_mode: "bootstrap_only" };
    const codex = (outcome: unknown) => ({ ...call("agent_create", args), status: "failed", result: envelope(outcome), error: null });
    const claude = (outcome: unknown) => ({ ...codex(outcome), error: { message: "Cutex tool returned an error" } });

    it("reads no_write code and detail from outcome (Codex and Claude shapes)", () => {
      const noWrite = { status: "no_write", code: "conflict", detail: "unresolved_agent_reservation" };
      expect(taskToolRow(codex(noWrite))).toMatchObject({ verb: "agentCreate", counterpartName: "demo-mouse", outcome: { kind: "failed", code: "conflict", detail: "unresolved_agent_reservation" } });
      // The Claude adapter's generic item error never hides the real reason.
      expect(taskToolRow(claude(noWrite))?.outcome).toEqual({ kind: "failed", code: "conflict", detail: "unresolved_agent_reservation" });
    });

    it("reads owner_action_required from outcome.failure", () => {
      const failure = { status: "owner_action_required", failure: { code: "profile_unavailable", detail: "log the profile in" } };
      expect(taskToolRow(claude(failure))?.outcome).toEqual({ kind: "failed", code: "profile_unavailable", detail: "log the profile in" });
      // Even when the item itself says completed (a body-only refusal).
      expect(taskToolRow({ ...codex(failure), status: "completed" })?.outcome?.kind).toBe("failed");
    });

    it("reads a no_write response_uncertain as uncertain", () => {
      expect(taskToolRow({ ...codex({ status: "no_write", code: "response_uncertain", detail: "Outcome unknown" }), status: "completed" })?.outcome).toMatchObject({ kind: "uncertain", detail: "Outcome unknown" });
    });

    it("takes the created agent's id from the receipt and leaves success without an outcome", () => {
      const ok = { ...codex({ status: "complete", receipt: { result: { kind: "created", agent: { cutex_session_id: "cutex.demo" } } } }), status: "completed" };
      expect(taskToolRow(ok)).toMatchObject({ counterpartId: "cutex.demo", counterpartName: "demo-mouse", outcome: null });
    });

    it("falls back to the generic item error only when nothing else says why", () => {
      expect(taskToolRow({ ...call("agent_create", args), status: "failed", result: { content: [], structuredContent: null }, error: { message: "Cutex tool returned an error" } })?.outcome).toEqual({ kind: "failed", code: null, detail: "Cutex tool returned an error" });
    });
  });

  it("leaves agent_list, services and other servers as plain tool rows", () => {
    expect(taskToolRow(call("agent_list", {}))).toBeNull();
    expect(taskToolRow(call("service_register", { slug: "web" }))).toBeNull();
    expect(taskToolRow({ ...call("agent_delegate", { target: "Kimi", text: "x" }), server: "other" })).toBeNull();
    expect(taskToolRow(call("toString", {}))).toBeNull();
  });
});

describe("toolErrorText", () => {
  it("pretty-prints a JSON body and ignores the generic item error when there is one", () => {
    const item = { ...call("agent_create", {}), status: "failed", result: { content: [{ type: "text", text: '{"outcome":{"status":"no_write"}}' }] }, error: { message: "Cutex tool returned an error" } };
    expect(toolErrorText(item)).toBe('{\n  "outcome": {\n    "status": "no_write"\n  }\n}');
  });

  it("uses plain text, structuredContent, contentItems or the item error", () => {
    expect(toolErrorText({ type: "mcpToolCall", id: "x", result: { content: [{ type: "text", text: "API 422" }] } })).toBe("API 422");
    expect(toolErrorText({ type: "mcpToolCall", id: "x", result: { content: [], structuredContent: { ok: false } } })).toBe('{\n  "ok": false\n}');
    expect(toolErrorText({ type: "dynamicToolCall", id: "x", contentItems: [{ type: "inputText", text: "denied" }] })).toBe("denied");
    expect(toolErrorText({ type: "mcpToolCall", id: "x", result: null, error: { message: "transport closed" } })).toBe("transport closed");
    expect(toolErrorText({ type: "mcpToolCall", id: "x" })).toBeNull();
  });
});

describe("taskDeliveryRow", () => {
  const msg = (schema: string | null, data: Record<string, unknown>): ExternalMessage => ({ senderId: "x", senderName: "Eva", deliveryMode: null, text: "Assignment ID: …", schema, data, eventType: null, sourceKind: null });

  it("reads assignment and follow-up views", () => {
    expect(taskDeliveryRow(msg("cutex.task-assignment.v1", { assignmentId: "as-9", taskId: "t-9", title: "生成协议类型", coordinatorCutexSessionId: "cutex.eva", coordinatorName: "Eva" }))).toMatchObject({ verb: "received", counterpartId: "cutex.eva", taskId: "t-9", text: "生成协议类型" });
    expect(taskDeliveryRow(msg("cutex.task-followup.v1", { assignmentId: "as-9", taskId: "t-9", decisionReference: "补测试" }))).toMatchObject({ verb: "changesRequested", text: "补测试" });
  });

  it("leaves ordinary bus messages alone", () => {
    expect(taskDeliveryRow(msg(null, {}))).toBeNull();
    expect(taskDeliveryRow(msg("cutex.bus-message.v1", {}))).toBeNull();
  });
});
