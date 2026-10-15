import { describe, expect, it } from "vitest";
import { CutexApiError, CutexClient, CutexUnreachableError, hasDotSegment, openStream } from "../src/index";

const BUILD = { version: "0.1.0", release: "r224", commit: "5f30a7c", builtAt: null, profile: "release", channel: "dev" };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Mock fetch: records calls, answers with `reply(call)` → [status, body]. */
function mockClient(reply: (call: Call) => [number, unknown] = () => [200, {}], options: ConstructorParameters<typeof CutexClient>[1] = {}) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body,
    };
    calls.push(call);
    const [status, body] = reply(call);
    return new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  const client = new CutexClient({ baseUrl: "http://h:1", token: "tok" }, { fetch, clientId: "c", ...options });
  return { client, calls };
}

const apiError = (code: string) => ({ contractVersion: 2, error: { source: "cutex", code, message: code, retryable: false } });

describe("CutexClient basics", () => {
  it("generates ids with Web Crypto and does not call fetch with the client as `this`", async () => {
    let receiver: unknown = "unset";
    const fetch = function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response("{}"));
    } as unknown as typeof globalThis.fetch;
    const client = new CutexClient({ baseUrl: "http://h:1", token: null }, { fetch });
    expect(client.clientId).toMatch(/^cutex-desktop-[0-9a-f-]{36}$/);
    await client.host();
    expect(receiver).not.toBe(client);
  });
});

