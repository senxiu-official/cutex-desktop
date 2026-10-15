import { describe, expect, it } from "vitest";
import type { QueueItem, QueuePause } from "@cutex-desktop/protocol";
import type { PendingSteer } from "../src/renderer/src/lib/pendingSteers";
import { composerAttachments, interruptSendText, mergeMessageTexts, pausedSection, restorePlan } from "../src/renderer/src/lib/queuePause";

const steer = (id: string, text: string, state: PendingSteer["state"], extra?: unknown[]): PendingSteer => ({ id, text, imageCount: 0, turnId: "t1", baseline: 0, state, extra });
const item = (queueId: string, input: unknown[]): QueueItem => ({
  queueId,
  clientUserMessageId: `c-${queueId}`,
  origin: { kind: "other", clientId: "desktop" },
  input,
  position: 0,
  revision: 1,
  state: "queued",
  createdAt: "",
  updatedAt: "",
});
const text = (t: string) => ({ type: "text", text: t, text_elements: [] });
const pause: QueuePause = { pausedAt: "2026-10-07T00:00:00Z", reason: "interrupted", turnId: "t1" };

describe("停止 = 全部暂停: paused section", () => {
  it("lists undelivered steers first, then the queue — only while cutex holds it", () => {
    const steers = [steer("s1", "a", "waiting"), steer("s2", "b", "undelivered")];
    const items = [item("q1", [text("one")])];
    expect(pausedSection(steers, items, pause)).toEqual({ steers: [steers[1]], items, count: 2 });
    // Not paused in cutex: the queue is a normal queue; undelivered steers still form the section.
    expect(pausedSection(steers, items, null)).toEqual({ steers: [steers[1]], items: [], count: 1 });
    // Transient stop of interrupt-and-send: never shown as paused.
    expect(pausedSection([], items, pause, true).count).toBe(0);
  });

  it("merges messages with a blank line, skipping empty ones", () => {
    expect(mergeMessageTexts([" a ", "", "b\nc"])).toBe("a\n\nb\nc");
    expect(interruptSendText([steer("s1", "steer one", "waiting"), steer("s2", "steer two", "waiting")], "new text")).toBe("steer one\n\nsteer two\n\nnew text");
    expect(interruptSendText([steer("s1", "only steers", "waiting")], "")).toBe("only steers");
  });
});

describe("放回输入框", () => {
  it("puts steers then queued items into the composer, carrying images and skills", () => {
    const img = { type: "image", url: "data:image/png;base64,AAAA" };
    const skill = { type: "skill", name: "review", path: "/s/review" };
    const plan = restorePlan(
      [steer("s1", "steer", "undelivered", [{ type: "localImage", path: "C:\\x\\shot.png" }])],
      [item("q1", [text("first")]), item("q2", [text("$review second"), img, skill])],
    );
    expect(plan.text).toBe("steer\n\nfirst\n\n$review second");
    expect(plan.take.map((i) => i.queueId)).toEqual(["q1", "q2"]);
    expect(plan.keep).toEqual([]);
    expect(plan.steerIds).toEqual(["s1"]);
    expect(plan.extra).toEqual([{ type: "localImage", path: "C:\\x\\shot.png" }, img, skill]);
    const att = composerAttachments(plan.extra);
    expect(att.images).toEqual([
      { name: "shot.png", preview: null, source: { kind: "path", path: "C:\\x\\shot.png" } },
      { name: "image", preview: img.url, source: { kind: "data", url: img.url } },
    ]);
    expect(att.skills).toEqual([{ name: "review", path: "/s/review" }]);
  });

  it("keeps queued items the composer cannot represent", () => {
    const plan = restorePlan([], [item("q1", [text("a")]), item("q2", [text("b"), { type: "mention", name: "x", path: "app://x" }])]);
    expect(plan.take.map((i) => i.queueId)).toEqual(["q1"]);
    expect(plan.keep.map((i) => i.queueId)).toEqual(["q2"]);
    expect(plan.text).toBe("a");
  });
});
