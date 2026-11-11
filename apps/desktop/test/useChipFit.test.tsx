// @vitest-environment jsdom
// 状态标签 自动 (lib/useChipFit): a row renders again only when its decision (text chip / compact) flips, not on
// every pixel its line changes width by — a sidebar edge drag resized every row per step (perf/divider-drag-commits).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const hub = vi.hoisted(() => ({ cb: null as null | (() => void) }));
vi.mock("../src/renderer/src/lib/resizeHub", () => ({
  sharedResizeObserver: (cb: () => void) => ((hub.cb = cb), { observe: () => {}, unobserve: () => {}, disconnect: () => {} }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useChipFit } = await import("../src/renderer/src/lib/useChipFit");

describe("useChipFit", () => {
  let root: Root;
  let host: HTMLDivElement;
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders the row only when the decision flips", async () => {
    let renders = 0;
    let shown: boolean | null = null;
    let width = 300;
    function Row() {
      renders++;
      const { lineRef, compact } = useChipFit("auto", []);
      shown = compact;
      return h("div", { ref: lineRef }, h("span", { "data-fit-name": "" }, "Alden"), h("span", { "data-fit-chip": "" }, h("span", { "data-fit-measure": "" }, "需要你")));
    }
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const rect = (w: number) => () => ({ width: w, height: 16, left: 0, top: 0, right: w, bottom: 16, x: 0, y: 0, toJSON: () => ({}) });
    const origRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) { return rect(this.hasAttribute("data-fit-measure") ? 40 : 0)(); };
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => 60 });
    try {
      await act(async () => root.render(h(Row)));
      expect(shown).toBe(false);
      const settled = renders;
      for (const w of [290, 280, 250, 200, 150]) {
        width = w;
        await act(async () => hub.cb!());
      }
      expect(renders).toBe(settled);
      width = 80;
      await act(async () => hub.cb!());
      expect(shown).toBe(true);
      expect(renders).toBe(settled + 1);
      width = 70;
      await act(async () => hub.cb!());
      expect(renders).toBe(settled + 1);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = origRect;
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    }
  });
});
