// @vitest-environment jsdom
// 工具参数严格模式 hint (owner 2026-10-25): a turn the provider failed for a tool's parameter schema shows, inside its
// error row, 打开并重试 / 去 Profile 设置 / 不再提示 — not a toast, it stays with the error; only while the agent's
// Profile has strict mode off; 不再提示 per host + Profile. cutex r261 marks the error (`cutexCode`); older cutex: text.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let detail: Record<string, unknown> = {};
let session: Record<string, unknown> | undefined;
let features = new Set(["profile-tool-schema-compat"]);
const confirm = vi.fn(async () => true);
let onlineError: unknown;
vi.mock("../src/renderer/src/bridge", () => ({
  api: {},
  apiFor: (hostId: string) => ({
    getProfile: async (name: string) => { calls.push(`get ${hostId} ${name}`); return detail; },
    patchProfile: async (name: string, patch: unknown) => { calls.push(`patch ${name} ${JSON.stringify(patch)}`); return { ...detail, toolSchemaCompat: "strict" }; },
  }),
  bridge: { on: () => () => {} },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
const app = {
  sessionAction: vi.fn(async (id: string, method: string, _params?: unknown, _hostId?: string) => {
    calls.push(`${method} ${id}`);
    if (method === "cutex/runtime/online" && onlineError) throw onlineError;
  }),
  submit: async (text: string, strategy: string, _extra: unknown, opts: { sessionId: string }) => { calls.push(`submit ${opts.sessionId} ${strategy} ${text}`); return null; },
  openSettings: (tab: string, focus: unknown) => { calls.push(`settings ${tab} ${JSON.stringify(focus)}`); },
};
vi.mock("../src/renderer/src/store", () => {
  const useApp = Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => app });
  return { useApp };
});
vi.mock("../src/renderer/src/lib/viewHost", () => ({ viewRow: () => session }));
vi.mock("../src/renderer/src/lib/hostScope", () => ({ hostData: () => ({ features }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ confirmDialog: (...a: unknown[]) => confirm(...(a as [])) }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({ updateCachedProfile: () => {} }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key), locale: "zh-CN" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { isToolSchemaRejection, turnRefusedToolSchema } = await import("../src/renderer/src/lib/toolSchemaHint");
const { ToolSchemaHint } = await import("../src/renderer/src/components/ToolSchemaHint");
const { HostBusyActionExhausted, HostBusyActionCancelled, HostBusyActionUncertain } = await import("../src/renderer/src/lib/hostBusyActions");
const { applyEvent, emptyTimeline, timelineFromThreadRead } = await import("../src/renderer/src/lib/timeline");
const applyNative = (state: ReturnType<typeof emptyTimeline>, message: { method: string; params: unknown }) =>
  applyEvent(state, { contractVersion: 2, eventId: "e", cursor: "c", streamId: "s", sequence: 1, receivedAt: "", cutexSessionId: "s1", hostId: "h1", source: "app_server", sensitivity: "owner", correlation: {}, native: { kind: "notification", message } } as never);

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  calls.length = 0;
  onlineError = undefined;
  app.sessionAction.mockClear();
  confirm.mockClear();
  detail = { name: "gem", toolSchemaCompat: null, detail: { editable: { toolSchemaCompat: true } } };
  session = { cutexSessionId: "s1", displayName: "Gem", profile: "gem", runtime: { status: "online", activeTurnId: null, runtimeGeneration: 4 } };
  features = new Set(["profile-tool-schema-compat"]);
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function draw(retryText: string | null = "截图给我", hostId = "h1", sessionId = "s1") {
  await act(async () => { root.render(h(ToolSchemaHint, { hostId, sessionId, retryText })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const hint = () => host.querySelector("[data-tool-schema-hint]");
const action = (name: string) => host.querySelector<HTMLButtonElement>(`[data-tool-schema-hint-action="${name}"]`)!;
const click = async (name: string) => { await act(async () => { action(name).click(); }); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

describe("recognising a refused tool schema", () => {
  it("Google's wordings, not other 400s", () => {
    expect(isToolSchemaRejection("unexpected status 400: Google does not support this JSON Schema enum")).toBe(true);
    expect(isToolSchemaRejection(`Invalid JSON payload received. Unknown name "additionalProperties" at 'tools[0].function_declarations[3].parameters': Cannot find field.`)).toBe(true);
    expect(isToolSchemaRejection("* GenerateContentRequest.tools[0].functionDeclarations[2].parameters.properties[mode].enum: only allowed for STRING type")).toBe(true);
    expect(isToolSchemaRejection("enum: only allowed for STRING type")).toBe(true);
    expect(isToolSchemaRejection("unexpected status 400 Bad Request: context length exceeded")).toBe(false);
    expect(isToolSchemaRejection("bootstrap.R: out of memory")).toBe(false);
    expect(isToolSchemaRejection(null)).toBe(false);
  });

  it("cutex r261's cutexCode wins, whatever the text", () => {
    expect(turnRefusedToolSchema({ error: "400 Bad Request", errorCode: "tool_schema_rejected" })).toBe(true);
    expect(turnRefusedToolSchema({ error: "400 Bad Request", errorCode: "other" })).toBe(false);
  });

  it("the timeline keeps cutexCode from turn/completed, error and thread/read", () => {
    const state = emptyTimeline();
    applyNative(state, { method: "turn/started", params: { turn: { id: "t1", status: "inProgress" } } });
    applyNative(state, { method: "turn/completed", params: { turn: { id: "t1", status: "failed", error: { message: "400", cutexCode: "tool_schema_rejected" } } } });
    expect(state.turns[0]!.errorCode).toBe("tool_schema_rejected");
    applyNative(state, { method: "turn/started", params: { turn: { id: "t2", status: "inProgress" } } });
    applyNative(state, { method: "error", params: { turnId: "t2", willRetry: false, error: { message: "400", cutexCode: "tool_schema_rejected" } } });
    applyNative(state, { method: "turn/completed", params: { turn: { id: "t2", status: "failed" } } });
    expect(state.turns[1]!.errorCode).toBe("tool_schema_rejected");
    const read = timelineFromThreadRead({ thread: { id: "th", turns: [{ id: "t3", status: "failed", error: { message: "x", cutexCode: "tool_schema_rejected" }, items: [] }] } });
    expect(read.turns[0]!.errorCode).toBe("tool_schema_rejected");
  });
});

describe("the hint in the error row", () => {
  it("still shows a real runtime failure, without sending the task", async () => {
    onlineError = new Error("runtime failed to start");
    await draw();
    await click("enable");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("runtime failed to start");
    expect(calls.filter((call) => call.startsWith("submit"))).toEqual([]);
  });

  it("does not continue a late start into a message after switching agent/host", async () => {
    let finish!: () => void;
    app.sessionAction.mockImplementationOnce(async (id, method) => { calls.push(`${method} ${id}`); });
    app.sessionAction.mockImplementationOnce(async (id, method) => {
      calls.push(`${method} ${id}`);
      await new Promise<void>((resolve) => { finish = resolve; });
    });
    await draw();
    await click("enable");
    await draw("different task", "h2", "s2");
    await act(async () => { finish(); });
    expect(calls.filter((call) => call.startsWith("submit"))).toEqual([]);
    expect(action("enable").disabled).toBe(false);
  });

  it.each([
    () => new HostBusyActionExhausted(),
    () => new HostBusyActionCancelled(),
    () => new HostBusyActionUncertain(new Error("transport")),
  ])("leaves pending-start feedback with the action row and resumes only on an explicit click (%#)", async (pending) => {
    onlineError = pending();
    await draw("first task");
    await click("enable");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("[data-tool-schema-hint-done]")).toBeNull();
    expect(action("enable").textContent).toBe("hostAction.retry");
    expect(calls.filter((call) => call.startsWith("submit"))).toEqual([]);
    expect(app.sessionAction).toHaveBeenLastCalledWith("s1", "cutex/runtime/online", { openVisibleTerminal: false }, "h1");

    // A runtime-only retry in the persistent action row does not continue the failed message.
    onlineError = undefined;
    await app.sessionAction("s1", "cutex/runtime/online", { openVisibleTerminal: false }, "h1");
    expect(calls.filter((call) => call.startsWith("submit"))).toEqual([]);
    session = { ...session, runtime: { status: "online", activeTurnId: null, runtimeGeneration: 5 } };
    await draw("first task");
    await click("enable");
    expect(calls.filter((call) => call.startsWith("patch"))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith("cutex/runtime/offline"))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith("submit"))).toEqual(["submit s1 auto first task"]);
    expect(host.querySelector("[data-tool-schema-hint-done]")?.textContent).toContain("toolSchemaHint.doneResent");
  });

  it("keeps the requested restart across an offline refresh when there is no text to resend", async () => {
    onlineError = new HostBusyActionExhausted();
    await draw(null);
    await click("enable");
    session = { ...session, runtime: { status: "offline", activeTurnId: null, runtimeGeneration: 5 } };
    onlineError = undefined;
    await draw(null);
    await click("enable");
    expect(calls.filter((call) => call.startsWith("cutex/runtime/online"))).toHaveLength(2);
    expect(calls.filter((call) => call.startsWith("cutex/runtime/offline"))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith("submit"))).toEqual([]);
  });

  it("does not dispatch duplicate workflows on two clicks before the first await settles", async () => {
    await draw();
    await act(async () => { action("enable").click(); action("enable").click(); });
    expect(calls.filter((call) => call.startsWith("patch"))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith("submit"))).toHaveLength(1);
  });

  it("shows for a Profile with strict mode off and names the setting and the restart", async () => {
    await draw();
    expect(calls).toEqual(["get h1 gem"]);
    expect(hint()?.textContent).toContain("toolSchemaHint.title");
    expect(hint()?.textContent).toContain(`toolSchemaHint.restartNote ${JSON.stringify({ profile: "gem" })}`);
  });

  it("nothing when the Profile already has strict mode, does not offer it, or the host lacks the switch", async () => {
    detail = { ...detail, toolSchemaCompat: "strict" };
    await draw();
    expect(hint()).toBeNull();
    detail = { name: "gem", toolSchemaCompat: null, detail: { editable: {} } };
    await draw(null);
    expect(hint()).toBeNull();
    features = new Set();
    act(() => root.unmount());
    root = createRoot(host);
    await draw();
    expect(hint()).toBeNull();
  });

  it("打开并重试: strict on, restart the online agent, send the failed message again", async () => {
    await draw("截图给我");
    await click("enable");
    expect(calls.slice(1)).toEqual([
      `patch gem ${JSON.stringify({ toolSchemaCompat: "strict" })}`,
      "cutex/runtime/offline s1",
      "cutex/runtime/online s1",
      "submit s1 auto 截图给我",
    ]);
    expect(confirm).not.toHaveBeenCalled();
    expect(host.querySelector("[data-tool-schema-hint-done]")?.textContent).toContain("toolSchemaHint.doneResent");
  });

  it("a working agent is restarted only after a confirm", async () => {
    session = { ...session, runtime: { status: "online", activeTurnId: "t9", runtimeGeneration: 4 } };
    confirm.mockResolvedValueOnce(false);
    await draw();
    await click("enable");
    expect(confirm).toHaveBeenCalledOnce();
    expect(calls).toEqual(["get h1 gem"]);
  });

  it("去 Profile 设置 opens that Profile", async () => {
    await draw();
    await click("settings");
    expect(calls).toContain(`settings profiles ${JSON.stringify({ profile: "gem" })}`);
  });

  it("不再提示 hides it for this host's Profile and is remembered", async () => {
    await draw();
    await click("dismiss");
    expect(hint()).toBeNull();
    expect(JSON.parse(localStorage.getItem("cutex-desktop.toolSchemaHint.dismissed.v1")!)).toEqual(["h1\ngem"]);
    act(() => root.unmount());
    root = createRoot(host);
    await draw();
    expect(hint()).toBeNull();
    // Another Profile still gets it.
    session = { ...session, profile: "other" };
    act(() => root.unmount());
    root = createRoot(host);
    await draw();
    expect(hint()).not.toBeNull();
  });
});
