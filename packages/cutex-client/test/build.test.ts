import { describe, expect, it } from "vitest";
import { cutexBuildChannelTag, cutexBuildLabel, readCutexBuild, type CutexBuild } from "../src/index";

const SHA = "5f30a7cad4dcd8435e797592a380349df509e35d";
const build = (over: Partial<CutexBuild> = {}): CutexBuild => ({ version: "0.1.0", release: null, commit: null, builtAt: null, profile: "release", channel: "main", ...over });

describe("cutex build info", () => {
  it("reads cutexBuild and tolerates its absence", () => {
    expect(readCutexBuild({ cutexBuild: { version: "0.1.0", release: "r224", commit: SHA, builtAt: null, profile: "release", channel: "dev" } })).toEqual(build({ release: "r224", commit: SHA }));
    expect(readCutexBuild({ cutexBuild: { version: "0.1.0", release: "", profile: "debug", channel: "stable" } })).toEqual(build({ profile: "debug", channel: "release" }));
    // cutex backend-upgrade names: release / main.
    expect(readCutexBuild({ cutexBuild: { version: "0.1.0", channel: "release" } })?.channel).toBe("release");
    expect(readCutexBuild({ cutexBuild: { version: "0.1.0", channel: "main" } })?.channel).toBe("main");
    expect(readCutexBuild({ cutexVersion: "0.1.0" })).toBeNull();
    expect(readCutexBuild(null)).toBeNull();
  });

  it("labels release and commit like the desktop row", () => {
    expect(cutexBuildLabel(build({ release: "r224", commit: SHA }))).toBe("r224 · 5f30a7c");
    expect(cutexBuildLabel(build({ commit: SHA }))).toBe("5f30a7c");
    expect(cutexBuildLabel(build({ release: "r224" }))).toBe("r224");
    expect(cutexBuildLabel(build({ release: "r224", commit: SHA, builtAt: "2026-10-11T09:30:00Z" }))).toBe("r224 · 5f30a7c · 2026-10-11 09:30");
    expect(cutexBuildLabel(build())).toBeNull();
    expect(cutexBuildLabel(null)).toBeNull();
  });

  it("tags only the release channel", () => {
    expect(cutexBuildChannelTag(build())).toBeNull();
    expect(cutexBuildChannelTag(build({ channel: "release" }))).toBe("release");
  });
});
