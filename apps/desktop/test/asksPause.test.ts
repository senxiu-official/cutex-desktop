// Owner pause of delegations (cutex asks-pause-v2): store actions, the agent menu item, and the
// queue tray's 插入 guard during a delegation turn.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queueSendNowMode } from "../src/renderer/src/lib/delegationTurn";
import { normalizeEntries, type MenuAction } from "../src/renderer/src/lib/contextMenu";

const PAUSE = { since: "2026-10-08T12:00:00Z", by: "owner", origin: "ownerPause" as const };
const api = vi.hoisted(() => ({
  asksPause: vi.fn(async () => ({ asksPaused: { since: "2026-10-08T12:00:00Z", by: "owner", origin: "ownerPause" }, changed: true })),
  asksResume: vi.fn(async () => ({ asksPaused: null, changed: true })),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api, onEvent: () => () => {} }));

const t = (key: string) => key;

async function seed(features: string[], asksPaused: typeof PAUSE | null = null) {
  const { useApp } = await import("../src/renderer/src/store");
  useApp.setState({ features: new Set(features), sessions: { a: { asksPaused } as never } });
  return useApp;
}

const session = { cutexSessionId: "a", displayName: "A", lifecycle: "active", runtime: { activeTurnId: null } } as never;

describe("asks pause (asks-pause-v2)", () => {
  beforeEach(() => {
    api.asksPause.mockClear();
    api.asksResume.mockClear();
  });

  it("pause / resume call cutex and keep the returned state", async () => {
    const useApp = await seed(["asks-pause-v2"]);
    await useApp.getState().pauseAsks("a");
    expect(api.asksPause).toHaveBeenCalledWith("a");
    expect(useApp.getState().sessions.a?.asksPaused).toEqual(PAUSE);
    await useApp.getState().resumeAsks("a");
    expect(api.asksResume).toHaveBeenCalledWith("a");
    expect(useApp.getState().sessions.a?.asksPaused).toBeNull();
  });

  it("older daemons: no calls", async () => {
    const useApp = await seed(["queue-pause"]);
    await useApp.getState().pauseAsks("a");
    await useApp.getState().resumeAsks("a");
    expect(api.asksPause).not.toHaveBeenCalled();
    expect(api.asksResume).not.toHaveBeenCalled();
  });

  it("agent menu offers 暂停委托 / 继续委托 only with the capability", async () => {
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const labels = () => normalizeEntries(agentMenu(session, t as never)).map((e) => (e === "separator" ? "|" : (e as MenuAction).label));
    await seed(["asks-pause-v2"]);
    expect(labels()).toContain("asksPause.pause");
    await seed(["asks-pause-v2"], PAUSE);
    expect(labels()).toContain("asksPause.resume");
    expect(labels()).not.toContain("asksPause.pause");
    await seed([]);
    expect(labels().some((l) => l.startsWith("asksPause."))).toBe(false);
  });
});

describe("queue tray 插入 during a delegation turn", () => {
  it("asks first only in a delegation turn with the steer-keys setting off", () => {
    expect(queueSendNowMode({ delegation: true, allowSteerKeys: false })).toBe("confirm");
    expect(queueSendNowMode({ delegation: true, allowSteerKeys: true })).toBe("steer");
    expect(queueSendNowMode({ delegation: false, allowSteerKeys: false })).toBe("steer");
  });
});
