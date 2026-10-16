// 后端更新 → sidebar 设置 dot (modules/backend-upgrade/store.ts startUpgradeSync + lib/settingsAttention):
// a connected host with the capability is read once per connection without opening Settings, and an
// available update raises the dot; stopping the module clears it.
import { describe, expect, it, vi } from "vitest";
import type { UpgradeStatus } from "../src/shared/backendUpgrade";

const env = vi.hoisted(() => {
  let state: { hosts: unknown; daemon: unknown; features: unknown; byHost: unknown; list: unknown[] } = { hosts: {}, daemon: {}, features: {}, byHost: {}, list: [] };
  const subs = new Set<() => void>();
  return {
    upgradeStatus: vi.fn(),
    get: () => state,
    set: (next: Partial<typeof state>) => {
      state = { ...state, ...next };
      for (const f of subs) f();
    },
    subs,
  };
});
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: () => () => {} }, api: {} }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { daemonFor: () => ({ upgradeStatus: env.upgradeStatus }) } }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: env.get, subscribe: (f: () => void) => (env.subs.add(f), () => env.subs.delete(f)) } }));
vi.mock("../src/renderer/src/lib/hostScope", () => ({ scopedHostData: (s: { list: unknown[] }) => s.list }));
const { startUpgradeSync } = await import("../src/renderer/src/modules/backend-upgrade/store");
const { useSettingsAttentionStore } = await import("../src/renderer/src/lib/settingsAttention");

const SETTINGS = { channel: "release" as const, source: "x", checkIntervalHours: 6, autoStage: true, autoApply: false, packageRun: "after" as const, packageRunBatch: 5, maxWaitSecs: 3600 };
const status = (over: Partial<UpgradeStatus> = {}): UpgradeStatus => ({ managed: true, serviceManager: "systemd", build: {}, installed: { release: "0.1.0" }, installedReleases: ["0.1.0"], settings: SETTINGS, trustedKeys: ["k"], ...over });
const host = (hostId: string, kind: string) => ({ hostId, daemon: { kind }, features: new Set(["backend-upgrade"]) });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("backend update dot on the sidebar 设置 entry", () => {
  it("reads a connected host once per connection and raises / clears the dot", async () => {
    env.upgradeStatus.mockResolvedValue(status({ available: { release: "0.1.1" } as UpgradeStatus["available"] }));
    const ctl = new AbortController();
    env.set({ list: [host("h", "connected")] });
    startUpgradeSync({ signal: ctl.signal } as never);
    await flush();
    expect(env.upgradeStatus).toHaveBeenCalledTimes(1);
    expect(useSettingsAttentionStore.getState().byModule["backend-upgrade"]).toBe("backend-upgrade.navAttention");

    env.set({ byHost: {} }); // unrelated host-data change: no second read
    await flush();
    expect(env.upgradeStatus).toHaveBeenCalledTimes(1);

    env.set({ list: [host("h", "disconnected")], daemon: { x: 1 } });
    env.set({ list: [host("h", "connected")], daemon: { x: 2 } }); // reconnect (e.g. after the upgrade restart)
    await flush();
    expect(env.upgradeStatus).toHaveBeenCalledTimes(2);

    ctl.abort();
    expect(useSettingsAttentionStore.getState().byModule["backend-upgrade"]).toBeUndefined();
  });
});
