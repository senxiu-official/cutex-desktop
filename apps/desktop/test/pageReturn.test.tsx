// @vitest-environment jsdom
// Back from a settings sub-page lands where the owner left (owner 2026-11-28): lib/pageReturn + PageBody's `nested`.
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PageBody } from "../src/renderer/src/components/Page";
import { ReturnStack, controlSpot, findControl } from "../src/renderer/src/lib/pageReturn";

describe("ReturnStack", () => {
  const left = (key: string, top = 0) => ({ key, top, spot: null });
  it("remembers the parent when a sub-page opens and gives it back on return", () => {
    const s = new ReturnStack();
    expect(s.go(left("appearance", 900), "appearance|avatar", true)).toBeNull();
    expect(s.go(left("appearance|avatar"), "appearance", false)).toEqual(left("appearance", 900));
    // Used once: a later visit to the same page starts at the top.
    expect(s.go(left("appearance"), "notify", false)).toBeNull();
    expect(s.go(left("notify"), "appearance", false)).toBeNull();
  });

  it("nests (a Profile, then its sub-page) and unwinds one level per return", () => {
    const s = new ReturnStack();
    s.go(left("profiles", 300), "profiles|p1", true);
    s.go(left("profiles|p1", 700), "profiles|p1|models", true);
    expect(s.go(left("profiles|p1|models"), "profiles|p1", true)?.top).toBe(700);
    expect(s.go(left("profiles|p1"), "profiles", false)?.top).toBe(300);
  });

  it("leaving for an unrelated page forgets the way back", () => {
    const s = new ReturnStack();
    s.go(left("appearance", 900), "appearance|avatar", true);
    expect(s.go(left("appearance|avatar"), "notify", false)).toBeNull();
    expect(s.go(left("notify"), "appearance", false)).toBeNull();
  });
});

describe("controlSpot", () => {
  it("finds the same control again in a fresh render of its card", () => {
    const root = document.createElement("div");
    root.innerHTML = `<section id="settings-a"><button>x</button><span><button id="b">y</button></span></section>`;
    document.body.append(root);
    const spot = controlSpot(root.querySelector("#b span, #b"), root)!;
    expect(spot).toEqual({ section: "settings-a", text: "y", index: 1 });
    root.innerHTML = `<section id="settings-a"><button>x</button><span><button id="c">y</button></span></section>`;
    expect(findControl(root, spot)?.id).toBe("c");
    expect(controlSpot(document.body, root)).toBeNull();
    root.remove();
  });
});

describe("PageBody", () => {
  let host: HTMLDivElement;
  let root: Root;
  const tops = new WeakMap<Element, number>();
  beforeEach(() => {
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    // jsdom has no layout: a scroller 500 px high over 5000 px of content.
    Object.defineProperty(HTMLElement.prototype, "scrollTop", { configurable: true, get(this: Element) { return tops.get(this) ?? 0; }, set(this: Element, v: number) { tops.set(this, Math.max(0, Math.min(v, 4500))); } });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 5000 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    for (const k of ["scrollTop", "scrollHeight", "clientHeight"]) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
  });
  const frames = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(() => r(null))); });
  const parent = () => h("div", null, h("section", { id: "settings-colors" }, h("button", null, "accent")), h("section", { id: "settings-avatar" }, h("button", { "data-entry": "" }, "open 头像"), h("button", null, "toggle")));
  const child = () => h("section", { id: "settings-portraits" }, h("button", null, "style"));
  const show = (key: string, nested: boolean, body: ReactNode) => act(() => root.render(h(PageBody, { scrollKey: key, nested, children: body })));
  const scroller = () => host.querySelector<HTMLElement>(".overflow-y-auto")!;

  it("back from a sub-page restores the parent's offset and focuses the row that opened it", async () => {
    await show("appearance", false, parent());
    scroller().scrollTop = 1800;
    scroller().dispatchEvent(new Event("scroll"));
    const entry = host.querySelector<HTMLButtonElement>("[data-entry]")!;
    entry.focus();
    act(() => entry.click());
    await show("appearance|avatar", true, child());
    expect(scroller().scrollTop).toBe(0);
    await show("appearance", false, parent());
    await frames();
    expect(scroller().scrollTop).toBe(1800);
    expect(document.activeElement).toBe(host.querySelector("[data-entry]"));
  });

  it("another page (not a return) opens at the top", async () => {
    await show("appearance", false, parent());
    scroller().scrollTop = 1800;
    scroller().dispatchEvent(new Event("scroll"));
    await show("notify", false, child());
    await frames();
    expect(scroller().scrollTop).toBe(0);
    await show("appearance", false, parent());
    await frames();
    expect(scroller().scrollTop).toBe(0);
  });
});
