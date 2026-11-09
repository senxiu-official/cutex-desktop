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
it("an armed row keeps its danger face while focused: its first click leaves the focus on it", () => {
  vi.useFakeTimers();
  try {
    act(() => openMenuAt(700, 100, [{ label: "Delete", armed: "Confirm delete", onSelect: picked }, { label: "Other", onSelect() {} }]));
    const rows = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(rows()[0]!.className).toContain("focus:bg-surface-2");
    act(() => rows()[0]!.click());
    const armed = document.querySelector<HTMLElement>("[data-armed]")!;
    expect(armed.className).toContain("bg-danger-solid");
    // A focus:bg-* utility sorts after bg-danger-solid and wins: white text on the grey focus background.
    expect(armed.className).not.toMatch(/focus:bg-/);
    expect(rows()[1]!.className).toContain("focus:bg-surface-2");
    act(() => vi.advanceTimersByTime(ARMED_TIMEOUT_MS + ARMED_EXPIRED_MS + 400));
  } finally { vi.useRealTimers(); }
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
