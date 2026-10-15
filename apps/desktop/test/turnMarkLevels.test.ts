// A finished turn's 「完成」 / 「出错」 mark follows the host's notification levels (`mark` method of the
// turn event's level); hosts without the tables keep marking every turn end.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_LEVELS_FEATURE } from "../src/shared/notificationLevels";
import { mock } from "../src/renderer/src/modules/notifications/mock";
import { turnEventOf } from "../src/renderer/src/lib/turnTriggers";
import type { NotifyOccurrence } from "../src/renderer/src/lib/notifyEvents";

// The focus host's daemon = the mock cutex tables (event preset `default`, methods preset `default`).
const focusApi = mock.api!({ legacy: false } as never) as Required<Pick<import("../src/shared/ipc").DesktopApi, "evaluateNotification" | "patchNotificationLevels">>;
vi.mock("../src/renderer/src/bridge", () => ({ api: { evaluateNotification: (r: never) => focusApi.evaluateNotification(r) }, bridge: {}, onEvent: () => () => {} }));

const { decide, markWanted } = await import("../src/renderer/src/modules/notifications/runtime");
const { emitNotify } = await import("../src/renderer/src/lib/notifyEvents");

type Host = { id: string; focus: boolean; features: Set<string> };
function ctx(hosts: Host[], daemonFor: (id: string) => unknown = () => focusApi) {
  return { hosts: { list: () => hosts, get: (id: string) => hosts.find((h) => h.id === id) }, services: { daemonFor } } as never;
}
const levels = { id: "local", focus: true, features: new Set([NOTIFICATION_LEVELS_FEATURE]) };
const old = { id: "local", focus: true, features: new Set<string>() };

function turnOcc(owner: "owner" | "other", status: string, over: Partial<NotifyOccurrence> = {}): NotifyOccurrence {
  return { key: "turn:a:1", events: [turnEventOf(owner, status)], fallback: [], agentId: "a", agentName: "a", projectId: "p1", title: "a", body: "", looking: false, ...over };
}
const marks = async (occ: NotifyOccurrence, c = ctx([levels])) => markWanted(await decide(occ, c));

describe("turn mark follows the notification levels", () => {
  // The mock stores one changed event; start from the plain `default` tables (live Workstation).
  beforeAll(() => focusApi.patchNotificationLevels({ events: { preset: "default" } }));

  it("other turns are `record` under default: no 完成 / 出错 mark", async () => {
    expect(await marks(turnOcc("other", "completed"))).toBe(false);
    expect(await marks(turnOcc("other", "failed"))).toBe(false);
  });

  it("owner turns: completed = inform, failed = needsYou → mark", async () => {
    expect(await marks(turnOcc("owner", "completed"))).toBe(true);
    expect(await marks(turnOcc("owner", "failed"))).toBe(true);
  });

  it("a host without notification levels marks every turn end", async () => {
    expect(await marks(turnOcc("other", "completed"), ctx([old]))).toBe(true);
    expect(await marks(turnOcc("other", "failed"), ctx([old]))).toBe(true);
  });

  it("another host's tables decide; unreachable → mark", async () => {
    const remote = { id: "r", focus: false, features: new Set([NOTIFICATION_LEVELS_FEATURE]) };
    expect(await marks(turnOcc("other", "completed", { hostId: "r" }), ctx([levels, remote]))).toBe(false);
    const down = ctx([levels, remote], () => ({ evaluateNotification: () => Promise.reject(new Error("offline")) }));
    expect(await marks(turnOcc("other", "completed", { hostId: "r" }), down)).toBe(true);
    const oldRemote = { ...remote, features: new Set<string>() };
    expect(await marks(turnOcc("other", "completed", { hostId: "r" }), ctx([levels, oldRemote]))).toBe(true);
  });

  it("a muted project lowers the owner's completed turn (inform → record): no mark", async () => {
    await focusApi.patchNotificationLevels({ projectOverrides: { p1: "mute" } });
    try {
      expect(await marks(turnOcc("owner", "completed"))).toBe(false);
      expect(await marks(turnOcc("owner", "completed", { projectId: "p2" }))).toBe(true);
    } finally {
      await focusApi.patchNotificationLevels({ projectOverrides: { p1: null } });
    }
  });

  it("markWanted: only the tables' `mark` method, or no tables", () => {
    expect(markWanted(null)).toBe(true);
    expect(markWanted({ tables: false, actions: [] })).toBe(true);
    expect(markWanted({ tables: true, actions: ["desktop"] })).toBe(false);
    expect(markWanted({ tables: true, actions: ["mark"] })).toBe(true);
  });

  it("no notifications handler installed: the mark is left as before", () => {
    const mark = vi.fn();
    emitNotify(turnOcc("other", "completed", { mark }));
    expect(mark).toHaveBeenCalledOnce();
  });
});
