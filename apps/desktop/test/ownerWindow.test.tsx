// @vitest-environment jsdom
// Multi-window P2 helpers (lib/ownerWindow, components/OwnerLayer): resolve the window / document an element
// lives in. The "desk" here is an iframe's document: another document with its own window and realm, like a
// desk window drawn by this renderer.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeElementOf, intersectionObserverFor, isDom, isElement, isHTMLElement, isNode, ownerDocumentOf, ownerWindowOf, resizeObserverFor, selectionOf } from "../src/renderer/src/lib/ownerWindow";
import { OwnerDocumentContext, useOwnerDocument, useOverlayRoot, useOwnerWindow } from "../src/renderer/src/lib/ownerContext";
import { OwnerLayer } from "../src/renderer/src/components/OwnerLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let frame: HTMLIFrameElement;
let desk: Document;
let deskWin: Window;

beforeEach(() => {
  frame = document.createElement("iframe");
  document.body.append(frame);
  deskWin = frame.contentWindow!;
  desk = frame.contentDocument!;
});

afterEach(() => {
  frame.remove();
  document.body.innerHTML = "";
});

describe("owner lookups", () => {
  it("resolves the element's own document / window, the main ones otherwise", () => {
    const here = document.createElement("div");
    const there = desk.createElement("div");
    desk.body.append(there);
    expect(ownerDocumentOf(here)).toBe(document);
    expect(ownerWindowOf(here)).toBe(window);
    expect(ownerDocumentOf(there)).toBe(desk);
    expect(ownerWindowOf(there)).toBe(deskWin);
    expect(ownerDocumentOf(desk)).toBe(desk);
    expect(ownerWindowOf(desk)).toBe(deskWin);
    expect(ownerDocumentOf(deskWin)).toBe(desk);
    expect(ownerWindowOf(deskWin)).toBe(deskWin);
    for (const none of [null, undefined]) {
      expect(ownerDocumentOf(none)).toBe(document);
      expect(ownerWindowOf(none)).toBe(window);
    }
    // A document without a browsing context (document.implementation): its nodes fall back to the main window.
    const loose = document.implementation.createHTMLDocument("");
    expect(ownerDocumentOf(loose.body)).toBe(loose);
    expect(ownerWindowOf(loose.body)).toBe(window);
  });

  it("reads focus and selection in the element's document", () => {
    const input = desk.createElement("input");
    desk.body.append(input);
    input.focus();
    expect(activeElementOf(input)).toBe(input);
    expect(activeElementOf(desk)).toBe(input);
    expect(activeElementOf()).toBe(document.activeElement);
    expect(selectionOf(input)).toBe(deskWin.getSelection());
    expect(selectionOf()).toBe(window.getSelection());
  });

  it("checks DOM types across realms", () => {
    const input = desk.createElement("input");
    expect(input instanceof HTMLInputElement).toBe(false);
    expect(isDom(input, "HTMLInputElement")).toBe(true);
    expect(isDom(input, "HTMLElement")).toBe(true);
    expect(isDom(input, "HTMLTextAreaElement")).toBe(false);
    expect(isDom(document.createElement("input"), "HTMLInputElement")).toBe(true);
    expect(isDom(desk.createTextNode("x"), "Text")).toBe(true);
    expect(isDom({ nodeType: 1, nodeName: "INPUT" }, "HTMLInputElement")).toBe(false);
    expect(isDom(null, "Node")).toBe(false);
    const svg = desk.createElementNS("http://www.w3.org/2000/svg", "svg");
    expect(isElement(svg) && !isHTMLElement(svg)).toBe(true);
    expect(isHTMLElement(input) && isElement(input) && isNode(input)).toBe(true);
    expect(isElement(desk.createTextNode("x"))).toBe(false);
    expect(isNode("div")).toBe(false);
  });

  it("makes observers from the element's window", () => {
    class Here { constructor(public cb: unknown) {} observe() {} disconnect() {} }
    class There extends Here {}
    const w = window as unknown as Record<string, unknown>;
    const d = deskWin as unknown as Record<string, unknown>;
    const saved = [w.ResizeObserver, d.ResizeObserver, w.IntersectionObserver, d.IntersectionObserver];
    w.ResizeObserver = Here; d.ResizeObserver = There;
    w.IntersectionObserver = Here; d.IntersectionObserver = There;
    try {
      expect(resizeObserverFor(desk.body, () => {})).toBeInstanceOf(There);
      expect(resizeObserverFor(document.body, () => {})).not.toBeInstanceOf(There);
      expect(resizeObserverFor(document.body, () => {})).toBeInstanceOf(Here);
      expect(intersectionObserverFor(desk.body, () => {})).toBeInstanceOf(There);
      // A window without one (an old engine / a test) falls back to this realm's; none at all: null.
      d.ResizeObserver = undefined;
      expect(resizeObserverFor(desk.body, () => {})).toBeInstanceOf(Here);
      w.ResizeObserver = undefined;
      expect(resizeObserverFor(desk.body, () => {})).toBeNull();
    } finally {
      [w.ResizeObserver, d.ResizeObserver, w.IntersectionObserver, d.IntersectionObserver] = saved;
    }
  });
});

describe("owner context and OwnerLayer", () => {
  let root: Root;
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => act(() => root.unmount()));

  function Probe({ name }: { name: string }) {
    const doc = useOwnerDocument();
    const win = useOwnerWindow();
    const body = useOverlayRoot();
    return h("span", { "data-probe": name, "data-desk": String(doc !== document), "data-win": String(win !== window), "data-body": String(body === doc.body) });
  }

  it("is the main window without a provider and the desk inside one", () => {
    act(() => root.render(h("div", null, h(Probe, { name: "main" }), h(OwnerDocumentContext.Provider, { value: desk }, h(Probe, { name: "desk" })))));
    const main = host.querySelector("[data-probe=main]")!;
    const inDesk = host.querySelector("[data-probe=desk]")!;
    expect([main.getAttribute("data-desk"), main.getAttribute("data-win"), main.getAttribute("data-body")]).toEqual(["false", "false", "true"]);
    expect([inDesk.getAttribute("data-desk"), inDesk.getAttribute("data-win"), inDesk.getAttribute("data-body")]).toEqual(["true", "true", "true"]);
  });

  it("renders inline for the main document and into the desk's body otherwise", () => {
    act(() => root.render(h(OwnerLayer, { doc: document, children: h(Probe, { name: "inline" }) })));
    expect(host.querySelector("[data-probe=inline]")?.getAttribute("data-desk")).toBe("false");
    act(() => root.render(h(OwnerLayer, { doc: null, children: h(Probe, { name: "inline" }) })));
    expect(host.querySelector("[data-probe=inline]")).not.toBeNull();
    act(() => root.render(h(OwnerLayer, { doc: desk, children: h(Probe, { name: "away" }) })));
    expect(host.querySelector("[data-probe=away]")).toBeNull();
    const away = desk.body.querySelector("[data-probe=away]");
    expect(away?.parentElement).toBe(desk.body);
    // Its subtree resolves the desk as its document (its own portals, listeners, rAF).
    expect(away?.getAttribute("data-desk")).toBe("true");
  });
});
