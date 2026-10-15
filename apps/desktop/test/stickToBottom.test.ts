import { describe, expect, it, vi } from "vitest";
import { STICK_THRESHOLD, followAfterSend, onFollowAfterSend, pendingFollowKey, scrollFollow } from "../src/renderer/src/lib/stickToBottom";

describe("stick to bottom: scroll events", () => {
  const view = 600;

  it("at (or near) the bottom follows", () => {
    expect(scrollFollow(false, null, { top: 400, scrollHeight: 1000, clientHeight: view })).toEqual({ stick: true, snap: false });
    expect(scrollFollow(true, { top: 400, clientHeight: view }, { top: 400 - STICK_THRESHOLD + 1, scrollHeight: 1000, clientHeight: view })).toEqual({ stick: true, snap: false });
  });

  it("a send's bubble landing before the snap does not read as scrolling away (regression)", () => {
    // Following at the bottom (top 400 of 1000); the optimistic bubble adds 79 px and the browser's
    // scroll anchoring fires a scroll in that frame, before the ResizeObserver snapped: the position
    // did not move up, so it keeps following and snaps to the new bottom.
    expect(scrollFollow(true, { top: 400, clientHeight: view }, { top: 400, scrollHeight: 1079, clientHeight: view })).toEqual({ stick: true, snap: true });
    expect(scrollFollow(true, { top: 400, clientHeight: view }, { top: 430, scrollHeight: 1130, clientHeight: view })).toEqual({ stick: true, snap: true });
    // The viewport changed size (the composer shrank after the send, the queue card grew).
    expect(scrollFollow(true, { top: 400, clientHeight: 540 }, { top: 380, scrollHeight: 1079, clientHeight: view })).toEqual({ stick: true, snap: true });
    // No earlier scroll event yet.
    expect(scrollFollow(true, null, { top: 400, scrollHeight: 1079, clientHeight: view })).toEqual({ stick: true, snap: true });
  });

  it("the owner scrolling up past the threshold lets go (agent output stops following)", () => {
    expect(scrollFollow(true, { top: 400, clientHeight: view }, { top: 300, scrollHeight: 1000, clientHeight: view })).toEqual({ stick: false, snap: false });
    // Up while content also grew.
    expect(scrollFollow(true, { top: 400, clientHeight: view }, { top: 390, scrollHeight: 1079, clientHeight: view })).toEqual({ stick: false, snap: false });
  });

  it("not following stays put until the owner is back near the bottom", () => {
    expect(scrollFollow(false, { top: 100, clientHeight: view }, { top: 200, scrollHeight: 1000, clientHeight: view })).toEqual({ stick: false, snap: false });
    expect(scrollFollow(false, { top: 200, clientHeight: view }, { top: 380, scrollHeight: 1000, clientHeight: view })).toEqual({ stick: true, snap: false });
  });
});

describe("stick to bottom: sends", () => {
  it("a composer send reaches the conversation listening for it", () => {
    const seen = vi.fn();
    const off = onFollowAfterSend(seen);
    followAfterSend("a1");
    expect(seen).toHaveBeenCalledWith("a1");
    off();
    followAfterSend("a2");
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("the pending-send key changes when a send is added, moves or settles", () => {
    const one = [{ id: "c1", placement: "turn", state: "sending" }];
    expect(pendingFollowKey(undefined)).toBe("");
    expect(pendingFollowKey(one)).not.toBe(pendingFollowKey([]));
    expect(pendingFollowKey([{ ...one[0]!, placement: "queue" }])).not.toBe(pendingFollowKey(one));
    expect(pendingFollowKey([{ ...one[0]!, state: "confirmed" }])).not.toBe(pendingFollowKey(one));
    expect(pendingFollowKey([...one])).toBe(pendingFollowKey(one));
  });
});
