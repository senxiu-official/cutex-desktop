// @vitest-environment jsdom
// The one tooltip (lib/tips, design 040 §2.1): data-tip after 500 ms, never over its own button's open panel, outside
// the edge of the float its anchor sits in, gone on a press / Esc / scroll, and in a second window too.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTips, placeTip, tipSuppressed, TIP_DELAY } from "../src/renderer/src/lib/tips";

const VIEW = { width: 1200, height: 800 };
const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

describe("placeTip", () => {
  it("below the anchor, above when there is no room below", () => {
    expect(placeTip(box(100, 100, 30, 20), { width: 80, height: 24 }, VIEW)).toEqual({ left: 100, top: 126, side: "below" });
    expect(placeTip(box(100, 770, 30, 20), { width: 80, height: 24 }, VIEW).side).toBe("above");
  });

  it("an explicit side wins", () => {
    expect(placeTip(box(100, 100, 30, 20), { width: 80, height: 24 }, VIEW, { side: "right" })).toMatchObject({ left: 136, side: "right" });
  });

  it("a side with no room flips (a sidebar docked on the right gets its tips on the left)", () => {
    const at = placeTip(box(1000, 100, 190, 28), { width: 160, height: 24 }, VIEW, { side: "right" });
    expect(at.side).toBe("left");
    expect(at.left + 160).toBeLessThanOrEqual(1000);
  });

  it("in a float: beside the float, level with the row — never over the float", () => {
    const float = box(300, 200, 240, 300);
    const at = placeTip(box(304, 260, 232, 28), { width: 160, height: 24 }, VIEW, { float });
    expect(at.side).toBe("right");
    expect(at.left).toBeGreaterThanOrEqual(float.right);
    expect(at.top).toBe(260);
    // No room on the right: the left side, still outside.
    const nearEdge = box(940, 200, 240, 300);
    const left = placeTip(box(944, 260, 232, 28), { width: 160, height: 24 }, VIEW, { float: nearEdge });
    expect(left.side).toBe("left");
    expect(left.left + 160).toBeLessThanOrEqual(nearEdge.left);
  });
});

describe("tipSuppressed", () => {
  it("while the anchor's own panel is open", () => {
    document.body.innerHTML = `<div class="float" role="menu"></div>`;
    const b = document.createElement("button");
    expect(tipSuppressed(b)).toBe(false);
    b.setAttribute("aria-expanded", "true");
    expect(tipSuppressed(b)).toBe(true);
    const wrap = document.createElement("div");
    wrap.innerHTML = `<button aria-expanded="true"></button>`;
    expect(tipSuppressed(wrap)).toBe(true);
  });

  it("not for an expanded toggle that opened no float (the sidebar button while the sidebar shows)", () => {
    document.body.innerHTML = "";
    const b = document.createElement("button");
    b.setAttribute("aria-expanded", "true");
    document.body.append(b);
    expect(tipSuppressed(b)).toBe(false);
  });
});

function setup(win: Window & typeof globalThis) {
  const doc = win.document;
  doc.body.innerHTML = `
    <button id="plain" data-tip="设置">S</button>
    <button id="open" data-tip="通知" aria-expanded="false">N</button>
    <div class="float" id="menu"><button id="row" data-tip="一个窗格只放一种东西">R</button></div>`;
  doc.getElementById("plain")!.getBoundingClientRect = () => box(100, 100, 30, 20);
  doc.getElementById("open")!.getBoundingClientRect = () => box(200, 100, 30, 20);
  doc.getElementById("menu")!.getBoundingClientRect = () => box(300, 200, 240, 300);
  doc.getElementById("row")!.getBoundingClientRect = () => box(304, 260, 232, 28);
  const over = (id: string) => doc.getElementById(id)!.dispatchEvent(new win.MouseEvent("pointerover", { bubbles: true }));
  const out = (id: string) => doc.getElementById(id)!.dispatchEvent(new win.MouseEvent("pointerout", { bubbles: true, relatedTarget: doc.body }));
  const tip = () => doc.querySelector<HTMLElement>("[data-tip-shown]");
  return { doc, over, out, tip };
}

