// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Popover } from "../src/renderer/src/components/Menu";
let el: HTMLDivElement, root: Root;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.stubGlobal("innerWidth", 800); vi.stubGlobal("innerHeight", 900);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-popover")) return { x: 0, y: 0, left: 0, top: 0, right: Math.min(576, innerWidth - 32), bottom: 576, width: Math.min(576, innerWidth - 32), height: 576 } as DOMRect;
    return { x: 700, y: 700, left: 700, top: 700, right: 780, bottom: 720, width: 80, height: 20 } as DOMRect;
  });
  el = document.createElement("div"); el.style.overflow = "hidden"; document.body.append(el); root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = (fitViewport = true) => act(() => root.render(h(Popover, { fitViewport, height: "576px", trigger: "Rules", children: () => h("input", { type: "checkbox" }) })));
const open = () => act(() => el.querySelector("button")!.click());
const panel = () => document.querySelector<HTMLElement>("[data-popover]");

it("escapes clipping ancestors and follows the viewport without changing the trigger", () => {
  mount(); const trigger = el.querySelector("button"); open();
  expect(panel()!.parentElement).toBe(document.body);
  expect(panel()!.style.position).toBe("fixed");
  expect(panel()!.style.left).toBe("208px"); expect(panel()!.style.top).toBe("118px");
  vi.stubGlobal("innerWidth", 430); act(() => window.dispatchEvent(new Event("resize")));
  expect(panel()!.style.left).toBe("16px"); expect(el.querySelector("button")).toBe(trigger);
  act(() => panel()!.querySelector("input")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  expect(panel()).not.toBeNull();
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true })));
  expect(panel()).not.toBeNull();
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(panel()).toBeNull();
});

it("does not dismiss the rule form while its typed-confirmation dialog handles input", () => {
  mount(); open();
  const dialog = document.createElement("dialog"); dialog.open = true; document.body.append(dialog);
  act(() => dialog.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(panel()).not.toBeNull(); dialog.remove();
  act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  expect(panel()).toBeNull();
});

it("keeps existing content-sized popovers inside their original parent", () => {
  mount(false); open(); expect(el.contains(panel())).toBe(true);
  expect(panel()!.style.position).toBe("");
});