describe("SSE over an injected fetch (Web Streams only)", () => {
  it("parses a chunked ReadableStream body, including a UTF-8 char split across chunks", async () => {
    const bytes = new TextEncoder().encode('id: 1\nevent: out\ndata: {"t":"你好"}\n\n');
    const split = bytes.indexOf(0xe4) + 1; // inside the first CJK char
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    let seen: RequestInit | undefined;
    const fetch = ((_: string | URL | Request, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    }) as typeof globalThis.fetch;
    const client = new CutexClient({ baseUrl: "http://h:1", token: "tok" }, { fetch });
    const messages: { id?: string; event: string; data: string }[] = [];
    await new Promise<void>((done) => {
      openStream(client, "/v2/terminals/x/stream", { onMessage: (m) => messages.push(m), onEnd: done });
    });
    expect(messages).toEqual([{ id: "1", event: "out", data: '{"t":"你好"}' }]);
    expect(seen?.headers).toMatchObject({ Accept: "text/event-stream", Authorization: "Bearer tok" });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("capabilities", () => {
  it("GETs /v2/capabilities with the bearer token", async () => {
    const { client, calls } = mockClient(() => [200, { cutexBuild: BUILD, featureList: ["x"] }]);
    expect(await client.capabilities()).toEqual({ cutexBuild: BUILD, featureList: ["x"] });
    expect(calls[0]).toMatchObject({ url: "http://h:1/v2/capabilities", method: "GET", headers: { Authorization: "Bearer tok", Accept: "application/json" } });
  });

  it("maps 404 to null but rethrows other errors", async () => {
    expect(await mockClient(() => [404, apiError("not_found")]).client.capabilities()).toBeNull();
    await expect(mockClient(() => [405, "no"]).client.capabilities()).rejects.toBeInstanceOf(CutexApiError);
  });
});

describe("runtime packages", () => {
  it("lists, with a missing route as null", async () => {
    const { client, calls } = mockClient(() => [200, { hostId: "workstation", agents: [] }]);
    expect(await client.runtimePackages()).toEqual({ hostId: "workstation", agents: [] });
    expect(calls[0]!.url).toBe("http://h:1/v2/runtime-packages");
    expect(await mockClient(() => [404, apiError("not_found")]).client.runtimePackages()).toBeNull();
    expect(await mockClient(() => [405, ""]).client.runtimePackages()).toBeNull();
    await expect(mockClient(() => [401, apiError("unauthorized")]).client.runtimePackages()).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("lists runs with a clamped limit and reads one run", async () => {
    const { client, calls } = mockClient((c) => (c.url.includes("/runs/") ? [200, { run: { runId: "rpu-1" } }] : [200, { runs: [{ runId: "rpu-1" }] }]));
    expect(await client.runtimePackageRuns(500)).toEqual([{ runId: "rpu-1" }]);
    expect(await client.runtimePackageRun("rpu-1")).toEqual({ runId: "rpu-1" });
    expect(calls.map((c) => c.url)).toEqual(["http://h:1/v2/runtime-packages/runs?limit=100", "http://h:1/v2/runtime-packages/runs/rpu-1"]);
    expect(await mockClient(() => [404, apiError("run_not_found")]).client.runtimePackageRun("rpu-2")).toBeNull();
    await expect(client.runtimePackageRun("../x")).rejects.toThrow("bad run id");
  });

  it("starts and reverts runs; refusals throw with their code", async () => {
    const { client, calls } = mockClient(() => [202, { run: { runId: "rpu-9" } }]);
    expect(await client.startRuntimePackageRun({ all: true })).toEqual({ runId: "rpu-9" });
    await client.startRuntimePackageRun({ agentIds: ["cutex.a", "cutex.a", "cutex.b"] });
    await client.revertRuntimePackageRun("rpu-9");
    await client.revertRuntimePackageRun("rpu-9", ["cutex.a"]);
    expect(calls.map((c) => [c.method, c.url, JSON.parse(String(c.body))])).toEqual([
      ["POST", "http://h:1/v2/runtime-packages/runs", { all: true }],
      ["POST", "http://h:1/v2/runtime-packages/runs", { agentIds: ["cutex.a", "cutex.b"] }],
      ["POST", "http://h:1/v2/runtime-packages/runs/rpu-9/revert", {}],
      ["POST", "http://h:1/v2/runtime-packages/runs/rpu-9/revert", { agentIds: ["cutex.a"] }],
    ]);
    await expect(client.startRuntimePackageRun({ agentIds: [] })).rejects.toThrow("bad agent ids");
    await expect(mockClient(() => [409, apiError("run_in_progress")]).client.startRuntimePackageRun({ all: true })).rejects.toMatchObject({ code: "run_in_progress", status: 409 });
  });
});

describe("director rotations (owner-rotation)", () => {
  it("lists by project, reads one, and maps a missing route / rotation to null", async () => {
    const { client, calls } = mockClient((c) => (c.url.includes("/rot-") ? [200, { rotation: { rotationId: "rot-1" } }] : [200, { rotations: [{ rotationId: "rot-1" }] }]));
    expect(await client.directorRotations("scp", 500)).toEqual([{ rotationId: "rot-1" }]);
    expect(await client.directorRotation("rot-1")).toEqual({ rotationId: "rot-1" });
    expect(calls.map((c) => c.url)).toEqual(["http://h:1/v2/director-rotations?projectId=scp&limit=100", "http://h:1/v2/director-rotations/rot-1"]);
    expect(await mockClient(() => [404, apiError("rotation_not_found")]).client.directorRotation("rot-2")).toBeNull();
    expect(await mockClient(() => [404, apiError("not_found")]).client.directorRotations("scp")).toBeNull();
    await expect(client.directorRotation("../x")).rejects.toThrow("bad rotation id");
  });

  it("starts, cancels and continues; refusals throw with their code", async () => {
    const { client, calls } = mockClient(() => [202, { rotation: { rotationId: "rot-9" } }]);
    expect(await client.startDirectorRotation({ requestId: "r1", projectId: "scp" })).toEqual({ rotationId: "rot-9" });
    await client.directorRotationAction("rot-9", "cancel");
    await client.directorRotationAction("rot-9", "continue");
    expect(calls.map((c) => [c.method, c.url, JSON.parse(String(c.body))])).toEqual([
      ["POST", "http://h:1/v2/director-rotations", { requestId: "r1", projectId: "scp" }],
      ["POST", "http://h:1/v2/director-rotations/rot-9/cancel", {}],
      ["POST", "http://h:1/v2/director-rotations/rot-9/continue", {}],
    ]);
    await expect(client.directorRotationAction("rot-9", "drop" as "cancel")).rejects.toThrow("bad rotation action");
    await expect(mockClient(() => [409, apiError("rotation_in_progress")]).client.startDirectorRotation({})).rejects.toMatchObject({ code: "rotation_in_progress", status: 409 });
  });
});

describe("agent alarms (alarms-api)", () => {
  it("lists with a session filter, reads one, cancels, and maps a missing route to null", async () => {
    const ID = "alarm-11111111-1111-1111-1111-111111111111";
    const { client, calls } = mockClient((c) => (c.url.includes("/alarm-") ? [200, { alarm: { id: ID } }] : [200, { hostId: "h", alarms: [], nextAt: null }]));
    expect(await client.alarms({ sessionId: "cutex.a", state: "all", limit: 5000 })).toEqual({ hostId: "h", alarms: [], nextAt: null });
    await client.alarms();
    expect(await client.alarm(ID)).toEqual({ id: ID });
    expect(await client.cancelAlarm(ID)).toEqual({ id: ID });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["GET", "http://h:1/v2/alarms?sessionId=cutex.a&state=all&limit=1000"],
      ["GET", "http://h:1/v2/alarms"],
      ["GET", `http://h:1/v2/alarms/${ID}`],
      ["DELETE", `http://h:1/v2/alarms/${ID}`],
    ]);
    expect(await mockClient(() => [404, apiError("not_found")]).client.alarms({ sessionId: "cutex.a" })).toBeNull();
    expect(await mockClient(() => [404, apiError("alarm_not_found")]).client.alarm(ID)).toBeNull();
    await expect(mockClient(() => [409, apiError("alarm_already_queued")]).client.cancelAlarm(ID)).rejects.toMatchObject({ code: "alarm_already_queued", status: 409 });
    await expect(client.cancelAlarm("../x")).rejects.toThrow("bad alarm id");
    await expect(client.alarms({ sessionId: "a b" })).rejects.toThrow("bad session id");
  });
});

describe("runtime restore candidates (runtime-restore-candidates)", () => {
  it("lists, dismisses and maps a missing route to null", async () => {
    const LIST = { hostId: "h", uncleanSince: "2026-10-13T02:00:00Z", reason: "host_rebooted", items: [{ cutexSessionId: "cutex.a", displayName: "Eva", lastOnlineAt: "2026-10-13T01:00:00Z" }] };
    const { client, calls } = mockClient((c) => (c.method === "DELETE" ? [200, { dismissed: 1 }] : [200, LIST]));
    expect(await client.restoreCandidates()).toEqual(LIST);
    expect(await client.dismissRestoreCandidates()).toEqual({ dismissed: 1 });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["GET", "http://h:1/v2/runtimes/restore-candidates"],
      ["DELETE", "http://h:1/v2/runtimes/restore-candidates"],
    ]);
    expect(await mockClient(() => [404, apiError("not_found")]).client.restoreCandidates()).toBeNull();
  });
});

describe("Claude quota auto-continue (claude-quota-auto-continue)", () => {
  it("reads one agent, switches, cancels, and maps a missing route to null", async () => {
    const VIEW = { cutexSessionId: "cutex.a", enabled: true, pending: null, last: null };
    const { client, calls } = mockClient((c) => (c.method === "GET" ? [200, { hostId: "h", sessions: [VIEW] }] : [200, { quotaAutoContinue: VIEW }]));
    expect(await client.quotaAutoContinue("cutex.a")).toEqual(VIEW);
    expect(await client.setQuotaAutoContinue("cutex.a", false)).toEqual(VIEW);
    expect(await client.cancelQuotaAutoContinue("cutex.a")).toEqual(VIEW);
    expect(calls.map((c) => [c.method, c.url, ...(c.body == null ? [] : [JSON.parse(String(c.body))])])).toEqual([
      ["GET", "http://h:1/v2/quota-auto-continue?sessionId=cutex.a"],
      ["PATCH", "http://h:1/v2/quota-auto-continue/cutex.a", { enabled: false }],
      ["DELETE", "http://h:1/v2/quota-auto-continue/cutex.a/pending"],
    ]);
    expect(await mockClient(() => [404, apiError("not_found")]).client.quotaAutoContinue("cutex.a")).toBeNull();
    await expect(mockClient(() => [404, apiError("session_not_found")]).client.setQuotaAutoContinue("cutex.a", true)).rejects.toMatchObject({ code: "session_not_found", status: 404 });
    await expect(client.quotaAutoContinue("a b")).rejects.toThrow("bad session id");
    await expect(client.cancelQuotaAutoContinue("../x")).rejects.toThrow("bad session id");
  });
});

describe("stuck Agent Bus messages", () => {
  it("lists with a clamped minAgeSecs and maps a missing route to null", async () => {
    const { client, calls } = mockClient(() => [200, { messages: [{ messageId: "m1" }], total: 1 }]);
    expect(await client.stuckBusMessages(600)).toEqual({ messages: [{ messageId: "m1" }], total: 1 });
    await client.stuckBusMessages(-5);
    await client.stuckBusMessages(1e12);
    await client.stuckBusMessages();
    expect(calls.map((c) => c.url)).toEqual([
      "http://h:1/v2/agent-bus/stuck-messages?minAgeSecs=600",
      "http://h:1/v2/agent-bus/stuck-messages?minAgeSecs=0",
      "http://h:1/v2/agent-bus/stuck-messages?minAgeSecs=2678400",
      "http://h:1/v2/agent-bus/stuck-messages",
    ]);
    expect(await mockClient(() => [404, apiError("not_found")]).client.stuckBusMessages(60)).toBeNull();
    await expect(mockClient(() => [503, apiError("agent_bus_state_unavailable")]).client.stuckBusMessages(60)).rejects.toMatchObject({ code: "agent_bus_state_unavailable" });
  });

  it("discards with a trimmed reason, the digest and allowProtected only when given; refusals throw with their code", async () => {
    const { client, calls } = mockClient(() => [200, { messageId: "m1", discarded: true, changed: true }]);
    const sha = "ab".repeat(32);
    expect(await client.discardStuckBusMessage({ messageId: "m1", reason: "  gone  " })).toEqual({ messageId: "m1", discarded: true, changed: true });
    await client.discardStuckBusMessage({ messageId: "m2", reason: "r", expectedSemanticSha256: sha, allowProtected: true });
    expect(calls.map((c) => [c.method, c.url, JSON.parse(String(c.body))])).toEqual([
      ["POST", "http://h:1/v2/agent-bus/stuck-messages/discard", { messageId: "m1", reason: "gone" }],
      ["POST", "http://h:1/v2/agent-bus/stuck-messages/discard", { messageId: "m2", reason: "r", expectedSemanticSha256: sha, allowProtected: true }],
    ]);
    await expect(client.discardStuckBusMessage({ messageId: "", reason: "r" })).rejects.toThrow("bad message id");
    await expect(client.discardStuckBusMessage({ messageId: "m1", reason: "  " })).rejects.toThrow("bad discard reason");
    await expect(client.discardStuckBusMessage({ messageId: "m1", reason: "r", expectedSemanticSha256: "xyz" })).rejects.toThrow("bad semantic digest");
    await expect(mockClient(() => [409, apiError("message_protected")]).client.discardStuckBusMessage({ messageId: "m1", reason: "r" })).rejects.toMatchObject({ code: "message_protected", status: 409 });
  });
});

describe("Claude accounts (claude-accounts)", () => {
  it("lists, creates, renames, removes and checks on /v2/claude/accounts; a missing route lists as null", async () => {
    const { client, calls } = mockClient((c) => (c.method === "GET" ? [200, { contractVersion: 2, accounts: [{ id: "default" }] }] : [200, { id: "ca-work1" }]));
    expect(await client.claudeAccounts()).toEqual({ contractVersion: 2, accounts: [{ id: "default" }] });
    await client.createClaudeAccount({ label: "DeepSeek", kind: "api", baseUrl: "https://api.deepseek.com/anthropic" });
    await client.updateClaudeAccount("ca-work1", { label: "Work" });
    await client.deleteClaudeAccount("ca-work1");
    await client.checkClaudeAccount("default");
    expect(calls.map((c) => [c.method, c.url, c.body === undefined || c.body === null ? null : JSON.parse(String(c.body))])).toEqual([
      ["GET", "http://h:1/v2/claude/accounts", null],
      ["POST", "http://h:1/v2/claude/accounts", { label: "DeepSeek", kind: "api", baseUrl: "https://api.deepseek.com/anthropic" }],
      ["PATCH", "http://h:1/v2/claude/accounts/ca-work1", { label: "Work" }],
      ["DELETE", "http://h:1/v2/claude/accounts/ca-work1", null],
      ["POST", "http://h:1/v2/claude/accounts/default/status", {}],
    ]);
    expect(await mockClient(() => [404, apiError("not_found")]).client.claudeAccounts()).toBeNull();
  });

  it("never sends an API key or a malformed id; refusals throw with their code", async () => {
    const { client, calls } = mockClient();
    await expect(client.createClaudeAccount({ label: "x", kind: "api", apiKey: "sk-test" } as never)).rejects.toThrow("apiKey");
    await expect(client.updateClaudeAccount("../x", { label: "x" })).rejects.toThrow("bad Claude account id");
    await expect(client.deleteClaudeAccount("CA-X")).rejects.toThrow("bad Claude account id");
    await expect(client.checkClaudeAccount("ca-a/login")).rejects.toThrow("bad Claude account id");
    expect(calls).toEqual([]);
    await expect(mockClient(() => [409, apiError("claude_account_in_use")]).client.deleteClaudeAccount("ca-a")).rejects.toMatchObject({ code: "claude_account_in_use", status: 409 });
  });
});

describe("approvals", () => {
  it("lists pending / all", async () => {
    const { client, calls } = mockClient(() => [200, { approvals: [{ approvalId: "apr-1" }] }]);
    expect(await client.approvals()).toEqual([{ approvalId: "apr-1" }]);
    await client.approvals("all");
    expect(calls.map((c) => c.url)).toEqual(["http://h:1/v2/approvals?state=pending", "http://h:1/v2/approvals?state=all"]);
  });

  it("treats a missing list as empty and a missing route as null", async () => {
    expect(await mockClient(() => [200, {}]).client.approvals()).toEqual([]);
    expect(await mockClient(() => [404, apiError("not_found")]).client.approvals()).toBeNull();
    expect(await mockClient(() => [405, ""]).client.approvals()).toBeNull();
    await expect(mockClient(() => [500, apiError("boom")]).client.approvals()).rejects.toMatchObject({ code: "boom" });
  });

  it("decides with a trimmed, capped note", async () => {
    const { client, calls } = mockClient(() => [200, { approval: { approvalId: "apr-1", state: "approved" } }]);
    expect(await client.decideApproval("apr-1", "approve", "  ok  ")).toEqual({ approvalId: "apr-1", state: "approved" });
    await client.decideApproval("apr-1", "deny", "x".repeat(2000));
    await client.decideApproval("apr-1", "deny", "   ");
    expect(calls[0]).toMatchObject({ url: "http://h:1/v2/approvals/apr-1/approve", method: "POST", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(calls[0]!.body as string)).toEqual({ note: "ok" });
    expect((JSON.parse(calls[1]!.body as string) as { note: string }).note).toHaveLength(1000);
    expect(JSON.parse(calls[2]!.body as string)).toEqual({});
  });

  it("validates id and decision before any request; surfaces refusals as CutexApiError", async () => {
    const { client, calls } = mockClient();
    await expect(client.decideApproval("../x", "approve")).rejects.toThrow("bad approval id");
    await expect(client.decideApproval("apr-1", "maybe" as "approve")).rejects.toThrow("bad decision");
    expect(calls).toHaveLength(0);
    await expect(mockClient(() => [409, apiError("approval_not_pending")]).client.decideApproval("apr-1", "approve")).rejects.toMatchObject({
      status: 409,
      code: "approval_not_pending",
    });
  });
});

describe("asks", () => {
  it("builds the filter query", async () => {
    const { client, calls } = mockClient(() => [200, { asks: [{ askId: "a" }] }]);
    expect(await client.asks({ involving: "owner", state: "open", project: "x".repeat(201), limit: 5000.7 })).toEqual([{ askId: "a" }]);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v2/asks");
    expect(Object.fromEntries(url.searchParams)).toEqual({ involving: "owner", state: "open", limit: "1000" });
  });

  it("maps a missing route to null", async () => {
    expect(await mockClient(() => [405, ""]).client.asks()).toBeNull();
    expect(await mockClient(() => [200, {}]).client.asks()).toEqual([]);
  });

  it("reads one ask and its answer pages", async () => {
    const { client, calls } = mockClient((c) => [200, c.url.includes("/answer") ? { text: "t", nextCursor: null } : { ask: { askId: "a:1" } }]);
    expect(await client.ask("a:1")).toEqual({ askId: "a:1" });
    expect(await client.askAnswer("a:1", 3.9)).toEqual({ text: "t", nextCursor: null });
    await client.askAnswer("a:1", 0);
    expect(calls.map((c) => c.url)).toEqual(["http://h:1/v2/asks/a%3A1", "http://h:1/v2/asks/a%3A1/answer?cursor=3", "http://h:1/v2/asks/a%3A1/answer"]);
  });

  it("null on 404, throws on bad ids and 405", async () => {
    expect(await mockClient(() => [404, apiError("ask_not_found")]).client.ask("a")).toBeNull();
    expect(await mockClient(() => [404, apiError("ask_not_found")]).client.askAnswer("a")).toBeNull();
    await expect(mockClient(() => [405, ""]).client.ask("a")).rejects.toBeInstanceOf(CutexApiError);
    await expect(mockClient().client.ask("a/b")).rejects.toThrow("bad ask id");
    await expect(mockClient().client.askAnswer("")).rejects.toThrow("bad ask id");
  });
});

describe("notifications", () => {
  it("reads states and acks a reminder", async () => {
    const states = { schema: "cutex/notification-state/v1", healthy: true, sessions: [] };
    const { client, calls } = mockClient((c) => [200, c.url.endsWith("/ack") ? { acknowledged: true, threadId: "t", reminderId: "r" } : states]);
    expect(await client.notificationStates()).toEqual(states);
    expect(await client.ackNotification("t", "r")).toEqual({ acknowledged: true, threadId: "t", reminderId: "r" });
    expect(calls[0]).toMatchObject({ url: "http://h:1/v2/notifications/states", method: "GET" });
    expect(calls[1]).toMatchObject({ url: "http://h:1/v2/notifications/ack", method: "POST" });
    expect(JSON.parse(calls[1]!.body as string)).toEqual({ threadId: "t", reminderId: "r" });
  });

  it("gets and sets the session level (snake_case thread_id)", async () => {
    const { client, calls } = mockClient(() => [200, { level: "off" }]);
    expect(await client.notificationLevel("t 1")).toBe("off");
    expect(await client.setNotificationLevel("t 1", "off")).toBe("off");
    expect(calls[0]).toMatchObject({ url: "http://h:1/v2/notifications/session?thread_id=t+1", method: "GET" });
    expect(calls[1]).toMatchObject({ url: "http://h:1/v2/notifications/session", method: "POST" });
    expect(JSON.parse(calls[1]!.body as string)).toEqual({ thread_id: "t 1", level: "off" });
  });

  it("maps the notify router's plain error body to http_400", async () => {
    await expect(mockClient(() => [400, { error: "invalid reminderId" }]).client.ackNotification("t", "")).rejects.toMatchObject({ code: "http_400" });
  });

  it("keeps the code of a flat peers-v2 error body ({code, message, retryable})", async () => {
    const err = CutexApiError.fromBody(503, { code: "peer_unreachable", message: "peer unreachable", retryable: true, details: null });
    expect(err).toMatchObject({ status: 503, code: "peer_unreachable", retryable: true, message: "peer_unreachable: peer unreachable" });
    expect(CutexApiError.fromBody(503, { code: "Not A Code" }).code).toBe("http_503");
  });
});

describe("uploadAttachment", () => {
  it("posts raw bytes with the mime type", async () => {
    const { client, calls } = mockClient(() => [200, { attachmentId: "att1", path: "/h/att1.png", mime: "image/png", size: 3 }]);
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await client.uploadAttachment("s/1", bytes, "image/png")).toEqual({ attachmentId: "att1", path: "/h/att1.png", mime: "image/png", size: 3 });
    expect(calls[0]).toMatchObject({ url: "http://h:1/v2/sessions/s%2F1/attachments", method: "POST", headers: { "Content-Type": "image/png", Authorization: "Bearer tok" } });
    expect(calls[0]!.body).toBe(bytes);
  });

  it("fills defaults from the request (Uint8Array, ArrayBuffer, Blob)", async () => {
    const { client } = mockClient(() => [200, { path: "/p" }]);
    expect(await client.uploadAttachment("s", new Uint8Array(4), "image/gif")).toEqual({ attachmentId: "", path: "/p", mime: "image/gif", size: 4 });
    expect((await client.uploadAttachment("s", new ArrayBuffer(5), "image/gif")).size).toBe(5);
    expect((await client.uploadAttachment("s", new Blob([new Uint8Array(6)]), "image/gif")).size).toBe(6);
  });

  it("maps errors like the desktop did", async () => {
    await expect(mockClient(() => [404, ""]).client.uploadAttachment("s", new Uint8Array(1), "image/png")).rejects.toThrow(/cannot receive images/);
    await expect(mockClient(() => [404, apiError("session_not_found")]).client.uploadAttachment("s", new Uint8Array(1), "image/png")).rejects.toMatchObject({ code: "session_not_found" });
    await expect(mockClient(() => [413, apiError("attachment_too_large")]).client.uploadAttachment("s", new Uint8Array(1), "image/png")).rejects.toMatchObject({ code: "attachment_too_large" });
    await expect(mockClient(() => [200, {}]).client.uploadAttachment("s", new Uint8Array(1), "image/png")).rejects.toThrow("session-attachments: no path in the reply");
    const failing = new CutexClient({ baseUrl: "http://h:1", token: null }, { fetch: () => Promise.reject(new TypeError("fetch failed")) });
    await expect(failing.uploadAttachment("s", new Uint8Array(1), "image/png")).rejects.toBeInstanceOf(CutexUnreachableError);
  });
});

describe("compact history (compact-history)", () => {
  it("sends ?compact=1 on bootstrap / history only when asked", async () => {
    const { client, calls } = mockClient(() => [200, {}]);
    await client.bootstrap("s1", { turnLimit: 5, compact: true });
    await client.bootstrap("s1", { turnLimit: 5 });
    await client.history("s1", { limit: 3, cursor: "c", compact: true });
    await client.history("s1", { limit: 3 });
    expect(new URL(calls[0]!.url).searchParams.get("compact")).toBe("1");
    expect(new URL(calls[0]!.url).searchParams.get("turnLimit")).toBe("5");
    expect(new URL(calls[1]!.url).searchParams.has("compact")).toBe(false);
    expect(new URL(calls[2]!.url).searchParams.get("compact")).toBe("1");
    expect(new URL(calls[2]!.url).searchParams.get("cursor")).toBe("c");
    expect(new URL(calls[3]!.url).searchParams.has("compact")).toBe(false);
  });
});

describe("submitInput: 503 idempotency_capacity_exceeded", () => {
  const full = (retryAfterMs?: number): [number, unknown] => [
    503,
    { contractVersion: 2, error: { source: "cutex", code: "idempotency_capacity_exceeded", message: "store full", retryable: true, details: retryAfterMs === undefined ? {} : { retryAfterMs } } },
  ];
  const ok: [number, unknown] = [200, { cutex: { result: { disposition: "started", turnId: "t1" } } }];
  const bodyOf = (call: Call) => JSON.parse(call.body as string) as { requestId: string; params: { clientUserMessageId: string; strategy: string } };

  /** Answers `script[i]` to the i-th request (the last one repeats). */
  function scripted(script: [number, unknown][], options: ConstructorParameters<typeof CutexClient>[1] = {}) {
    const waits: number[] = [];
    let n = 0;
    const made = mockClient(() => script[Math.min(n++, script.length - 1)]!, { sleep: (ms) => (waits.push(ms), Promise.resolve()), ...options });
    return { ...made, waits };
  }

  it("retries with the same requestId and clientUserMessageId, then returns the result", async () => {
    const { client, calls, waits } = scripted([full(), full(), ok]);
    const result = await client.submitInput("s1", [{ type: "text", text: "hi" }], "auto", { clientUserMessageId: "cm-1" });
    expect(result).toMatchObject({ disposition: "started", turnId: "t1" });
    expect(calls).toHaveLength(3);
    const first = bodyOf(calls[0]!);
    for (const call of calls) {
      expect(call.method).toBe("POST");
      expect(call.url).toBe("http://h:1/v2/sessions/s1/cutex/requests");
      expect(call.body).toBe(calls[0]!.body);
    }
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.params.clientUserMessageId).toBe("cm-1");
    expect(waits).toEqual([400, 1200]);
  });

  it("covers queue submits too, and a generated clientUserMessageId stays the same across attempts", async () => {
    const { client, calls } = scripted([full(), ok]);
    await client.submitInput("s1", [], "queue");
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[1]!).params.strategy).toBe("queue");
    expect(bodyOf(calls[1]!).params.clientUserMessageId).toBe(bodyOf(calls[0]!).params.clientUserMessageId);
    expect(bodyOf(calls[1]!).requestId).toBe(bodyOf(calls[0]!).requestId);
  });

  it("gives up after 3 retries with the capacity error", async () => {
    const { client, calls, waits } = scripted([full()]);
    const failure = await client.submitInput("s1", [], "auto", { clientUserMessageId: "cm-2" }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(CutexApiError);
    expect(failure).toMatchObject({ status: 503, code: "idempotency_capacity_exceeded", retryable: true, capacityExceeded: true });
    expect(calls).toHaveLength(4);
    expect(new Set(calls.map((c) => c.body)).size).toBe(1);
    expect(waits).toEqual([400, 1200, 2400]);
  });

  it("waits for cutex's retryAfterMs when it is longer than the backoff, but never more than 3 s", async () => {
    const { client, waits } = scripted([full(900), full(60 * 60 * 1000), full(10), ok]);
    await client.submitInput("s1", [], "auto");
    expect(waits).toEqual([900, 3000, 2400]);
  });

  it("does not retry other errors", async () => {
    for (const reply of [[409, apiError("idempotency_conflict")], [503, apiError("host_unavailable")], [409, apiError("request_outcome_unknown")]] as [number, unknown][]) {
      const { client, calls, waits } = scripted([reply]);
      await expect(client.submitInput("s1", [], "auto")).rejects.toBeInstanceOf(CutexApiError);
      expect(calls).toHaveLength(1);
      expect(waits).toEqual([]);
    }
    const down = new CutexClient({ baseUrl: "http://h:1", token: null }, { fetch: () => Promise.reject(new TypeError("fetch failed")), sleep: () => Promise.reject(new Error("must not wait")) });
    await expect(down.submitInput("s1", [], "auto")).rejects.toBeInstanceOf(CutexUnreachableError);
  });

  it("retries nothing with capacityRetryDelaysMs: []", async () => {
    const { client, calls } = scripted([full(), ok], { capacityRetryDelaysMs: [] });
    await expect(client.submitInput("s1", [], "auto")).rejects.toMatchObject({ code: "idempotency_capacity_exceeded" });
    expect(calls).toHaveLength(1);
  });
});

