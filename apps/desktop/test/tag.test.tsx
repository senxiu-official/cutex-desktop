// @vitest-environment jsdom
// The one Tag / CountBadge (components/Tag, design 040 §2): tone → look, count cap, extra attributes pass through.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { CountBadge, Tag } from "../src/renderer/src/components/Tag";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | null = null;
const render = (el: React.ReactElement) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
};
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});

it("a Tag is a soft, borderless chip in one of five tones; attributes and extra classes pass through", () => {
  const host = render(h("div", null, h(Tag, { tone: "attention", title: "t", "data-testid": "x", className: "ml-auto" } as never, "待审核")));
  const el = host.querySelector<HTMLElement>("[data-tag]")!;
  expect(el.getAttribute("data-tag")).toBe("attention");
  expect(el.className).toContain("bg-attention-soft");
  expect(el.className).toContain("rounded-chip");
  expect(el.className).toContain("ml-auto");
  expect(el.className).not.toMatch(/\bborder\b/);
  expect(el.getAttribute("data-testid")).toBe("x");
  expect(el.textContent).toBe("待审核");
  expect(render(h(Tag, null, "a")).querySelector("[data-tag]")!.getAttribute("data-tag")).toBe("neutral");
});

it("a CountBadge shows the number, caps it at max+, and takes a tone", () => {
  const host = render(h("div", null, h(CountBadge, { count: 3 }), h(CountBadge, { count: 120, tone: "danger" }), h(CountBadge, { count: 12, max: 9, tone: "accent" }), h(CountBadge, { count: "!" })));
  const b = [...host.querySelectorAll<HTMLElement>("[data-count-badge]")];
  expect(b.map((x) => x.textContent)).toEqual(["3", "99+", "9+", "!"]);
  expect(b.map((x) => x.getAttribute("data-count-badge"))).toEqual(["attention", "danger", "accent", "attention"]);
});

it("count digits use the fixed UI font with even figures, not the owner's 西文字体 (font rule 2026-10-23)", () => {
  const host = render(h(CountBadge, { count: 7 }));
  const el = host.querySelector<HTMLElement>("[data-count-badge]")!;
  expect(el.className).toContain("font-fixed");
  expect(el.className).toContain("tabular-nums");
});
