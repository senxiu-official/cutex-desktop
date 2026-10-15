// 后端更新 store (modules/backend-upgrade/store.ts): a status read after the last upgrade event
// supersedes it; a host reset fences reads still in flight.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpgradeEvent, UpgradeStatus } from "../src/shared/backendUpgrade";

const env = vi.hoisted(() => ({ upgradeStatus: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: undefined, api: {} }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { daemonFor: () => ({ upgradeStatus: env.upgradeStatus }) } }));
const { hostUpgrade, loadUpgradeStatus, putUpgradeEvent, resetHostUpgrade, useUpgradeStore } = await import("../src/renderer/src/modules/backend-upgrade/store");
const { upgradeAttention } = await import("../src/renderer/src/modules/backend-upgrade/model");

const SETTINGS = { channel: "release" as const, source: "x", checkIntervalHours: 6, autoStage: true, autoApply: false, packageRun: "after" as const, packageRunBatch: 5, maxWaitSecs: 3600 };
const status = (over: Partial<UpgradeStatus> = {}): UpgradeStatus => ({ managed: true, serviceManager: "systemd", build: {}, installed: { release: "r241" }, installedReleases: ["r241"], settings: SETTINGS, trustedKeys: ["k"], ...over });
const event: UpgradeEvent = { reason: "state", hostId: "h", run: { runId: "upg-1", kind: "apply", phase: "stopping", fromRelease: "r240", toRelease: "r241", servicesDown: true }, available: null, staged: null };
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => {
  useUpgradeStore.setState({ byHost: {} });
  env.upgradeStatus.mockReset();
});

describe("backend upgrade store", () => {
  it("a status read started after the event clears it (the dot and 'services restarting' follow the status)", async () => {
    putUpgradeEvent("h", event);
    expect(upgradeAttention(hostUpgrade("h").status, hostUpgrade("h").event)).toBe("none"); // no status yet → unmanaged
    env.upgradeStatus.mockResolvedValue(status({ run: { runId: "upg-1", kind: "apply", fromRelease: "r240", toRelease: "r241", mode: "reload", class: "reload-safe", phase: "committed", createdAt: "", maxWaitSecs: 1, packageRun: "after", timeline: [] } }));
    await loadUpgradeStatus("h");
    expect(hostUpgrade("h").event).toBeNull();
    expect(upgradeAttention(hostUpgrade("h").status, hostUpgrade("h").event)).toBe("none");
  });

  it("keeps an event that arrived while the read was in flight", async () => {
    const d = deferred<UpgradeStatus>();
    env.upgradeStatus.mockReturnValue(d.promise);
    const p = loadUpgradeStatus("h");
    putUpgradeEvent("h", event);
    d.resolve(status());
    await p;
    expect(hostUpgrade("h").event).toEqual(event);
    expect(upgradeAttention(hostUpgrade("h").status, hostUpgrade("h").event)).toBe("running");
  });

  it("a read in flight during a host reset does not patch stale status back in", async () => {
    const d = deferred<UpgradeStatus>();
    env.upgradeStatus.mockReturnValueOnce(d.promise);
    const p = loadUpgradeStatus("h");
    resetHostUpgrade("h");
    d.resolve(status());
    await p;
    expect(useUpgradeStore.getState().byHost.h).toBeUndefined();
    // A new read after the reset is not deduplicated into the fenced one.
    env.upgradeStatus.mockResolvedValueOnce(status({ installed: { release: "r242" } }));
    await loadUpgradeStatus("h");
    expect(hostUpgrade("h").status?.installed?.release).toBe("r242");
  });
});