describe("queueMove (admission-order)", () => {
  const bodyOf = (call: Call) => JSON.parse(call.body as string) as { requestId: string; method: string; params: Record<string, unknown> };

  it("posts cutex/userInput/queue/move with before = a ref or null", async () => {
    const { client, calls } = mockClient(() => [200, { cutex: { result: { revision: 18 } } }]);
    expect(await client.queueMove("s1", "q1", 17, { kind: "ask", id: "a1" })).toEqual({ revision: 18 });
    await client.queueMove("s1", "q1", 17, null);
    expect(bodyOf(calls[0]!)).toMatchObject({ method: "cutex/userInput/queue/move", params: { queueId: "q1", expectedRevision: 17, before: { kind: "ask", id: "a1" } } });
    expect(bodyOf(calls[1]!).params).toEqual({ queueId: "q1", expectedRevision: 17, before: null });
  });

  it("retries a capacity refusal under the same requestId; passing_not_allowed throws with its code", async () => {
    let n = 0;
    const full = { contractVersion: 2, error: { source: "cutex", code: "idempotency_capacity_exceeded", message: "full", retryable: true, details: {} } };
    const { client, calls } = mockClient(() => (n++ === 0 ? [503, full] : [200, { cutex: { result: {} } }]), { sleep: () => Promise.resolve() });
    await client.queueMove("s1", "q1", 3, null);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toBe(calls[0]!.body);
    const refused = { contractVersion: 2, error: { source: "cutex", code: "passing_not_allowed", message: "no", retryable: false, details: {} } };
    await expect(mockClient(() => [409, refused]).client.queueMove("s1", "q1", 3, { kind: "owner", id: "q0" })).rejects.toMatchObject({ code: "passing_not_allowed" });
  });
});

