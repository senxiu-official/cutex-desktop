import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CutexClient } from "@cutex-desktop/cutex-client";
import { describe, expect, it, vi } from "vitest";
import { ServiceNotifications } from "../src/main/serviceNotifications";
import { SERVICE_NOTIFICATIONS_FEATURE } from "../src/shared/serviceNotifications";

const STREAM = "00000000-0000-4000-8000-000000000001";
const FIRST = "00000000-0000-4000-8000-000000000002";
const LAST = "00000000-0000-4000-8000-000000000003";

describe("desktop service notification delivery", () => {
  it("opens one grouped notice and durably advances the replay cursor", async () => {
    vi.useFakeTimers();
    const home = mkdtempSync(join(tmpdir(), "cutex-service-notices-"));
    const show = vi.fn(), open = vi.fn();
    const request = vi.fn(async (_method: string, route: string) => {
      if (route === "/v2/service-notifications") return {
        streamId: STREAM,
        notifications: [
          { id: FIRST, slug: "sample", cursor: 1, desktop: true, phone: true },
          { id: LAST, slug: "sample", cursor: 2, desktop: true, phone: true },
        ],
      };
      return { notification: { id: LAST, slug: "sample", desktop: true, title: "Synthetic title", body: "Fixture",
        deliverUntil: Math.floor(Date.now() / 1000) + 60, target: { kind: "servicePath", path: "/example" } } };
    });
    const client = { request } as unknown as CutexClient;
    const daemon = { activeClient: () => client, capabilities: async () => ({ hostId: "fixture", featureList: [SERVICE_NOTIFICATIONS_FEATURE] }) };
    const options = { daemon: () => daemon, userData: () => home, show, open, muted: () => false };
    const monitor = new ServiceNotifications(options), restarted = new ServiceNotifications(options);
    try {
      monitor.onHost("fixture");
      await vi.advanceTimersByTimeAsync(0);
      expect(show).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[1]?.[1]).toBe(`/v2/services/sample/notifications/${LAST}`);
      const key = show.mock.calls[0]?.[0]?.key;
      expect(monitor.click(key)).toBe(true);
      expect(open).toHaveBeenCalledWith({ hostId: "fixture", slug: "sample", id: LAST, path: "/example" });
      monitor.dispose();
      restarted.onHost("fixture");
      await vi.advanceTimersByTimeAsync(0);
      expect(show).toHaveBeenCalledTimes(1);
    } finally {
      monitor.dispose(); restarted.dispose(); vi.useRealTimers();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("skips the delivery feed for narrowed owner devices", async () => {
    vi.useFakeTimers();
    const request = vi.fn(), client = { request } as unknown as CutexClient;
    const daemon = { activeClient: () => client, capabilities: async () => ({ hostId: "fixture", featureList: [SERVICE_NOTIFICATIONS_FEATURE],
      user: { id: "owner", name: null, isOwner: true, pending: false, grant: null, scope: "read" as const } }) };
    const monitor = new ServiceNotifications({ daemon: () => daemon, userData: tmpdir, show: vi.fn(), open: vi.fn(), muted: () => false });
    try {
      monitor.onHost("fixture");
      await vi.advanceTimersByTimeAsync(20_000);
      expect(request).not.toHaveBeenCalled();
    } finally { monitor.dispose(); vi.useRealTimers(); }
  });
});
