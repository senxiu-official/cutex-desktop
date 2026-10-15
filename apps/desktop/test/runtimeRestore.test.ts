// Restore after an unclean stop (cutex runtime-restore-candidates): sequential per-agent starts with
// failures reported per agent, the owner's selection, and the client routes.
import { describe, expect, it, vi } from "vitest";
import { chosenCandidates, restoreSequentially } from "../src/renderer/src/lib/runtimeRestore";
import type { RestoreCandidate } from "../src/shared/runtimeRestore";

const item = (id: string, name: string): RestoreCandidate => ({ cutexSessionId: id, displayName: name, lastOnlineAt: "2026-10-13T01:00:00Z" });
const ITEMS = [item("cutex.a", "Eva"), item("cutex.b", "Rei"), item("cutex.c", "Mika")];

describe("restoreSequentially", () => {
  it("starts one agent at a time in list order and reports each failure", async () => {
    let running = 0;
    const order: string[] = [];
    const start = vi.fn(async (id: string) => {
      running += 1;
      expect(running).toBe(1);
      order.push(id);
      await new Promise((r) => setTimeout(r, 1));
      running -= 1;
      if (id === "cutex.b") throw new Error("runtime_start_failed: readiness failed: unreadable external input history");
    });
    const progress: Array<[number, number]> = [];
    const outcomes = await restoreSequentially(ITEMS, start, (done, total) => progress.push([done, total]));
    expect(order).toEqual(["cutex.a", "cutex.b", "cutex.c"]);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(outcomes.map((o) => [o.displayName, o.error === null])).toEqual([["Eva", true], ["Rei", false], ["Mika", true]]);
    expect(outcomes[1]!.error).toContain("unreadable external input history");
  });

  it("keeps cutex refusal objects readable", async () => {
    const [outcome] = await restoreSequentially([ITEMS[0]!], async () => {
      throw { code: "launch_in_progress", message: "agent has a live launch" };
    });
    expect(outcome!.error).toBe("agent has a live launch");
  });
});

describe("chosenCandidates", () => {
  it("keeps list order and ignores unknown ids", () => {
    expect(chosenCandidates(ITEMS, new Set(["cutex.c", "cutex.a", "cutex.x"])).map((i) => i.displayName)).toEqual(["Eva", "Mika"]);
    expect(chosenCandidates(ITEMS, new Set())).toEqual([]);
  });
});
