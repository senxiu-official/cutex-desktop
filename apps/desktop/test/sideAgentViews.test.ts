// The tool area is one layout for every agent (docs/desktop-modules.md §24; v1.17 abolished §18.5's
// per-agent views, RFC §13 D27′): focusing another agent keeps the tool columns as they are — a pane
// shows what that agent's bindings see; a maximised card it cannot see ends; closing the focused agent's
// last content hides the tool area.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

describe("side store: one layout for every agent", () => {
  it("open a card on A → B keeps the tool area open (A's card hidden for B) → A sees it again; a maximised card B cannot see ends", async () => {
    const { useApp, SETTINGS_PAGE } = await import("../src/renderer/src/store");
    const { startSideStore, updateLayout, useSide, setMode } = await import("../src/renderer/src/lib/sideLayoutStore");
    const { applyOpen, closeInstances, lanePages, place, placeSpec, SINGLETON_KEY } = await import("../src/renderer/src/lib/sideLayout");
    useApp.setState({ selectedId: "A" });
    if (typeof window === "undefined") vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    const stop = startSideStore(() => () => {});
    const ctxOf = (sessionId: string) => ({ hostId: "local", sessionId, workspaceKey: null, available: () => true });
    try {
      expect(useSide.getState().layout.open).toBe(false);
      // A opens its side chat (agent-bound) and a follow-bound card.
      let chat = "";
      const openKind = (kind: string, binding: { kind: "agent"; hostId: string; sessionId: string } | { kind: "follow"; hostId: string }, home: string) =>
        updateLayout((l) => {
          const input = { kind: kind as `${string}.${string}`, binding, key: SINGLETON_KEY, state: null, v: 1, pinned: false };
          const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home }));
          const applied = applyOpen(l, decision, input, 1, { reveal: true, home });
          if (kind === "side-chat.chat") chat = applied.instanceId;
          return applied.layout;
        });
      openKind("side-chat.chat", { kind: "agent", hostId: "local", sessionId: "A" }, "chat");
      expect(useSide.getState().layout.open).toBe(true);
      const chatCard = useSide.getState().layout.pages[0]!.cards[0]!.id;
      setMode({ kind: "maximised", card: chatCard });

      useApp.setState({ selectedId: "B" });
      // Same layout: open, the chat column has nothing for B (off screen); the maximised chat card ends.
      expect(useSide.getState().layout.open).toBe(true);
      expect(lanePages(useSide.getState().layout, ctxOf("B"))).toEqual([]);
      expect(useSide.getState().mode).toBeNull();

      // A settings page keeps selectedId: nothing changes.
      useApp.setState({ view: { kind: "page", page: SETTINGS_PAGE, params: {} } });
      expect(useSide.getState().layout.open).toBe(true);

      useApp.setState({ selectedId: "A", view: { kind: "conversation" } });
      expect(lanePages(useSide.getState().layout, ctxOf("A")).map((p) => p.id)).toEqual([useSide.getState().layout.pages[0]!.id]);

      // Closing A's last content hides the tool area.
      updateLayout((l) => closeInstances(l, [chat]));
      expect(useSide.getState().layout.open).toBe(false);
    } finally {
      stop();
      vi.unstubAllGlobals();
    }
  }, 30_000);
});
