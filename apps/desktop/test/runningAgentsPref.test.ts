// 运行中智能体 default moved to "compact" rows (owner 2026-10-12): the old default migrates once (runningAgentsRev).
import { describe, expect, it } from "vitest";
import { DEFAULT_RUNNING_AGENTS, migrateRunningAgents, RUNNING_AGENTS, RUNNING_AGENTS_REV } from "../src/renderer/src/lib/runningAgentsPref";

describe("migrateRunningAgents", () => {
  it("missing / invalid → compact rows", () => {
    expect(DEFAULT_RUNNING_AGENTS).toBe("compact");
    expect(RUNNING_AGENTS).toEqual(["compact", "full", "avatars"]);
    expect(migrateRunningAgents(undefined, undefined)).toBe("compact");
    expect(migrateRunningAgents("bogus", RUNNING_AGENTS_REV)).toBe("compact");
  });

  it("the old default (avatars) saved before the rev switches once", () => {
    expect(migrateRunningAgents("avatars", undefined)).toBe("compact");
    expect(migrateRunningAgents("avatars", 0)).toBe("compact");
  });

  it("other choices are kept", () => {
    expect(migrateRunningAgents("full", undefined)).toBe("full");
    expect(migrateRunningAgents("compact", RUNNING_AGENTS_REV)).toBe("compact");
  });

  it("already migrated: a later avatars choice stays", () => {
    expect(migrateRunningAgents("avatars", RUNNING_AGENTS_REV)).toBe("avatars");
  });
});
