import { describe, expect, it } from "vitest";
import { agentMessageText, applyMessageEvent, deliveryKindOf, pendingMessagesFor, seedMessages, splitEnvelopeText, stateOf, stripLegacyPrefix, wakeableNotes, type MessageMap } from "../src/renderer/src/lib/agentMessages";
import { parseExternalInput } from "../src/renderer/src/lib/timeline";

const sent = { messageId: "m1", fromCutexSessionId: "a", toCutexSessionId: "b", deliveryMode: "passive", deliveryKind: "note", content: "hi", body: "hi", sender: { id: "a", name: "Alpha", runtime: "codex" }, recipient: { id: "b", name: "Beta", runtime: "claude" } };

describe("deliveryKindOf", () => {
  it("prefers deliveryKind and maps the legacy wire modes", () => {
    expect(deliveryKindOf("wake", "passive")).toBe("wake");
    expect(deliveryKindOf(undefined, "passive")).toBe("note");
    expect(deliveryKindOf(null, "after_turn")).toBe("wake");
    expect(deliveryKindOf(null, "soon")).toBe("wake");
    expect(deliveryKindOf(null, "interrupt")).toBeNull();
    expect(deliveryKindOf(null, null)).toBeNull();
  });
});

describe("applyMessageEvent", () => {
  it("tracks a message from sent through delivered", () => {
    let map: MessageMap = {};
    map = applyMessageEvent(map, "cutex/agentBus/messageSent", sent, 100);
    expect(map.m1).toMatchObject({ from: "a", to: "b", senderName: "Alpha", recipientName: "Beta", kind: "note", body: "hi", state: "pending", sentAt: 100 });
    map = applyMessageEvent(map, "cutex/agentBus/messageDelivered", { messageId: "m1", fromCutexSessionId: "a", toCutexSessionId: "b", turnId: "t9", deliveredAt: "2026-10-08T01:00:00Z" }, 200);
    expect(map.m1).toMatchObject({ state: "delivered", turnId: "t9", deliveredAt: Date.parse("2026-10-08T01:00:00Z") / 1000, body: "hi", kind: "note" });
  });

  it("is idempotent and never goes back from a final state", () => {
    let map: MessageMap = applyMessageEvent({}, "cutex/agentBus/messageSent", sent, 100);
    map = applyMessageEvent(map, "cutex/agentBus/messageDelivered", { messageId: "m1", turnId: "t" }, 200);
    const same = applyMessageEvent(map, "cutex/agentBus/messageDelivered", { messageId: "m1", turnId: "t" }, 200);
    expect(same).toBe(map);
    // A late queued event (the recipient's stream after the host feed) keeps it read in.
    const late = applyMessageEvent(map, "cutex/agentBus/messageQueued", { ...sent, queuedAt: "2026-10-08T00:59:00Z" }, 300);
    expect(late.m1!.state).toBe("delivered");
    // A failure after delivery is ignored.
    expect(applyMessageEvent(map, "cutex/agentBus/messageFailed", { messageId: "m1", error: "x" }, 300)).toBe(map);
  });

  it("records the actual kind cutex reports (a wake downgraded to a note)", () => {
    let map = applyMessageEvent({}, "cutex/agentBus/messageSent", { ...sent, deliveryKind: "note", deliveryMode: "passive" }, 1);
    expect(map.m1!.kind).toBe("note");
    map = applyMessageEvent({}, "cutex/agentBus/messageSent", { ...sent, deliveryKind: undefined, deliveryMode: "after_turn" }, 1);
    expect(map.m1!.kind).toBe("wake");
  });

  it("marks live failures and reads error objects", () => {
    const map = applyMessageEvent(applyMessageEvent({}, "cutex/agentBus/messageQueued", sent, 1), "cutex/agentBus/messageFailed", { messageId: "m1", error: { code: "quarantined", message: "runtime gone" } }, 2);
    expect(map.m1).toMatchObject({ state: "failed", error: "runtime gone", failedLive: true });
  });

  it("ignores other methods and events without a message id", () => {
    const map: MessageMap = {};
    expect(applyMessageEvent(map, "cutex/session/updated", sent, 1)).toBe(map);
    expect(applyMessageEvent(map, "cutex/agentBus/messageSent", { content: "x" }, 1)).toBe(map);
  });
});

