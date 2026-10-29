// The tool area is the focused conversation's own Shelf (docs/desktop-modules.md §24.13, owner 2026-10-21:
// 「Shelf 按对话记」 replaces v1.17's one layout for every agent): focusing another agent shows that agent's
// Shelf (a new one: a copy of the default layout, here empty); a maximised card ends; focusing A again
// brings A's Shelf back as it was; closing the focused agent's last content hides the tool area.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

describe("side store: a Shelf per conversation (§24.13)", () => {
  it("open a card on A → B has its own (empty) Shelf → A gets its Shelf back as it was; a maximised card ends on the switch", async () => {
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

      const aPage = useSide.getState().layout.pages[0]!.id;
      useApp.setState({ selectedId: "B" });
      // B's own Shelf: the default layout (none here: empty, closed); A's chat is not in it; the maximised card ends.
      expect(useSide.getState().layout.pages).toEqual([]);
      expect(useSide.getState().layout.open).toBe(false);
      expect(lanePages(useSide.getState().layout, ctxOf("B"))).toEqual([]);
      expect(useSide.getState().mode).toBeNull();

      // A settings page keeps selectedId: nothing changes.
      useApp.setState({ view: { kind: "page", page: SETTINGS_PAGE, params: {} } });
      expect(useSide.getState().layout.pages).toEqual([]);

      useApp.setState({ selectedId: "A", view: { kind: "conversation" } });
      expect(useSide.getState().layout.open).toBe(true);
      expect(lanePages(useSide.getState().layout, ctxOf("A")).map((p) => p.id)).toEqual([aPage]);
      expect(useSide.getState().layout.instances[chat]?.kind).toBe("side-chat.chat");

      // Closing A's last content hides the tool area.
      updateLayout((l) => closeInstances(l, [chat]));
      expect(useSide.getState().layout.open).toBe(false);
    } finally {
      stop();
      vi.unstubAllGlobals();
    }
  }, 30_000);
});
