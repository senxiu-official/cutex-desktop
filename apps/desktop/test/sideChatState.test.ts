import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SideChat } from "../src/shared/sideChat";
import { NOTE_BODY_LIMIT } from "../src/shared/notes";

const harness = vi.hoisted(() => ({
  host: "host-a",
  notify: vi.fn(),
  api: {
    sideOpen: vi.fn(), sideRead: vi.fn(), sideSend: vi.fn(), sideInterrupt: vi.fn(),
    sideRespond: vi.fn(), sideClose: vi.fn(), notesCreate: vi.fn(), history: vi.fn(),
  },
}));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { daemonFor: vi.fn(() => harness.api) } }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ hosts: { active: harness.host }, sessions: {} }) }, viewHostOf: () => harness.host, viewOf: () => undefined }));


import { sideErrorText } from "../src/renderer/src/modules/side-chat/errors";
import { closeSideChat, closeSideInstance, openSideChat, receiveSide, showSide, loadSide, sendSide, setSideDraft, sideKey, sideModuleActive, summarizeSide, useSides } from "../src/renderer/src/modules/side-chat/state";

function chat(over: Partial<SideChat> = {}): SideChat {
  return {
    id: "side-1", sessionId: "parent-1", threadId: "side-thread", anchorTurnId: "parent-turn",
    lastTurnId: null, forkedThroughTurnId: "fork-cutoff", runtimeGeneration: 4, status: "ready", createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:01Z",
    activeTurnId: null, revision: 1, events: [], pendingRequests: [], truncated: false,
    model: "gpt-test", effort: "high", ...over,
  };
}
function completed(body = "# A note\n\nA confirmed conclusion.") {
  return chat({ revision: 5, events: [
    { seq: 1, method: "turn/started", params: { turn: { id: "summary-turn", status: "inProgress", items: [] } } },
    { seq: 2, method: "item/completed", params: { turnId: "summary-turn", item: { type: "agentMessage", id: "summary-reply", text: body, phase: "final_answer" } } },
    { seq: 3, method: "turn/completed", params: { turn: { id: "summary-turn", status: "completed", items: [] } } },
  ] });
}
function seed(draft = "A side question") {
  const view = { chat: chat(), draft, sending: false, error: null, summary: null, pendingMessage: null, unread: false, parentThreadId: "parent-thread" };
  useSides.setState({ views: { [sideKey("host-a", "side-1")]: view } });
}
function current() { return useSides.getState().views[sideKey("host-a", "side-1")]!; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  sideModuleActive(false);
  harness.host = "host-a";
  for (const fn of Object.values(harness.api)) fn.mockReset();
  harness.notify.mockReset();
  // No timer or event loop: long polls stay pending until a test explicitly returns a change.
  harness.api.sideRead.mockImplementation(() => new Promise(() => {}));
  harness.api.sideClose.mockResolvedValue({ closed: true });
  harness.api.notesCreate.mockResolvedValue({ id: "note-1" });
  seed();
  sideModuleActive(true);
});
afterEach(() => { sideModuleActive(false); });

