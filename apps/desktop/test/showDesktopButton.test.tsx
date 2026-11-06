// @vitest-environment jsdom
// 「显示桌面」 (components/ShowDesktopButton; owner 2026-10-23: in the window bar's left group, last before ⋯): a click
// shows the desktop, the button is pressed while it shows and its tooltip says a second press puts the layout back
// (lib/paneActions showDesktop toggles); the narrow bar's ⋯ row does the same. Ctrl+Shift+D stays (lib/paneKeys).
import { readFileSync } from "node:fs";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ shown: false, snapshot: null as unknown, toggles: 0 }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, v?: Record<string, unknown>) => (v ? `${key}:${JSON.stringify(v)}` : key) }) }));
vi.mock("../src/renderer/src/lib/paneActions", () => ({
  showDesktop: () => {
    fx.toggles++;
    // What the real one does: show (remembering the layout), or put it back.
    fx.snapshot = fx.shown ? null : {};
    fx.shown = !fx.shown;
  },
  useDesktopShown: () => fx.shown,
  useDesktop: (sel: (s: { snapshot: unknown }) => unknown) => sel({ snapshot: fx.snapshot }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ShowDesktopButton, useShowDesktopRow } = await import("../src/renderer/src/components/ShowDesktopButton");

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
const btn = () => host.querySelector<HTMLButtonElement>("[data-show-desktop]")!;
const render = () => act(() => root!.render(h(ShowDesktopButton, { className: "ICON" })));

beforeEach(() => {
  Object.assign(fx, { shown: false, snapshot: null, toggles: 0 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

describe("显示桌面", () => {
  it("press: the desktop shows (pressed, 「再按放回」); press again: the layout comes back", () => {
    render();
    expect(btn().getAttribute("aria-pressed")).toBe("false");
    expect(btn().dataset.tip).toBe('pane.desktop:{"key":"Ctrl+Shift+D"}');
    act(() => btn().click());
    render();
    expect(fx.toggles).toBe(1);
    expect(btn().getAttribute("aria-pressed")).toBe("true");
    expect(btn().dataset.tip).toBe('pane.desktopBack:{"key":"Ctrl+Shift+D"}');
    act(() => btn().click());
    render();
    expect(fx.toggles).toBe(2);
    expect(btn().getAttribute("aria-pressed")).toBe("false");
  });

  it("a real button: in the Tab order, with its name for a screen reader", () => {
    render();
    expect(btn().tagName).toBe("BUTTON");
    expect(btn().tabIndex).toBe(0);
    expect(btn().getAttribute("aria-label")).toBe(btn().dataset.tip);
    expect(btn().dataset.titlebarEntry).toBe("show-desktop");
  });

  it("the narrow bar's ⋯ row: its name without the shortcut, the same toggle", () => {
    let row: ReturnType<typeof useShowDesktopRow> | null = null;
    function Probe() {
      row = useShowDesktopRow();
      return null;
    }
    act(() => root!.render(h(Probe)));
    expect(row!.label).toBe("titlebar.showDesktop");
    act(() => row!.onSelect());
    expect(fx.toggles).toBe(1);
  });
});

describe("wiring (source)", () => {
  const src = (rel: string) => readFileSync(`src/renderer/src/${rel}`, "utf8");
  it("the left group has it, the right-hand group and the tray do not", () => {
    expect(src("components/SidebarNav.tsx")).toMatch(/<ShowDesktopButton className=\{btn\} \/>\}[\s\S]*?\{any &&/);
    expect(src("components/TitleBar.tsx")).not.toContain("<ShowDesktopButton");
    expect(src("components/ChipTray.tsx")).not.toContain("<ShowDesktopButton");
  });
});
