// @vitest-environment jsdom
// Desk windows (multi-window P1), renderer side: the desk document mirrors the main document's look
// (lib/deskDocument), React handles events inside a portal into another document, the desk store opens a
// desk with main's ticket and hands its conversation back when the window closes (lib/deskStore,
// lib/deskActions), and the conversation comes back to the main layout as a chip (lib/paneLayout).
import { act, createElement as h, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ layouts: [] as unknown[], beside: [] as unknown[] }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: {}, api: {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/paneStore", () => ({
  setPaneLayout: (fn: (l: unknown) => unknown) => void fx.layouts.push(fn),
  openAgentBeside: (hostId: string, sessionId: string) => void fx.beside.push({ hostId, sessionId }),
  closeConversationPane: () => {},
  livePaneBinding: () => null,
  usePanes: { getState: () => ({ layout: null }), windows: () => [] },
}));
vi.mock("../src/renderer/src/store", () => ({ sidebarOf: () => null, useApp: { getState: () => ({}) } }));

import { mirrorDocument } from "../src/renderer/src/lib/deskDocument";
import { deskGone, DESKS_STORAGE_KEY, onDeskWindowEvent, openDesk, parseStoredDesks, useDesks } from "../src/renderer/src/lib/deskStore";
import { giveBackToMain } from "../src/renderer/src/lib/deskActions";
import { addConversationChip, chipShowing, defaultLayout, type PaneLayout } from "../src/renderer/src/lib/paneLayout";
import type { DeskBridge } from "../src/shared/ipc";

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A fake desk window: its own document, as window.open would return it. */
function fakeWindow(): Window {
  const doc = document.implementation.createHTMLDocument("");
  return { document: doc, closed: false, requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) } as unknown as Window;
}

function fakeDesk(): { bridge: DeskBridge; opened: { url: string; name: string }[]; opener: Window; win: Window } {
  const win = fakeWindow();
  const opened: { url: string; name: string }[] = [];
  let n = 0;
  const bridge: DeskBridge = {
    ticket: vi.fn(async (deskId?: string) => ({ deskId: deskId ?? `d00000000000${n++}`, name: `cutex-desk-nonce${n}` })),
    focus: vi.fn(async () => true),
    close: vi.fn(async () => {}),
  };
  const opener = { document, open: (url: string, name: string) => (opened.push({ url, name }), win) } as unknown as Window;
  return { bridge, opened, opener, win };
}

beforeEach(() => {
  useDesks.setState({ desks: [], focused: null });
  localStorage.clear();
  fx.layouts.length = 0;
  fx.beside.length = 0;
  document.head.innerHTML = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});

