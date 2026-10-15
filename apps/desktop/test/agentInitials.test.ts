// Avatar initials skip the project's shared prefix and revision suffixes (owner 2026-10-12).
import { describe, expect, it } from "vitest";
import { commonDashPrefix, initialOf, initialStem, projectInitials } from "../src/renderer/src/lib/agentInitials";

describe("commonDashPrefix", () => {
  it("longest shared prefix ending at a separator", () => {
    expect(commonDashPrefix(["proj-ceo-r1", "proj-gpt-research-r1", "proj-pm"])).toBe("proj-");
    expect(commonDashPrefix(["proj-gpt-a", "proj-gpt-b"])).toBe("proj-gpt-");
    expect(commonDashPrefix(["PROJ-ceo", "proj-pm"])).toBe("proj-");
  });

  it("nothing shared / one name → none", () => {
    expect(commonDashPrefix(["alpha", "beta"])).toBe("");
    expect(commonDashPrefix(["vector", "proj-a"])).toBe("");
    expect(commonDashPrefix(["proj-ceo-r1"])).toBe("");
    expect(commonDashPrefix([])).toBe("");
  });
});

describe("initialStem / initialOf", () => {
  it("strips the slug or prefix and revision suffixes", () => {
    expect(initialStem("proj-ceo-r1", "proj-")).toBe("ceo");
    expect(initialStem("demo-director-r2", "", ["demo"])).toBe("director");
    expect(initialStem("worker-v3-r2")).toBe("worker");
    expect(initialStem("Demo2026-writer", "", ["demo2026"])).toBe("writer");
  });

  it("the longer of slug and shared prefix wins", () => {
    expect(initialStem("proj-gpt-a", "proj-gpt-", ["vec"])).toBe("a");
  });

  it("falls back to the whole name when nothing would be left", () => {
    expect(initialStem("proj-", "proj-")).toBe("proj-");
    expect(initialStem("r1")).toBe("r1");
    expect(initialStem("proj-r1", "proj-")).toBe("r1");
  });

  it("first letter upper-cased; CJK: first character", () => {
    expect(initialOf("ceo")).toBe("C");
    expect(initialOf("研究员")).toBe("研");
    expect(initialOf("_x")).toBe("X");
    expect(initialOf("")).toBe("?");
  });
});

describe("projectInitials", () => {
  it("DEMO2026: no longer every avatar a V", () => {
    const names = ["proj-ceo-r1", "proj-gpt-research-r1", "proj-claude-writer-r2", "proj-data-v2"];
    const out = projectInitials(names, ["demo2026", "DEMO2026"]);
    expect(names.map((n) => out.get(n))).toEqual(["C", "G", "C", "D"]);
  });

  it("a project slug alone (one member) still strips", () => {
    expect(projectInitials(["demo-director-r2"], ["demo"]).get("demo-director-r2")).toBe("D");
  });

  it("names without a shared prefix keep their first letter", () => {
    const out = projectInitials(["alice", "bob-r1"]);
    expect([out.get("alice"), out.get("bob-r1")]).toEqual(["A", "B"]);
  });
});
