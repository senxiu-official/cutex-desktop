// @vitest-environment jsdom
// Multi-window P3: a desk window draws the app's shell for its own window (components/DeskWindows) — the sidebar /
// work row (PaneHost), the tray, the Shelf instance layer and the Settings Shelf — portalled into the desk's
// document, every part reading that desk's layout and selection (lib/windowScope). The desk here is an iframe's
// document, as in deskPortals.test.tsx; the heavy parts are probes that report what they see.
import { act, createElement as h, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => {
  const parts = new Set<string>();
  const part = (name: string) => () => {
    parts.add(name);
    return null;
  };
  return { host: [] as { doc: Document; desk: string | null; panes: number; selected: string | null }[], parts, part };
});

vi.mock("../src/renderer/src/bridge", () => ({ bridge: {}, api: {}, apiFor: () => ({}), cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  const { selectionAware } = await import("../src/renderer/src/lib/windowScope");
  const useApp = selectionAware(create(() => ({ selectedId: "main-agent" as string | null, selectedHost: "local" as string | null, view: { kind: "conversation" }, hosts: { active: "local" } })));
  return { useApp, hostApi: () => ({}), agentHost: (s: { selectedHost: string | null }) => s.selectedHost ?? "local" };
});
vi.mock("../src/renderer/src/lib/workspaceView", async () => {
  const { createContext } = await import("react");
  return { WorkspaceContext: createContext(null), useSelectedScope: () => null, useSelectedHost: () => "local", useWorkspace: () => ({}) };
});
vi.mock("../src/renderer/src/modules/react", () => ({ useOpenPage: () => null }));
vi.mock("../src/renderer/src/modules/Outlet", () => ({ PageAsideOutlet: () => null }));
vi.mock("../src/renderer/src/components/PaneHost", async () => {
  const { useDeskId } = await import("../src/renderer/src/lib/deskContext");
  const { usePanes } = await import("../src/renderer/src/lib/paneStore");
  const { useApp } = await import("../src/renderer/src/store");
  const { createElement } = await import("react");
  function PaneHost() {
    const desk = useDeskId();
    const panes = usePanes((s) => Object.keys(s.layout.panes).length);
    const selected = useApp((s: { selectedId: string | null }) => s.selectedId);
    return createElement("div", {
      "data-probe-host": "",
      ref: (el: HTMLElement | null) => {
        if (el) seen.host.push({ doc: el.ownerDocument, desk, panes, selected });
      },
    });
  }
  return { PaneHost };
});
vi.mock("../src/renderer/src/components/ChipTray", () => ({ DesktopBackground: seen.part("background"), TrayFrame: ({ children }: { children: ReactNode }) => (seen.parts.add("tray"), children) }));
vi.mock("../src/renderer/src/components/side/SideInstanceLayer", () => ({ SideInstanceLayer: seen.part("instances") }));
vi.mock("../src/renderer/src/components/SettingsShelf", () => ({ SettingsShelf: seen.part("settings") }));
vi.mock("../src/renderer/src/components/WindowControls", () => ({ LinuxControls: () => null, CaptionSpace: () => null }));

import { DeskWindows } from "../src/renderer/src/components/DeskWindows";
import { useDesks } from "../src/renderer/src/lib/deskStore";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { defaultLayout, openBeside } from "../src/renderer/src/lib/paneLayout";
import { keepSelection, resetWindowsForTest } from "../src/renderer/src/lib/windowScope";
import { I18nProvider } from "../src/renderer/src/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DESK = "d000000000001";
let frame: HTMLIFrameElement;

beforeEach(() => {
  frame = document.createElement("iframe");
  document.body.append(frame);
  seen.host.length = 0;
  seen.parts.clear();
});

afterEach(() => {
  useDesks.setState({ desks: [], focused: null });
  resetWindowsForTest();
  frame.remove();
});

describe("desk shell (components/DeskWindows, P3)", () => {
  it("draws the shell into the desk's document, with that desk's own layout and selection", () => {
    const deskDoc = frame.contentDocument!;
    const root = deskDoc.createElement("div");
    root.id = "root";
    deskDoc.body.append(root);
    usePanes.of(DESK).setState({ layout: openBeside(defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "desk-agent" }), { hostId: "local", sessionId: "other" }, 1, { room: true }) });
    keepSelection(DESK, { selectedId: "desk-agent", selectedHost: "local", view: { kind: "conversation" } });
    useDesks.setState({ desks: [{ deskId: DESK, handle: { deskId: DESK, win: frame.contentWindow!, root, dispose: () => {} }, content: { kind: "conversation", hostId: "local", sessionId: "desk-agent" } }] });
    const host = document.createElement("div");
    document.body.append(host);
    const app = createRoot(host);
    act(() => app.render(h(I18nProvider, null, h(DeskWindows))));
    // The work row is drawn in the desk's document, for the desk, with its layout (two panes) and its selection.
    expect(seen.host).toHaveLength(1);
    expect(seen.host[0]).toEqual({ doc: deskDoc, desk: DESK, panes: 2, selected: "desk-agent" });
    // The rest of the shell: background, tray, the Shelf instance layer, the Settings Shelf (when opened there).
    expect([...seen.parts].sort()).toEqual(["background", "instances", "settings", "tray"]);
    // Its own title bar (桌子 2: the main window is the first).
    expect(deskDoc.querySelector("[data-desk-bar]")?.textContent).toMatch(/2/);
    expect(deskDoc.querySelector(`[data-desk="${DESK}"]`)).not.toBeNull();
    expect(document.querySelector("[data-probe-host]")).toBeNull();
    act(() => app.unmount());
    host.remove();
  });
});
