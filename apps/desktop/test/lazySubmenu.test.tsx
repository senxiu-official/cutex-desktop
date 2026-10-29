// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeDialog, closeMenu, openMenuAt, type MenuEntry } from "../src/renderer/src/lib/contextMenu";
import { Overlays } from "../src/renderer/src/components/Overlays";
import { I18nProvider, translate } from "../src/renderer/src/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(h(I18nProvider, null, h(Overlays))));
});
afterEach(() => { act(() => { closeMenu(); closeDialog(); root.unmount(); }); host.remove(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const key = (key: string) => act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
const parent = () => document.querySelector<HTMLButtonElement>('[role=menuitem]')!;
const hover = (row = parent()) => act(() => row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
const open = (submenu: MenuEntry[] | (() => Promise<MenuEntry[]>)) => act(() => openMenuAt(20, 20, [{ label: "Source file", submenu, onSelect() {} }]));
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('[data-flyout] [role=menuitem]')];

it("loads only on hover, with the normal chevron, portal and loading note", async () => {
  const pending = deferred<MenuEntry[]>(), loader = vi.fn(() => pending.promise), picked = vi.fn();
  open(loader);
  expect(loader).not.toHaveBeenCalled(); expect(parent().getAttribute("aria-haspopup")).toBe("menu");
  expect(parent().querySelector("svg")).not.toBeNull();
  hover();
  expect(loader).toHaveBeenCalledOnce();
  expect(document.querySelector("[data-flyout]")?.parentElement).toBe(document.body);
  expect(document.body.textContent).toContain(translate("sidebar.hostLoading"));
  await act(async () => pending.resolve([{ label: "Open source", onSelect: picked }]));
  expect(parent().textContent).toContain("Source file");
  act(() => rows()[0]!.click()); expect(picked).toHaveBeenCalledOnce();
  expect(document.querySelector('[role=menu]')).toBeNull();
});

it.each(["ArrowRight", "Enter"])("%s opens from root, Left closes and preserves parent focus for reopening", async (entryKey) => {
  const loader = vi.fn(async () => [{ label: "Open source", onSelect() {} }]);
  open(loader); key("ArrowDown");
  await act(async () => key(entryKey));
  expect(loader).toHaveBeenCalledOnce(); expect(rows()).toHaveLength(1);
  act(() => rows()[0]!.focus()); key("ArrowLeft");
  expect(document.querySelector("[data-flyout]")).toBeNull();
  expect(document.activeElement).toBe(parent()); expect(parent().getAttribute("aria-expanded")).toBe("false");
  await act(async () => key("ArrowRight"));
  expect(loader).toHaveBeenCalledTimes(2); expect(rows()).toHaveLength(1);
});

it("uses shared armed selection and confirm dialogs for resolved actions", async () => {
  const picked = vi.fn();
  open(async () => [{ label: "Delete source", armed: "Really delete", confirm: "Confirm source removal", onSelect: picked }]);
  await act(async () => hover());
  act(() => rows()[0]!.click());
  expect(rows()[0]!.hasAttribute("data-armed")).toBe(true); expect(picked).not.toHaveBeenCalled();
  act(() => rows()[0]!.click());
  expect(document.querySelector('[role=menu]')).toBeNull();
  expect(document.querySelector('[role=dialog]')?.textContent).toContain("Confirm source removal");
  await act(async () => document.querySelector<HTMLButtonElement>('[role=dialog] button:last-child')!.click());
  expect(picked).toHaveBeenCalledOnce();
});

it("filters unavailable and rejected eligibility checks, normalizing separators", async () => {
  const allowed = deferred<boolean>();
  open(async () => ["separator", { label: "Allowed", available: () => allowed.promise, onSelect() {} }, "separator", { label: "Denied", available: async () => false, onSelect() {} }, { label: "Broken", available: async () => { throw Error("probe"); }, onSelect() {} }, "separator"]);
  await act(async () => hover()); expect(rows()).toHaveLength(0);
  await act(async () => allowed.resolve(true));
  expect(rows().map(row => row.textContent)).toEqual(["Allowed"]);
  expect(document.querySelector('[data-flyout] [role=menu]')?.children).toHaveLength(1);
});

it.each(["empty", "error"])("keeps the menu open with a disabled %s note", async (kind) => {
  open(async () => { if (kind === "error") throw Error("Source unavailable"); return []; });
  await act(async () => hover());
  expect(document.querySelector('[data-flyout]')?.textContent).toContain(kind === "error" ? "Source unavailable" : "—");
  expect(rows()).toHaveLength(0); expect(parent()).toBeTruthy();
});

it.each(["close", "leave", "replace"])("ignores a late loader completion after %s", async (reason) => {
  const pending = deferred<MenuEntry[]>(), available = vi.fn(async () => true);
  open(() => pending.promise); hover();
  act(() => {
    if (reason === "close") closeMenu();
    else if (reason === "leave") key("ArrowDown");
    else openMenuAt(21, 21, [{ label: "Replacement", onSelect() {} }]);
  });
  // Leaving a lone row via arrows wraps to it; explicitly unmount its flyout with Left.
  if (reason === "leave") { key("ArrowRight"); key("ArrowLeft"); }
  await act(async () => pending.resolve([{ label: "Late action", available, onSelect() {} }]));
  expect(available).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("Late action");
  expect(document.querySelector('[data-flyout]')).toBeNull();
});
