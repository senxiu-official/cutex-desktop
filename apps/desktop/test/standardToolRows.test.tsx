// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawItem } from "../src/renderer/src/lib/timeline";
import { standardToolRow } from "../src/renderer/src/lib/standardToolRows";
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (k: string, v?: Record<string, unknown>) => v ? `${k}:${v.n}` : k }) }));
const { StandardToolRow } = await import("../src/renderer/src/modules/conversation/StandardToolRow");
const native = (tool: string, args: unknown = {}, over = {}): RawItem => ({ type: "dynamicToolCall", namespace: "claude", tool, arguments: args, id: "native", status: "completed", success: true, contentItems: [{ type: "inputText", text: "returned text" }], ...over }) as RawItem;
const command = (actions: unknown[]): RawItem => ({ type: "commandExecution", id: "cmd", command: "rg needle src", commandActions: actions, status: "completed", aggregatedOutput: "src/a.ts:10:needle", exitCode: 0 }) as RawItem;
const list = (result: unknown, over = {}): RawItem => ({ type: "mcpToolCall", server: "cutex", tool: "agent_list", arguments: { limit: 5 }, result: { structuredContent: result }, id: "list", status: "completed", ...over }) as RawItem;
describe("structured common tools", () => {
 it("Read keeps path/range and accepts JSON arguments", () => {
  const m = standardToolRow(native("Read", JSON.stringify({ file_path: "C:/work/a.ts", offset: 12, limit: 30, pages: "1-2" })))!;
  expect(m.summary).toBe("C:/work/a.ts:12"); expect(m.fields).toContainEqual({ name: "limit", value: "30" }); expect(m.fields).toContainEqual({ name: "pages", value: "1-2" });
 });
 it("Codex/old Claude read, search and listFiles actions use structured fields", () => {
  expect(standardToolRow(command([{ type: "read", path: "src/a.ts", name: "a.ts" }]))?.kind).toBe("read");
  expect(standardToolRow(command([{ type: "search", query: "needle", path: "src" }]))?.summary).toBe("needle · src");
  expect(standardToolRow(command([{ type: "listFiles", path: "." }]))?.kind).toBe("search");
 });
 it("mixed/unknown/malformed and shell text stay generic", () => {
  for (const a of [[], [null], [{ type: "unknown", command: "cat a" }], [{ type: "read" }], [{ type: "read", path: "a" }, { type: "unknown", command: "rm b" }]]) expect(standardToolRow(command(a))).toBeNull();
  expect(standardToolRow({ ...command([]), command: "Read src/a.ts" })).toBeNull();
 });
 it("Grep/Glob retain scope/options without guessing result counts", () => {
  const m = standardToolRow(native("Grep", { pattern: "foo.*bar", path: "src", glob: "*.ts", "-i": true, output_mode: "content", head_limit: 20, "-A": 3 }))!;
  expect(m.fields).toContainEqual({ name: "-A", value: "3" }); expect(m.summary).toBe("foo.*bar · src"); expect(m.fields).toContainEqual({ name: "-i", value: "true" });
  expect(standardToolRow(native("Glob", { pattern: "**/*.tsx", path: "app" }))?.kind).toBe("search");
 });
 it("ToolSearch discovery is scoped to Claude and requires a query", () => {
  expect(standardToolRow(native("ToolSearch", { query: "select:mcp__cutex__agent_list", max_results: 3 }))?.kind).toBe("tools");
  for (const i of [native("Read", "{bad"), native("ToolSearch", []), native("Read", { file_path: "a" }, { namespace: "other" }), native("WebFetch", { url: "https://example.invalid" })]) expect(standardToolRow(i)).toBeNull();
 });
 it("agent inventory supports MCP structured/text and Claude dynamic results, including empty lists", () => {
  const data = { agents: [{ id: "agent-1", name: "Kai", status: "busy" }, null, { name: "bad" }], agents_total: 20, next_cursor: 5 };
  const m = standardToolRow(list(data))!;
  expect(m.agents).toEqual([{ id: "agent-1", name: "Kai", status: "busy" }]); expect(m.agentCount).toBe(1);
  expect(standardToolRow(list(null, { result: { content: [{ type: "text", text: JSON.stringify(data) }] } }))?.agents).toEqual(m.agents);
  expect(standardToolRow(native("agent_list", {}, { contentItems: [{ type: "inputText", text: JSON.stringify(data) }] }))?.agents).toEqual(m.agents);
  expect(standardToolRow(list({ agents: [] }))?.agentCount).toBe(0);
  expect(standardToolRow(list({ ok: false }))?.agentCount).toBeNull(); expect(standardToolRow(list(data, { server: "other" }))).toBeNull();
 });
});
let root: Root | undefined; let box: HTMLDivElement;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
function mount(item: RawItem) { box = document.createElement("div"); document.body.append(box); root = createRoot(box); update(item); }
function update(item: RawItem) { act(() => root!.render(h(StandardToolRow, { item, sessionId: "eva" }))); }
function toggle() { act(() => box.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click()); }
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; box?.remove(); });
describe("dedicated tool row interactions", () => {
 it("keeps one collapsed row while streaming; expansion survives completion and reveals full input/output", () => {
  const i = native("Read", { file_path: "src/a.ts", offset: 12, limit: 30 }, { status: "inProgress", contentItems: null }); mount(i);
  expect(box.querySelector('[data-tool-view="read"]')).not.toBeNull(); expect(box.querySelector(".animate-spin")).not.toBeNull(); expect(box.querySelector("pre")).toBeNull();
  toggle(); expect(box.textContent).toContain("offset12");
  update({ ...i, status: "completed", contentItems: [{ type: "inputText", text: "late reply" }] });
  expect(box.querySelector('button[aria-expanded="true"]')).not.toBeNull(); expect(box.querySelector("pre")?.textContent).toBe("late reply");
  toggle(); expect(box.querySelector("pre")).toBeNull();
 });
 it("search retains native options and full command output", () => {
  mount(command([{ type: "search", query: "needle", path: "src" }])); toggle(); expect(box.querySelector("pre")?.textContent).toBe("src/a.ts:10:needle");
 });
 it("discovery summarizes query, with max_results on expansion", () => {
  mount(native("ToolSearch", { query: "select:mcp__cutex__agent_list", max_results: 3 })); expect(box.textContent).toContain("conversation.tools.tools"); expect(box.textContent).toContain("select:mcp__cutex__agent_list"); toggle(); expect(box.textContent).toContain("max_results3");
 });
 it("agent lists show returned count, expandable identities and complete result pagination metadata", () => {
  mount(list({ agents: [{ id: "agent-1", name: "Kai", status: "busy" }], next_cursor: 10 })); expect(box.textContent).toContain("conversation.tools.agentCount:1"); expect(box.querySelector("ul")).toBeNull(); toggle(); expect(box.querySelector("ul")?.textContent).toBe("Kaiagent-1status.running"); expect(box.querySelector("pre")?.textContent).toContain('"next_cursor": 10');
 });
 it("pending notices: counts on the row, titles in the details; an older host or none pending adds nothing", () => {
  const pending = { total: 3, counts: { answer: 2, question: 0, state: 1 }, more: true, entries: [{ delivery_id: "d1", delegation: "ask-1", kind: "answer", title: "Fix the sidebar" }, { delivery_id: "d2", delegation: "ask-2", kind: "newKind", title: "" }, { title: "no delegation" }] };
  expect(standardToolRow(list({ agents: [], pending_notices: pending }))?.pendingNotices).toEqual({ total: 3, counts: { answer: 2, question: 0, state: 1 }, more: true, entries: [{ id: "d1", delegation: "ask-1", kind: "answer", title: "Fix the sidebar" }, { id: "d2", delegation: "ask-2", kind: null, title: "ask-2" }] });
  expect(standardToolRow(list({ agents: [] }))?.pendingNotices).toBeNull();
  expect(standardToolRow(list({ agents: [], pending_notices: { total: 0, counts: {}, entries: [] } }))?.pendingNotices).toBeNull();
  mount(list({ agents: [{ id: "agent-1", name: "Kai", status: "busy" }], pending_notices: pending }));
  expect(box.textContent).toContain("conversation.tools.pendingNotices:3 · conversation.tools.pendingNotices.answer 2 · conversation.tools.pendingNotices.state 1");
  toggle(); expect(box.textContent).toContain("Fix the sidebar"); expect(box.textContent).toContain("conversation.tools.pendingNotices.more:2");
 });
 it("failed native calls retain visible error and stay collapsed", () => {
  mount(native("Read", { file_path: "missing" }, { status: "failed", success: false, contentItems: [{ type: "inputText", text: "file not found" }] })); expect(box.textContent).toContain("taskrow.outcome.failed"); expect(box.textContent).toContain("file not found"); expect(box.querySelector('button[aria-expanded="false"]')).not.toBeNull();
 });
});

