// @vitest-environment jsdom
// 最大化 / 还原 is one stable change of the row (owner 2026-10-22: it flickered, the sidebar too):
// - the row slides as a whole from the geometry taken before the commit (lib/columnGlide armRowGlide): every item
//   eases its width with no flex shrink / grow meanwhile and the row's leading space eases with them — never a
//   per-column translate (that jumped on the first frame and snapped on the last);
// - the eased width holds for a column filling the row (`flex: 1 1 0%`: basis auto meanwhile), and the change's later
//   render (SideArea storing the maximised widths) glides nothing on top: the column collapsed to its border for the
//   whole slide, the timeline re-wrapped at 0 px and the history left the bottom (maximize-scroll 2026-10-27);
// - the sidebar's automatic rail does not read the 最大化 state: toggling it does not even re-render the hook.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import * as glide from "../src/renderer/src/lib/columnGlide";
import { resetGrow, useGrow } from "../src/renderer/src/lib/panelGrow";
import { useSidebarRail, useWsUi } from "../src/renderer/src/lib/workspaces";

type Box = { left: number; width: number };
function stubBox(el: HTMLElement, box: () => Box) {
  el.getBoundingClientRect = () => {
    const b = box();
    return { left: b.left, width: b.width, right: b.left + b.width, top: 0, bottom: 100, height: 100, x: b.left, y: 0, toJSON() {} } as DOMRect;
  };
}

afterEach(() => {
  glide.resetColumnGlide();
  resetGrow();
  document.body.innerHTML = "";
});

describe("最大化 slides the whole row", () => {
  it("each changed item eases its width (no shrink / grow, basis auto meanwhile), the leading space eases too; no translate", () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const row = document.createElement("div");
    const [a, b, c] = [0, 1, 2].map(() => document.createElement("div"));
    row.append(a!, b!, c!);
    document.body.append(row);
    // Before: centred group 317 | 770 | 8 | 460 in a 1600 px row. After: the column takes the free row.
    let grown = false;
    stubBox(row, () => ({ left: 0, width: 1600 }));
    stubBox(a!, () => (grown ? { left: 0, width: 1132 } : { left: 317, width: 770 }));
    stubBox(b!, () => (grown ? { left: 1132, width: 8 } : { left: 1087, width: 8 }));
    stubBox(c!, () => (grown ? { left: 1140, width: 460 } : { left: 1095, width: 460 }));
    const calls: { el: Element; frames: Keyframe[] }[] = [];
    for (const el of [row, a!, b!, c!]) {
      el.animate = ((frames: Keyframe[]) => {
        calls.push({ el, frames });
        return { finished: Promise.resolve(), cancel() {}, playState: "running" } as unknown as Animation;
      }) as typeof el.animate;
      el.getAnimations = () => [];
    }
    glide.armRowGlide(row);
    grown = true;
    glide.glideColumns(row);
    const col = calls.find((x) => x.el === a)!;
    expect(col.frames).toEqual([
      { flexShrink: "0", flexGrow: "0", flexBasis: "auto", width: "770px" },
      { flexShrink: "0", flexGrow: "0", flexBasis: "auto", width: "1132px" },
    ]);
    // Unchanged widths do not move on their own: they ride on the row.
    expect(calls.find((x) => x.el === c)).toBeUndefined();
    const lead = calls.find((x) => x.el === row)!;
    expect(lead.frames).toEqual([
      { justifyContent: "flex-start", paddingLeft: "317px" },
      { justifyContent: "flex-start", paddingLeft: "0px" },
    ]);
    expect(calls.some((x) => x.frames.some((f) => "transform" in f))).toBe(false);
    vi.unstubAllGlobals();
  });

  it("the render storing the maximised widths during the slide glides nothing of its own", () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const row = document.createElement("div");
    const col = document.createElement("div");
    col.dataset.glide = "main";
    row.append(col);
    document.body.append(row);
    // 770 px centred before; the first render draws it grown (1132); the bake's render makes it fill the row, read
    // mid-slide (the collapsed 2 px of the bug, or wherever the slide has it).
    let box: Box = { left: 317, width: 770 };
    stubBox(row, () => ({ left: 0, width: 1600 }));
    stubBox(col, () => box);
    const calls: Keyframe[][] = [];
    for (const el of [row, col]) {
      el.animate = ((frames: Keyframe[]) => {
        calls.push(frames);
        return { finished: new Promise(() => {}), cancel() {}, playState: "running" } as unknown as Animation;
      }) as typeof el.animate;
      el.getAnimations = () => [];
    }
    // The column's box is remembered (an earlier change).
    glide.glideColumns(row);
    expect(calls).toEqual([]);
    glide.armRowGlide(row);
    box = { left: 0, width: 1132 };
    glide.glideColumns(row);
    const slide = calls.length;
    expect(slide).toBeGreaterThan(0);
    box = { left: 0, width: 2 };
    glide.glideColumns(row);
    expect(calls.length).toBe(slide);
    expect(calls.some((f) => f.some((k) => "transform" in k))).toBe(false);
    vi.unstubAllGlobals();
  });

  it("an armed row taken during a drag does nothing (a drag is never a slide)", () => {
    const row = document.createElement("div");
    document.body.append(row);
    glide.resizeDrag(true);
    glide.armRowGlide(row);
    glide.resizeDrag(false);
    const spy = vi.fn();
    row.animate = spy as never;
    glide.glideColumns(row);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("最大化 leaves the sidebar alone", () => {
  it("the automatic rail does not read the 最大化 state: toggling it does not re-render the hook nor change its answer", () => {
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useSidebarRail(false, 256));
      return null;
    }
    useWsUi.setState({ windowWidth: 1500 });
    const el = document.createElement("div");
    document.body.append(el);
    const r = createRoot(el);
    act(() => r.render(h(Probe)));
    const before = seen.length;
    act(() => useGrow.setState({ target: { kind: "conv", paneId: "main" } }));
    act(() => useGrow.setState({ room: { conv: { main: 0 }, shelf: 0 } }));
    act(() => useGrow.setState({ target: null }));
    expect(seen.length).toBe(before);
    expect(new Set(seen).size).toBe(1);
    act(() => r.unmount());
  });
});