describe("seedMessages / pendingMessagesFor", () => {
  const received = [
    { messageId: "p1", fromCutexSessionId: "a", toCutexSessionId: "b", deliveryMode: "passive", content: "old prefix", body: "first", state: "pending", queuedAt: "2026-10-08T00:00:00Z", sender: { id: "a", name: "Alpha" } },
    { messageId: "p2", fromCutexSessionId: "c", toCutexSessionId: "b", deliveryMode: "after_turn", content: "second", state: "inbox_accepted", queuedAt: "2026-10-08T00:01:00Z" },
    { messageId: "d1", fromCutexSessionId: "a", toCutexSessionId: "b", deliveryMode: "passive", content: "done", state: "delivered" },
    { messageId: "q1", fromCutexSessionId: "a", toCutexSessionId: "b", deliveryMode: "passive", content: "old", state: "quarantined", error: { code: "legacy" } },
  ];

  it("seeds incoming and sent snapshots", () => {
    const map = seedMessages({}, "b", received, [{ messageId: "s1", toCutexSessionId: "a", deliveryKind: "note", body: "out", state: "delivered", sentAt: "2026-10-08T00:00:00Z", contextTurnId: "ta" }]);
    expect(map.p1).toMatchObject({ body: "first", kind: "note", senderName: "Alpha", state: "pending" });
    expect(map.p2).toMatchObject({ body: "second", kind: "wake", state: "pending" });
    expect(map.q1).toMatchObject({ state: "failed", failedLive: false, error: "legacy" });
    expect(map.s1).toMatchObject({ from: "b", to: "a", state: "delivered", turnId: "ta" });
  });

  it("lists pending messages oldest first; read-in, snapshot failures and other agents' are left out", () => {
    let map = seedMessages({}, "b", received, []);
    expect(pendingMessagesFor(map, "b").map((m) => m.messageId)).toEqual(["p1", "p2"]);
    expect(pendingMessagesFor(map, "b", (id) => id === "p1").map((m) => m.messageId)).toEqual(["p2"]);
    expect(pendingMessagesFor(map, "a")).toEqual([]);
    map = applyMessageEvent(map, "cutex/agentBus/messageFailed", { messageId: "p2", error: "boom" }, 5);
    expect(pendingMessagesFor(map, "b").map((m) => [m.messageId, m.state])).toEqual([["p1", "pending"], ["p2", "failed"]]);
    expect(pendingMessagesFor(map, "b", undefined, new Set(["p2"])).map((m) => m.messageId)).toEqual(["p1"]);
    expect(wakeableNotes(pendingMessagesFor(map, "b"))).toBe(1);
  });

  it("names the service sender of an alarm / job completion and keeps cutex's timing", () => {
    const service = [
      // r224 shape (live Workstation 2026-10-11): no sender field, only the frozen native envelope.
      { messageId: "alarm-1", fromCutexSessionId: null, toCutexSessionId: "b", deliveryMode: "after_turn", content: "wake up after the reset", state: "pending",
        externalInput: { message: { id: "alarm-1", source: { kind: "service", id: "Cutex Alarm" }, type: "alarm", delivery: "after_turn" } } },
      // fix/alarm-pending-note shape: sender fields on an unfrozen (held) job completion.
      { messageId: "jsc_1", fromCutexSessionId: null, toCutexSessionId: "b", deliveryMode: "after_turn", content: "{}", state: "pending",
        sender: { id: "cutex-job-service", name: null }, senderKind: "job_service", queuedAt: "2026-10-11T00:16:52Z" },
      { messageId: "alarm-2", fromCutexSessionId: null, toCutexSessionId: "b", deliveryMode: "after_turn", content: "x", state: "pending",
        sender: { id: "Cutex Alarm" }, senderKind: "alarm_service", afterTurnOnly: true },
      { messageId: "soon-1", fromCutexSessionId: "a", toCutexSessionId: "b", deliveryMode: "after_turn", content: "y", state: "pending",
        externalInput: { message: { source: { kind: "agent", id: "a" }, delivery: "soon" } } },
    ];
    const map = seedMessages({}, "b", service, []);
    expect(map["alarm-1"]).toMatchObject({ from: "Cutex Alarm", sourceKind: "service", kind: "wake", timing: "afterTurn", state: "pending" });
    expect(map.jsc_1).toMatchObject({ from: "cutex-job-service", sourceKind: "service", timing: null });
    expect(map["alarm-2"]).toMatchObject({ from: "Cutex Alarm", sourceKind: "service", timing: "afterTurn" });
    expect(map["soon-1"]).toMatchObject({ from: "a", sourceKind: null, timing: "nextStep" });
    expect(pendingMessagesFor(map, "b").map((m) => m.messageId)).toContain("alarm-1");
    // Its native item in the timeline (item id = bus message id) reads it in.
    expect(pendingMessagesFor(map, "b", (id) => id === "alarm-1").map((m) => m.messageId)).not.toContain("alarm-1");
  });

  it("maps snapshot states", () => {
    expect(stateOf("pending")).toBe("pending");
    expect(stateOf("inbox_accepted")).toBe("pending");
    expect(stateOf("delivered")).toBe("delivered");
    expect(stateOf("quarantined")).toBe("failed");
    expect(stateOf("stale_held")).toBe("pending");
    expect(stateOf("discarded")).toBe("failed");
  });
});