const operation = (tool: string, args: unknown, result: unknown = {}, over = {}): RawItem => ({ type: "mcpToolCall", server: "cutex", tool, arguments: args, result: { structuredContent: result }, id: "operation", status: "completed", ...over }) as RawItem;
const actionArgs = { tool: "agent_delegate", action_id: "action-1" };
const receipt = (status: string, over = {}) => ({ schema: "cutex.tool-action-receipt.v1", ok: true, ...actionArgs, status, outcomeUnknown: status === "unknown" || status === "notFound", ...over });

describe("operation tool projections", () => {
 it("member lifecycle is the requested operation/target, never an inferred online state", () => {
  for (const change of ["online", "offline", "restart"]) {
   const m = standardToolRow(operation("member_runtime", { cutex_session_id: "agent-kai", change }, { outcome: { status: "complete" } }))!;
   expect(m.kind).toBe("memberRuntime"); expect(m.operation).toBe(change); expect(m.summary).toBe("agent-kai"); expect(m.state).toBeUndefined();
  }
  expect(standardToolRow(operation("member_runtime", { change: "restart" }))).toBeNull();
  expect(standardToolRow(operation("member_runtime", { cutex_session_id: "kai", change: "delete" }))).toBeNull();
 });
 it("TaskStop supports task_id and historical shell_id only in the Claude namespace", () => {
  expect(standardToolRow(native("TaskStop", { task_id: "task-a" }))?.summary).toBe("task-a");
  expect(standardToolRow(native("TaskStop", { shell_id: "shell-old" }))?.kind).toBe("taskStop");
  expect(standardToolRow(native("TaskStop", {}))).toBeNull();
  expect(standardToolRow(native("TaskStop", { task_id: "x" }, { namespace: "other" }))).toBeNull();
 });
 it("artifact pages retain ref/version, zero offsets and continuation metadata with text", () => {
  const m = standardToolRow(operation("artifact_read", { ref: "af-test@latest", cursor: 0 }, { ok: true, name: "Design", ref: "af-test@2", version: 2, media_type: "text/markdown", cursor: 0, next_cursor: 8192, text: "page text" }))!;
  expect(m.summary).toBe("af-test@latest · cursor=0"); expect(m.body).toBe("page text"); expect(m.resultFields).toContainEqual({ name: "next_cursor", value: "8192" });
  const binary = standardToolRow(operation("artifact_read", { ref: "af-test@2" }, { ok: true, binary: true, text: null, detail: "metadata only", next_cursor: null }))!;
  expect(binary.body).toBeNull(); expect(binary.resultFields).toContainEqual({ name: "next_cursor", value: "null" });
  expect(standardToolRow(operation("artifact_read", { cursor: 0 }))).toBeNull();
 });
 it("exact receipts show operation status; mismatched identities or schemas never claim completion", () => {
  for (const state of ["running", "completed", "failed", "awaitingApproval", "unknown", "notFound"]) expect(standardToolRow(operation("action_status", actionArgs, receipt(state)))?.state).toBe(state);
  for (const wrong of [{ action_id: "other" }, { tool: "agent_create" }, { schema: "other" }, { ok: false }, { status: "done" }]) expect(standardToolRow(operation("action_status", actionArgs, receipt("completed", wrong)))?.state).toBeUndefined();
  expect(standardToolRow(operation("action_status", { action_id: "action-1" }))).toBeNull();
  expect(standardToolRow(operation("artifact_read", { ref: "x" }, {}, { server: "other" }))).toBeNull();
 });
 it("MCP text and dynamic legacy envelopes preserve refusal/uncertainty rather than showing success", () => {
  const data = { outcome: { status: "no_write", code: "response_uncertain", detail: "Outcome cannot be proved" } };
  const args = { cutex_session_id: "kai", change: "restart" };
  expect(standardToolRow(operation("member_runtime", args, data))?.outcome?.kind).toBe("uncertain");
  expect(standardToolRow(native("member_runtime", JSON.stringify(args), { contentItems: [{ type: "inputText", text: JSON.stringify(data) }] }))?.outcome?.kind).toBe("uncertain");
  const item = operation("artifact_read", { ref: "af-missing@1" }, null, { result: { content: [{ type: "text", text: JSON.stringify({ ok: false, code: "artifact_not_found" }) }] } });
  expect(standardToolRow(item)?.outcome?.kind).toBe("failed");
  expect(standardToolRow(operation("artifact_read", { ref: "x" }, null, { result: { isError: true, structuredContent: { ok: true } } }))?.outcome?.kind).toBe("failed");
 });
});

