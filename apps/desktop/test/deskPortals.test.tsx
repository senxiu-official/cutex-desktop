// @vitest-environment jsdom
// Multi-window P2: overlays opened in a desk window render, listen and close in that desk's document (lib/ownerWindow,
// lib/ownerContext, components/OwnerLayer). The desk here is an iframe's document: another window and realm drawn by
// this renderer through a portal, like components/DeskWindows. The main window keeps rendering them where it did.
import { act, createElement as h, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDialog, closeMenu, confirmDialog, contextMenu, openMenuAt, openMenuFrom } from "../src/renderer/src/lib/contextMenu";
import { Overlays } from "../src/renderer/src/components/Overlays";
import { Popover } from "../src/renderer/src/components/Menu";
import { ArmedHint } from "../src/renderer/src/components/ArmedHint";
import { useArmed } from "../src/renderer/src/lib/armedConfirm";
import { installDeskGuards } from "../src/renderer/src/lib/deskGuards";
import { isImeComposing } from "../src/renderer/src/lib/ime";
import { OwnerDocumentContext } from "../src/renderer/src/lib/ownerContext";
import { useDesks, type DeskRecord } from "../src/renderer/src/lib/deskStore";
import { I18nProvider } from "../src/renderer/src/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let frame: HTMLIFrameElement;
let desk: Document;
let deskWin: Window;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  frame = document.createElement("iframe");
  document.body.append(frame);
  deskWin = frame.contentWindow!;
  desk = frame.contentDocument!;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    closeMenu();
    closeDialog();
  });
  act(() => root.unmount());
  useDesks.setState({ desks: [], focused: null });
  host.remove();
  frame.remove();
  vi.restoreAllMocks();
});

/** Draw `children` in the desk the way components/DeskWindows does: a portal with the desk's owner document. */
function InDesk({ children }: { children: ReactNode }) {
  return h(OwnerDocumentContext.Provider, { value: desk }, createPortal(children, desk.body));
}

const key = (target: EventTarget, k: string, view: Window) => act(() => void target.dispatchEvent(new (view as typeof window).KeyboardEvent("keydown", { key: k, bubbles: true })));

describe("context menu and dialogs (global hosts)", () => {
  beforeEach(() => act(() => root.render(h(I18nProvider, null, h(Overlays)))));

  it("opens a ⋯ menu in the trigger's desk document and closes it with Esc there", () => {
    const trigger = desk.createElement("button");
    desk.body.append(trigger);
    act(() => openMenuFrom(trigger, [{ label: "Do it", onSelect: () => {} }]));
    expect(desk.querySelector("[role=menu]")?.textContent).toContain("Do it");
    expect(document.querySelector("[role=menu]")).toBeNull();
    // Esc in the main window does not reach it; Esc in the desk does.
    key(document, "Escape", window);
    expect(desk.querySelector("[role=menu]")).not.toBeNull();
    key(desk, "Escape", deskWin);
    expect(desk.querySelector("[role=menu]")).toBeNull();
  });

  it("opens a right-click menu where the click happened (a React handler inside the desk portal)", () => {
    act(() => root.render(h(I18nProvider, null, h(Overlays), h(InDesk, { children: h("div", { id: "target", onContextMenu: contextMenu(() => [{ label: "Rename", onSelect: () => {} }]) }, "row") }))));
    const target = desk.getElementById("target")!;
    act(() => void target.dispatchEvent(new (deskWin as typeof window).MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 30 })));
    const menu = desk.querySelector<HTMLElement>("[role=menu]");
    expect(menu?.textContent).toContain("Rename");
    expect(document.querySelector("[role=menu]")).toBeNull();
    // An outside mousedown in the desk closes it (its listeners are on the desk document).
    act(() => void desk.body.dispatchEvent(new (deskWin as typeof window).MouseEvent("mousedown", { bubbles: true })));
    expect(desk.querySelector("[role=menu]")).toBeNull();
  });

  it("asks a confirm in the desk window that has the focus; Enter there answers it", async () => {
    vi.spyOn(desk, "hasFocus").mockReturnValue(true);
    const record = { deskId: "d000000000001", handle: { deskId: "d000000000001", win: deskWin, root: desk.body, dispose: () => {} }, content: { kind: "probe" } } as DeskRecord;
    useDesks.setState({ desks: [record], focused: record.deskId });
    let answer: boolean | null = null;
    act(() => void confirmDialog("Close it?").then((ok) => (answer = ok)));
    expect(desk.querySelector("[role=dialog]")?.textContent).toContain("Close it?");
    expect(document.querySelector("[role=dialog]")).toBeNull();
    key(desk, "Enter", deskWin);
    await act(async () => {});
    expect(answer).toBe(true);
    expect(desk.querySelector("[role=dialog]")).toBeNull();
  });

  it("keeps the main window's menu inline in the app tree, as before", () => {
    act(() => openMenuAt(10, 10, [{ label: "Here", onSelect: () => {} }]));
    const menu = document.querySelector("[role=menu]");
    expect(menu && host.contains(menu)).toBe(true);
    expect(desk.querySelector("[role=menu]")).toBeNull();
  });
});