describe("queueSteer (queue-steer)", () => {
  const ok = { cutex: { result: { disposition: "steered", turnId: "t1", clientUserMessageId: "cm-1", queueRevision: 4 } } };
  const bodyOf = (call: Call) => JSON.parse(call.body as string) as { requestId: string; method: string; params: Record<string, unknown> };

  it("posts cutex/userInput/queue/steer with only the given optional params", async () => {
    const { client, calls } = mockClient(() => [200, ok]);
    expect(await client.queueSteer("s1", "q1", 3, { ifIdle: "start" })).toEqual({ disposition: "steered", turnId: "t1", clientUserMessageId: "cm-1", queueRevision: 4 });
    await client.queueSteer("s1", "q1", 3, { expectedTurnId: "t1", ifIdle: "fail" });
    await client.queueSteer("s1", "q1", 3);
    expect(calls[0]!.url).toBe("http://h:1/v2/sessions/s1/cutex/requests");
    expect(bodyOf(calls[0]!)).toMatchObject({ method: "cutex/userInput/queue/steer", params: { queueId: "q1", expectedRevision: 3, ifIdle: "start" } });
    expect(bodyOf(calls[1]!).params).toEqual({ queueId: "q1", expectedRevision: 3, expectedTurnId: "t1", ifIdle: "fail" });
    expect(bodyOf(calls[2]!).params).toEqual({ queueId: "q1", expectedRevision: 3 });
  });

  it("retries a capacity refusal under the same requestId; refusals throw with code and details", async () => {
    let n = 0;
    const full = { contractVersion: 2, error: { source: "cutex", code: "idempotency_capacity_exceeded", message: "full", retryable: true, details: {} } };
    const { client, calls } = mockClient(() => (n++ === 0 ? [503, full] : [200, ok]), { sleep: () => Promise.resolve() });
    await client.queueSteer("s1", "q1", 3);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toBe(calls[0]!.body);
    const refused = { contractVersion: 2, error: { source: "cutex", code: "steer_unavailable", message: "kept", retryable: true, details: { reason: "delegationTurn" } } };
    await expect(mockClient(() => [409, refused]).client.queueSteer("s1", "q1", 3)).rejects.toMatchObject({ code: "steer_unavailable", details: { reason: "delegationTurn" } });
  });
});