describe("desk document mirror", () => {
  let stop: () => void = () => {};
  afterEach(() => stop());

  it("copies stylesheets in order and follows HMR-style changes, <html> attributes and removals", async () => {
    const a = document.createElement("style");
    a.textContent = ".a{color:red}";
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./assets/index.css";
    document.head.append(a, link);
    document.documentElement.dataset.theme = "light";
    const desk = fakeWindow().document;
    stop = mirrorDocument(document, desk);
    const sheets = () => [...desk.head.querySelectorAll("style, link")].map((el) => (el.localName === "style" ? `style:${el.textContent}` : `link:${el.getAttribute("href")}`));
    expect(sheets()).toEqual([".a{color:red}", `${new URL("./assets/index.css", document.baseURI).href}`].map((v, i) => (i === 0 ? `style:${v}` : `link:${v}`)));
    expect(desk.documentElement.dataset.theme).toBe("light");

    // Vite HMR rewrites a <style> in place; a new module adds one; the theme switches.
    a.textContent = ".a{color:blue}";
    const b = document.createElement("style");
    b.textContent = ".b{}";
    document.head.append(b);
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.setProperty("--win", "#101010");
    await flush();
    expect(sheets()[0]).toBe("style:.a{color:blue}");
    expect(sheets()[2]).toBe("style:.b{}");
    expect(desk.documentElement.dataset.theme).toBe("dark");
    expect(desk.documentElement.style.getPropertyValue("--win")).toBe("#101010");

    a.remove();
    delete document.documentElement.dataset.theme;
    await flush();
    expect(sheets()).toHaveLength(2);
    expect(desk.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("stops following once stopped", async () => {
    const desk = fakeWindow().document;
    stop = mirrorDocument(document, desk);
    stop();
    const s = document.createElement("style");
    document.head.append(s);
    await flush();
    expect(desk.head.querySelectorAll("style, link")).toHaveLength(0);
  });
});

describe("React in a desk document", () => {
  it("a portal into another document gets its clicks and typing", () => {
    const desk = fakeWindow().document;
    const target = desk.createElement("div");
    desk.body.append(target);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const clicks = vi.fn();
    function Probe() {
      const [text, setText] = useState("");
      return createPortal(h("div", null, h("button", { onClick: clicks }, "go"), h("input", { value: text, onChange: (e: { target: { value: string } }) => setText(e.target.value) }), h("output", null, text)), target);
    }
    act(() => root.render(h(Probe)));
    act(() => void target.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(clicks).toHaveBeenCalledTimes(1);
    const input = target.querySelector("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "hello desk");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(target.querySelector("output")!.textContent).toBe("hello desk");
    act(() => root.unmount());
    host.remove();
  });
});

describe("desk store", () => {
  const conv = { kind: "conversation" as const, hostId: "local", sessionId: "s1" };

  it("opens with main's ticket name, draws into the new document and remembers the desk", async () => {
    const f = fakeDesk();
    const record = await openDesk(f.bridge, conv, undefined, f.opener);
    expect(f.opened).toEqual([{ url: "about:blank", name: "cutex-desk-nonce1" }]);
    expect(record?.handle.root.ownerDocument).toBe(f.win.document);
    expect(record?.handle.root.id).toBe("root");
    expect(useDesks.getState().desks).toHaveLength(1);
    expect(parseStoredDesks(localStorage.getItem(DESKS_STORAGE_KEY))).toEqual([{ deskId: record!.deskId, hostId: "local", sessionId: "s1" }]);
  });

  it("no ticket (too many desks) or no bridge: nothing opens", async () => {
    const f = fakeDesk();
    f.bridge.ticket = vi.fn(async () => null);
    expect(await openDesk(f.bridge, conv, undefined, f.opener)).toBeNull();
    expect(await openDesk(undefined, conv, undefined, f.opener)).toBeNull();
    expect(f.opened).toHaveLength(0);
  });

  it("main's `closed`: forgotten and handed back; a quit keeps it remembered and hands nothing back", async () => {
    const f = fakeDesk();
    const a = (await openDesk(f.bridge, conv, undefined, f.opener))!;
    const giveBack = vi.fn();
    onDeskWindowEvent({ deskId: a.deskId, kind: "focus" }, giveBack);
    expect(useDesks.getState().focused).toBe(a.deskId);
    onDeskWindowEvent({ deskId: a.deskId, kind: "closed" }, giveBack);
    expect(giveBack).toHaveBeenCalledWith(conv, a.deskId);
    expect(useDesks.getState()).toMatchObject({ desks: [], focused: null });
    expect(parseStoredDesks(localStorage.getItem(DESKS_STORAGE_KEY))).toEqual([]);

    const b = (await openDesk(f.bridge, conv, undefined, f.opener))!;
    const later = vi.fn();
    deskGone(b.deskId, later, true);
    expect(later).not.toHaveBeenCalled();
    expect(parseStoredDesks(localStorage.getItem(DESKS_STORAGE_KEY))).toEqual([{ deskId: b.deskId, hostId: "local", sessionId: "s1" }]);
  });

  it("stored desks are read defensively", () => {
    expect(parseStoredDesks("nope")).toEqual([]);
    expect(parseStoredDesks(JSON.stringify([{ deskId: "../x", hostId: "a", sessionId: "b" }, { deskId: "d0123456789ab", hostId: "a", sessionId: "b" }]))).toEqual([{ deskId: "d0123456789ab", hostId: "a", sessionId: "b" }]);
  });
});

describe("hand-back to the main window", () => {
  const layout = (): PaneLayout => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "other" });

  it("a closed desk's conversation becomes a chip in the tray (once)", () => {
    giveBackToMain({ kind: "conversation", hostId: "local", sessionId: "s1" }, "d0123456789ab");
    expect(fx.layouts).toHaveLength(1);
    const next = (fx.layouts[0] as (l: PaneLayout) => PaneLayout)(layout());
    expect(chipShowing(next, "local", "s1")).not.toBeNull();
    expect(addConversationChip(next, { hostId: "local", sessionId: "s1" }, 2)).toBe(next);
    // Already on screen: nothing changes.
    expect(addConversationChip(layout(), { hostId: "local", sessionId: "other" }, 2).chips).toEqual([]);
  });

  it("放回主窗口 opens it beside instead", async () => {
    const { backToMain } = await import("../src/renderer/src/lib/deskActions");
    backToMain("d0123456789ab");
    giveBackToMain({ kind: "conversation", hostId: "local", sessionId: "s1" }, "d0123456789ab");
    expect(fx.beside).toEqual([{ hostId: "local", sessionId: "s1" }]);
    expect(fx.layouts).toHaveLength(0);
  });
});
