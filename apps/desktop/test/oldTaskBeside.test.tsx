// @vitest-environment jsdom
// Ctrl/⌘ + click and middle click on an old-task result (owner 2026-11-27 「不生效」): the agent opens beside the focused
// one first, as the sidebar's agent rows do (lib/workspaceEffects agentEffect "beside"), then the jump lands on the turn.
// A plain click only jumps.
import { describe, expect, it, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({ run: vi.fn(), agentEffect: vi.fn(), jump: vi.fn(async () => ({ status: "focused" as const })) }));
vi.mock("../src/renderer/src/lib/workspaceEffects", () => ({
  agentEffect: (...args: unknown[]) => {
    fx.agentEffect(...args);
    return { foretell: null, run: fx.run };
  },
}));
vi.mock("../src/renderer/src/lib/jump", () => ({ jumpToTurn: fx.jump }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

import { openTaskHit } from "../src/renderer/src/lib/sessionSearchStore";

const hit = { connectionId: "ws", cutexSessionId: "s1", turnId: "t9" };

beforeEach(() => {
  fx.run.mockReset();
  fx.agentEffect.mockReset();
  fx.jump.mockClear();
});

describe("old-task result: open beside", () => {
  it("opens the agent beside, then jumps to the turn", async () => {
    await openTaskHit(hit, { beside: true });
    expect(fx.agentEffect).toHaveBeenCalledWith({ hostId: "ws", key: "s1" }, "beside");
    expect(fx.run).toHaveBeenCalledTimes(1);
    expect(fx.jump).toHaveBeenCalledWith("ws", "s1", "t9");
    expect(fx.run.mock.invocationCallOrder[0]!).toBeLessThan(fx.jump.mock.invocationCallOrder[0]!);
  });

  it("a plain open only jumps", async () => {
    await openTaskHit(hit);
    expect(fx.agentEffect).not.toHaveBeenCalled();
    expect(fx.jump).toHaveBeenCalledWith("ws", "s1", "t9");
  });
});
