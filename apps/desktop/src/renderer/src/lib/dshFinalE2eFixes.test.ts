// r265 D6 (final real-daemon desktop E2E) fixes: a created / deleted file's tool row counts and shows
// its whole body (FileUpdateChange add / delete carry the content, not a unified diff); a DSH fork started from the
// chat shows its effort from the session defaults instead of 「…」.
import { describe, expect, it } from "vitest";
import { chatModelAndEffort } from "./dshModels";
import { diffCounts, toolOutput } from "./workGroups";

const path = "/ws/notes.txt";
const item = (changes: unknown[]) => ({ type: "fileChange", id: "f", status: "completed", changes });

describe("file change rows", () => {
  it("counts every line of a created file", () => {
    expect(diffCounts(item([{ path, kind: { type: "add" }, diff: "one\n" }]))).toEqual({ added: 1, removed: 0 });
    expect(diffCounts(item([{ path, kind: { type: "add" }, diff: "a\nb\n+c" }]))).toEqual({ added: 3, removed: 0 });
  });
  it("counts every line of a deleted file as removed", () => {
    expect(diffCounts(item([{ path, kind: { type: "delete" }, diff: "x\ny\n" }]))).toEqual({ added: 0, removed: 2 });
  });
  it("still counts an update's unified diff", () => {
    expect(diffCounts(item([{ path, kind: { type: "update", move_path: null }, diff: "@@\n-one\n+two\n" }]))).toEqual({ added: 1, removed: 1 });
    expect(diffCounts(item([{ path, kind: { type: "add" }, diff: "one\n" }, { path, kind: { type: "update" }, diff: "@@\n-one\n+two\n" }]))).toEqual({ added: 2, removed: 1 });
  });
  it("no diff → nothing to count", () => {
    expect(diffCounts(item([{ path, kind: { type: "add" } }]))).toBeNull();
  });
  it("shows a created file as an added diff and an update as before", () => {
    expect(toolOutput(item([{ path, kind: { type: "add" }, diff: "one\n" }]))).toBe(`--- /dev/null\n+++ ${path}\n@@ -0,0 +1,1 @@\n+one`);
    expect(toolOutput(item([{ path, kind: { type: "delete" }, diff: "x\n" }]))).toBe(`--- ${path}\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-x`);
    expect(toolOutput(item([{ path, kind: { type: "update" }, diff: "@@\n-one\n+two\n" }]))).toBe(`--- ${path}\n@@\n-one\n+two\n`);
  });
});

describe("chat model / effort", () => {
  const defaults = { model: "deepseek-v4-pro", reasoningEffort: "low" };
  it("live settings win", () => {
    expect(chatModelAndEffort({ model: "deepseek-flash", effort: "high" }, "dsh", defaults)).toEqual({ model: "deepseek-flash", effort: "high" });
  });
  it("DSH without live settings (a fork's runtime started after the chat opened): the session defaults", () => {
    expect(chatModelAndEffort(null, "dsh", defaults)).toEqual({ model: "deepseek-v4-pro", effort: "low" });
    expect(chatModelAndEffort({ model: "deepseek-v4-pro", effort: null }, "dsh", defaults)).toEqual({ model: "deepseek-v4-pro", effort: "low" });
    expect(chatModelAndEffort({ model: " ", effort: "" }, "dsh", { model: 3, reasoningEffort: null })).toEqual({ model: null, effort: null });
  });
  it("other runtimes keep the live settings only", () => {
    expect(chatModelAndEffort(null, "codex", defaults)).toEqual({ model: null, effort: null });
    expect(chatModelAndEffort({ model: "gpt-5.5", effort: "medium" }, "claude", defaults)).toEqual({ model: "gpt-5.5", effort: "medium" });
  });
});
