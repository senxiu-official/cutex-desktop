// @vitest-environment jsdom
// History only moves up — but a resize of the pane itself is not jitter (lib/stickToBottom keepRowsUp / resizedSlack):
// the window (or a Shelf / split divider) making the conversation pane taller keeps the rows at the bottom and shrinks
// the room under them; only changes inside a pane of constant height (the input box, 「接下来」, …) become room.
// Regression 2026-10-27: growing from a short window left 440 px of blank under the rows at 1440x960.
import { beforeEach, describe, expect, it } from "vitest";
import { keepRowsUp, nextSlack, resizedSlack, type RowsAnchor } from "../src/renderer/src/lib/stickToBottom";

describe("resizedSlack", () => {
  it("a taller pane shrinks the room by the growth, never below 0", () => {
    expect(resizedSlack(100, 60)).toBe(40);
    expect(resizedSlack(100, 440)).toBe(0);
    expect(resizedSlack(0, 440)).toBe(0);
  });
  it("only the width changed: the room stays", () => {
    expect(resizedSlack(80, 0)).toBe(80);
  });
});

/**
 * A pane (`main`, top 0) of `height` px: the scroller fills it above the composer, the column holds `rows` (heights)
 * and the room spacer. jsdom has no layout: the geometry the code reads is computed from this model.
 */
class Pane {
  height = 600;
  width = 900;
  composer = 120;
  rows = [400, 300, 200, 150, 90];
  room = 0;
  private top = 0;
  main = document.createElement("main");
  scroller = document.createElement("div");
  col = document.createElement("div");
  rowEls: HTMLElement[] = [];
  anchor: RowsAnchor | null = null;

  constructor() {
    this.main.append(this.scroller);
    this.scroller.append(this.col);
    document.body.append(this.main);
    const rect = (top: number, height: number, width = this.width) => ({ top, bottom: top + height, height, left: 0, right: width, width, x: 0, y: top, toJSON() {} }) as DOMRect;
    this.main.getBoundingClientRect = () => rect(0, this.height);
    this.scroller.getBoundingClientRect = () => rect(0, this.clientHeight);
    Object.defineProperties(this.scroller, {
      clientHeight: { get: () => this.clientHeight },
      scrollHeight: { get: () => this.scrollHeight },
      scrollTop: { get: () => this.top, set: (v: number) => (this.top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight))) },
    });
    this.scroller.scrollTo = ((o: ScrollToOptions) => {
      this.scroller.scrollTop = o.top ?? 0;
    }) as typeof this.scroller.scrollTo;
    for (const h of this.rows) {
      const el = document.createElement("div");
      el.setAttribute("data-tl-row", "");
      const i = this.rowEls.length;
      el.getBoundingClientRect = () => rect(this.offset(i) - this.top, this.rows[i] ?? 0);
      this.col.append(el);
      this.rowEls.push(el);
    }
    this.layout();
  }
  get clientHeight() {
    return Math.max(0, this.height - this.composer);
  }
  get scrollHeight() {
    return Math.max(this.clientHeight, this.rows.reduce((a, b) => a + b, 0) + this.room);
  }
  offset(i: number) {
    return this.rows.slice(0, i).reduce((a, b) => a + b, 0);
  }
  /** The last row's top on screen. */
  get lastTop() {
    return this.rowEls.at(-1)!.getBoundingClientRect().top;
  }
  /** The blank between the last row and the bottom of the viewport. */
  get blank() {
    const r = this.rowEls.at(-1)!.getBoundingClientRect();
    return this.clientHeight - r.bottom;
  }
  /** Conversation's ResizeObserver while following: snap to the bottom, then keepRowsUp. */
  layout(userToggle = false) {
    this.scroller.scrollTop = this.top; // clamp to the new size, as the browser does
    this.scroller.scrollTo({ top: this.scrollHeight });
    this.anchor = keepRowsUp(this.scroller, this.col, this.anchor, this.room, (px) => (this.room = px), userToggle);
  }
}

describe("keepRowsUp: changes inside the pane vs a resize of the pane", () => {
  let p: Pane;
  beforeEach(() => {
    document.body.innerHTML = "";
    p = new Pane();
  });

  it("starts at the bottom with no room", () => {
    expect(p.room).toBe(0);
    expect(p.blank).toBe(0);
  });

  it("inside a constant pane the input box getting shorter becomes room: the rows do not move", () => {
    const top = p.lastTop;
    p.composer = 40;
    p.layout();
    expect(p.room).toBe(80);
    expect(p.lastTop).toBe(top);
    // It grows back: the room is filled first, nothing left behind.
    p.composer = 120;
    p.layout();
    expect(p.room).toBe(0);
    expect(p.lastTop).toBe(top);
  });

  it("the pane getting taller (window resize) keeps the rows at the bottom: no blank under them (regression: 440 px)", () => {
    p.height = 400;
    p.layout();
    p.height = 840;
    p.layout();
    expect(p.room).toBe(0);
    expect(p.blank).toBe(0);
  });

  it("the room there was shrinks by the growth, never below 0", () => {
    p.composer = 20; // a long draft sent: 100 px of room
    p.layout();
    expect(p.room).toBe(100);
    p.height = 660;
    p.layout();
    expect(p.room).toBe(40);
    expect(p.blank).toBe(40);
    p.height = 900;
    p.layout();
    expect(p.room).toBe(0);
    expect(p.blank).toBe(0);
  });

  it("the pane getting shorter is unchanged: the room is eaten first and the rows stay put", () => {
    p.composer = 20;
    p.layout();
    const top = p.lastTop;
    p.height = 570;
    p.layout();
    expect(p.room).toBe(70);
    expect(p.lastTop).toBe(top);
    // Shorter than the room: the rest moves the rows up.
    p.height = 400;
    p.layout();
    expect(p.room).toBe(0);
    expect(p.lastTop).toBeLessThan(top);
  });

  it("a width change (a divider dragged sideways) that makes rows shorter leaves no room", () => {
    p.width = 1200;
    p.rows = p.rows.map((h) => h - 20);
    p.layout();
    expect(p.room).toBe(0);
    expect(p.blank).toBe(0);
  });

  it("the same row reflow inside a constant pane still becomes room (only-up kept)", () => {
    const top = p.lastTop;
    p.rows[4] = 60; // the last row got 30 px shorter: the ones above would go down
    p.layout();
    expect(p.room).toBe(nextSlack(0, 30));
    expect(p.lastTop).toBe(top + 0);
  });

  it("an automatic shrink keeps room, a user collapse clears it, then automatic changes keep room again", () => {
    p.composer = 40;
    p.layout();
    expect(p.room).toBe(80);
    expect(p.blank).toBe(80);

    p.rows[4] = 60;
    p.layout(true);
    expect(p.room).toBe(0);
    expect(p.blank).toBe(0);

    p.rows[4] = 30;
    p.layout();
    expect(p.room).toBe(30);
    expect(p.blank).toBe(30);
  });

  it("a user expand discards room kept from an automatic shrink", () => {
    p.composer = 40;
    p.layout();
    expect(p.room).toBe(80);

    p.rows[4] = 140;
    p.layout(true);
    expect(p.room).toBe(0);
    expect(p.blank).toBe(0);
  });
});
