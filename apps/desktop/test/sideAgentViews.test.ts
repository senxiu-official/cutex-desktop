// The side store follows the selected agent (owner 2026-10-11, RFC §13 D27′): each agent keeps its
// own column state and page in view; another agent's content never shows; a new agent starts closed.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

describe("side store: per-agent views", () => {
  it("open a card on A → B closed (no foreign pages) → A restored; Settings keeps the last agent's view", async () => {
    const { useApp, SETTINGS_PAGE } = await import("../src/renderer/src/store");
    const { startSideStore, updateLayout, useSide, setMode } = await import("../src/renderer/src/lib/sideLayoutStore");
    const { applyOpen, closeInstances, place, placeSpec, SINGLETON_KEY } = await import("../src/renderer/src/lib/sideLayout");
    useApp.setState({ selectedId: "A" });
    // node: startSideStore only listens for beforeunload on window
    if (typeof window === "undefined") vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    const stop = startSideStore(() => () => {});
    try {
      expect(useSide.getState().layout.open).toBe(false);
      // A opens its side chat (agent-bound).
      let chat = "";
      updateLayout((l) => {
        const input = { kind: "side-chat.chat", binding: { kind: "agent", hostId: "local", sessionId: "A" }, key: SINGLETON_KEY, state: null, v: 1, pinned: false } as const;
        const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "chat" }));
        const applied = applyOpen(l, decision, input, 1, { reveal: true, home: "chat" });
        chat = applied.instanceId;
        return applied.layout;
      });
      const page = useSide.getState().layout.activePage;
      expect(useSide.getState().layout.open).toBe(true);
      setMode({ kind: "maximised", card: null });

      useApp.setState({ selectedId: "B" });
      expect(useSide.getState().layout.open).toBe(false);
      expect(useSide.getState().mode).toBeNull();

      // A settings page keeps selectedId: nothing changes.
      useApp.setState({ view: { kind: "page", page: SETTINGS_PAGE, params: {} } });
      expect(useSide.getState().layout.open).toBe(false);

      useApp.setState({ selectedId: "A", view: { kind: "conversation" } });
      expect(useSide.getState().layout).toMatchObject({ open: true, activePage: page });
      expect(useSide.getState().mode).toEqual({ kind: "maximised", card: null });

      // Closing A's last content closes A's column.
      updateLayout((l) => closeInstances(l, [chat]));
      expect(useSide.getState().layout.open).toBe(false);
      expect(useSide.getState().layout.views?.A).toMatchObject({ open: false });
    } finally {
      stop();
      vi.unstubAllGlobals();
    }
  }, 30_000);
});
