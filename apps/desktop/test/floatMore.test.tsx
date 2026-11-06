// @vitest-environment jsdom
// 「还有 N 个」 (design 040 §2.1): a float's list says how many rows sit below what it shows; nothing when all fit.
import { act, createElement as h, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string, vars?: { n: number }) => `${key}:${vars?.n}` }));
const { FloatMore, rowsBelow, useRowsBelow } = await import("../src/renderer/src/components/FloatMore");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("rowsBelow", () => {
  it("counts the rows that start at or under the visible bottom", () => {
    expect(rowsBelow([0, 30, 60, 90], 60)).toBe(2);
    expect(rowsBelow([0, 30], 200)).toBe(0);
  });
});

/** A 30 px row list whose box shows `visible` px (jsdom has no layout: the metrics are set by hand). */
function List({ count, visible }: { count: number; visible: number }) {
  const list = useRef<HTMLDivElement | null>(null);
  const setMetrics = (el: HTMLDivElement | null) => {
    list.current = el;
    if (!el) return;
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => visible });
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => count * 30 });
  };
  const n = useRowsBelow(list);
  return h(
    "div",
    { ref: setMetrics, id: "list" },
    ...Array.from({ length: count }, (_, i) =>
      h("div", { key: i, ref: (r: HTMLDivElement | null) => void (r && Object.defineProperty(r, "offsetTop", { configurable: true, get: () => i * 30 })) }, `row ${i}`),
    ),
    h(FloatMore, { n, list }),
  );
}

describe("FloatMore", () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("says how many are below", () => {
    act(() => root.render(h(List, { count: 10, visible: 120 })));
    const more = host.querySelector<HTMLElement>("[data-float-more]")!;
    // 120 px shown, less the 26 px footer: the rows from 94 px on (4 … 9) are below.
    expect(more.textContent).toBe("float.more:6");
    expect(more.getAttribute("aria-hidden")).toBe("true");
  });

  it("nothing at all when everything fits (no extra child in the list)", () => {
    act(() => root.render(h(List, { count: 3, visible: 120 })));
    expect(host.querySelector("[data-float-more]")).toBeNull();
    expect(host.querySelector("#list")!.children).toHaveLength(3);
  });
});

describe("where it is used", () => {
  const src = (p: string) => readFileSync(resolve(__dirname, "../src/renderer/src", p), "utf8");
  it("menus, popovers, the host switcher and the status chips fade their scrolling edges and count what is below", () => {
    for (const p of ["components/Menu.tsx", "components/MenuFlyout.tsx", "components/HostSwitcher.tsx", "components/StatusChip.tsx"]) {
      expect(src(p), p).toContain("float-scroll");
      expect(src(p), p).toContain("<FloatMore");
    }
  });
});