describe("Side request identity and lifecycle", () => {
  it("closes a thread whose open completes after the user closes the card", async () => {
    const response = deferred<{ chat: SideChat }>();
    harness.api.sideOpen.mockReturnValue(response.promise);
    const opening = openSideChat("pending-card", "host-a", "parent-1", {}, "Do not send after closing");
    const closing = closeSideInstance("pending-card", "host-a", "parent-1");
    expect(harness.api.sideClose).not.toHaveBeenCalled();
    response.resolve({ chat: chat() });
    await opening;
    expect(await closing).toBe(true);
    expect(harness.api.sideClose).toHaveBeenCalledWith("parent-1", "side-1");
    expect(harness.api.sideSend).not.toHaveBeenCalled();
  });
  it("releases closed transcripts and bounds UI tombstones without reviving evicted reads", async () => {
    const response = deferred<{ chat: SideChat }>();
    harness.api.sideRead.mockReturnValueOnce(response.promise);
    const loading = loadSide("host-a", "parent-1", "side-1");
    receiveSide("host-a", completed());
    await closeSideChat("host-a", "parent-1", "side-1");
    expect(current().chat.events).toEqual([]);
    expect(current().summary).toBeNull();
    for (let n = 0; n < 140; n++) {
      receiveSide("host-a", chat({ id: `new-${n}`, events: completed().events }));
      await closeSideChat("host-a", "parent-1", `new-${n}`);
    }
    expect(Object.keys(useSides.getState().views)).toHaveLength(128);
    response.resolve({ chat: completed() }); await loading;
    expect(current()).toBeUndefined();
  });
  it("reattaches from conflict details and retains the question as a draft", async () => {
    harness.api.sideOpen.mockResolvedValue({ error: { code: "side_chat_already_open", message: "exists", details: { chatId: "side-1", anchorTurnId: "old" } } });
    harness.api.sideRead.mockResolvedValueOnce({ chat: chat({ anchorTurnId: "old" }) });
    expect(await openSideChat("conflict-card", "host-a", "parent-1", { anchorTurnId: "new" }, "new question")).toBe("side-1");
    expect(harness.api.sideRead).toHaveBeenCalledWith("parent-1", "side-1");
    expect(harness.api.sideSend).not.toHaveBeenCalled();
    expect(current().draft).toBe("new question");
    await closeSideInstance("conflict-card", "host-a", "parent-1", "side-1");
  });
  it("an External Input fork refusal reads as busy / held text, never the raw code", async () => {
    harness.api.sideOpen.mockResolvedValue({ error: { code: "side_fork_blocked_external_input", message: "x", details: { blockedBy: "held", asks: 0, messages: 1 } } });
    const error = await openSideChat("blocked-card", "host-a", "parent-1").catch(e => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(harness.api.sideRead).not.toHaveBeenCalled();
    const t = (key: string) => key;
    expect(sideErrorText((error as Error).message, t)).toBe("side-chat.forkHeld");
    // Through Electron IPC only the message survives, wrapped.
    expect(sideErrorText(`Error invoking remote method: Error: ${(error as Error).message}`, t)).toBe("side-chat.forkHeld");
    expect(sideErrorText("side_fork_blocked_external_input: busy", t)).toBe("side-chat.forkBusy");
    expect(sideErrorText("side_fork_blocked_external_input: the agent is still working", t)).toBe("side-chat.forkBusy");
    expect(sideErrorText("side_native_error: other", t)).toBe("side_native_error: other");
    // The failed open is not cached: a retry asks cutex again.
    harness.api.sideOpen.mockResolvedValue({ chat: chat({ id: "side-2" }) });
    await expect(openSideChat("blocked-card", "host-a", "parent-1")).resolves.toBe("side-2");
  });
  it("maps Claude Side refusals to readable text (docs/SIDE-CHATS.md \"Claude agents\")", () => {
    const t = (key: string) => key;
    const ipc = (text: string) => `Error invoking remote method 'cutex-desktop:invoke': CutexApiError: ${text}`;
    expect(sideErrorText(ipc("side_runtime_unsupported: claude adapter lacks sideChat"), t)).toBe("side-chat.runtimeUnsupported");
    expect(sideErrorText(ipc("side_runtime_offline: parent is not connected"), t)).toBe("side-chat.offline");
    expect(sideErrorText(ipc("side_chat_not_found: no such side chat"), t)).toBe("side-chat.stale");
    expect(sideErrorText(ipc("side_boundary_changed: the running turn has just started; retry in a moment"), t)).toBe("side-chat.boundaryChanged");
    expect(sideErrorText("native_transcript_behind", t)).toBe("side-chat.boundaryChanged");
    // Codes are matched whole: a longer code is not one of them.
    expect(sideErrorText("side_runtime_offline_x: other", t)).toBe("side_runtime_offline_x: other");
  });
  it("a send to a chat lost to an adapter restart (404 side_chat_not_found) marks it stale, not an error", async () => {
    seed();
    harness.api.sideSend.mockRejectedValueOnce(new Error("CutexApiError: side_chat_not_found: side chat not found"));
    await sendSide("host-a", "side-1");
    expect(current().chat.status).toBe("stale");
    expect(current().error).toBeNull();
  });
  it("hiding stops new polls without closing, and a late reply marks unread", async () => {
    const response = deferred<{ chat: SideChat }>();
    harness.api.sideRead.mockReturnValueOnce(response.promise);
    const hide = showSide("host-a", "side-1");
    hide(); response.resolve({ chat: completed() });
    await vi.waitFor(() => expect(current().unread).toBe(true));
    expect(harness.api.sideRead).toHaveBeenCalledTimes(1);
    expect(harness.api.sideClose).not.toHaveBeenCalled();
    const hideAgain = showSide("host-a", "side-1");
    expect(current().unread).toBe(false); hideAgain();
  });
  it("retries an uncertain send with the original message id and immutable text", async () => {
    harness.api.sideSend.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ chat: chat({ revision: 2 }), turnId: "turn-2" });
    await sendSide("host-a", "side-1");
    expect(current().error).toBe("response lost");
    const firstInput = harness.api.sideSend.mock.calls[0]![2];
    // Programmatic draft changes must not silently change the request being retried.
    setSideDraft("host-a", "side-1", "A different follow-up");
    await sendSide("host-a", "side-1");
    expect(harness.api.sideSend.mock.calls[1]![2]).toEqual(firstInput);
  });

  it("deduplicates double-send while the first request is pending", async () => {
    const response = deferred<{ chat: SideChat; turnId: string }>();
    harness.api.sideSend.mockReturnValue(response.promise);
    const first = sendSide("host-a", "side-1");
    await sendSide("host-a", "side-1");
    expect(harness.api.sideSend).toHaveBeenCalledTimes(1);
    response.resolve({ chat: chat({ revision: 2 }), turnId: "turn-2" });
    await first;
    expect(current().sending).toBe(false);
  });

  it("never resurrects an explicitly closed Side with a late send response", async () => {
    const response = deferred<{ chat: SideChat; turnId: string }>();
    harness.api.sideSend.mockReturnValue(response.promise);
    const sending = sendSide("host-a", "side-1");
    expect(await closeSideChat("host-a", "parent-1", "side-1")).toBe(true);
    response.resolve({ chat: chat({ revision: 10, status: "running", activeTurnId: "turn-2" }), turnId: "turn-2" });
    await sending;
    expect(current().chat.status).toBe("closed");
  });

  it("never resurrects an explicitly closed Side with a late load response", async () => {
    const response = deferred<{ chat: SideChat }>();
    harness.api.sideRead.mockReturnValueOnce(response.promise);
    const loading = loadSide("host-a", "parent-1", "side-1");
    await closeSideChat("host-a", "parent-1", "side-1");
    response.resolve({ chat: chat({ revision: 10 }) });
    await loading;
    expect(current().chat.status).toBe("closed");
  });

  it("dispatches to the bound host even after focus changes", async () => {
    const { services } = await import("../src/renderer/src/modules/app");
    harness.host = "host-b";
    harness.api.sideSend.mockResolvedValue({ chat: chat({ revision: 2 }), turnId: "t2" });
    await sendSide("host-a", "side-1");
    expect(await closeSideChat("host-a", "parent-1", "side-1")).toBe(true);
    expect(services.daemonFor).toHaveBeenLastCalledWith("host-a");
    expect(harness.api.sideSend).toHaveBeenCalledTimes(1);
  });
});

