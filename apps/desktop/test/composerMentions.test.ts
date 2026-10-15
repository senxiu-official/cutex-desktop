import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidateIndex, composerCandidateKey, mentionPathsFor, startMentionSearch } from "../src/renderer/src/lib/composerMentions";
import { composerKeyAction } from "../src/renderer/src/lib/sendKeys";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("mention search lifetime", () => {
  it("keeps the new query's candidates when an old request resolves last", async () => {
    const old = deferred<string[]>();
    const current = deferred<string[]>();
    const publish = vi.fn();
    const cancelOld = startMentionSearch("a", () => old.promise, publish);
    await vi.advanceTimersByTimeAsync(120);
    cancelOld();
    const cancelCurrent = startMentionSearch("ab", () => current.promise, publish);
    await vi.advanceTimersByTimeAsync(120);
    current.resolve(["ab.ts"]);
    await vi.advanceTimersByTimeAsync(0);
    old.resolve(["a.ts"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledExactlyOnceWith({ query: "ab", paths: ["ab.ts"] });
    cancelCurrent();
  });

  it("ignores an old failure even when the composer returns to the same query", async () => {
    const old = deferred<string[]>();
    const publish = vi.fn();
    const cancelOld = startMentionSearch("a", () => old.promise, publish);
    await vi.advanceTimersByTimeAsync(120);
    cancelOld();
    const cancelCurrent = startMentionSearch("a", async () => ["new-a.ts"], publish);
    await vi.advanceTimersByTimeAsync(120);
    old.reject(new Error("old request failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledExactlyOnceWith({ query: "a", paths: ["new-a.ts"] });
    cancelCurrent();
  });

  it("cancels the debounce and does not publish after closing an in-flight search", async () => {
    const search = vi.fn(async () => ["file.ts"]);
    const publish = vi.fn();
    startMentionSearch("a", search, publish)();
    await vi.advanceTimersByTimeAsync(120);
    expect(search).not.toHaveBeenCalled();
    const pending = deferred<string[]>();
    const close = startMentionSearch("b", () => pending.promise, publish);
    await vi.advanceTimersByTimeAsync(120);
    close();
    pending.resolve(["b.ts"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hides a previous query's candidates immediately and handles a current failure", async () => {
    const results = { query: "a", paths: ["a.ts"] };
    expect(mentionPathsFor(results, "ab")).toEqual([]);
    expect(mentionPathsFor(results, null)).toEqual([]);
    expect(mentionPathsFor(results, "a")).toBe(results.paths);
    const publish = vi.fn();
    const cancel = startMentionSearch("ab", async () => { throw new Error("unavailable"); }, publish);
    await vi.advanceTimersByTimeAsync(120);
    expect(publish).toHaveBeenCalledExactlyOnceWith({ query: "ab", paths: [] });
    cancel();
  });
});

describe("composer candidate key routing", () => {
  const enter = { key: "Enter", shift: false, isComposing: false };

  it("picks a valid candidate after a shrinking list instead of swallowing Enter", () => {
    const paths = ["one.ts", "two.ts"];
    const decision = composerCandidateKey(enter, paths.length, 4);
    expect(candidateIndex(4, paths.length)).toBe(1);
    expect(decision).toEqual({ index: 1 });
    if (decision && decision !== "composing") expect(paths[decision.index]).toBe("two.ts");
    expect(composerCandidateKey({ ...enter, key: "Tab" }, 2, -1)).toEqual({ index: 0 });
  });

  it("leaves normal Enter and Shift+Enter routing unchanged when no candidate is available", () => {
    const context = { busy: true, hasContent: true, pendingSteers: 0, collapsedSelection: true };
    expect(composerCandidateKey(enter, 0, 4)).toBeNull();
    expect(composerKeyAction("queueFirst", { ...enter, ctrl: false }, context)).toBe("send");
    expect(composerKeyAction("cli", { ...enter, ctrl: false }, context)).toBe("steer");
    expect(composerCandidateKey({ ...enter, shift: true }, 2, 0)).toBeNull();
    expect(composerKeyAction("queueFirst", { ...enter, ctrl: false, shift: true }, context)).toBeNull();
  });

  it("keeps IME confirmation out of both candidate selection and send routing", () => {
    for (const count of [0, 2]) {
      expect(composerCandidateKey({ ...enter, isComposing: true }, count, 4)).toBe("composing");
    }
  });
});
