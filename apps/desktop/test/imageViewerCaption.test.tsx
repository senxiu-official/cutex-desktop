// @vitest-environment jsdom
// The enlarged image's toolbar keeps clear of the window's own buttons (owner 2026-11-28: its × sat on the window's ×):
// where the OS draws them over the page (Windows caption buttons right, macOS traffic lights left) it sits under the
// window bar's band, the height main gives the caption overlay; Linux draws its buttons in the page (covered), no band.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TITLEBAR_HEIGHT } from "../src/shared/ipc";

const env = vi.hoisted(() => ({ controls: "right" as "right" | "left" | null }));
vi.mock("../src/renderer/src/bridge", () => ({
  get bridge() {
    return { window: { nativeControls: env.controls, control: async () => {}, setChrome: async () => {} } };
  },
  api: {},
}));
vi.mock("../src/renderer/src/store", () => ({
  featuresOf: () => new Set(),
  hostApi: () => ({}),
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ notify: vi.fn() }), subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { ImageZoom } = await import("../src/renderer/src/components/ImageThumbs");
const { captionBand } = await import("../src/renderer/src/components/WindowControls");

let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
});

async function toolbarTop(controls: "right" | "left" | null) {
  env.controls = controls;
  act(() => root.render(h(ImageZoom, { src: "data:image/png;base64,AA==", onClose: () => {} })));
  return document.querySelector<HTMLElement>("[data-image-zoom-toolbar]")!.style.top;
}

describe("the enlarged image's toolbar and the window's buttons", () => {
  it("captionBand: the window bar's height where the OS draws the buttons over the page; none on Linux", () => {
    expect(captionBand("right")).toBe(TITLEBAR_HEIGHT);
    expect(captionBand("left")).toBe(TITLEBAR_HEIGHT);
    expect(captionBand(null)).toBe(0);
  });

  it("Windows (caption buttons right) and macOS (traffic lights left): under the band", async () => {
    expect(await toolbarTop("right")).toBe(`calc(${TITLEBAR_HEIGHT}px + 0.75rem)`);
    expect(await toolbarTop("left")).toBe(`calc(${TITLEBAR_HEIGHT}px + 0.75rem)`);
  });

  it("Linux (drawn buttons, covered by the overlay): at the top as before", async () => {
    expect(await toolbarTop(null)).toBe("calc(0px + 0.75rem)");
  });
});
