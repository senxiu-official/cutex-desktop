// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BROWSER_CURSOR_COLOR, type BrowserCursorView } from "../src/shared/browserCursor";
const fx = vi.hoisted(() => ({ color: "#7966db", save: vi.fn(), rpc: undefined as undefined | ((value?: string | null) => Promise<{ color: string }>) }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { browser: { cursorColor: (color?: string | null) => { fx.save(color); if (fx.rpc) return fx.rpc(color); if (color !== undefined) fx.color = color ?? "#7966db"; return Promise.resolve({ color: fx.color }); } } } }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  SettingRow: ({ label, children, reset }: any) => h("div", {}, label, children, reset),
  ResetButton: ({ onClick, disabled }: any) => h("button", { onClick, disabled, "data-reset": true }, "Reset"),
}));
import { BrowserAgentCursor } from "../src/renderer/src/modules/browser/BrowserAgentCursor";
import { BrowserCursorSettings } from "../src/renderer/src/modules/browser/BrowserCursorSettings";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>, mount: HTMLDivElement, target: HTMLDivElement, hidden = false, width = 640;
const observers = new Set<() => void>();
beforeEach(() => {
  hidden = false; width = 640; fx.color = DEFAULT_BROWSER_CURSOR_COLOR; fx.save.mockClear(); fx.rpc = undefined;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.stubGlobal("ResizeObserver", class { callback: () => void; constructor(cb: () => void) { this.callback = cb; observers.add(cb); } observe() {} disconnect() { observers.delete(this.callback); } });
  mount = document.createElement("div"); target = document.createElement("div"); target.innerHTML = '<input value="page-owned">'; document.body.append(target, mount);
  target.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: 360, width, height: 360, toJSON() {} });
  root = createRoot(mount);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; delete (document as any).hidden; vi.unstubAllGlobals(); vi.useRealTimers(); observers.clear(); });
