// Owner 2026-10-23: the tray is the taskbar of what is open. Closing the workspace on screen (the tray's ×, 关闭 in its
// header, Ctrl+W — lib/workspaces closeWorkspace with `closing`) activates the tray's next entry, like a browser closing
// its active tab (the keeper's nextAfterClose, lib/trayPins); with nothing else in the tray the desktop shows and the
// tray card keeps its place (lib/trayRoom holdTrayPlace / heldGeometry: it no longer flies to the desktop's middle).
// 「—」 (minimise) still goes to the desktop. Two workspaces: only that column closes.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

import { addConversationColumn, conversationPanes, defaultLayout, MAIN_PANE, paneBinding, type PaneLayout } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { addOpen, isOpenInTray, useTrayOpen } from "../src/renderer/src/lib/trayOpen";
import { setTrayPins, type TrayAgent, type TrayNext } from "../src/renderer/src/lib/trayPins";
import { heldGeometry, useTrayRoom, type RoomGeometry } from "../src/renderer/src/lib/trayRoom";
import { closeEffect, minimizeWorkspace } from "../src/renderer/src/lib/workspaceEffects";
import { closeWorkspace } from "../src/renderer/src/lib/workspaces";
import { closePaneWithHint } from "../src/renderer/src/lib/convPaneControls";
import { useApp } from "../src/renderer/src/store";

const A = { hostId: "local", sessionId: "A" };
const one = (sessionId = "A"): PaneLayout => defaultLayout({ sidebarOpen: true, sidebarWidth: 240, hostId: "local", sessionId });
const two = (): PaneLayout => addConversationColumn(one("A"), { hostId: "local", sessionId: "B" }, 1);

const fx = { asked: [] as TrayAgent[][], opened: 0, next: null as TrayNext | null };

function keeper(name: string | null) {
  fx.next = name
    ? {
        name,
        open: () => {
          fx.opened++;
          // What the real open does: the column shows the next agent, the one it showed becomes an open item.
          addOpen(A);
          usePanes.setState({ layout: one(name) });
        },
      }
    : null;
  setTrayPins({
    isPinned: () => false,
    pin: async () => false,
    unpin: async () => false,
    nextAfterClose: (closing) => {
      fx.asked.push([...closing]);
      return fx.next;
    },
  });
}

beforeEach(() => {
  Object.assign(fx, { asked: [], opened: 0, next: null });
  usePanes.setState({ layout: one() });
  useTrayOpen.setState({ open: [], back: [] });
  useTrayRoom.setState({ hold: 0 });
  useApp.setState({ selectedId: "A", selectedHost: "local" });
  try {
    localStorage.setItem("cutex-desktop.paneCloseHint", "1");
  } catch {
    // node: no storage
  }
});

const shown = () => conversationPanes(usePanes.getState().layout).map((id) => paneBinding(usePanes.getState().layout, id)?.sessionId ?? null);

describe("closing the workspace on screen", () => {
  it("the tray's next entry takes its place; the closed one is not an open item; the tray is not held", () => {
    keeper("B");
    closeWorkspace(MAIN_PANE, [A]);
    expect(fx.asked).toEqual([[A]]);
    expect(fx.opened).toBe(1);
    expect(shown()).toEqual(["B"]);
    expect(isOpenInTray(A)).toBe(false);
    expect(useApp.getState().selectedId).toBe("A");
    expect(useTrayRoom.getState().hold).toBe(0);
  });

  it("关闭 / Ctrl+W (closePaneWithHint) asks about the agent on screen", () => {
    keeper("B");
    closePaneWithHint(MAIN_PANE);
    expect(fx.asked).toEqual([[A]]);
    expect(shown()).toEqual(["B"]);
  });

  it("nothing else in the tray: the desktop shows and the tray card keeps its place", () => {
    keeper(null);
    closeWorkspace(MAIN_PANE, [A]);
    expect(fx.asked).toHaveLength(1);
    expect(useApp.getState().selectedId).toBeNull();
    expect(useTrayRoom.getState().hold).toBeGreaterThan(0);
  });

  it("no keeper (the module off): the desktop, as before", () => {
    setTrayPins(null);
    closeWorkspace(MAIN_PANE, [A]);
    expect(useApp.getState().selectedId).toBeNull();
  });

  it("「—」 minimise does not activate the next: into the tray, back to the desktop", () => {
    keeper("B");
    minimizeWorkspace(MAIN_PANE);
    expect(fx.asked).toEqual([]);
    expect(isOpenInTray(A)).toBe(true);
    expect(useApp.getState().selectedId).toBeNull();
  });

  it("two workspaces: only that column closes, nothing else opens", () => {
    keeper("C");
    usePanes.setState({ layout: two() });
    const [, right] = conversationPanes(usePanes.getState().layout);
    closeWorkspace(right!, [{ hostId: "local", sessionId: "B" }]);
    expect(fx.asked).toEqual([]);
    expect(shown()).toEqual(["A"]);
  });

  it("the preview of 关闭 names the one that comes next", () => {
    keeper("Bea");
    expect(closeEffect(MAIN_PANE).foretell!.text).toContain("Bea");
    keeper(null);
    expect(closeEffect(MAIN_PANE).foretell!.text).not.toContain("Bea");
  });
});

describe("the tray card over the desktop after the last close (pure)", () => {
  const under: RoomGeometry = { kind: "room", left: 512, width: 770, top: 756, centre: false };
  const desk: RoomGeometry = { kind: "room", left: 272, width: 1298, top: 757, centre: true };

  it("keeps the place it had under the conversations, at the desktop's height", () => {
    expect(heldGeometry(desk, under)).toEqual({ kind: "room", left: 512, width: 770, top: 757, centre: false });
    expect(heldGeometry(desk, { ...under, kind: "wide" })).toEqual({ kind: "room", left: 512, width: 770, top: 757, centre: false });
  });

  it("nothing kept, a place that was centred / the band, or conversations on screen again: the measure as it is", () => {
    expect(heldGeometry(desk, null)).toBeNull();
    expect(heldGeometry(desk, { ...under, centre: true })).toBeNull();
    expect(heldGeometry(desk, { kind: "band" })).toBeNull();
    expect(heldGeometry(under, under)).toBeNull();
    expect(heldGeometry({ kind: "band" }, under)).toBeNull();
  });
});
