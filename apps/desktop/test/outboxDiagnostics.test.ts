import { describe, expect, it } from "vitest";
import { applyEvent, emptyTimeline, type TimelineState } from "../src/renderer/src/lib/timeline";
import { confirmOutbox, markOutboxDispatched, newOutboxEntry, outboxStatusCopy, retryOutbox, setOutboxStage } from "../src/renderer/src/lib/outbox";
import { OUTBOX_LINGER_MS, outboxLingerRecord } from "../src/renderer/src/lib/outboxDiagnostics";

const native = (method: string, params: unknown) => ({ source: "app_server", native: { kind: "notification", message: { method, params } } }) as never;
const started = (turnId: string) => native("turn/started", { turn: { id: turnId, status: "inProgress" } });
const userItem = (id: string, text: string, turnId: string, clientId?: string) =>
  native("item/completed", { turnId, item: { type: "userMessage", id, ...(clientId ? { clientId } : {}), content: [{ type: "text", text, text_elements: [] }] } });
const play = (events: never[]): TimelineState => {
  const tl = emptyTimeline();
  for (const e of events) applyEvent(tl, e);
  return tl;
};

describe("interrupt & send stages", () => {
  it("says what happens before the submit goes out, then in flight, then accepted", () => {
    const entry = newOutboxEntry(null, { id: "s1", text: "secret text", strategy: "auto", placement: "turn", stage: "stopping" }, 1000);
    expect(outboxStatusCopy(entry).label).toBe("outbox.stopping");
    const checking = setOutboxStage([entry], "s1", "checking", 3200);
    expect(outboxStatusCopy(checking[0]!).label).toBe("outbox.checking");
    expect(checking[0]!.stoppedAt).toBe(3200);
    const out = markOutboxDispatched(checking, "s1", 9700);
    expect(out[0]!.stage).toBeUndefined();
    expect(out[0]!.dispatchedAt).toBe(9700);
    expect(outboxStatusCopy(out[0]!).label).toBe("outbox.sending");
    const confirmed = confirmOutbox(out, "s1", { disposition: "started", turnId: "t1" }, 1, 9800);
    expect(outboxStatusCopy(confirmed[0]!)).toEqual({ label: "outbox.confirmed", hint: "outbox.confirmedHint" });
    expect(outboxStatusCopy(confirmed[0]!, { silentSeconds: 4 })).toEqual({ label: "outbox.confirmedSilent", hint: "outbox.confirmedHint", vars: { n: 4 } });
    // A still-sending entry never claims delivery, silent or not.
    expect(outboxStatusCopy(out[0]!, { silentSeconds: 4 }).label).toBe("outbox.sending");
    expect(retryOutbox(confirmed, "s1", "auto", "turn")[0]!.confirmedAt).toBeUndefined();
  });

  it("does not touch a confirmed entry", () => {
    const entry = confirmOutbox([newOutboxEntry(null, { id: "s1", text: "x", strategy: "auto", placement: "turn" }, 0)], "s1", { disposition: "started", turnId: "t1" }, 1, 5);
    expect(markOutboxDispatched(entry, "s1", 9)[0]).toBe(entry[0]);
    expect(setOutboxStage(entry, "s1", "checking", 9)[0]).toBe(entry[0]);
  });
});

describe("outboxLingerRecord", () => {
  it("is null for a send visible no longer than the threshold", () => {
    const entry = newOutboxEntry(null, { id: "s1", text: "x", strategy: "auto", placement: "turn" }, 1000);
    expect(outboxLingerRecord("cutex.a", entry, null, 1000 + OUTBOX_LINGER_MS, "left")).toBeNull();
  });

  it("records states, ages and timeline matches without the text", () => {
    const tl = play([started("t1")]);
    let list = [newOutboxEntry(tl, { id: "s1", text: "very private words", strategy: "auto", placement: "turn", stage: "stopping" }, 0)];
    list = setOutboxStage(list, "s1", "checking", 2200);
    list = markOutboxDispatched(list, "s1", 8700);
    list = confirmOutbox(list, "s1", { disposition: "started", turnId: "t2" }, 1, 8800);
    const landed = play([started("t1"), userItem("u1", "very private words", "t1", "s1")]);
    const record = outboxLingerRecord("cutex.a", list[0]!, landed, 9100, "left")!;
    expect(record).toMatchObject({
      source: "outbox-linger", outcome: "left", sessionId: "cutex.a", clientUserMessageId: "s1",
      state: "confirmed", placement: "turn", strategy: "auto", stage: null, waitingForPrevious: false,
      visibleMs: 9100, stoppedAfterMs: 2200, dispatchedAfterMs: 8700, confirmedAfterMs: 8800,
      clientIdInTimeline: true, turnIdKnown: true, turnStatus: "absent", turnIsActive: false, activeTurn: true, untaggedSinceSend: 0,
    });
    expect(JSON.stringify(record)).not.toContain("private");
  });

  it("counts untagged same-text messages since the send (no-echo fallback) as a number", () => {
    const before = play([started("t1"), userItem("u0", "again", "t1")]);
    const entry = newOutboxEntry(before, { id: "s2", text: "again", strategy: "auto", placement: "turn" }, 0);
    const after = play([started("t1"), userItem("u0", "again", "t1"), userItem("u1", "again", "t1")]);
    expect(outboxLingerRecord("cutex.a", entry, after, 5000, "visible")?.untaggedSinceSend).toBe(1);
  });
});