const cue = (patch: Partial<BrowserCursorView> = {}): BrowserCursorView => ({ sequence: 1, kind: "click", phase: "move", x: 35, y: 20, viewport: { width: 640, height: 360 }, color: DEFAULT_BROWSER_CURSOR_COLOR, ...patch });
function render(value: BrowserCursorView | undefined, props: { granted?: boolean; visible?: boolean } = {}) {
  act(() => root.render(h(BrowserAgentCursor, { cue: value, granted: props.granted ?? true, visible: props.visible ?? true, viewport: { current: target } })));
}
describe("renderer-only agent cursor", () => {
  it("uses C's filled folded triangle with its vertex at the action point, without touching the page", () => {
    const before = target.innerHTML; render(cue());
    const tip = mount.querySelector<HTMLElement>("[data-agent-cursor-tip]")!;
    expect(tip.style.transform).toBe("translate(35px, 20px)");
    expect(tip.querySelector("path")!.getAttribute("d")).toBe("M0 0L20 7L7.8 7.8L7 20Z");
    expect(tip.querySelector("path")!.getAttribute("transform")).toBe("rotate(5)");
    expect(target.innerHTML).toBe(before); expect(mount.querySelector("[data-agent-click-pulse]")).toBeNull();
  });
  it("pulses only at dispatch and removes feedback after its short duration", () => {
    vi.useFakeTimers(); render(cue({ phase: "dispatch" })); expect(mount.querySelector("[data-agent-click-pulse]")).not.toBeNull();
    act(() => vi.advanceTimersByTime(421)); expect(mount.querySelector("[data-agent-click-pulse]")).toBeNull(); expect(mount.querySelector("[data-agent-cursor-tip]")).not.toBeNull();
  });
  it("frames the typed target and shows a content-free scroll hint", () => {
    render(cue({ kind: "type", phase: "dispatch", rect: { x: 10, y: 10, width: 50, height: 20 } }));
    const ring = mount.querySelector<HTMLElement>("[data-agent-focus-ring]")!; expect(ring.style.left).toBe("10px"); expect(ring.style.width).toBe("50px");
    render(cue({ sequence: 2, kind: "scroll", phase: "dispatch" })); expect(mount.querySelector("[data-agent-focus-ring]")).toBeNull(); expect(mount.querySelector("[data-agent-scroll-hint]")).not.toBeNull();
  });
  it.each(["pause", "hidden", "end"])("hides for %s and requires fresh feedback when shown again", reason => {
    render(cue());
    if (reason === "pause") render(cue(), { granted: false });
    if (reason === "hidden") render(cue(), { visible: false });
    if (reason === "end") render(undefined);
    expect(mount.querySelector("[data-browser-agent-cursor]")).toBeNull();
    if (reason !== "end") { render(cue()); expect(mount.querySelector("[data-browser-agent-cursor]")).toBeNull(); }
    render(cue({ sequence: 2 })); expect(mount.querySelector("[data-browser-agent-cursor]")).not.toBeNull();
  });
  it("clears on native document hide and on resize before another geometry event", () => {
    render(cue()); hidden = true; act(() => document.dispatchEvent(new Event("visibilitychange"))); expect(mount.querySelector("[data-browser-agent-cursor]")).toBeNull();
    hidden = false; act(() => document.dispatchEvent(new Event("visibilitychange"))); render(cue({ sequence: 2 })); expect(mount.querySelector("[data-browser-agent-cursor]")).not.toBeNull();
    width = 800; act(() => { for (const cb of observers) cb(); }); expect(mount.querySelector("[data-browser-agent-cursor]")).toBeNull();
    render(cue({ sequence: 3, viewport: { width: 800, height: 360 } })); expect(mount.querySelector("[data-browser-agent-cursor]")).not.toBeNull();
  });
  it("applies chosen colours and contrasting black/white outlines", () => {
    render(cue({ color: "#ffffff" })); const overlay = mount.querySelector<HTMLElement>("[data-browser-agent-cursor]")!;
    expect(overlay.style.getPropertyValue("--agent-cursor-color")).toBe("#ffffff"); expect(overlay.style.getPropertyValue("--agent-cursor-outline")).toBe("#151821");
    render(cue({ sequence: 2, color: "#000000" })); expect(overlay.style.getPropertyValue("--agent-cursor-outline")).toBe("#ffffff");
  });
});
describe("browser cursor settings", () => {
  it("reads the main preference, saves custom colours and resets through main", async () => {
    fx.color = "#123456"; await act(async () => root.render(h(BrowserCursorSettings)));
    const input = mount.querySelector<HTMLInputElement>('input[type="color"]')!; expect(input.value).toBe("#123456");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "#abcdef"); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(fx.save).toHaveBeenCalledWith("#abcdef"); expect(fx.color).toBe("#abcdef");
    await act(async () => mount.querySelector<HTMLButtonElement>("[data-reset]")!.click());
    expect(fx.save).toHaveBeenCalledWith(null); expect(input.value).toBe(DEFAULT_BROWSER_CURSOR_COLOR);
  });
  it("keeps the final colour when another choice arrives during an in-flight save", async () => {
    let resolve!: (value: { color: string }) => void;
    const first = new Promise<{ color: string }>(yes => { resolve = yes; });
    fx.rpc = value => value === "#111111" ? first : Promise.resolve({ color: value ?? DEFAULT_BROWSER_CURSOR_COLOR });
    await act(async () => root.render(h(BrowserCursorSettings)));
    const input = mount.querySelector<HTMLInputElement>('input[type="color"]')!;
    const change = (value: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); };
    act(() => change("#111111")); act(() => change("#222222"));
    expect(fx.save.mock.calls.map(call => call[0])).toEqual([undefined, "#111111"]);
    await act(async () => resolve({ color: "#111111" }));
    expect(fx.save.mock.calls.map(call => call[0])).toEqual([undefined, "#111111", "#222222"]); expect(input.value).toBe("#222222");
  });
  it("does not let a late initial read overwrite a saved owner colour", async () => {
    let resolve!: (value: { color: string }) => void;
    const initial = new Promise<{ color: string }>(yes => { resolve = yes; });
    fx.rpc = value => value === undefined ? initial : Promise.resolve({ color: value! });
    await act(async () => root.render(h(BrowserCursorSettings)));
    const input = mount.querySelector<HTMLInputElement>('input[type="color"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "#333333"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => resolve({ color: "#111111" })); expect(input.value).toBe("#333333");
  });

});
