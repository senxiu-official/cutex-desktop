import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { applyEvent, orderedEntries, parseExternalInput, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { toInteraction } from "../src/renderer/src/lib/interactions";

function native(method: string, params: unknown, kind: "notification" | "serverRequest" = "notification", id?: number): EventEnvelope {
  return {
    contractVersion: 2,
    eventId: "e",
    cursor: "c",
    streamId: "s",
    sequence: 1,
    receivedAt: "",
    cutexSessionId: "me",
    hostId: "h",
    source: "app_server",
    sensitivity: "owner",
    correlation: {},
    native: { kind, message: { id, method, params } },
  };
}

const externalItem = {
  type: "functionCallOutput",
  id: "msg-1",
  name: "external_event",
  namespace: "external",
  output: JSON.stringify({ source: { kind: "agent", id: "eva" }, type: "message", text: "Message Type: MESSAGE\nPayload:\nhello from eva" }),
  externalInputView: {
    schema: "cutex.agent-message.v1",
    data: { senderId: "eva", senderName: "Eva", deliveryMode: "after_turn", occurredAtEpochSeconds: 1 },
  },
};

describe("timeline", () => {
  it("parses cross-agent external input and strips the payload prefix", () => {
    expect(parseExternalInput(externalItem)).toEqual({
      senderId: "eva",
      senderName: "Eva",
      deliveryMode: "after_turn",
      text: "hello from eva",
      schema: "cutex.agent-message.v1",
      data: externalItem.externalInputView.data,
      eventType: "message",
      sourceKind: "agent",
    });
  });

  it("accepts array-form function call output", () => {
    const item = { ...externalItem, output: [{ type: "input_text", text: externalItem.output }] };
    expect(parseExternalInput(item)?.text).toBe("hello from eva");
    expect(parseExternalInput(item)).toMatchObject({ eventType: "message", sourceKind: "agent" });
  });

  it("carries the event body's type and source kind as they are", () => {
    const withBody = (body: unknown) => ({ ...externalItem, output: JSON.stringify(body) });
    expect(parseExternalInput(withBody({ source: { kind: "agent", id: "lead" }, type: "ASK", text: "brief" }))).toMatchObject({ eventType: "ASK", sourceKind: "agent", text: "brief" });
    expect(parseExternalInput(withBody({ source: { kind: "owner", id: "owner" }, type: "QUESTION", text: "?" }))).toMatchObject({ eventType: "QUESTION", sourceKind: "owner" });
    expect(parseExternalInput(withBody({ source: { kind: "service", id: "cutex-alarm" }, type: "alarm", text: "wake" }))).toMatchObject({ eventType: "alarm", sourceKind: "service" });
    // Missing or non-string fields → null.
    expect(parseExternalInput(withBody({ text: "bare" }))).toMatchObject({ eventType: null, sourceKind: null, text: "bare" });
    expect(parseExternalInput(withBody({ source: { id: "eva" }, type: 3, text: "x" }))).toMatchObject({ eventType: null, sourceKind: null });
    // Output that is not JSON is the text itself.
    expect(parseExternalInput({ ...externalItem, output: "plain words" })).toMatchObject({ eventType: null, sourceKind: null, text: "plain words" });
  });

  it("builds from thread/read and applies live deltas", () => {
    const state = timelineFromThreadRead({
      thread: {
        id: "t1",
        turns: [
          {
            id: "turn-1",
            status: "completed",
            items: [
              { type: "userMessage", id: "u1", content: [{ type: "text", text: "hi" }] },
              { type: "agentMessage", id: "a1", text: "hello" },
              externalItem,
            ],
          },
        ],
      },
    });
    expect(orderedEntries(state).map((e) => e.kind)).toEqual(["user", "agent", "received"]);

    applyEvent(state, native("turn/started", { turn: { id: "turn-2", status: "inProgress" } }));
    applyEvent(state, native("item/agentMessage/delta", { turnId: "turn-2", itemId: "a2", delta: "wor" }));
    applyEvent(state, native("item/agentMessage/delta", { turnId: "turn-2", itemId: "a2", delta: "ld" }));
    expect(state.activeTurnId).toBe("turn-2");
    const streaming = state.entries.get("a2");
    expect(streaming).toMatchObject({ kind: "agent", text: "world", streaming: true });

    applyEvent(state, native("turn/completed", { turn: { id: "turn-2", status: "completed" } }));
    expect(state.activeTurnId).toBeNull();
    expect(state.entries.get("a2")).toMatchObject({ streaming: false });
  });

  it("plan mode: proposed plan streams into a plan entry; update_plan keeps one checklist per turn", () => {
    const state = timelineFromThreadRead({ thread: { id: "t", turns: [] } });
    applyEvent(state, native("turn/started", { turn: { id: "p1", status: "inProgress" } }));
    applyEvent(state, native("item/plan/delta", { turnId: "p1", itemId: "pl", delta: "1. read" }));
    applyEvent(state, native("item/plan/delta", { turnId: "p1", itemId: "pl", delta: "\n2. write" }));
    expect(state.entries.get("pl")).toMatchObject({ kind: "plan", text: "1. read\n2. write", streaming: true });
    applyEvent(state, native("turn/plan/updated", { turnId: "p1", explanation: null, plan: [{ step: "a", status: "inProgress" }] }));
    applyEvent(state, native("turn/plan/updated", { turnId: "p1", explanation: "x", plan: [{ step: "a", status: "completed" }] }));
    expect(orderedEntries(state).filter((e) => e.kind === "checklist")).toHaveLength(1);
    expect(state.entries.get("checklist:p1")).toMatchObject({ explanation: "x", steps: [{ step: "a", status: "completed" }] });
    applyEvent(state, native("turn/completed", { turn: { id: "p1", status: "completed" } }));
    expect(state.entries.get("pl")).toMatchObject({ streaming: false });
  });

  it("tracks pending server requests until resolved", () => {
    const state = timelineFromThreadRead({ thread: { id: "t", turns: [] } });
    applyEvent(state, native("item/tool/requestUserInput", { questions: [] }, "serverRequest", 7));
    expect(state.pending.has("7")).toBe(true);
    applyEvent(state, native("serverRequest/resolved", { requestId: 7 }));
    expect(state.pending.size).toBe(0);
  });

  it("serverRequest/resolved settles an answer still in flight (store.respond must not put it back)", () => {
    const state = timelineFromThreadRead({ thread: { id: "t", turns: [] } });
    applyEvent(state, native("item/commandExecution/requestApproval", { threadId: "t", command: "ls" }, "serverRequest", 5));
    // store.respond: out of the dock while the reply is in flight.
    state.pending.delete("5");
    state.answering.add("5");
    expect(applyEvent(state, native("serverRequest/resolved", { threadId: "t", requestId: 5 }))).toBe(false);
    expect(state.answering.has("5")).toBe(false);
  });

  it("restores pending approvals from bootstrap pendingServerRequests (`native` = raw request)", () => {
    // Shape of cutex management v2 server_requests::snapshot.
    const params = { threadId: "t", turnId: "turn-1", itemId: "c1", command: "rm -rf build", availableDecisions: ["accept", "decline", "cancel"] };
    const state = timelineFromThreadRead({ thread: { id: "t", turns: [] } }, [
      { runtimeGeneration: 3, native: { id: 12, method: "item/commandExecution/requestApproval", params } },
      { runtimeGeneration: 3, native: { id: "elic-1", method: "mcpServer/elicitation/request" } },
    ]);
    expect([...state.pending.keys()]).toEqual(["12", "elic-1"]);
    // The interaction dock renders the approval card from this request.
    const card = toInteraction(state.pending.get("12")!);
    expect(card).toMatchObject({ kind: "approval", request: { id: 12, method: "item/commandExecution/requestApproval", params } });
    expect(state.pending.get("elic-1")!.params).toEqual({});
    applyEvent(state, native("serverRequest/resolved", { requestId: 12 }));
    expect([...state.pending.keys()]).toEqual(["elic-1"]);
  });

  it("renders agent-bus sends from this session as mirrored 'sent' entries", () => {
    const state = timelineFromThreadRead({ thread: { id: "t", turns: [] } });
    applyEvent(state, native("turn/started", { turn: { id: "turn-1", status: "inProgress" } }));
    const sent: EventEnvelope = {
      ...native("x", {}),
      source: "cutex",
      native: undefined,
      cutex: {
        method: "cutex/agentBus/messageSent",
        params: { messageId: "m1", fromCutexSessionId: "me", toCutexSessionId: "alden", deliveryMode: "soon", content: "ping" },
      },
    };
    applyEvent(state, sent);
    expect(orderedEntries(state)).toEqual([
      { kind: "sent", id: "sent:m1", turnId: "turn-1", to: "alden", deliveryMode: "soon", text: "ping", messageId: "m1" },
    ]);
  });
});

describe("native r53 protocol tolerance", () => {
  it("ignores thread/prediction/updated, accepts rootTurnId and renders a partial_answer as agent text", () => {
    const state = timelineFromThreadRead({ thread: { id: "th", turns: [] } });
    const before = JSON.stringify(orderedEntries(state));
    expect(applyEvent(state, native("thread/prediction/updated", { threadId: "th", requestId: "p1", status: "running", prediction: null }))).toBe(false);
    expect(JSON.stringify(orderedEntries(state))).toBe(before);

    applyEvent(state, native("turn/started", { threadId: "th", turn: { id: "turn-1", status: "inProgress", rootTurnId: null, items: [] } }));
    expect(state.activeTurnId).toBe("turn-1");
    const partial = { type: "agentMessage", id: "a1", text: "partial so far", phase: "partial_answer", memoryCitation: null, unknownFutureField: { x: 1 } };
    applyEvent(state, native("item/completed", { threadId: "th", turnId: "turn-1", item: partial }));
    applyEvent(state, native("turn/completed", { threadId: "th", turn: { id: "turn-1", status: "completed", rootTurnId: "turn-1", items: [] } }));
    expect(state.entries.get("a1")).toMatchObject({ kind: "agent", text: "partial so far", streaming: false });
    expect(state.activeTurnId).toBeNull();
  });
});

describe("subagent thread routing", () => {
  const ev = (threadId: string | undefined, kind = "notification") =>
    ({ native: { kind, message: { method: "item/started", params: threadId ? { threadId } : {} } }, correlation: {} }) as never;
  it("flags events of other threads only", async () => {
    const { isChildThreadEvent, eventThreadId } = await import("../src/renderer/src/lib/timeline");
    expect(eventThreadId(ev("t-child"))).toBe("t-child");
    expect(isChildThreadEvent(ev("t-child"), "t-parent")).toBe(true);
    expect(isChildThreadEvent(ev("t-parent"), "t-parent")).toBe(false);
    expect(isChildThreadEvent(ev(undefined), "t-parent")).toBe(false);
    expect(isChildThreadEvent(ev("t-child"), null)).toBe(false);
  });

  it("keeps a subagent's server requests and their serverRequest/resolved in the parent's dock", async () => {
    const { isChildThreadEvent, isDockEvent } = await import("../src/renderer/src/lib/timeline");
    const request = native("item/commandExecution/requestApproval", { threadId: "t-child", command: "ls" }, "serverRequest", 4);
    const resolved = native("serverRequest/resolved", { threadId: "t-child", requestId: 4 });
    expect(isChildThreadEvent(resolved, "t-parent")).toBe(true);
    expect(isDockEvent(request)).toBe(true);
    expect(isDockEvent(resolved)).toBe(true);
    expect(isDockEvent(ev("t-child"))).toBe(false);
    expect(isDockEvent({ ...native("x", {}), native: undefined, cutex: { method: "cutex/runtime/online", params: {} } } as never)).toBe(false);
    // Applied to the parent's timeline, the resolution clears the parent's card.
    const parent = timelineFromThreadRead({ thread: { id: "t-parent", turns: [] } });
    applyEvent(parent, request);
    expect(applyEvent(parent, resolved)).toBe(true);
    expect(parent.pending.size).toBe(0);
  });
});
