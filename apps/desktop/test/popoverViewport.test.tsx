// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Popover } from "../src/renderer/src/components/Menu";
import { OwnerDocumentContext } from "../src/renderer/src/lib/ownerContext";
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

it.each([1.25, 1.5])("retains its panel through fractional layout, focus changes and automatic scrolling (DPR %s)", (dpr) => {
  vi.stubGlobal("devicePixelRatio", dpr);
  const fractional = (n: number) => Math.round(n * dpr) / dpr;
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
    const isPanel = this.hasAttribute("data-popover");
    const left = fractional(isPanel ? 0 : 700.3), top = fractional(isPanel ? 0 : 700.3);
    const width = fractional(isPanel ? 320.3 : 80.3), height = fractional(isPanel ? 256.3 : 20.3);
    return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height } as DOMRect;
  });
  mount();
  const trigger = el.querySelector("button");
  open();
  const original = panel()!;
  const position = [original.style.left, original.style.top];
  const timeline = document.createElement("div"); document.body.append(timeline);
  try {
    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("resize"));
      timeline.dispatchEvent(new Event("scroll"));
      el.dispatchEvent(new Event("scroll"));
    });
    expect(panel()).toBe(original);
    expect([original.style.left, original.style.top]).toEqual(position);
    expect(el.querySelector("button")).toBe(trigger);
  } finally { timeline.remove(); }
});

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

it.each(["ancestor", "window", "document"])("repositions on programmatic %s scroll without dismissing or replacing the panel", (target) => {
  mount(); open();
  const original = panel()!;
  const trigger = el.querySelector("button");
  const anchor = trigger!.parentElement!;
  Object.defineProperty(anchor, "getBoundingClientRect", { configurable: true,
    value: () => ({ left: 200, top: 650, right: 280, bottom: 670, width: 80, height: 20 } as DOMRect) });
  act(() => {
    (target === "ancestor" ? el : target === "window" ? window : document).dispatchEvent(new Event("scroll"));
  });
  expect(panel()).toBe(original);
  expect(original.style.left).toBe("200px");
  expect(original.style.top).toBe("68px");
  expect(el.querySelector("button")).toBe(trigger);
});

it("ignores unrelated timeline auto-scroll without measuring, losing an input draft, focus or IME", () => {
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  act(() => root.render(h(Popover, { trigger: "Search", children: () => h("input", { defaultValue: "草稿" }) })));
  open();
  const original = panel()!;
  const field = original.querySelector("input")!;
  act(() => {
    field.focus();
    field.setSelectionRange(1, 2);
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  });
  const timeline = document.createElement("div"); document.body.append(timeline);
  measure.mockClear();
  try {
    act(() => {
      for (let i = 0; i < 20; i++) {
        timeline.scrollTop = i * 20;
        timeline.dispatchEvent(new Event("scroll"));
      }
    });
    expect(panel()).toBe(original);
    expect(panel()!.querySelector("input")).toBe(field);
    expect(field.value).toBe("草稿");
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([1, 2]);
    expect(measure).not.toHaveBeenCalled();
    act(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true })));
    expect(panel()).toBe(original);
    act(() => field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    act(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(panel()).toBeNull();
  } finally { timeline.remove(); }
});

it.each(["wheel", "touchmove"])("dismisses on outside user %s before any scroll event", (type) => {
  mount(); open(); expect(panel()).not.toBeNull();
  act(() => document.body.dispatchEvent(type === "wheel"
    ? new WheelEvent("wheel", { bubbles: true, deltaY: 100 })
    : new Event("touchmove", { bubbles: true })));
  expect(panel()).toBeNull();
});

it.each(["wheel", "touchmove"])("retains the panel and portalled descendants during internal user %s", (type) => {
  act(() => root.render(h(Popover, {
    trigger: "Parent",
    children: () => h(Popover, { trigger: "Child", children: () => h("input", { defaultValue: "draft" }) }),
  })));
  open();
  const parent = panel()!;
  act(() => parent.querySelector("button")!.click());
  const panels = [...document.querySelectorAll<HTMLElement>("[data-popover]")];
  const child = panels.find(node => node !== parent)!;
  expect(child.parentElement).toBe(document.body);
  expect(parent.contains(child)).toBe(false);
  const field = child.querySelector("input")!;
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  measure.mockClear();
  act(() => {
    field.focus();
    field.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    field.dispatchEvent(type === "wheel" ? new WheelEvent("wheel", { bubbles: true, deltaY: 100 }) : new Event("touchmove", { bubbles: true }));
    child.dispatchEvent(new Event("scroll"));
  });
  expect([...document.querySelectorAll("[data-popover]")]).toEqual(panels);
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe("draft");
  expect(measure).not.toHaveBeenCalled();
});

it("handles scroll and user dismissal in the owning window's document", () => {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const desk = frame.contentDocument!;
  const deskWin = frame.contentWindow! as Window & typeof globalThis;
  const deskHost = desk.createElement("div"); desk.body.append(deskHost);
  const deskRoot = createRoot(deskHost);
  try {
    act(() => deskRoot.render(h(OwnerDocumentContext.Provider, { value: desk },
      h(Popover, { trigger: "Desk", children: () => h("input", { defaultValue: "desk draft" }) }))));
    act(() => deskHost.querySelector("button")!.click());
    const original = desk.querySelector<HTMLElement>("[data-popover]")!;
    expect(original).not.toBeNull();
    expect(document.querySelector("[data-popover]")).toBeNull();
    const unrelated = desk.createElement("div"); desk.body.append(unrelated);
    act(() => unrelated.dispatchEvent(new deskWin.Event("scroll")));
    expect(desk.querySelector("[data-popover]")).toBe(original);
    act(() => document.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true })));
    expect(desk.querySelector("[data-popover]")).toBe(original);
    act(() => desk.body.dispatchEvent(new deskWin.WheelEvent("wheel", { bubbles: true, deltaY: 100 })));
    expect(desk.querySelector("[data-popover]")).toBeNull();
  } finally {
    act(() => deskRoot.unmount());
    frame.remove();
  }
});
