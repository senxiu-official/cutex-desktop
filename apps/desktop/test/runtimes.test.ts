import { describe, expect, it } from "vitest";
import { adaptRuntimes, selectedRuntime } from "../src/shared/runtimes";

describe("adaptRuntimes (GET /v2/runtimes, assumed shape)", () => {
  it("normalises entries, sorts releases newest first and agents by name", () => {
    const view = adaptRuntimes({
      hostId: "h",
      native: [
        { release: "r48", version: "0.160.0-r48", agents: [{ cutexSessionId: "cutex.b", name: "Zed" }, { cutexSessionId: "cutex.a", name: "Amy" }] },
        { release: "r50", version: "0.160.0-r50", selected: true, agentCount: 5, agents: [{ cutexSessionId: "cutex.c" }] },
        { release: "r9" },
      ],
      claude: [{ release: "claude-r4" }, { release: "claude-r5", selected: true }],
    })!;
    expect(view.native.map((r) => r.release)).toEqual(["r50", "r48", "r9"]);
    expect(view.native[0]).toMatchObject({ selected: true, agentCount: 5, agents: [{ id: "cutex.c", name: "cutex.c" }] });
    expect(view.native[1]!.agents.map((a) => a.name)).toEqual(["Amy", "Zed"]);
    expect(view.native[1]!.agentCount).toBe(2);
    expect(view.native[2]).toMatchObject({ version: null, path: null, selected: false, missing: false, agentCount: 0, agents: [] });
    expect(selectedRuntime(view.claude)?.release).toBe("claude-r5");
    expect(view.claude.map((r) => r.release)).toEqual(["claude-r5", "claude-r4"]);
  });

  it("drops malformed entries / agents and tolerates missing lists", () => {
    const view = adaptRuntimes({ native: [null, { version: "x" }, { release: "r50", agents: [null, { name: "no id" }], agentCount: -1 }] })!;
    expect(view.native).toEqual([{ release: "r50", version: null, path: null, selected: false, missing: false, agentCount: 0, agents: [] }]);
    expect(view.claude).toEqual([]);
    expect(adaptRuntimes(null)).toBeNull();
    expect(adaptRuntimes("nope")).toBeNull();
    expect(selectedRuntime([])).toBeNull();
  });
});