describe("self-service profile (users-self-profile)", () => {
  it("reads and patches /v2/users/me; a missing route reads as null", async () => {
    const me = { user: { id: "owner", name: "Owner", isOwner: true, displayName: "J", avatarEtag: null } };
    const { client, calls } = mockClient(() => [200, me]);
    expect(await client.usersMe()).toEqual(me);
    await client.patchUsersMe({ displayName: " J ", avatar: { contentType: "image/png", data: "AAAA" } });
    expect(calls.map((c) => [c.method, c.url, c.body ? JSON.parse(String(c.body)) : null])).toEqual([
      ["GET", "http://h:1/v2/users/me", null],
      ["PATCH", "http://h:1/v2/users/me", { displayName: "J", avatar: { contentType: "image/png", data: "AAAA" } }],
    ]);
    expect(await mockClient(() => [404, apiError("route_not_found")]).client.usersMe()).toBeNull();
    await expect(mockClient(() => [413, apiError("avatar_too_large")]).client.patchUsersMe({ displayName: "x" })).rejects.toMatchObject({ code: "avatar_too_large" });
  });

  it("lists and removes the caller's own devices (user-own-devices); a missing route reads as null", async () => {
    const device = { tokenId: "mct-1", label: "desktop-x", kind: "client", createdAt: "", userId: "u-1", pending: false, current: true };
    const { client, calls } = mockClient((c) => (c.method === "GET" ? [200, { hostId: "H", userId: "u-1", devices: [device, { tokenId: "mct-2", label: "p", kind: "device", createdAt: "", userId: "u-1", pending: false }] }] : [200, { tokenId: "mct-2", revoked: true, current: false }]));
    const mine = await client.usersMeDevices();
    expect(mine).toMatchObject({ hostId: "H", userId: "u-1" });
    expect(mine!.devices.map((d) => [d.tokenId, d.current])).toEqual([["mct-1", true], ["mct-2", false]]);
    expect(await client.usersMeRemoveDevice("mct-2")).toEqual({ tokenId: "mct-2", revoked: true, current: false });
    expect(calls.map((c) => [c.method, c.url])).toEqual([["GET", "http://h:1/v2/users/me/devices"], ["DELETE", "http://h:1/v2/users/me/devices/mct-2"]]);
    expect(await mockClient(() => [404, apiError("route_not_found")]).client.usersMeDevices()).toBeNull();
    await expect(mockClient(() => [403, apiError("user_pending")]).client.usersMeDevices()).rejects.toMatchObject({ code: "user_pending" });
    await expect(mockClient(() => [404, apiError("client_token_not_found")]).client.usersMeRemoveDevice("mct-9")).rejects.toMatchObject({ code: "client_token_not_found" });
  });

  it("fetches an avatar as base64 with its ETag; none / invisible / not an image reads as null", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const fetchWith = (response: () => Response) => new CutexClient({ baseUrl: "http://h:1", token: "tok" }, { fetch: (async () => response()) as typeof globalThis.fetch, clientId: "c" });
    const ok = await fetchWith(() => new Response(png, { status: 200, headers: { "Content-Type": "image/png", ETag: '"0123456789abcdef"' } })).userAvatar("u-0123456789ab");
    expect(ok).toEqual({ contentType: "image/png", data: Buffer.from(png).toString("base64"), etag: "0123456789abcdef" });
    expect(await fetchWith(() => new Response(JSON.stringify(apiError("avatar_not_found")), { status: 404 })).userAvatar("owner")).toBeNull();
    expect(await fetchWith(() => new Response("<svg/>", { status: 200, headers: { "Content-Type": "image/svg+xml" } })).userAvatar("owner")).toBeNull();
    expect(await fetchWith(() => new Response(new Uint8Array(49 * 1024), { status: 200, headers: { "Content-Type": "image/png" } })).userAvatar("owner")).toBeNull();
    await expect(fetchWith(() => new Response("{}")).userAvatar("../x")).rejects.toThrow("bad user id");
  });
});