describe("one-click Side notes", () => {
  it("defaults a toolbar-opened chat to the actual fork cutoff", async () => {
    receiveSide("host-a", chat({ anchorTurnId: null }));
    harness.api.sideSend.mockResolvedValue({ chat: { ...completed(), anchorTurnId: null }, turnId: "summary-turn" });
    await summarizeSide("host-a", "side-1", "Summarize");
    await vi.waitFor(() => expect(current().summary?.status).toBe("saved"));
    expect(harness.api.notesCreate.mock.calls[0]![0].anchor).toEqual({ sessionId: "parent-1", threadId: "parent-thread", turnId: "fork-cutoff" });
  });
  it("reads the bound parent's latest turn at save time when selected", async () => {
    harness.api.history.mockResolvedValue({ threadId: "parent-thread", native: { result: { thread: { id: "parent-thread", turns: [{ id: "newest-main-turn", status: "completed", items: [] }] } } } });
    harness.api.sideSend.mockResolvedValue({ chat: completed(), turnId: "summary-turn" });
    await summarizeSide("host-a", "side-1", "Summarize", "latest");
    await vi.waitFor(() => expect(current().summary?.status).toBe("saved"));
    expect(harness.api.notesCreate.mock.calls[0]![0].anchor).toEqual({ sessionId: "parent-1", threadId: "parent-thread", turnId: "newest-main-turn" });
  });
  it("retains the acknowledged summary turn on its original host after a host switch", async () => {
    const response = deferred<{ chat: SideChat; turnId: string }>();
    harness.api.sideSend.mockReturnValue(response.promise);
    const generating = summarizeSide("host-a", "side-1", "Summarize this discussion");
    harness.host = "host-b";
    response.resolve({ chat: chat({ revision: 3, status: "running", activeTurnId: "summary-turn" }), turnId: "summary-turn" });
    await generating;
    expect(current().summary).toMatchObject({ status: "generating", turnId: "summary-turn" });
    expect(harness.api.notesCreate).not.toHaveBeenCalled();
    expect(useSides.getState().views[sideKey("host-b", "side-1")]).toBeUndefined();
  });

  it("retries a lost summary acknowledgement with the same nonce and original prompt", async () => {
    harness.api.sideSend.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ chat: chat({ revision: 2 }), turnId: "summary-turn" });
    await summarizeSide("host-a", "side-1", "Original summary prompt");
    const first = harness.api.sideSend.mock.calls[0]![2];
    await summarizeSide("host-a", "side-1", "Changed settings after the failure");
    expect(harness.api.sideSend.mock.calls[1]![2]).toEqual(first);
  });

  it("saves one note with parent provenance and no native main-chat write", async () => {
    harness.api.sideSend.mockResolvedValue({ chat: completed(), turnId: "summary-turn" });
    await summarizeSide("host-a", "side-1", "Summarize this discussion");
    await vi.waitFor(() => expect(current().summary?.status).toBe("saved"));
    expect(harness.api.notesCreate).toHaveBeenCalledTimes(1);
    expect(harness.api.notesCreate.mock.calls[0]![0]).toMatchObject({
      title: "A note", body: "# A note\n\nA confirmed conclusion.",
      scope: { kind: "session", id: "parent-1" }, pins: [], anchor: { sessionId: "parent-1", turnId: "parent-turn" },
    });
    expect(harness.api.notesCreate.mock.calls[0]![0].anchor.threadId).not.toBe("side-thread");
    expect(harness.api.sideSend).toHaveBeenCalledTimes(1);
    expect(harness.api.sideSend.mock.calls[0]!.slice(0, 2)).toEqual(["parent-1", "side-1"]);
  });

  it("a failed note save retries its immutable body+nonce without asking the model again", async () => {
    harness.api.sideSend.mockResolvedValue({ chat: completed(), turnId: "summary-turn" });
    harness.api.notesCreate.mockRejectedValueOnce(new Error("save response lost")).mockResolvedValueOnce({ id: "note-1" });
    await summarizeSide("host-a", "side-1", "Summarize");
    await vi.waitFor(() => expect(current().summary?.status).toBe("failed"));
    const first = harness.api.notesCreate.mock.calls[0]![0];
    await summarizeSide("host-a", "side-1", "Changed prompt");
    expect(harness.api.notesCreate).toHaveBeenCalledTimes(2);
    expect(harness.api.notesCreate.mock.calls[1]![0]).toEqual(first);
    expect(harness.api.sideSend).toHaveBeenCalledTimes(1);
    expect(current().summary?.status).toBe("saved");
  });

  it("saves promptly when a completed summary arrives before the send acknowledgement", async () => {
    const response = deferred<{ chat: SideChat; turnId: string }>();
    harness.api.sideSend.mockReturnValue(response.promise);
    const generating = summarizeSide("host-a", "side-1", "Summarize");
    harness.api.sideRead.mockResolvedValueOnce({ chat: completed() });
    await loadSide("host-a", "parent-1", "side-1");
    expect(current().summary?.status).toBe("requesting");
    response.resolve({ chat: chat({ revision: 2, status: "running", activeTurnId: "summary-turn" }), turnId: "summary-turn" });
    await generating;
    await vi.waitFor(() => expect(current().summary?.status).toBe("saved"));
    expect(harness.api.notesCreate).toHaveBeenCalledTimes(1);
    expect(current().chat.revision).toBe(5);
  });

  it("does not get stuck forever retrying a note body beyond the API limit", async () => {
    harness.api.sideSend.mockResolvedValue({ chat: completed("x".repeat(NOTE_BODY_LIMIT + 1)), turnId: "summary-turn" });
    await summarizeSide("host-a", "side-1", "Summarize");
    await vi.waitFor(() => expect(current().summary?.status).toBe("failed"));
    expect(current().summary?.input).toBeUndefined();
    expect(harness.api.notesCreate).not.toHaveBeenCalled();
  });
});
