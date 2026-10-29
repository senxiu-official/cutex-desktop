// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeMenu, openMenuAt } from "../src/renderer/src/lib/contextMenu";
import { Overlays } from "../src/renderer/src/components/Overlays";
import { ARMED_EXPIRED_MS, ARMED_TIMEOUT_MS } from "../src/renderer/src/lib/armedConfirm";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const picked = vi.fn();
beforeEach(() => { picked.mockClear(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); act(() => root.render(h(Overlays))); });
afterEach(() => { act(() => closeMenu()); act(() => root.unmount()); host.remove(); });
const open = () => {
  act(() => openMenuAt(700, 100, [{ label: "Parent", onSelect() {}, submenu: [{ label: "First", onSelect: picked }, { label: "Nested", onSelect() {}, submenu: [{ label: "Deep", onSelect: picked }] }] }]));
  act(() => document.querySelector('[role="menuitem"]')!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
};
it("treats wheel, touch and clicks inside portalled context submenus as inside the menu", () => {
  open();
  const flyout = document.querySelector<HTMLElement>("[data-flyout]")!;
  expect(flyout.parentElement).toBe(document.body);
  act(() => { flyout.dispatchEvent(new WheelEvent("wheel", { bubbles: true })); flyout.dispatchEvent(new Event("touchmove", { bubbles: true })); flyout.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  expect(document.querySelector("[data-flyout]")).toBe(flyout);
  act(() => flyout.querySelector<HTMLElement>('[role="menuitem"]')!.click());
  expect(picked).toHaveBeenCalledOnce();
  expect(document.querySelector("[data-flyout]")).toBeNull();
});
it("preserves keyboard entry, navigation and activation across the portal", () => {
  open();
  const key = (value: string) => act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));
  key("ArrowRight");
  act(() => document.querySelector<HTMLElement>('[data-flyout] [role="menuitem"]')!.focus());
  key("ArrowDown");
  expect(document.activeElement?.textContent).toContain("Nested");
  key("ArrowUp"); key("Enter");
  expect(picked).toHaveBeenCalledOnce();
});
it("nested flyouts are siblings in the document, and outside wheel closes the whole tree", () => {
  open();
  const nested = [...document.querySelectorAll<HTMLElement>('[data-flyout] [role="menuitem"]')].find(el => el.textContent === "Nested")!;
  act(() => nested.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect([...document.querySelectorAll("[data-flyout]")].every(el => el.parentElement === document.body)).toBe(true);
  expect(document.querySelectorAll("[data-flyout]")).toHaveLength(2);
  act(() => document.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true })));
  expect(document.querySelector("[role=menu]")).toBeNull();
});
it("shows the existing timeout explanation for an armed action inside a portalled submenu", () => {
  vi.useFakeTimers();
  try {
    act(() => openMenuAt(700, 100, [{ label: "Parent", onSelect() {}, submenu: [{ label: "Delete", armed: "Confirm delete", onSelect: picked }] }]));
    act(() => document.querySelector('[role="menuitem"]')!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => document.querySelector<HTMLElement>('[data-flyout] [role="menuitem"]')!.click());
    expect(document.querySelector('[data-flyout] [data-armed]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(ARMED_TIMEOUT_MS));
    expect(document.querySelector('[data-flyout] [data-armed]')).toBeNull();
    expect(document.querySelector('[data-testid="armed-expired"]')).not.toBeNull();
    expect(picked).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(ARMED_EXPIRED_MS + 400));
  } finally { vi.useRealTimers(); }
});
