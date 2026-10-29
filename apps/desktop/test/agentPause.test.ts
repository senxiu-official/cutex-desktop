// 暂停智能体 (cutex agent-pause, lib/agentPause): parsing the session resource's state, the kept newer state, the
// menu row (worded apart from 暂停新委托), hidden on hosts without the capability, and 继续并发送's two steps.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentPauseOf, parseAgentPause, type AgentPause } from "../src/shared/agentPause";
import { normalizeEntries, type MenuAction } from "../src/renderer/src/lib/contextMenu";
// The store and the menus at the top (bridge mocked — vi.mock is hoisted), like asksPause.test.
import { useApp } from "../src/renderer/src/store";
import { agentMenu } from "../src/renderer/src/lib/menus";
import { agentPauseNow, noteAgentPause, resumeAndSend, shownAgentPause, useAgentPauses } from "../src/renderer/src/lib/agentPause";

const PAUSED: AgentPause = { cutexSessionId: "a", phase: "paused", requestedAt: "2026-10-25T01:00:00Z", pausedAt: "2026-10-25T01:00:05Z", by: "owner" };
const api = vi.hoisted(() => ({
  agentPause: vi.fn(async () => ({ agentPause: { cutexSessionId: "a", phase: "pausing", requestedAt: "2026-10-25T01:00:00Z", by: "owner" }, changed: true })),
  agentResume: vi.fn(async (): Promise<unknown> => ({ agentPause: null, changed: true })),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api, onEvent: () => () => {} }));

const t = (key: string) => key;
const session = { cutexSessionId: "a", displayName: "A", lifecycle: "active", runtime: { activeTurnId: null } } as never;

function seed(features: string[], agentPause: AgentPause | null = null) {
  const resource = { cutexSessionId: "a", displayName: "A", lifecycle: "active", revision: 1, agentPause };
  useApp.setState({ features: new Set(features), sidebar: { active: [resource], hostRows: {} } as never });
  useAgentPauses.setState({ byKey: {} });
  return resource;
}

describe("agent pause state", () => {
  it("parses the contract's object, null otherwise", () => {
    expect(parseAgentPause(PAUSED)).toEqual(PAUSED);
    expect(parseAgentPause({ ...PAUSED, by: "director", byCutexSessionId: "eva" })?.byCutexSessionId).toBe("eva");
    expect(parseAgentPause({ ...PAUSED, phase: "stopped" })).toBeNull();
    expect(parseAgentPause(null)).toBeNull();
    expect(parseAgentPause("paused")).toBeNull();
    expect(agentPauseOf({ agentPause: PAUSED })).toEqual(PAUSED);
    expect(agentPauseOf({})).toBeNull();
  });

  it("a kept newer state wins only over the resource it was noted against", () => {
    const resource = { agentPause: null };
    expect(shownAgentPause(resource, { pause: PAUSED, base: resource })).toEqual(PAUSED);
    // A newer snapshot: cutex's own value again.
    expect(shownAgentPause({ agentPause: null }, { pause: PAUSED, base: resource })).toBeNull();
    expect(shownAgentPause({ agentPause: PAUSED }, undefined)).toEqual(PAUSED);
  });

  it("an event / answer shows before the next snapshot; hosts without agent-pause show nothing", () => {
    seed(["agent-pause"]);
    expect(agentPauseNow("local", "a")).toBeNull();
    noteAgentPause("local", "a", PAUSED);
    expect(agentPauseNow("local", "a")).toEqual(PAUSED);
    seed([], PAUSED);
    expect(agentPauseNow("local", "a")).toBeNull();
  });
});

describe("agent menu", () => {
  const labels = () => normalizeEntries(agentMenu(session, t as never, "local")).map((e) => (e === "separator" ? "|" : (e as MenuAction).label));

  it("暂停智能体 / 继续智能体 beside 暂停新委托, only with the capability", () => {
    seed(["agent-pause", "asks-pause-v2"]);
    expect(labels()).toContain("agentPause.pause");
    expect(labels()).toContain("asksPause.pause");
    expect(labels().indexOf("agentPause.pause")).toBeLessThan(labels().indexOf("asksPause.pause"));
    seed(["agent-pause", "asks-pause-v2"], PAUSED);
    expect(labels()).toContain("agentPause.resume");
    expect(labels()).not.toContain("agentPause.pause");
    seed(["asks-pause-v2"], PAUSED);
    expect(labels().some((l) => l.startsWith("agentPause."))).toBe(false);
  });
});

describe("继续并发送", () => {
  beforeEach(() => {
    api.agentResume.mockClear();
  });

  it("sends only after resuming worked", async () => {
    seed(["agent-pause"], PAUSED);
    const order: string[] = [];
    api.agentResume.mockImplementationOnce(async () => (order.push("resume"), { agentPause: null, changed: true }));
    const send = vi.fn(async () => void order.push("send"));
    expect(await resumeAndSend("local", "a", send)).toBe(true);
    expect(order).toEqual(["resume", "send"]);
    expect(agentPauseNow("local", "a")).toBeNull();
  });

  it("keeps the draft when resuming failed", async () => {
    seed(["agent-pause"], PAUSED);
    api.agentResume.mockImplementationOnce(async () => {
      throw new Error("agent_not_found");
    });
    const send = vi.fn(async () => {});
    expect(await resumeAndSend("local", "a", send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(agentPauseNow("local", "a")).toEqual(PAUSED);
  });
});
