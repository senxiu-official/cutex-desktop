// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const prefs = vi.hoisted(() => ({ modelPins: {} }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => prefs, getUiPrefs: () => prefs, setUiPref: vi.fn() }));
vi.mock("../src/renderer/src/lib/modelDisplay", () => ({ useModelName: () => (id: string) => id, rawIdTitle: () => undefined }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useComposerHost: () => "local" }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { ModelPicker } from "../src/renderer/src/components/ModelPicker";
import { OwnerDocumentContext } from "../src/renderer/src/lib/ownerContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const selected = vi.fn(), opened = vi.fn();
const models = Array.from({ length: 25 }, (_, i) => ({ model: `gemini-model-${i}-preview-customtools`, displayName: "", description: "" }));
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); (el as HTMLElement).click(); });
const button = (text: string, doc: Document = document) => [...doc.querySelectorAll("button")].find(el => el.textContent === text)!;
const render = () => act(() => root.render(h(ModelPicker, { profile: "Gemini", models, current: models[0]!.model, label: "model trigger", onOpen: opened, onSelect: selected })));
const open = () => { click(button("model trigger")); click(button("composer.model.more21")); };
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const box = this.hasAttribute("data-popover") ? { left: 620, top: 500, width: 320, height: 180 } : this.textContent?.includes("composer.model.more") ? { left: 624, top: 630, width: 312, height: 30 } : { left: 900, top: 700, width: 40, height: 20 };
    return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-flyout") ? 324 : 320; });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-flyout") ? 792 : 180; });
  host = document.createElement("div"); host.style.overflow = "hidden"; document.body.appendChild(host); root = createRoot(host); render();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it("portals the model menu and 21 extra models beyond the pane's overflow, inside the viewport", () => {
  open();
  const flyout = document.querySelector<HTMLElement>("[data-flyout]")!;
  expect(flyout.parentElement).toBe(document.body);
  expect(host.contains(flyout)).toBe(false);
  expect(Number.parseFloat(flyout.style.left)).toBeGreaterThanOrEqual(4);
  expect(Number.parseFloat(flyout.style.left) + 324).toBeLessThanOrEqual(996);
  expect(flyout.style.top).toBe("4px");
  expect(flyout.querySelector('[role="menu"]')!.className).toContain("overflow-y-auto");
  expect(flyout.textContent).toContain(models[24]!.model);
  expect(flyout.querySelector("button span span")!.className).not.toContain("truncate");
  expect(opened).toHaveBeenCalledOnce();
});
it("entering the portalled submenu keeps it open, and its item click selects and closes", () => {
  open();
  const flyout = document.querySelector<HTMLElement>("[data-flyout]")!;
  const row = button("composer.model.more21").parentElement!;
  act(() => row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: flyout })));
  expect(document.querySelector("[data-flyout]")).toBe(flyout);
  click([...flyout.querySelectorAll("button")].find(el => el.textContent === models[7]!.model)!);
  expect(selected).toHaveBeenCalledWith(models[7]!.model);
  expect(document.querySelector("[data-popover]")).toBeNull();
});
it("pinning a model and scrolling inside the flyout do not dismiss the parent", () => {
  open();
  const flyout = document.querySelector<HTMLElement>("[data-flyout]")!;
  click(flyout.querySelector('[title="composer.model.pin"]')!);
  act(() => flyout.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 })));
  expect(document.querySelector("[data-flyout]")).toBe(flyout);
  expect(selected).not.toHaveBeenCalled();
});
it.each(["outside", "Escape", "number"])("keeps %s dismissal or selection working", how => {
  open();
  act(() => {
    if (how === "outside") document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: how === "number" ? "2" : "Escape", bubbles: true }));
  });
  expect(document.querySelector("[data-popover]")).toBeNull();
  if (how === "number") expect(selected).toHaveBeenCalledWith(models[1]!.model);
});
it("uses the owning desk document for both levels", () => {
  const frame = document.createElement("iframe"); document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  act(() => root.render(h(OwnerDocumentContext.Provider, { value: doc }, h(ModelPicker, { profile: "Gemini", models, current: null, label: "desk trigger", onOpen: opened, onSelect: selected }))));
  click(button("desk trigger")); click(button("composer.model.more21", doc));
  expect(doc.querySelector("[data-flyout]")!.parentElement).toBe(doc.body);
  expect(document.querySelector("[data-flyout]")).toBeNull();
  act(() => root.unmount()); root = createRoot(host); frame.remove();
});