describe("users and grants (users)", () => {
  const grant = { projects: ["p1", "p1", "p2"], standaloneAgents: ["s1"], send: true };
  it("lists, creates, patches, deletes, binds and changes settings on /v2/users; a missing route lists as null", async () => {
    const { client, calls } = mockClient((c) => (c.method === "GET" ? [200, { revision: 3, users: [], tokens: [], peers: [], settings: { ownerRequiresApproval: true } }] : [200, {}]));
    expect(await client.users()).toMatchObject({ revision: 3 });
    await client.createUser({ name: "  Mia ", color: "#ff8800", grant });
    await client.patchUser("u-0123456789ab", { grant: { projects: "all", standaloneAgents: [], send: false } });
    await client.patchUser("owner", { name: "Me" });
    await client.deleteUser("u-0123456789ab");
    await client.bindTokenUser("tok-1", "u-0123456789ab");
    await client.bindTokenUser("tok-2", null);
    await client.bindPeerUser("ci-0123456789abcdef0123456789abcdef", "owner");
    await client.patchUsersSettings({ ownerRequiresApproval: false });
    await client.createPairingCode("phone", { userId: "u-0123456789ab" });
    await client.createPairingCode("tablet");
    expect(calls.map((c) => [c.method, c.url, c.body === undefined || c.body === null ? null : JSON.parse(String(c.body))])).toEqual([
      ["GET", "http://h:1/v2/users", null],
      ["POST", "http://h:1/v2/users", { name: "Mia", color: "#ff8800", grant: { projects: ["p1", "p2"], standaloneAgents: ["s1"], send: true } }],
      ["PATCH", "http://h:1/v2/users/u-0123456789ab", { grant: { projects: "all", standaloneAgents: [], send: false } }],
      ["PATCH", "http://h:1/v2/users/owner", { name: "Me" }],
      ["DELETE", "http://h:1/v2/users/u-0123456789ab", null],
      ["PUT", "http://h:1/v2/users/token-bindings/tok-1", { userId: "u-0123456789ab" }],
      ["PUT", "http://h:1/v2/users/token-bindings/tok-2", { userId: null }],
      ["PUT", "http://h:1/v2/users/peer-bindings/ci-0123456789abcdef0123456789abcdef", { userId: "owner" }],
      ["PATCH", "http://h:1/v2/users/settings", { ownerRequiresApproval: false }],
      ["POST", "http://h:1/v2/pairing-codes", { label: "phone", userId: "u-0123456789ab" }],
      ["POST", "http://h:1/v2/pairing-codes", { label: "tablet" }],
    ]);
    expect(await mockClient(() => [404, apiError("route_not_found")]).client.users()).toBeNull();
  });

  it("validates before any request; refusals throw with their code", async () => {
    const { client, calls } = mockClient();
    await expect(client.createUser({ name: "   " })).rejects.toThrow("bad user name");
    await expect(client.createUser({ name: "x", grant: { projects: [1], standaloneAgents: [], send: true } as never })).rejects.toThrow("bad grant projects");
    await expect(client.createUser({ name: "x", color: "red;}" })).rejects.toThrow("bad user color");
    await expect(client.patchUser("../x", { name: "x" })).rejects.toThrow("bad user id");
    await expect(client.patchUser("u-1", {})).rejects.toThrow("empty user patch");
    await expect(client.deleteUser("owner")).rejects.toThrow("bad user id");
    await expect(client.bindTokenUser("a/b", null)).rejects.toThrow("bad token id");
    await expect(client.bindPeerUser("x", "owner")).rejects.toThrow("bad peer id");
    await expect(client.createPairingCode("x", { userId: "root" })).rejects.toThrow("bad user id");
    expect(calls).toEqual([]);
    await expect(mockClient(() => [409, apiError("user_in_use")]).client.deleteUser("u-1")).rejects.toMatchObject({ code: "user_in_use", status: 409 });
    await expect(mockClient(() => [403, apiError("owner_required")]).client.users()).rejects.toMatchObject({ code: "owner_required", status: 403 });
  });
});

