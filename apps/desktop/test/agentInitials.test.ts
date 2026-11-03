// Avatar initials skip the project's shared prefix and revision suffixes (owner 2026-10-12); two letters since 2026-11-01.
import { describe, expect, it } from "vitest";
import { commonDashPrefix, initialCandidates, initialOf, initialStem, listInitials, projectInitials, twoLetterInitials } from "../src/renderer/src/lib/agentInitials";

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
    expect(names.map((n) => out.get(n))).toEqual(["Ce", "GR", "CW", "Da"]);
  });

  it("a project slug alone (one member) still strips", () => {
    expect(projectInitials(["demo-director-r2"], ["demo"]).get("demo-director-r2")).toBe("Di");
  });

  it("names without a shared prefix keep their first letters", () => {
    const out = projectInitials(["alice", "bob-r1"]);
    expect([out.get("alice"), out.get("bob-r1")]).toEqual(["Al", "Bo"]);
  });
});

describe("two-letter initials (owner 2026-11-01)", () => {
  it("one word: first two letters, first upper, second lower", () => {
    expect(twoLetterInitials("Pipit")).toBe("Pi");
    expect(twoLetterInitials("moth")).toBe("Mo");
    expect(twoLetterInitials("CEO")).toBe("Ce");
    expect(twoLetterInitials("x")).toBe("X");
  });

  it("several parts: initials of the first and the last part", () => {
    expect(twoLetterInitials("review-insert-sol")).toBe("RS");
    expect(twoLetterInitials("review-insert-opus")).toBe("RO");
    expect(twoLetterInitials("ui-lead")).toBe("UL");
    expect(twoLetterInitials("ui_lead")).toBe("UL");
    expect(twoLetterInitials("ui lead")).toBe("UL");
    expect(twoLetterInitials("uiLead")).toBe("UL");
    expect(twoLetterInitials("next.strip")).toBe("NS");
  });

  it("CJK: one character; CJK parts after a Latin start are skipped", () => {
    expect(twoLetterInitials("研究员")).toBe("研");
    expect(twoLetterInitials("小侦探")).toBe("小");
    expect(twoLetterInitials("ハル")).toBe("ハ");
    expect(twoLetterInitials("Rust 生命周期报错")).toBe("Ru");
  });

  it("digits and emoji", () => {
    expect(twoLetterInitials("2026")).toBe("20");
    expect(twoLetterInitials("agent-7")).toBe("A7");
    expect(twoLetterInitials("🦊")).toBe("🦊");
    expect(twoLetterInitials("🦊 fox")).toBe("Fo");
    expect(twoLetterInitials("")).toBe("?");
  });

  it("the owner's sidebar: Pi, Mo, RS, RO, Wr, UL", () => {
    const out = listInitials(["Pipit", "Moth", "review-insert-sol", "review-insert-opus", "Wren", "ui-lead"].map((name) => ({ key: name, name })), [], false);
    expect([...out.values()].sort()).toEqual(["Mo", "Pi", "RO", "RS", "UL", "Wr"]);
  });

  it("a clash in one list: the later agent takes its next candidate; the earlier one keeps its letters", () => {
    const a = { key: "a", name: "Pipit", order: "2026-10-01" };
    const b = { key: "b", name: "Pixel", order: "2026-10-20" };
    expect(Object.fromEntries(listInitials([b, a]))).toEqual({ a: "Pi", b: "Px" });
    // Adding a newer clash never changes the older ones.
    const c = { key: "c", name: "Pixie", order: "2026-10-30" };
    const three = listInitials([c, b, a]);
    expect([three.get("a"), three.get("b")]).toEqual(["Pi", "Px"]);
    expect(["Pi", "Px"]).not.toContain(three.get("c"));
    // Parts: the first initial with another part's, then letters.
    const parts = listInitials([{ key: "x", name: "review-sol", order: "1" }, { key: "y", name: "rust-sol", order: "2" }]);
    expect(parts.get("x")).toBe("RS");
    expect(parts.get("y")).not.toBe("RS");
    // CJK: the next character.
    const cjk = listInitials([{ key: "p", name: "小侦探", order: "1" }, { key: "q", name: "小助手", order: "2" }]);
    expect([cjk.get("p"), cjk.get("q")]).toEqual(["小", "助"]);
    // Same name twice, no order: by key, deterministic.
    expect(Object.fromEntries(listInitials([{ key: "2", name: "Moth" }, { key: "1", name: "Moth" }]))).toEqual({ "1": "Mo", "2": "Mt" });
  });

  it("candidates run out → the plain initials", () => {
    expect(initialCandidates("Ab")).toEqual(["Ab"]);
    expect(Object.fromEntries(listInitials([{ key: "1", name: "Ab" }, { key: "2", name: "ab" }]))).toEqual({ "1": "Ab", "2": "Ab" });
  });
});
