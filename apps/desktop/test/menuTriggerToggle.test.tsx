// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IdentityButton, IdentityChip } from "../src/renderer/src/components/IdentityMenu";
import { Overlays } from "../src/renderer/src/components/Overlays";
import { Popover } from "../src/renderer/src/components/Menu";
import { I18nProvider } from "../src/renderer/src/i18n";
import { closeMenu, openMenuAbove, openMenuFrom, openMenuAt, useOverlayState } from "../src/renderer/src/lib/contextMenu";
vi.mock("../src/renderer/src/lib/identityView", () => ({ useIdentity: () => ({ name: "Test owner", role: "owner", picture: null, color: null, words: { line: "identity.owner" } }), useShellInfo: () => null }));
vi.mock("../src/renderer/src/lib/update", () => ({ useUpdateStatus: () => null, updateButtonVisible: () => false }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => closeMenu()); act(() => root.unmount()); host.remove(); });
const menu = () => document.querySelector('[role="menu"]');
function press(target: Element) {
 act(() => target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
 act(() => target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
 act(() => { target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); target.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}
function Fixture({ identity }: { identity: typeof IdentityButton }) {
 return h(I18nProvider, null, h(identity), h("button", { "data-outside": "" }, "Outside"), h(Overlays));
}
it.each([IdentityButton, IdentityChip])("%s opens once, toggles closed, closes outside and on Escape", component => {
 act(() => root.render(h(Fixture, { identity: component })));
 const trigger = host.querySelector<HTMLElement>('button[aria-haspopup="menu"]')!;
 press(trigger); expect(menu()).not.toBeNull(); expect(trigger.getAttribute("aria-expanded")).toBe("true");
 press(trigger.querySelector("svg") ?? trigger); expect(menu()).toBeNull(); expect(trigger.getAttribute("aria-expanded")).toBe("false");
 press(trigger); press(host.querySelector('[data-outside]')!); expect(menu()).toBeNull();
 press(trigger); act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); expect(menu()).toBeNull();
 // Keyboard activation has no preceding mouse event and must toggle too.
 act(() => trigger.click()); expect(menu()).not.toBeNull(); act(() => trigger.click()); expect(menu()).toBeNull();
});
it.each([openMenuAbove, openMenuFrom])("anchored menus keep their trigger inside until click toggles, and replace a different trigger", open => {
 const entries = [{ label: "Choice", onSelect() {} }];
 function Buttons() { const { menu: state } = useOverlayState(); return h("div", null,
  ...["a", "b"].map(id => h("button", { key: id, "data-trigger": id, "aria-expanded": state?.trigger?.dataset.trigger === id, onClick: (e: React.MouseEvent<HTMLButtonElement>) => open(e.currentTarget, entries, { owner: "same-owner" }) }, h("span", null, id))), h(Overlays)); }
 act(() => root.render(h(Buttons)));
 const a = host.querySelector<HTMLElement>('[data-trigger="a"]')!, b = host.querySelector<HTMLElement>('[data-trigger="b"]')!;
 press(a); const first = menu();
 act(() => a.firstElementChild!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))); expect(menu()).toBe(first);
 act(() => a.click()); expect(menu()).toBeNull();
 press(a); press(b); expect(menu()).not.toBeNull(); expect(b.getAttribute("aria-expanded")).toBe("true");
 press(b); expect(menu()).toBeNull();
});
it("ordinary Popover follows the same toggle/outside/Escape contract", () => {
 act(() => root.render(h(Popover, { trigger: "Simple", children: () => h("span", null, "Panel") })));
 const trigger = host.querySelector("button")!;
 press(trigger); expect(document.querySelector('[data-popover]')).not.toBeNull();
 press(trigger); expect(document.querySelector('[data-popover]')).toBeNull();
 press(trigger); press(document.body); expect(document.querySelector('[data-popover]')).toBeNull();
 press(trigger); act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); expect(document.querySelector('[data-popover]')).toBeNull();
});
it("point context menus retain explicit open behavior", () => {
 act(() => root.render(h(Overlays)));
 const entries = [{ label: "Context", onSelect() {} }];
 act(() => openMenuAt(10, 10, entries)); expect(menu()).not.toBeNull();
 act(() => openMenuAt(10, 10, entries)); expect(menu()).not.toBeNull();
});

it("explicit replacement stays open and a delayed eligibility reply never resurrects a toggled menu", async () => {
 act(() => root.render(h(Overlays)));
 const trigger = document.createElement("button"); host.append(trigger);
 const entries = [{ label: "Copy", onSelect() {} }];
 act(() => openMenuFrom(trigger, entries, { toggle: false })); expect(menu()).not.toBeNull();
 act(() => openMenuFrom(trigger, entries, { toggle: false })); expect(menu()).not.toBeNull();
 act(() => closeMenu());
 let finish!: (allowed: boolean) => void;
 const pending = new Promise<boolean>(resolve => { finish = resolve; });
 const delayed = [...entries, { label: "Late", onSelect() {}, available: () => pending }];
 act(() => openMenuFrom(trigger, delayed)); expect(menu()).not.toBeNull();
 act(() => openMenuFrom(trigger, delayed)); expect(menu()).toBeNull();
 await act(async () => finish(true)); expect(menu()).toBeNull();
});
