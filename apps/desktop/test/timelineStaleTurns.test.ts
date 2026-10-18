import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { applyEvent, settleStaleTurns, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { toolLiveness } from "../src/renderer/src/lib/workGroups";

function native(method: string, params: unknown): EventEnvelope {
  return {
    contractVersion: 2,
    eventId: "e",
    cursor: "c",
    streamId: "s",
    sequence: 1,
    receivedAt: "",
    cutexSessionId: "me",
    hostId: "h",
    source: "app_server",
    sensitivity: "owner",
    correlation: {},
    native: { kind: "notification", message: { method, params } },
  };
}

const tool = { type: "commandExecution", id: "cmd-1", command: "sleep 600", status: "inProgress" };

/** A Claude turn running a tool, whose runtime is then restarted (重启运行时) without a turn/completed. */
function runningTool() {
  const state = timelineFromThreadRead({ thread: { id: "th", turns: [] } });
  applyEvent(state, native("turn/started", { threadId: "th", turn: { id: "t1", status: "inProgress", items: [] } }));
  applyEvent(state, native("item/started", { threadId: "th", turnId: "t1", item: { type: "agentMessage", id: "a1", text: "" } }));
  applyEvent(state, native("item/agentMessage/delta", { threadId: "th", turnId: "t1", itemId: "a1", delta: "running it" }));
  applyEvent(state, native("item/started", { threadId: "th", turnId: "t1", item: tool }));
  return state;
}

const turn = (state: ReturnType<typeof runningTool>, id: string) => state.turns.find((t) => t.id === id)!;
const liveness = (state: ReturnType<typeof runningTool>, id: string) => {
  const entry = state.entries.get(id)!;
  if (entry.kind !== "tool") throw new Error("not a tool row");
  return toolLiveness(entry.item, turn(state, entry.turnId).status === "inProgress", []);
};

describe("turns cut off by a runtime restart", () => {
  it("a later turn settles the earlier still-running turn as interrupted, its tool no longer spins", () => {
    const state = runningTool();
    expect(liveness(state, "cmd-1")).toBe("running");
    applyEvent(state, native("turn/started", { threadId: "th", turn: { id: "t2", status: "inProgress", items: [] } }));
    expect(turn(state, "t1").status).toBe("interrupted");
    expect(turn(state, "t1").completedAt).not.toBeNull();
    expect(turn(state, "t2").status).toBe("inProgress");
    expect(state.activeTurnId).toBe("t2");
    expect(liveness(state, "cmd-1")).toBe("interrupted");
    const agent = state.entries.get("a1");
    expect(agent?.kind === "agent" && agent.streaming).toBe(false);
    // Items of the new turn run normally.
    applyEvent(state, native("item/started", { threadId: "th", turnId: "t2", item: { ...tool, id: "cmd-2" } }));
    expect(liveness(state, "cmd-2")).toBe("running");
  });

  it("a turn/completed that arrives after all the same wins", () => {
    const state = runningTool();
    expect(settleStaleTurns(state, null)).toBe(true);
    expect(turn(state, "t1").status).toBe("interrupted");
    expect(settleStaleTurns(state, null)).toBe(false);
    applyEvent(state, native("turn/completed", { threadId: "th", turn: { id: "t1", status: "failed", error: { message: "boom" } } }));
    expect(turn(state, "t1").status).toBe("failed");
  });

  it("thread/read: only the newest turn of a live runtime may still run; offline history none", () => {
    const read = {
      thread: {
        id: "th",
        turns: [
          { id: "old", status: "inProgress", items: [tool] },
          { id: "new", status: "inProgress", items: [] },
        ],
      },
    };
    const live = timelineFromThreadRead(read);
    expect(live.turns.map((t) => t.status)).toEqual(["interrupted", "inProgress"]);
    expect(live.activeTurnId).toBe("new");
    const offline = timelineFromThreadRead(read, [], { runtimeLive: false });
    expect(offline.turns.map((t) => t.status)).toEqual(["interrupted", "interrupted"]);
    expect(offline.activeTurnId).toBeNull();
    expect(liveness(offline, "cmd-1")).toBe("interrupted");
  });
});
