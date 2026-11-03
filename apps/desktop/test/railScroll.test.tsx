// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useRailScroll } from "../src/renderer/src/lib/railScroll";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
let scroll = 0;
const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 40, width: 40, height: bottom - top, x: 0, y: top, toJSON() {} });
function Scene({ active, dragging = false }: { active: string; dragging?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useRailScroll(ref, active, "two-pages", false, dragging);
  return <div ref={node => {
    ref.current = node;
    if (!node) return;
    Object.defineProperties(node, {
      clientHeight: { configurable: true, value: 100 }, scrollHeight: { configurable: true, value: 300 }, offsetHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, get: () => scroll, set: n => { scroll = Math.max(0, Math.min(200, n)); } },
    });
    node.getBoundingClientRect = () => rect(0, 100);
    [...node.children].forEach((item, i) => { item.getBoundingClientRect = () => rect(i * 260 - scroll, i * 260 + 34 - scroll); });
  }}><button data-shelf-page="first" /><button data-shelf-page="last" /></div>;
}
afterEach(() => { act(() => root.render(null)); scroll = 0; vi.restoreAllMocks(); });

it("reveals a newly active page within its own lane and updates edge fades after wheel scrolling", () => {
  act(() => root.render(<Scene active="first" />));
  const lane = host.firstElementChild as HTMLElement;
  expect(lane.dataset.railBefore).toBe("false");
  expect(lane.dataset.railAfter).toBe("true");
  act(() => root.render(<Scene active="last" />));
  expect(scroll).toBe(200);
  expect(lane.dataset.railBefore).toBe("true");
  expect(lane.dataset.railAfter).toBe("false");
  lane.scrollTop = 80;
  lane.dispatchEvent(new Event("scroll"));
  expect(lane.dataset.railBefore).toBe("true");
  expect(lane.dataset.railAfter).toBe("true");
  expect(lane.style.maskImage).toContain("transparent");
});

it("auto-scrolls while a drag stays near an edge, and stops when the pointer leaves or drag ends", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let seq = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { frames.set(++seq, cb); return seq; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  act(() => root.render(<Scene active="first" dragging />));
  const move = (x: number, y: number) => window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y }));
  const tick = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(0)); };
  move(20, 99); tick(); tick();
  expect(scroll).toBeGreaterThan(20);
  const before = scroll;
  move(100, 99); tick();
  expect(scroll).toBe(before);
  move(20, 99);
  act(() => root.render(<Scene active="first" />));
  expect(frames.size).toBe(0);
});