describe("operation tool views", () => {
 it("member runtime has an operation-specific request label and preserves owner expansion through completion", () => {
  const i = operation("member_runtime", { cutex_session_id: "kai", change: "restart" }, null, { status: "inProgress" }); mount(i);
  expect(box.textContent).toContain("conversation.tools.memberRuntime.restart"); expect(box.querySelector("pre")).toBeNull(); toggle();
  update(operation("member_runtime", { cutex_session_id: "kai", change: "restart" }, { outcome: { status: "complete", receipt: { result: { kind: "lifecycle" } } } }));
  expect(box.querySelector('button[aria-expanded="true"]')).not.toBeNull(); expect(box.querySelector("pre")?.textContent).toContain("lifecycle");
 });
 it("TaskStop shows its task identity and keeps returned stop details expandable", () => {
  mount(native("TaskStop", { task_id: "task-1" }, { contentItems: [{ type: "inputText", text: "Task stopped" }] }));
  expect(box.textContent).toContain("conversation.tools.taskStop"); expect(box.textContent).toContain("task-1"); toggle(); expect(box.querySelector("pre")?.textContent).toBe("Task stopped");
 });
 it("artifact reading shows page text as text and preserves complete raw metadata", () => {
  mount(operation("artifact_read", { ref: "af-test@2", cursor: 0 }, { ok: true, name: "Design", version: 2, text: "<script>plain text</script>", next_cursor: 8192 }));
  expect(box.querySelector("pre")).toBeNull(); toggle(); expect(box.querySelector("pre")?.textContent).toBe("<script>plain text</script>"); expect(box.querySelector("script")).toBeNull(); expect(box.textContent).toContain("next_cursor8192"); expect(box.querySelector("details pre")?.textContent).toContain('"version": 2');
 });
 it("completed action status says the tool call completed and explains the distinction from delegated work", () => {
  mount(operation("action_status", actionArgs, receipt("completed", { result: { delegation: "delegation-1" } })));
  expect(box.textContent).toContain("conversation.tools.actionStatus.completed"); expect(box.textContent).not.toContain("taskrow.outcome.failed"); toggle(); expect(box.textContent).toContain("conversation.tools.actionStatus.hint");
 });
 it("notFound/unknown states never display completion and operation failure does not imply query failure", () => {
  mount(operation("action_status", actionArgs, receipt("notFound"))); expect(box.textContent).toContain("conversation.tools.actionStatus.notFound"); expect(box.textContent).not.toContain("actionStatus.completed");
  update(operation("action_status", actionArgs, receipt("failed", { result: { ok: false } }))); expect(box.textContent).toContain("conversation.tools.actionStatus.failed"); expect(box.textContent).not.toContain("taskrow.outcome.failed");
 });
 it("completed failure and uncertain management envelopes keep the correct outcome visible", () => {
  mount(operation("member_runtime", { cutex_session_id: "kai", change: "online" }, { outcome: { status: "no_write", code: "response_uncertain", detail: "check exact receipt" } }));
  expect(box.textContent).toContain("taskrow.outcome.uncertain"); expect(box.textContent).toContain("check exact receipt"); expect(box.textContent).not.toContain("taskrow.outcome.failed");
  update(operation("member_runtime", { cutex_session_id: "kai", change: "online" }, { outcome: { status: "no_write", code: "denied", detail: "permission missing" } }));
  expect(box.textContent).toContain("taskrow.outcome.failed"); expect(box.textContent).toContain("permission missing");
 });
 it("read failures stay visible and counted when the surrounding work group folds", async () => {
  const { summarize, isFailed } = await import("../src/renderer/src/lib/workGroups");
  const item = operation("artifact_read", { ref: "missing" }, { ok: false, code: "artifact_not_found", detail: "not found" });
  expect(isFailed(item)).toBe(true); expect(summarize([{ kind: "tool", id: item.id, turnId: "t", item }]).failed).toBe(1);
  mount(item); expect(box.textContent).toContain("taskrow.outcome.failed"); expect(box.textContent).toContain("not found");
 });
});
