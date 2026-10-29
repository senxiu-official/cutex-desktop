import { describe, expect, it, vi } from "vitest";
import { STICK_THRESHOLD, followAfterSend, nextSlack, onFollowAfterSend, pendingFollowKey, scrollFollow, turnFollowKey } from "../src/renderer/src/lib/stickToBottom";

describe("stick to bottom: scroll events", () => {
  const view = 600;

  it("at (or near) the bottom follows", () => {
    expect(scrollFollow(false, null, { top: 400, scrollHeight: 1000, clientHeight: view })).toEqual({ stick: true, snap: false });
    expect(scrollFollow(false, { top: 300, clientHeight: view }, { top: 400 - STICK_THRESHOLD + 1, scrollHeight: 1000, clientHeight: view })).toEqual({ stick: true, snap: false });
  });

  it("a small upward wheel inside the bottom zone releases before streamed growth can snap it back", () => {
    const near = { top: 380, scrollHeight: 1000, clientHeight: view };
    expect(scrollFollow(true, { top: 400, clientHeight: view }, near, true)).toEqual({ stick: false, snap: false });
    // A row resize, turn completion or history layout fires another scroll while still near.
    expect(scrollFollow(false, { top: 380, clientHeight: view }, near, false)).toEqual({ stick: false, snap: false });
    expect(scrollFollow(false, { top: 380, clientHeight: view }, near, true)).toEqual({ stick: false, snap: false });
    expect(scrollFollow(false, { top: 380, clientHeight: view }, { ...near, top: 360, scrollHeight: 1020 }, true)).toEqual({ stick: false, snap: false });
    // Returning down into the zone is explicit owner scrolling and reattaches.
    expect(scrollFollow(false, { top: 360, clientHeight: view }, near, true)).toEqual({ stick: true, snap: false });
  });

  it("content shrinking into the bottom zone cannot reattach a released reader", () => {
    expect(scrollFollow(false, { top: 200, clientHeight: view }, { top: 200, scrollHeight: 820, clientHeight: view }, false)).toEqual({ stick: false, snap: false });
    // Browser anchoring while following still keeps its existing attachment.
    expect(scrollFollow(true, { top: 400, clientHeight: view }, { top: 380, scrollHeight: 1000, clientHeight: view }, false)).toEqual({ stick: true, snap: false });
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

  it("the layout moving the position up never lets go — only the owner's own input does (regression 2026-10-23)", () => {
    // Preview repro (mock, cutex-mock-turnstart-ms): following at the bottom of a conversation longer
    // than the 长对话 window (30 turns), the owner sends; cutex starts the turn in its own commit. The
    // oldest shown turn leaves the top (scroll anchoring: 12626 → 12192) and the new turn's header and
    // live line grow the bottom by 53 px. That scroll event, handled before the ResizeObserver snapped,
    // moved UP with a gap over the threshold: it let go, and the reply streamed below the view.
    const prev = { top: 12626, clientHeight: 548 };
    const anchored = { top: 12192, scrollHeight: 12793, clientHeight: 548 };
    expect(scrollFollow(true, prev, anchored, false)).toEqual({ stick: true, snap: true });
    // Clamping after content above / below shrank, then grew again before the snap: the same.
    expect(scrollFollow(true, { top: 400, clientHeight: view }, { top: 250, scrollHeight: 1000, clientHeight: view }, false)).toEqual({ stick: true, snap: true });
    // The owner's wheel / keys / drag moving up in that same situation still let go.
    expect(scrollFollow(true, prev, anchored, true)).toEqual({ stick: false, snap: false });
    // Not following (the owner scrolled up before): the layout does not re-attach it either.
    expect(scrollFollow(false, prev, anchored, false)).toEqual({ stick: false, snap: false });
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

  it("the turn key changes when a turn starts or ends (snapped in the commit, like new rows)", () => {
    const idle = { turns: [{}, {}], activeTurnId: null };
    const started = { turns: [{}, {}, {}], activeTurnId: "t3" };
    expect(turnFollowKey(undefined)).toBe("");
    expect(turnFollowKey(started)).not.toBe(turnFollowKey(idle));
    expect(turnFollowKey({ ...started, activeTurnId: null })).not.toBe(turnFollowKey(started));
    expect(turnFollowKey({ turns: [...started.turns], activeTurnId: "t3" })).toBe(turnFollowKey(started));
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

describe("stick to bottom: the history only moves up (owner 2026-10-26; 「接下来」 included 2026-10-27)", () => {
  it("what would pull the rows down becomes room under them", () => {
    // A turn ends with agent messages after its reply: the live line (22 px) leaves under them while the reply's
    // action row (16 px) lands above — the rows under the reply would go down 22 px.
    expect(nextSlack(0, 22)).toBe(22);
    // The 需要你 strip (26 px) goes away, the input box shrinks after a long draft was sent.
    expect(nextSlack(22, 26)).toBe(48);
    expect(nextSlack(0, 81)).toBe(81);
  });

  it("「接下来」 getting shorter becomes room too (a queued message deleted / taken, the panel folded or emptied)", () => {
    expect(nextSlack(0, 24)).toBe(24);
    expect(nextSlack(24, 48)).toBe(72);
    // On top of the room a long draft left.
    expect(nextSlack(81, 55)).toBe(136);
  });

  it("「接下来」 shrinking and growing back reuses the room: repeated cycles leave none behind", () => {
    let room = 0;
    for (let i = 0; i < 50; i++) {
      room = nextSlack(room, 24); // a queued message deleted
      expect(room).toBe(24);
      room = nextSlack(room, -24); // another one queued
      expect(room).toBe(0);
    }
    // Fold (-48 px of panel) then unfold: the same.
    expect(nextSlack(nextSlack(0, 48), -48)).toBe(0);
    // A new reply row (40 px) after the panel emptied (55 px): it fills part of the room, the rest stays.
    expect(nextSlack(nextSlack(0, 55), -40)).toBe(15);
  });

  it("what would move them up fills the room first", () => {
    // A new row (40 px) under the rows: it takes the room, nothing moves.
    expect(nextSlack(22, -40)).toBe(0);
    expect(nextSlack(60, -40)).toBe(20);
    // A taller 「接下来」 / status row (the viewport shrinks) takes it too.
    expect(nextSlack(30, -24)).toBe(6);
  });

  it("sub-pixel noise changes nothing", () => {
    expect(nextSlack(10, 0.3)).toBe(10);
    expect(nextSlack(10, -0.4)).toBe(10);
  });
});
