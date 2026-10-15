import { describe, expect, it } from "vitest";
import { buildLabel, cutexBuildText } from "../src/renderer/src/lib/settingsNav";
import { pinsFor, withPins } from "../src/renderer/src/lib/models";

describe("buildLabel", () => {
  it("short commit + minute-precision date", () => {
    expect(buildLabel({ commit: "c20812e4f00ba7", committedAt: "2026-10-07T12:20:31+11:00" })).toBe("c20812e · 2026-10-07 12:20");
    expect(buildLabel({ commit: "c20812e4f00ba7", committedAt: null })).toBe("c20812e");
    expect(buildLabel(null)).toBeNull();
  });
});

describe("cutexBuildText", () => {
  const text = { dev: "dev build", legacy: "older cutex" };
  const build = { version: "0.1.0", release: null, commit: null, builtAt: null, profile: "release", channel: "main" } as const;
  it("release · commit, commit only, dev build, older cutex", () => {
    expect(cutexBuildText({ ...build, release: "r224", commit: "5f30a7cad4dcd8435e" }, text)).toBe("r224 · 5f30a7c");
    expect(cutexBuildText({ ...build, commit: "5f30a7cad4dcd8435e" }, text)).toBe("5f30a7c");
    expect(cutexBuildText({ ...build, profile: "debug" }, text)).toBe("dev build");
    expect(cutexBuildText(undefined, text)).toBe("older cutex");
  });
  it("shows only a non-dev channel", () => {
    expect(cutexBuildText({ ...build, release: "r230", commit: "abcdef0123", channel: "release" }, text)).toBe("r230 · abcdef0 · release");
  });
});

describe("model pins per host", () => {
  it("keeps hosts apart", () => {
    let all = withPins({}, "local", "default", ["a"]);
    all = withPins(all, "workstation", "default", ["b"]);
    expect(pinsFor(all, "local", "default")).toEqual(["a"]);
    expect(pinsFor(all, "workstation", "default")).toEqual(["b"]);
    expect(pinsFor(all, "workstation", "other")).toBeUndefined();
  });
  it("ignores the old flat shape (profile → list)", () => {
    const old = { default: ["x"] } as unknown as Record<string, Record<string, string[]>>;
    expect(pinsFor(old, "default", "0")).toBeUndefined();
    expect(withPins(old, "local", "default", ["y"]).local).toEqual({ default: ["y"] });
  });
});
