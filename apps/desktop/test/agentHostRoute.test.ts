import { describe, expect, it } from "vitest";
import { routeAgentHost } from "../src/renderer/src/lib/agentHostRoute";

const lists = (table: Record<string, boolean | null>) => (host: string) => table[host] ?? null;

describe("routeAgentHost", () => {
  it("keeps the preferred host when it lists the agent", () => {
    expect(routeAgentHost("local", ["local", "workstation"], lists({ local: true, workstation: true }))).toBe("local");
  });
  it("moves to the one other host of the scope that lists it (focus fallback of a timeline link)", () => {
    expect(routeAgentHost("local", ["local", "workstation"], lists({ local: false, workstation: true }))).toBe("workstation");
    // The preferred host's snapshot is not loaded yet: the listing host still wins.
    expect(routeAgentHost("local", ["local", "workstation"], lists({ local: null, workstation: true }))).toBe("workstation");
  });
  it("stays on the preferred host when nobody lists it (a just-created agent)", () => {
    expect(routeAgentHost("workstation", ["local", "workstation"], lists({ local: false, workstation: false }))).toBe("workstation");
    expect(routeAgentHost("workstation", ["local", "workstation"], lists({}))).toBe("workstation");
  });
  it("ignores hosts outside the candidates", () => {
    expect(routeAgentHost("local", ["local"], lists({ local: false, workstation: true }))).toBe("local");
  });
  it("several other hosts list it: the tie-break host (the open agent's) if among them, else the preferred", () => {
    const table = lists({ local: false, a: true, b: true });
    expect(routeAgentHost("local", ["local", "a", "b"], table, "b")).toBe("b");
    expect(routeAgentHost("local", ["local", "a", "b"], table)).toBe("local");
  });
});
