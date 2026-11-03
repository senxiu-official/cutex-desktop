// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => () => {} }, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (state: object) => unknown) => select({}), { getState: () => ({ setBackgroundItems() {} }) }),
  agentHost: () => "local", hostApi: () => ({ backgroundTerminals: async () => [] }), viewOf: () => ({ runtimeGeneration: 1 }),
}));
vi.mock("../src/renderer/src/lib/viewHost", () => ({ viewRow: () => ({ runtime: { runtimeGeneration: 1, status: "online" } }) }));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({ useConvScope: () => null }));
vi.mock("../src/renderer/src/lib/agentFeaturesView", () => ({
  // A real hook so skipping this capability lookup changes the component's hook order.
  useAgentFeatures: () => { useState(0); return { runtime: "claude", map: { backgroundTerminals: true } }; },
}));
const { useBackgroundTerminals } = await import("../src/renderer/src/lib/background");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps hook order stable while a thread loads and disappears", async () => {
  function Probe({ threadId }: { threadId: string | null }) {
    const { terminals } = useBackgroundTerminals("agent", threadId, null);
    return createElement("span", null, terminals.length);
  }
  const host = document.createElement("div"), root = createRoot(host);
  try {
    for (const threadId of [null, "thread", null]) {
      await act(async () => root.render(createElement(Probe, { threadId })));
      expect(host.textContent).toBe("0");
    }
  } finally { act(() => root.unmount()); }
});