describe("components drawn in a desk", () => {
  it("portals a fitViewport popover into the desk body; Esc in the desk closes it, Esc in the main window does not", () => {
    act(() => root.render(h(InDesk, { children: h(Popover, { fitViewport: true, trigger: "Rules", children: () => h("span", null, "panel") }) })));
    act(() => desk.querySelector("button")!.click());
    const panel = desk.querySelector<HTMLElement>("[data-popover]");
    expect(panel?.parentElement).toBe(desk.body);
    expect(document.querySelector("[data-popover]")).toBeNull();
    key(document, "Escape", window);
    expect(desk.querySelector("[data-popover]")).not.toBeNull();
    key(desk, "Escape", deskWin);
    expect(desk.querySelector("[data-popover]")).toBeNull();
  });

  it("puts an armed button's hint bubble (tooltip-like) into the desk body", () => {
    function Armed() {
      const anchor = useRef<HTMLButtonElement>(null);
      return h("div", null, h("button", { ref: anchor }, "清空"), h(ArmedHint, { anchor, text: "再点一次确认" }));
    }
    act(() => root.render(h(InDesk, { children: h(Armed) })));
    const bubble = [...desk.querySelectorAll("[role=status]")].find((el) => el.textContent === "再点一次确认");
    expect(bubble?.parentElement).toBe(desk.body);
    expect([...document.querySelectorAll("[role=status]")].some((el) => el.textContent === "再点一次确认")).toBe(false);
  });
});

describe("keys in a desk", () => {
  it("an armed button drawn in a desk disarms on Esc in the desk window, not in the main window", () => {
    function Clear() {
      const [armed, setArmed] = useArmed();
      return h("button", { "data-armed-state": armed ? "armed" : "idle", onClick: () => setArmed(true) }, "清空");
    }
    act(() => root.render(h(InDesk, { children: h(Clear) })));
    const button = desk.querySelector<HTMLButtonElement>("[data-armed-state]")!;
    act(() => button.click());
    expect(button.dataset.armedState).toBe("armed");
    key(window, "Escape", window);
    expect(button.dataset.armedState).toBe("armed");
    key(deskWin, "Escape", deskWin);
    expect(button.dataset.armedState).toBe("idle");
  });
});

describe("desk document guards (lib/deskGuards)", () => {
  it("installs this document's guards in a desk window and removes them; nothing for the main window", () => {
    class FakeObserver { observe() {} unobserve() {} disconnect() {} }
    (deskWin as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeObserver;
    const before = document.querySelectorAll("[data-overlay-scrollbars]").length;
    expect(installDeskGuards(window)()).toBeUndefined();
    expect(document.querySelectorAll("[data-overlay-scrollbars]").length).toBe(before);
    const off = installDeskGuards(deskWin);
    expect(desk.querySelector("[data-overlay-scrollbars]")).not.toBeNull();
    // The IME guard follows composition in the desk document.
    const input = desk.createElement("input");
    desk.body.append(input);
    input.dispatchEvent(new (deskWin as typeof window).CompositionEvent("compositionstart", { bubbles: true }));
    expect(isImeComposing({ target: input } as unknown as KeyboardEvent)).toBe(true);
    off();
    expect(desk.querySelector("[data-overlay-scrollbars]")).toBeNull();
  });
});
