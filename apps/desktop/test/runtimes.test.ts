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
    expect(view.native[2]).toMatchObject({ version: null, sha256Prefix: null, path: null, selected: false, missing: false, agentCount: 0, agents: [] });
    expect(selectedRuntime(view.claude)?.release).toBe("claude-r5");
    expect(view.claude.map((r) => r.release)).toEqual(["claude-r5", "claude-r4"]);
  });

  it("drops malformed entries / agents and tolerates missing lists", () => {
    const view = adaptRuntimes({ native: [null, { version: "x" }, { release: "r50", agents: [null, { name: "no id" }], agentCount: -1 }] })!;
    expect(view.native).toEqual([{ release: "r50", version: null, sha256Prefix: null, path: null, selected: false, missing: false, agentCount: 0, agents: [] }]);
    expect(view.claude).toEqual([]);
    expect(adaptRuntimes(null)).toBeNull();
    expect(adaptRuntimes("nope")).toBeNull();
    expect(selectedRuntime([])).toBeNull();
  });
});

it("preserves SHA-only native entries without registry version metadata", () => {
  const view = adaptRuntimes({native: [
    {release: "sha256-abc123def456", sha256Prefix: "abc123def456", selected: true},
    {release: "r52", version: "0.160.0-r52.4", sha256Prefix: "def456abc123"},
    {release: "malformed-sha", sha256Prefix: 123},
  ]})!;
  expect(selectedRuntime(view.native)).toMatchObject({version: null, sha256Prefix: "abc123def456"});
  expect(view.native.find(r => r.release === "r52")).toMatchObject({version: "0.160.0-r52.4", sha256Prefix: "def456abc123"});
  expect(view.native.find(r => r.release === "malformed-sha")?.sha256Prefix).toBeNull();
  expect(adaptRuntimes({})).toEqual({native: [], claude: []});
});
