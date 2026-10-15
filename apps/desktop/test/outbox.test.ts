import { describe, expect, it } from "vitest";
import type { QueueItem } from "@cutex-desktop/protocol";
import { applyEvent, emptyTimeline, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import {
  confirmOutbox,
  failOutbox,
  flushedOutboxEntry,
  flushOutbox,
  pendingTail,
  pendingUserEntry,
  sendRowKey,
  timelineRowKey,
  hasUnlandedTurn,
  newOutboxEntry,
  markOutboxWaiting,
  outboxStatusCopy,
  outboxAt,
  predictPlacement,
  pruneHidden,
  reconcileOutbox,
  retryOutbox,
  sendErrorText,
  submitLandedPaused,
  timelineTail,
  updateOutbox,
  visibleQueue,
  type OutboxEntry,
} from "../src/renderer/src/lib/outbox";

const native = (method: string, params: unknown) => ({ source: "app_server", native: { kind: "notification", message: { method, params } } }) as never;
const userItem = (id: string, text: string, turnId: string, clientId?: string) =>
  native("item/completed", { turnId, item: { type: "userMessage", id, ...(clientId ? { clientId } : {}), content: [{ type: "text", text, text_elements: [] }] } });
const started = (turnId: string) => native("turn/started", { turn: { id: turnId, status: "inProgress" } });
const completed = (turnId: string, status = "completed") => native("turn/completed", { turn: { id: turnId, status } });
const idle = () => timelineFromThreadRead({ thread: { id: "th", turns: [{ id: "t0", status: "completed", items: [{ type: "userMessage", id: "u0", content: [{ type: "text", text: "hi" }] }] }] } });
const qItem = (queueId: string, clientUserMessageId: string, text = "x"): QueueItem => ({
  queueId,
  clientUserMessageId,
  origin: { kind: "other", clientId: "desktop" },
  input: [{ type: "text", text, text_elements: [] }],
  position: 0,
  revision: 1,
  state: "queued",
  createdAt: "",
  updatedAt: "",
});
const entry = (id: string, text: string, placement: OutboxEntry["placement"], tl = idle()) => newOutboxEntry(tl, { id, text, strategy: placement === "queue" ? "queue" : "auto", placement });

describe("outbox: placement", () => {
  it("predicts where a send ends up", () => {
    expect(predictPlacement("auto", false)).toBe("turn");
    expect(predictPlacement("auto", true)).toBe("steer");
    expect(predictPlacement("auto", true, { noSteer: true })).toBe("queue");
    expect(predictPlacement("queue", true)).toBe("queue");
    expect(predictPlacement("interrupt", true)).toBe("turn");
    expect(predictPlacement("auto", false, { offlineQueued: true })).toBe("queue");
  });
  it("counts images and keeps the order of sends", () => {
    const e = newOutboxEntry(null, { id: "c1", text: "", extra: [{ type: "image", url: "data:" }, { type: "skill", name: "s", path: "p" }], strategy: "auto", placement: "turn" });
    expect(e.imageCount).toBe(1);
    expect(e.state).toBe("sending");
  });
});

describe("outbox: queued send", () => {
  it("pending → confirmed (shown with cutex's item) → replaced by the listed item", () => {
    const tl = idle();
    let list = [entry("c1", "later", "queue", tl)];
    expect(outboxAt(list, "queue")).toHaveLength(1);
    const item = qItem("q1", "c1", "later");
    list = confirmOutbox(list, "c1", { disposition: "queued", turnId: null, queue: item }, 5);
    expect(list[0]).toMatchObject({ state: "confirmed", placement: "queue", queueItem: item });
    // Rendered as a normal queue row now (full actions), not as a pending row.
    expect(outboxAt(list, "queue")).toHaveLength(0);
    expect(visibleQueue([], [], list)).toEqual([item]);
    // A queue list fetched before the response (tick 4) without it: still shown.
    expect(reconcileOutbox(list, tl, [], 4)).toBe(list);
    // The list has it: the outbox entry leaves; the real row (same clientUserMessageId key) stays.
    expect(reconcileOutbox(list, tl, [item], null)).toEqual([]);
    expect(visibleQueue([item], [], list)).toEqual([item]);
  });
  it("event (queue list) before the response: the entry leaves on the list, the late response is a no-op", () => {
    const tl = idle();
    let list = [entry("c1", "later", "queue", tl)];
    list = reconcileOutbox(list, tl, [qItem("q1", "c1")], 1);
    expect(list).toEqual([]);
    expect(confirmOutbox(list, "c1", { disposition: "queued", turnId: null, queue: qItem("q1", "c1") }, 2)).toEqual([]);
  });
  it("flushed before any list had it: a list fetched after the response drops it", () => {
    const tl = idle();
    const list = confirmOutbox([entry("c1", "later", "queue", tl)], "c1", { disposition: "queued", queue: qItem("q1", "c1") }, 3);
    expect(reconcileOutbox(list, tl, [], 7)).toEqual([]);
  });
  it("hidden rows (being removed) disappear; pruned once cutex no longer lists them", () => {
    const a = qItem("q1", "c1");
    const b = qItem("q2", "c2");
    expect(visibleQueue([a, b], ["q1"], [])).toEqual([b]);
    expect(pruneHidden(["q1"], [a, b])).toEqual(["q1"]);
    expect(pruneHidden(["q1"], [b])).toEqual([]);
    const same = ["q1"];
    expect(pruneHidden(same, [a])).toBe(same);
  });
});

describe("outbox: new turn", () => {
  it("response before the event: confirmed until the tagged user message arrives", () => {
    const tl = idle();
    let list = [entry("c1", "go", "turn", tl)];
    expect(hasUnlandedTurn(list)).toBe(true);
    list = confirmOutbox(list, "c1", { disposition: "started", turnId: "t1" }, 1);
    expect(list[0]).toMatchObject({ state: "confirmed", placement: "turn", turnId: "t1" });
    applyEvent(tl, started("t1"));
    expect(reconcileOutbox(list, tl, [])).toBe(list);
    applyEvent(tl, userItem("u1", "go", "t1", "c1"));
    expect(reconcileOutbox(list, tl, [])).toEqual([]);
  });
  it("event before the response: the entry leaves while still sending; the late response is a no-op", () => {
    const tl = idle();
    let list = [entry("c1", "go", "turn", tl)];
    applyEvent(tl, started("t1"));
    applyEvent(tl, userItem("u1", "go", "t1", "c1"));
    list = reconcileOutbox(list, tl, []);
    expect(list).toEqual([]);
    expect(confirmOutbox(list, "c1", { disposition: "started", turnId: "t1" }, 1)).toEqual([]);
  });
  it("duplicate events are idempotent", () => {
    const tl = idle();
    const list = [entry("c1", "go", "turn", tl), entry("c2", "next", "queue", tl)];
    applyEvent(tl, started("t1"));
    applyEvent(tl, userItem("u1", "go", "t1", "c1"));
    const once = reconcileOutbox(list, tl, []);
    applyEvent(tl, userItem("u1", "go", "t1", "c1"));
    const twice = reconcileOutbox(once, tl, []);
    expect(twice).toBe(once);
    expect(twice.map((e) => e.id)).toEqual(["c2"]);
  });
  it("natives without the clientId echo: matched by a new message with the same text (older ones excluded)", () => {
    const tl = idle(); // already has an untagged "hi"
    let list = [entry("c1", "hi", "turn", tl), entry("c2", "hi", "turn", tl)];
    list = confirmOutbox(confirmOutbox(list, "c1", { disposition: "started" }, 1), "c2", { disposition: "started" }, 2);
    expect(reconcileOutbox(list, tl, [])).toBe(list);
    applyEvent(tl, started("t1"));
    applyEvent(tl, userItem("u1", "hi", "t1"));
    // One new message claims one entry.
    expect(reconcileOutbox(list, tl, []).map((e) => e.id)).toEqual(["c2"]);
  });
  it("a started turn that ends without the message does not leave a stale bubble", () => {
    const tl = idle();
    const list = confirmOutbox([entry("c1", "go", "turn", tl)], "c1", { disposition: "started", turnId: "t1" }, 1);
    applyEvent(tl, started("t1"));
    expect(reconcileOutbox(list, tl, [])).toBe(list);
    applyEvent(tl, completed("t1", "interrupted"));
    expect(reconcileOutbox(list, tl, [])).toEqual([]);
  });
  it("the response corrects the predicted placement", () => {
    const tl = idle();
    const list = confirmOutbox([entry("c1", "go", "steer", tl)], "c1", { disposition: "started", turnId: "t9" }, 1);
    expect(list[0]!.placement).toBe("turn");
    const queued = confirmOutbox([entry("c2", "go", "turn", tl)], "c2", { disposition: "queued", queue: qItem("q1", "c2") }, 1);
    expect(queued[0]!.placement).toBe("queue");
  });
});

describe("outbox: steer", () => {
  it("steered / deduplicated responses hand over (the pending-steer row keeps the id)", () => {
    const tl = idle();
    expect(confirmOutbox([entry("c1", "s", "steer", tl)], "c1", { disposition: "steered", turnId: "t1" }, 1)).toEqual([]);
    expect(confirmOutbox([entry("c1", "s", "turn", tl)], "c1", { disposition: "deduplicated" }, 1)).toEqual([]);
  });
  it("a promoted queue item does not count as landed because the queue still lists it", () => {
    const tl = idle();
    const p = newOutboxEntry(tl, { id: "c1", text: "s", strategy: "auto", placement: "steer", promoted: true });
    const list = [p];
    expect(reconcileOutbox(list, tl, [qItem("q1", "c1")])).toBe(list);
  });
});

describe("outbox: failure", () => {
  it("failed entries stay visible with the error; retry goes back to sending under the same id", () => {
    const tl = emptyTimeline();
    let list = [entry("c1", "go", "queue", tl)];
    list = failOutbox(list, "c1", "ssh tunnel down");
    expect(list[0]).toMatchObject({ state: "failed", error: "ssh tunnel down" });
    expect(outboxAt(list, "queue")).toHaveLength(1);
    expect(hasUnlandedTurn(failOutbox([entry("c2", "x", "turn", tl)], "c2", "e"))).toBe(false);
    // Nothing in the timeline / queue removes a failed entry by itself…
    expect(reconcileOutbox(list, tl, [], 9)).toBe(list);
    list = retryOutbox(list, "c1", "auto", "turn");
    expect(list[0]).toMatchObject({ id: "c1", state: "sending", strategy: "auto", placement: "turn" });
    expect(list[0]!.error).toBeUndefined();
  });
  it("…unless the first attempt did land after all (its id shows up)", () => {
    const tl = idle();
    const list = failOutbox([entry("c1", "go", "turn", tl)], "c1", "timeout");
    applyEvent(tl, started("t1"));
    applyEvent(tl, userItem("u1", "go", "t1", "c1"));
    expect(reconcileOutbox(list, tl, [])).toEqual([]);
  });
  it("shows cutex's full request store (503 idempotency_capacity_exceeded) as a readable message", () => {
    const capacity = () => "cutex is overloaded";
    // The code is the message prefix after the IPC hop (Electron's wrapper is stripped in bridge.ts).
    expect(sendErrorText(new Error("idempotency_capacity_exceeded: the request store is full of requests; nothing was forwarded"), capacity)).toBe("cutex is overloaded");
    expect(sendErrorText(new Error("Error invoking remote method 'x': CutexApiError: idempotency_capacity_exceeded: full"), capacity)).toBe("cutex is overloaded");
    expect(sendErrorText("idempotency_capacity_exceeded: full", capacity)).toBe("cutex is overloaded");
    // Everything else is shown as is.
    expect(sendErrorText(new Error("request_outcome_unknown: lost"), capacity)).toBe("request_outcome_unknown: lost");
    expect(sendErrorText(new Error("my_idempotency_capacity_exceeded_x"), capacity)).toBe("my_idempotency_capacity_exceeded_x");
    expect(sendErrorText(42, capacity)).toBe("42");
  });
  it("update patches the merged text of interrupt & send", () => {
    const list = updateOutbox([entry("c1", "tail", "turn")], "c1", { text: "steer\n\ntail", extra: [{ type: "localImage", path: "a.png" }] });
    expect(list[0]).toMatchObject({ text: "steer\n\ntail", imageCount: 1 });
  });
});

describe("outbox: a send that started a turn whose userMessage comes late", () => {
  // cute-codex emits turn/started at once but records the userMessage (item/started + completed,
  // clientId) only after pre-sampling compaction / MCP startup / prompt hooks.
  const itemStarted = (id: string, text: string, turnId: string, clientId: string) =>
    native("item/started", { turnId, item: { type: "userMessage", id, clientId, content: [{ type: "text", text, text_elements: [] }] } });

  it("stays pending while the turn runs without it, then leaves on the item/started clientId", () => {
    const tl = idle();
    let list = [entry("c1", "go", "turn", tl)];
    applyEvent(tl, started("t1"));
    list = confirmOutbox(list, "c1", { disposition: "started", turnId: "t1" }, 1);
    applyEvent(tl, native("item/started", { turnId: "t1", item: { type: "contextCompaction", id: "cc1" } }));
    expect(reconcileOutbox(list, tl, [])).toBe(list);
    expect(outboxAt(list, "turn")).toHaveLength(1);
    applyEvent(tl, itemStarted("u1", "go", "t1", "c1"));
    expect(reconcileOutbox(list, tl, [])).toEqual([]);
  });

  it("pending sends render before the running turn's header and live line, never below them", () => {
    expect(timelineTail("t1", new Set())).toEqual(["pending", "header", "tail"]);
    expect(timelineTail("t1", new Set(["t1"]))).toEqual(["pending", "tail"]);
    expect(timelineTail(null, new Set())).toEqual(["pending"]);
    for (const slots of [timelineTail("t1", new Set()), timelineTail("t1", new Set(["t1"]))]) {
      expect(slots.indexOf("pending")).toBeLessThan(slots.indexOf("tail"));
    }
  });
});

describe("submitLandedPaused (queue-idle-start)", () => {
  it("is true only for a queued result that cutex says is held by a paused queue", () => {
    expect(submitLandedPaused({ disposition: "queued", queue: {}, paused: true })).toBe(true);
    expect(submitLandedPaused({ disposition: "queued", queue: {}, paused: false })).toBe(false);
    // Older cutex: no `paused` field — nothing to say.
    expect(submitLandedPaused({ disposition: "queued", queue: {} })).toBe(false);
    // An idle agent's `queue` submit now starts at once.
    expect(submitLandedPaused({ disposition: "started", turnId: "t1", paused: false })).toBe(false);
    expect(submitLandedPaused(null)).toBe(false);
  });

  it("a queue row's send-now on an idle agent lands as a new turn, busy as a steer", () => {
    expect(predictPlacement("auto", false)).toBe("turn");
    expect(predictPlacement("auto", true)).toBe("steer");
  });
});

it("distinguishes desktop waiting, request dispatch and confirmed message visibility", () => {
  const entry = newOutboxEntry(null, { id: "send-1", text: "message", strategy: "auto", placement: "turn" });
  expect(outboxStatusCopy(entry).label).toBe("outbox.sending");
  const waiting = markOutboxWaiting([entry], entry.id, true);
  expect(outboxStatusCopy(waiting[0]!).label).toBe("outbox.waiting");
  const dispatched = markOutboxWaiting(waiting, entry.id, false);
  expect(outboxStatusCopy(dispatched[0]!).label).toBe("outbox.sending");
  const confirmed = confirmOutbox(dispatched, entry.id, { disposition: "started", turnId: "turn-1" }, 1);
  expect(outboxStatusCopy(confirmed[0]!).label).toBe("outbox.confirmed");
  expect(markOutboxWaiting(confirmed, entry.id, true)[0]).toBe(confirmed[0]);
  expect(retryOutbox(waiting, entry.id, "auto", "turn")[0]?.waitingForPrevious).toBe(false);
});

/** The row keys the timeline renders, in order: its entries (timelineRowKey), then the pending sends. */
const rowKeys = (tl: ReturnType<typeof idle>, list: OutboxEntry[]) => [...[...tl.entries.values()].map(timelineRowKey), ...pendingTail(list, tl).map((e) => sendRowKey(e.id))];

describe("outbox: one row per send across the handoff (no duplicate, no gap)", () => {
  it("the pending bubble and the native userMessage share one key, at every step", () => {
    const tl = idle();
    let list = [entry("c1", "go", "turn", tl)];
    const key = sendRowKey("c1");
    const once = (keys: string[]) => keys.filter((k) => k === key).length;
    // Sending, confirmed, turn started: the pending row, last.
    expect(rowKeys(tl, list).at(-1)).toBe(key);
    list = confirmOutbox(list, "c1", { disposition: "started", turnId: "t1" }, 1);
    applyEvent(tl, started("t1"));
    expect(once(rowKeys(tl, list))).toBe(1);
    // The userMessage landed but the outbox is not reconciled yet: still exactly one row (the real one).
    applyEvent(tl, userItem("u1", "go", "t1", "c1"));
    expect(pendingTail(list, tl)).toEqual([]);
    expect(once(rowKeys(tl, list))).toBe(1);
    expect(rowKeys(tl, list).at(-1)).toBe(key);
    // Reconciled: the same key, the same place.
    list = reconcileOutbox(list, tl, []);
    expect(list).toEqual([]);
    expect(rowKeys(tl, list).at(-1)).toBe(key);
  });
  it("a failed send keeps its row; untagged messages keep their id keys", () => {
    const tl = idle();
    const list = failOutbox([entry("c1", "go", "turn", tl)], "c1", "boom");
    expect(pendingTail(list, tl).map((e) => e.state)).toEqual(["failed"]);
    expect(rowKeys(tl, list)).toEqual(["u0", sendRowKey("c1")]);
  });
  it("pending entries render as user entries, stable per outbox entry object", () => {
    const e = entry("c1", "go", "turn");
    expect(pendingUserEntry(e)).toBe(pendingUserEntry(e));
    expect(pendingUserEntry(e)).toMatchObject({ kind: "user", text: "go", clientId: "c1" });
    expect(pendingUserEntry({ ...e, state: "confirmed" })).not.toBe(pendingUserEntry(e));
  });
  it("pending entries carry their images like the message that replaces them (no growth at the handoff)", () => {
    const e = newOutboxEntry(null, { id: "c2", text: "look", extra: [{ type: "image", url: "data:image/png;base64,AA==" }, { type: "localImage", path: "/tmp/a.png" }, { type: "skill", name: "s", path: "p" }], strategy: "auto", placement: "turn" });
    expect(pendingUserEntry(e).images).toEqual([{ kind: "url", url: "data:image/png;base64,AA==" }, { kind: "path", path: "/tmp/a.png" }]);
    expect(pendingUserEntry(entry("c3", "plain", "turn")).images).toBeUndefined();
  });
});

describe("outbox: a queued message flushed into a new turn (cutex/userInput/submitted)", () => {
  const submitted = { clientUserMessageId: "cq", input: [{ type: "text", text: "later" }], disposition: "started", turnId: "t1" };
  it("leaves the queue row for a pending bubble at once, which the userMessage replaces under the same key", () => {
    const tl = idle();
    const queue = [qItem("q1", "cq", "later")];
    applyEvent(tl, started("t1"));
    const flushed = flushedOutboxEntry(tl, submitted, 5)!;
    expect(flushed).toMatchObject({ id: "cq", text: "later", placement: "turn", state: "confirmed", turnId: "t1", promoted: true });
    let list = [flushed];
    // Never both: the queue row is hidden while the bubble shows; never neither: a stale queue list does not land it.
    expect(visibleQueue(queue, [], list)).toEqual([]);
    expect(reconcileOutbox(list, tl, queue, 6)).toBe(list);
    expect(reconcileOutbox(list, tl, [], 7)).toBe(list);
    expect(rowKeys(tl, list).at(-1)).toBe(sendRowKey("cq"));
    applyEvent(tl, userItem("u1", "later", "t1", "cq"));
    list = reconcileOutbox(list, tl, []);
    expect(list).toEqual([]);
    expect(rowKeys(tl, list).at(-1)).toBe(sendRowKey("cq"));
  });
  it("a queued send still in the outbox becomes the pending bubble when cutex flushes it (never shown nowhere)", () => {
    const tl = idle();
    applyEvent(tl, started("t1"));
    let list = [entry("cq", "later", "queue", tl)];
    list = flushOutbox(list, tl, submitted, 9);
    expect(list).toMatchObject([{ id: "cq", placement: "turn", state: "confirmed", turnId: "t1", promoted: true }]);
    expect(pendingTail(list, tl).map((e) => e.id)).toEqual(["cq"]);
    // A stale queue list still holding it does not land it; the late "queued" response keeps it in the timeline.
    expect(reconcileOutbox(list, tl, [qItem("q1", "cq", "later")], 10)).toBe(list);
    expect(confirmOutbox(list, "cq", { disposition: "queued", turnId: null, queue: qItem("q1", "cq", "later") }, 11)[0]).toBe(list[0]);
    expect(visibleQueue([qItem("q1", "cq", "later")], [], list)).toEqual([]);
    // Nothing to do: already a turn send, another disposition, or already in the timeline.
    expect(flushOutbox(list, tl, submitted, 12)).toBe(list);
    const q = [entry("cq", "later", "queue", tl)];
    expect(flushOutbox(q, tl, { ...submitted, disposition: "steered" }, 12)).toBe(q);
    applyEvent(tl, userItem("u1", "later", "t1", "cq"));
    expect(flushOutbox(q, tl, submitted, 13)).toBe(q);
  });
  it("hides a queue row whose message is already in the timeline (userMessage before the queue refresh)", () => {
    const tl = idle();
    const queue = [qItem("q1", "cq", "later"), qItem("q2", "cr", "after")];
    applyEvent(tl, started("t1"));
    applyEvent(tl, userItem("u1", "later", "t1", "cq"));
    expect(visibleQueue(queue, [], [], tl)).toEqual([queue[1]]);
    expect(visibleQueue(queue, [], [])).toEqual(queue);
  });
  it("ignores steered / unknown submissions and messages already in the timeline", () => {
    const tl = idle();
    expect(flushedOutboxEntry(tl, { ...submitted, disposition: "steered" }, 1)).toBeNull();
    expect(flushedOutboxEntry(tl, { ...submitted, clientUserMessageId: undefined }, 1)).toBeNull();
    applyEvent(tl, started("t1"));
    applyEvent(tl, userItem("u1", "later", "t1", "cq"));
    expect(flushedOutboxEntry(tl, submitted, 1)).toBeNull();
  });
});