describe("dot-only ids never reroute a request", () => {
  it("refuses `.` / `..` token, session and ask ids before any request", async () => {
    const { client, calls } = mockClient();
    for (const id of [".", "..", "..."]) {
      expect(() => client.revokeClientToken(id)).toThrow(/bad token id/);
      expect(() => client.renameClientToken(id, "x")).toThrow(/bad token id/);
      await expect(client.ask(id)).rejects.toThrow(/bad ask id/);
      await expect(client.setQuotaAutoContinue(id, true)).rejects.toThrow(/bad session id/);
    }
    // Ids with dots inside still pass.
    await client.revokeClientToken("tok.1");
    expect(calls.map((c) => c.url)).toEqual(["http://h:1/v2/client-tokens/tok.1"]);
  });

  it("refuses any dot segment in a request path, also percent-encoded (not reported as unreachable)", async () => {
    const { client, calls } = mockClient();
    await expect(client.session("..")).rejects.toThrow(/dot segment/);
    await expect(client.session("..")).rejects.not.toBeInstanceOf(CutexUnreachableError);
    await expect(client.bootstrap(".")).rejects.toThrow(/dot segment/);
    expect(calls).toHaveLength(0);
    expect(hasDotSegment("/v2/sessions/%2e%2E/x")).toBe(true);
    expect(hasDotSegment("/v2/sessions/.%2e")).toBe(true);
    expect(hasDotSegment("/v2/a/./b")).toBe(true);
    expect(hasDotSegment("/v2/sessions/a..b?x=..")).toBe(false);
    expect(hasDotSegment("/v2/sessions/...")).toBe(false);
  });
});