describe("installTips", () => {
  let detach: () => void = () => {};
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    detach();
    vi.useRealTimers();
  });

  it("shows after 500 ms of hover, says what it is, and is described-by while up", () => {
    detach = installTips(window);
    const { over, out, tip, doc } = setup(window);
    over("plain");
    vi.advanceTimersByTime(TIP_DELAY - 10);
    expect(tip()).toBeNull();
    vi.advanceTimersByTime(20);
    expect(tip()?.textContent).toBe("设置");
    expect(tip()?.getAttribute("role")).toBe("tooltip");
    expect(doc.getElementById("plain")!.getAttribute("aria-describedby")).toBe("cutex-tip");
    out("plain");
    expect(tip()).toBeNull();
    expect(doc.getElementById("plain")!.hasAttribute("aria-describedby")).toBe(false);
  });

  it("never over the panel its own button opened", () => {
    detach = installTips(window);
    const { over, tip, doc } = setup(window);
    doc.getElementById("open")!.setAttribute("aria-expanded", "true");
    over("open");
    vi.advanceTimersByTime(TIP_DELAY + 50);
    expect(tip()).toBeNull();
  });

  it("goes when the button opens its panel while the tip is up", () => {
    detach = installTips(window);
    const { over, tip, doc } = setup(window);
    over("open");
    vi.advanceTimersByTime(TIP_DELAY + 10);
    expect(tip()).not.toBeNull();
    doc.getElementById("open")!.setAttribute("aria-expanded", "true");
    vi.advanceTimersByTime(250);
    expect(tip()).toBeNull();
  });

  it("a press hides it and it does not come back until the pointer leaves", () => {
    detach = installTips(window);
    const { over, out, tip, doc } = setup(window);
    over("plain");
    vi.advanceTimersByTime(TIP_DELAY + 10);
    doc.getElementById("plain")!.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
    expect(tip()).toBeNull();
    over("plain");
    vi.advanceTimersByTime(TIP_DELAY + 10);
    expect(tip()).toBeNull();
    out("plain");
    vi.advanceTimersByTime(1000);
    over("plain");
    vi.advanceTimersByTime(TIP_DELAY + 10);
    expect(tip()).not.toBeNull();
  });

  it("a sidebar row: beside the sidebar, never down over the rows it just opened", () => {
    detach = installTips(window);
    document.body.innerHTML = `<aside id="side" data-tip-beside=""><button id="project" data-tip="C:/Tools/cutex">cutex</button><div id="rows"></div></aside>`;
    const project = document.getElementById("project")!;
    const real = window.HTMLElement.prototype.getBoundingClientRect;
    window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return this.hasAttribute("data-tip-shown") ? box(0, 0, 160, 24) : this.id === "project" ? box(8, 120, 200, 28) : this.id === "side" ? box(0, 40, 264, 760) : box(0, 0, 0, 0);
    };
    project.dispatchEvent(new window.MouseEvent("pointerover", { bubbles: true }));
    vi.advanceTimersByTime(TIP_DELAY + 10);
    const tip = document.querySelector<HTMLElement>("[data-tip-shown]")!;
    expect(tip.getAttribute("data-side")).toBe("right");
    expect(parseFloat(tip.style.left)).toBeGreaterThanOrEqual(264);
    expect(parseFloat(tip.style.top)).toBe(120);
    window.HTMLElement.prototype.getBoundingClientRect = real;
  });

  it("Enter on the focused anchor hides it until focus moves", () => {
    detach = installTips(window);
    const { over, tip, doc } = setup(window);
    const plain = doc.getElementById("plain")!;
    over("plain");
    vi.advanceTimersByTime(TIP_DELAY + 10);
    expect(tip()).not.toBeNull();
    plain.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(tip()).toBeNull();
    over("plain");
    vi.advanceTimersByTime(TIP_DELAY + 10);
    expect(tip()).toBeNull();
  });

  it("Esc and a scroll hide it", () => {
    detach = installTips(window);
    const { over, tip, doc } = setup(window);
    over("plain");
    vi.advanceTimersByTime(TIP_DELAY + 10);
    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(tip()).toBeNull();
    vi.advanceTimersByTime(1000);
    over("open");
    vi.advanceTimersByTime(TIP_DELAY + 10);
    doc.body.dispatchEvent(new window.Event("scroll"));
    expect(tip()).toBeNull();
  });

  it("an anchor inside a float gets its tip outside the float's edge", () => {
    detach = installTips(window);
    const { over, tip } = setup(window);
    const real = window.HTMLElement.prototype.getBoundingClientRect;
    window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return this.hasAttribute("data-tip-shown") ? box(0, 0, 160, 24) : box(0, 0, 0, 0);
    };
    over("row");
    vi.advanceTimersByTime(TIP_DELAY + 10);
    expect(tip()?.getAttribute("data-side")).toBe("right");
    expect(parseFloat(tip()!.style.left)).toBeGreaterThanOrEqual(540);
    window.HTMLElement.prototype.getBoundingClientRect = real;
  });

  it("works in a second window (a desk window's own document)", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const win = frame.contentWindow as Window & typeof globalThis;
    detach = installTips(win);
    const { over, tip } = setup(win);
    over("plain");
    vi.advanceTimersByTime(TIP_DELAY + 10);
    expect(tip()?.textContent).toBe("设置");
    expect(tip()?.ownerDocument).toBe(win.document);
    expect(document.querySelector("[data-tip-shown]")).toBeNull();
  });
});
