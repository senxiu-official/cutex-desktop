import { describe, expect, it, vi } from "vitest";
import { CutexApiError, type CutexClient } from "@cutex-desktop/cutex-client";
import { notesApi, scopeId, sideApi } from "../src/main/notesSideApi";

function harness() {
  const request = vi.fn().mockResolvedValue({});
  const client = { request } as unknown as CutexClient;
  return { request, notes: notesApi(client), side: sideApi(client) };
}
describe("owner Notes bridge", () => {
  it("reads one note by validated id", async () => {
    const { notes, request } = harness();
    await notes.notesGet("note-one");
    expect(request).toHaveBeenCalledWith("GET", "/v2/notes/note-one");
    expect(() => notes.notesGet("../notes")).toThrow();
  });
  it("keeps source scope and pins separate; strips unrecognized fields", async () => {
    const { notes, request } = harness();
    await notes.notesCreate({ clientNonce: "retry-1", title: "", body: "笔记", scope: { kind: "session", id: "s-1" }, pins: [{ kind: "project", id: "p-1" }, { kind: "host" }], anchor: { sessionId: "s-1", turnId: "t-1" } });
    expect(request).toHaveBeenCalledWith("POST", "/v2/notes", { body: { clientNonce: "retry-1", title: "", body: "笔记", scope: { kind: "session", id: "s-1" }, pins: [{ kind: "project", id: "p-1" }, { kind: "host" }], anchor: { sessionId: "s-1", turnId: "t-1" } } });
  });
  it("sends revision guards for updates and deletion, never silently overwrites", async () => {
    const { notes, request } = harness();
    await notes.notesUpdate("note-1", { expectedRevision: 4, body: "更新", pins: [] });
    expect(request).toHaveBeenLastCalledWith("PATCH", "/v2/notes/note-1", { body: { expectedRevision: 4, body: "更新", pins: [] } });
    await notes.notesDelete("note-1", 5);
    expect(request).toHaveBeenLastCalledWith("DELETE", "/v2/notes/note-1", { body: { expectedRevision: 5 } });
    expect(() => notes.notesDelete("note-1", 0)).toThrow("revision");
  });
  it("validates sizes, query limits and resource identifiers before HTTP", () => {
    const { notes, request } = harness();
    for (const id of ["..", ".", "../../x", "a/b", "a?b", "a\0b", ""]) expect(() => scopeId(id)).toThrow();
    expect(scopeId("session-1:abc.def")).toBe("session-1:abc.def");
    expect(() => notes.notesCreate({ clientNonce: "n", title: "", body: "x".repeat(64001), scope: { kind: "host" } })).toThrow();
    expect(() => notes.notesList({ limit: 201 })).toThrow();
    expect(() => notes.notesList({ query: "x".repeat(501) })).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
describe("owner Side bridge", () => {
  it("preserves the conflict attachment details across serializable IPC", async () => {
    const { side, request } = harness();
    request.mockRejectedValue(new CutexApiError(409, "side_chat_already_open", "already open", false, { chatId: "side-1", anchorTurnId: "turn-1" }));
    expect(JSON.parse(JSON.stringify(await side.sideOpen("parent")))).toMatchObject({ error: { code: "side_chat_already_open", details: { chatId: "side-1", anchorTurnId: "turn-1" } } });
    request.mockRejectedValue(new CutexApiError(409, "side_runtime_offline", "offline"));
    await expect(side.sideOpen("parent")).rejects.toThrow("offline");
  });
  it("turns an External Input fork refusal into counts only (no message bodies) across IPC", async () => {
    const { side, request } = harness();
    request.mockRejectedValue(new CutexApiError(409, "side_fork_blocked_external_input", "held", false, {
      blockedBy: "held", blockingAsks: [{ askId: "ask-1" }],
      externalInput: [{ messageId: "m-1", held: true, sender: { id: "cutex.a", name: "A" } }, { messageId: "m-2", state: "pending" }],
    }));
    const result = JSON.parse(JSON.stringify(await side.sideOpen("parent")));
    expect(result).toEqual({ error: { code: "side_fork_blocked_external_input", message: "side_fork_blocked_external_input: held",
      details: { blockedBy: "held", asks: 1, messages: 2 } } });
    request.mockRejectedValue(new CutexApiError(409, "side_fork_blocked_external_input", "busy", false, { blockedBy: "weird" }));
    expect(await side.sideOpen("parent")).toMatchObject({ error: { details: { blockedBy: "busy", asks: 0, messages: 0 } } });
  });
  it("passes a model without adding renderer thread authority, with a 200-byte limit", async () => {
    const { side, request } = harness();
    await side.sideOpen("parent", { model: "gpt-test" });
    expect(request).toHaveBeenCalledWith("POST", "/v2/sessions/parent/side-chats", { body: { model: "gpt-test" } });
    await expect(side.sideOpen("parent", { model: "字".repeat(100) })).rejects.toThrow("model");
    await expect(side.sideOpen("parent", { model: "a\nb" })).rejects.toThrow("model");
  });
  it("only uses session-scoped Side routes, keeping native IDs out of renderer authority", async () => {
    const { side, request } = harness();
    await side.sideOpen("parent", { anchorTurnId: "anchor", lastTurnId: "cutoff" });
    expect(request).toHaveBeenLastCalledWith("POST", "/v2/sessions/parent/side-chats", { body: { anchorTurnId: "anchor", lastTurnId: "cutoff" } });
    await side.sideSend("parent", "side", { text: "旁支问题", clientMessageId: "retry-key" });
    expect(request).toHaveBeenLastCalledWith("POST", "/v2/sessions/parent/side-chats/side/messages", { body: { text: "旁支问题", clientMessageId: "retry-key" } });
    await side.sideInterrupt("parent", "side");
    expect(request).toHaveBeenLastCalledWith("POST", "/v2/sessions/parent/side-chats/side/interrupt", { body: {} });
    await side.sideClose("parent", "side");
    expect(request).toHaveBeenLastCalledWith("DELETE", "/v2/sessions/parent/side-chats/side");
  });
  it("bounds change-driven reads", async () => {
    const { side, request } = harness();
    await side.sideRead("parent", "side", 12, 25000);
    expect(request).toHaveBeenLastCalledWith("GET", "/v2/sessions/parent/side-chats/side", { query: { afterRevision: 12, waitMs: 25000 } });
    expect(() => side.sideRead("parent", "side", -1)).toThrow();
    expect(() => side.sideRead("parent", "side", 12, 25001)).toThrow();
    expect(() => side.sideSend("parent", "side", { text: "字".repeat(22000), clientMessageId: "n" })).toThrow("UTF-8");
  });
  it("accepts one native response or error, never arbitrary native calls", async () => {
    const { side, request } = harness();
    await side.sideRespond("parent", "side", 7, { result: { decision: "decline" } });
    expect(request).toHaveBeenLastCalledWith("POST", "/v2/sessions/parent/side-chats/side/responses", { body: { requestId: 7, result: { decision: "decline" } } });
    await side.sideRespond("parent", "side", "request", { error: { code: -32603, message: "No" } });
    expect(request).toHaveBeenLastCalledWith("POST", "/v2/sessions/parent/side-chats/side/responses", { body: { requestId: "request", error: { code: -32603, message: "No" } } });
    expect(() => side.sideRespond("p", "s", 1, { error: { code: NaN, message: "No" } })).toThrow();
    expect(() => side.sideRespond("p", "s", 1, { result: {}, error: { code: 1, message: "No" } })).toThrow();
  });
});
