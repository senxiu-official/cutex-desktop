// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScopeSource, HostScope } from "../src/renderer/src/lib/hostScope";

const fixture = vi.hoisted(() => ({ state: null as ScopeSource | null, listeners: new Set<() => void>() }));
vi.mock("../src/renderer/src/store", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (fn: () => void) => { fixture.listeners.add(fn); return () => { fixture.listeners.delete(fn); }; };
  return { useApp: (select: (s: ScopeSource) => unknown) => useSyncExternalStore(subscribe, () => select(fixture.state!)) };
});
vi.mock("../src/renderer/src/bridge", () => ({ api: {} }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ hostMarksSingle: false }), getUiPrefs: () => ({ hostMarksSingle: false }) }));
import { useHostScope } from "../src/renderer/src/lib/useHostScope";

afterEach(() => fixture.listeners.clear());
describe("host scope subscription", () => {
  it("does not rerender for remote data refreshes but immediately observes connectivity", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    fixture.state = { hosts: null, daemon: { kind: "connecting", baseUrl: "mock://" }, byHost: { remote: { daemon: { kind: "connected", baseUrl: "mock://", hostId: "remote" } } } };
    let renders = 0, last: HostScope | undefined;
    function Probe() { renders++; last = useHostScope(); return null; }
    const node = document.createElement("div"), root = createRoot(node);
    const update = (state: ScopeSource) => act(() => { fixture.state = state; for (const fn of fixture.listeners) fn(); });
    try {
      act(() => root.render(<Probe />));
      const initial = last;
      for (let i = 0; i < 100; i++) update({ ...fixture.state!, byHost: { remote: { ...fixture.state!.byHost.remote!, sidebar: i } } } as ScopeSource);
      expect(renders).toBe(1);
      expect(last).toBe(initial);
      update({ ...fixture.state!, byHost: { remote: { daemon: { kind: "unreachable", baseUrl: "mock://", message: "disconnected" } } } });
      expect(renders).toBe(2);
      expect(last).not.toBe(initial);
      expect(renders).toBe(2);
    } finally { act(() => root.unmount()); }
  });
});
