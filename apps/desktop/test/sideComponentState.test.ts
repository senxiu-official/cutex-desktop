// Params / state of the migrated right-side components (modules/workspace, modules/diff,
// modules/subagents; RFC §4): what other modules may pass, dedupe keys, restore after a restart.
import { describe, expect, it, vi } from "vitest";
import { baseOf, initPreview, isSourceToggleable, parsePreviewParams, previewKey, restorePreview } from "../src/renderer/src/modules/workspace/previewState";
import { diffKey, diffLabel, diffName, initDiff, parseDiffParams, restoreDiff, turnTexts } from "../src/renderer/src/modules/diff/diffState";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

describe("workspace.preview", () => {
  it("accepts a path (+ line, host) and nothing else", () => {
    expect(parsePreviewParams({ path: "docs/DESIGN.md", line: 12 })).toEqual({ path: "docs/DESIGN.md", line: 12, host: false });
    expect(parsePreviewParams({ path: "/home/jy/r.md", host: true })).toEqual({ path: "/home/jy/r.md", line: null, host: true });
    expect(parsePreviewParams({ path: "a.ts", line: 0 })).toEqual({ path: "a.ts", line: null, host: false });
    expect(parsePreviewParams({ path: "a.ts", line: 1.5 })?.line).toBeNull();
    for (const bad of [null, "a.ts", [], {}, { path: "" }, { path: 3 }, { path: "x".repeat(4001) }]) expect(parsePreviewParams(bad as never)).toBeNull();
  });

  it("dedupes per path and source (workspace vs host)", () => {
    expect(previewKey({ path: "a.md", line: null, host: false })).toBe("ws:a.md");
    expect(previewKey({ path: "a.md", line: 3, host: true })).toBe("host:a.md");
  });

  it("a line anchor opens the source; otherwise reopening keeps the toggle", () => {
    expect(initPreview({ path: "a.md", line: 4, host: false }, null).source).toBe(true);
    expect(initPreview({ path: "a.md", line: null, host: false }, { path: "a.md", line: null, host: false, source: true }).source).toBe(true);
    expect(initPreview({ path: "a.md", line: null, host: false }, null).source).toBe(false);
  });

  it("restores v1 state, drops anything else", () => {
    expect(restorePreview({ path: "a.md", line: 2, host: false, source: true }, 1)).toEqual({ path: "a.md", line: 2, host: false, source: true });
    expect(restorePreview({ path: "a.md" }, 2)).toBeNull();
    expect(restorePreview({ nope: 1 }, 1)).toBeNull();
  });

  it("source toggle only for rendered kinds; base names on both separators", () => {
    expect(isSourceToggleable("README.MD")).toBe(true);
    expect(isSourceToggleable("x.svg")).toBe(true);
    expect(isSourceToggleable("x.ts")).toBe(false);
    expect(baseOf("C:\\Users\\a\\b.txt")).toBe("b.txt");
    expect(baseOf("docs/DESIGN.md")).toBe("DESIGN.md");
  });
});

describe("diff.view", () => {
  it("git and turn sources; anything else is refused", () => {
    expect(parseDiffParams({ source: "git", path: "a.ts" })).toEqual({ source: "git", path: "a.ts" });
    expect(parseDiffParams({ source: "git", path: "a.ts", staged: true })).toEqual({ source: "git", path: "a.ts", staged: true });
    expect(parseDiffParams({ source: "turn", sessionId: "s", turnId: "t", path: "a.ts", diff: "@@" })).toMatchObject({ source: "turn", turnId: "t" });
    for (const bad of [null, { source: "git" }, { source: "turn", sessionId: "s", turnId: "t", path: "a.ts" }, { source: "svn", path: "a" }]) expect(parseDiffParams(bad as never)).toBeNull();
  });

  it("keys: one per file (git) / per turn + file; the turn text stays in memory, never in state", () => {
    const p = parseDiffParams({ source: "turn", sessionId: "s", turnId: "t9", path: "src/a.ts", diff: "+x" })!;
    expect(diffKey(p)).toBe("turn:t9:src/a.ts");
    const state = initDiff(p);
    expect(state).toEqual({ source: "turn", sessionId: "s", turnId: "t9", path: "src/a.ts" });
    expect(JSON.stringify(state)).not.toContain("+x");
    expect(turnTexts.get("turn:t9:src/a.ts")).toBe("+x");
    expect(diffKey({ source: "git", path: "src/a.ts" })).toBe("git:src/a.ts");
  });

  it("a git diff comes back after a restart, a turn diff does not", () => {
    expect(restoreDiff({ source: "git", path: "a.ts", staged: false }, 1)).toEqual({ source: "git", path: "a.ts", staged: false });
    expect(restoreDiff({ source: "turn", sessionId: "s", turnId: "t", path: "a.ts" }, 1)).toBeNull();
    expect(restoreDiff({ source: "git", path: "a.ts" }, 2)).toBeNull();
    expect(diffName("apps\\desktop\\a.ts")).toBe("a.ts");
    expect(diffName("apps/desktop/a.ts")).toBe("a.ts");
  });

  it("v1.7 text source: the caller's diff, keyed by its key, memory only, gone after a restart", () => {
    const p = parseDiffParams({ source: "text", key: "af-1:2:4", title: "regression.md v2 → v4", diff: "-a\n+b" })!;
    expect(p).toEqual({ source: "text", key: "af-1:2:4", title: "regression.md v2 → v4", diff: "-a\n+b" });
    expect(diffKey(p)).toBe("text:af-1:2:4");
    const state = initDiff(p);
    expect(state).toEqual({ source: "text", key: "af-1:2:4", title: "regression.md v2 → v4" });
    expect(JSON.stringify(state)).not.toContain("+b");
    expect(turnTexts.get("text:af-1:2:4")).toBe("-a\n+b");
    expect(diffLabel(state)).toBe("regression.md v2 → v4");
    expect(restoreDiff({ source: "text", key: "af-1:2:4", title: "x" }, 1)).toBeNull();
    for (const bad of [{ source: "text", key: "", title: "t", diff: "" }, { source: "text", key: "k", title: "t" }, { source: "text", key: "k", diff: "" }]) expect(parseDiffParams(bad as never)).toBeNull();
  });
});

describe("subagents.thread", () => {
  it("takes a thread id; restores v1 only", async () => {
    const { parseThreadParams, restoreThread } = await import("../src/renderer/src/modules/subagents/threadState");
    expect(parseThreadParams({ threadId: "th-1" })).toEqual({ threadId: "th-1" });
    expect(parseThreadParams({ threadId: "" })).toBeNull();
    expect(parseThreadParams({ threadId: "x".repeat(201) })).toBeNull();
    expect(restoreThread({ threadId: "th-1" }, 1)).toEqual({ threadId: "th-1" });
    expect(restoreThread({ threadId: "th-1" }, 2)).toBeNull();
  });
});
