import { describe, expect, it } from "vitest";
import { agentAlias, agentMatches, realAgentName, realNameTip } from "../src/renderer/src/lib/agentAlias";

const agent = { cutexSessionId: "cutex.1", displayName: "小侦探", formalAgentName: "demo-analysis-public-r1", displayNameOverride: "小侦探", threadName: null };
const plain = { cutexSessionId: "cutex.2", displayName: "demo-director-r2", formalAgentName: "demo-director-r2", displayNameOverride: null, threadName: null };

describe("agent alias (displayNameOverride)", () => {
  it("separates the shown alias from the real name", () => {
    expect(realAgentName(agent)).toBe("demo-analysis-public-r1");
    expect(agentAlias(agent)).toBe("小侦探");
    expect(realNameTip(agent)).toBe("demo-analysis-public-r1");
    expect(realAgentName(plain)).toBe("demo-director-r2");
    expect(agentAlias(plain)).toBeNull();
    expect(realNameTip(plain)).toBeNull();
  });

  it("falls back to the thread name / id when there is no formal name", () => {
    expect(realAgentName({ ...agent, formalAgentName: null, threadName: "fix the build" })).toBe("fix the build");
    expect(realAgentName({ ...agent, formalAgentName: null })).toBe("cutex.1");
  });

  it("an alias equal to the real name is no alias", () => {
    expect(agentAlias({ ...plain, displayNameOverride: "demo-director-r2" })).toBeNull();
  });

  it("search matches the alias, the real name, the note and the exact id", () => {
    expect(agentMatches(agent, agent.displayName, "侦探")).toBe(true);
    expect(agentMatches(agent, agent.displayName, "public-r1")).toBe(true);
    expect(agentMatches({ ...agent, note: "Owns the analysis" }, agent.displayName, "analysis")).toBe(true);
    expect(agentMatches(agent, agent.displayName, "cutex.1")).toBe(true);
    expect(agentMatches(agent, agent.displayName, "cutex")).toBe(false);
    expect(agentMatches(agent, agent.displayName, "")).toBe(true);
  });
});