describe("received envelope", () => {
  const v2Text = 'Message Type: MESSAGE\nSender: Alpha (cutex-a)\nSender capabilities: narrower than yours\nReply: only via agent_tell to="cutex-a"\nPayload:\nhello\nPayload: not a header';

  it("splits the header and payload", () => {
    expect(splitEnvelopeText(v2Text)).toEqual({
      type: "MESSAGE",
      fields: { Sender: "Alpha (cutex-a)", "Sender capabilities": "narrower than yours", Reply: 'only via agent_tell to="cutex-a"' },
      payload: "hello\nPayload: not a header",
    });
    expect(splitEnvelopeText("plain text")).toBeNull();
  });

  it("prefers the view body and reports the envelope facts", () => {
    expect(agentMessageText(v2Text, { body: "hello (view)", deliveryKind: "note", bodyTruncated: true })).toEqual({
      text: "hello (view)",
      envelope: { sender: "Alpha (cutex-a)", narrower: true, replyOnly: true, kind: "note", bodyTruncated: true, downgraded: false },
    });
    // No view body: the payload after the header.
    expect(agentMessageText(v2Text, {}).text).toBe("hello\nPayload: not a header");
  });

  it("keeps old messages as today: no envelope, prefix stripped only up to Payload", () => {
    expect(agentMessageText("Message Type: MESSAGE\nPayload:\n[message from X] hi", { deliveryMode: "passive" })).toEqual({ text: "[message from X] hi", envelope: null });
    expect(agentMessageText("no header", {})).toEqual({ text: "no header", envelope: null });
    // Other event types stay raw.
    expect(agentMessageText("Message Type: ASK\nPayload:\nbrief", { body: "x" })).toEqual({ text: "Message Type: ASK\nPayload:\nbrief", envelope: null });
  });

  it("parseExternalInput carries the envelope; task views keep their raw text", () => {
    const item = (schema: string, data: Record<string, unknown>, text: string) => ({ type: "functionCallOutput", id: "i", name: "external_event", output: JSON.stringify({ source: { kind: "agent", id: "cutex.a" }, type: "message", text }), externalInputView: { schema, data } });
    const v2 = parseExternalInput(item("cutex.agent-message.v1", { senderId: "a", senderName: "Alpha", deliveryMode: "after_turn", deliveryKind: "wake", body: "hello" }, v2Text));
    expect(v2).toMatchObject({ text: "hello", envelope: { kind: "wake", narrower: true, replyOnly: true } });
    const old = parseExternalInput(item("cutex.agent-message.v1", { senderId: "a", senderName: "Alpha", deliveryMode: "passive" }, "Message Type: MESSAGE\nPayload:\n[message from Alpha] hi"));
    expect(old?.text).toBe("[message from Alpha] hi");
    expect(old && "envelope" in old).toBe(false);
    const task = parseExternalInput(item("cutex.task-assignment.v1", { body: "not used" }, "Assignment ID: as-1"));
    expect(task?.text).toBe("Assignment ID: as-1");
  });
});

describe("legacy prefix / downgrade", () => {
  it("strips only the exact default prefix", () => {
    expect(stripLegacyPrefix("[message from Alpha] hi", "Alpha")).toBe("hi");
    expect(stripLegacyPrefix("[message from Beta] hi", "Alpha")).toBe("[message from Beta] hi");
    expect(stripLegacyPrefix("<Alpha> hi", "Alpha")).toBe("<Alpha> hi");
  });

  it("keeps wakeDowngraded once seen", () => {
    let map = applyMessageEvent({}, "cutex/agentBus/messageSent", { ...sent, deliveryKind: "note", wakeDowngraded: true }, 1);
    map = applyMessageEvent(map, "cutex/agentBus/messageDelivered", { messageId: "m1", deliveryKind: "note" }, 2);
    expect(map.m1).toMatchObject({ kind: "note", downgraded: true, state: "delivered" });
    expect(seedMessages({}, "a", [], [{ messageId: "s", toCutexSessionId: "b", deliveryKind: "note", wakeDowngraded: true, state: "pending", deliveredAt: null }]).s!.downgraded).toBe(true);
  });
});