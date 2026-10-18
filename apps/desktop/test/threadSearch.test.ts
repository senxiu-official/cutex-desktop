import { describe, expect, it, vi } from "vitest";
import { searchErrorKind, searchTerm, splitSnippet, THREAD_SEARCH_CAPABILITY } from "../src/renderer/src/modules/thread-search/model";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const { default: threadSearch } = await import("../src/renderer/src/modules/thread-search");
import { mock } from "../src/renderer/src/modules/thread-search/mock";
import { en } from "../src/renderer/src/i18n/en";
import { enAU } from "../src/renderer/src/i18n/en-AU";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";

describe("conversation search (thread/searchOccurrences)", () => {
  it("splits a snippet at its UTF-16 match range, clamped", () => {
    expect(splitSnippet({ snippet: "…the deploy failed", snippetMatchRange: { start: 5, end: 11 } })).toEqual({ before: "…the ", match: "deploy", after: " failed" });
    // Astral characters count as two UTF-16 units, like the native range.
    expect(splitSnippet({ snippet: "😀 部署失败", snippetMatchRange: { start: 3, end: 5 } }).match).toBe("部署");
    expect(splitSnippet({ snippet: "abc", snippetMatchRange: { start: 2, end: 99 } })).toEqual({ before: "ab", match: "c", after: "" });
    expect(splitSnippet({ snippet: "abc", snippetMatchRange: { start: -4, end: 1 } }).match).toBe("a");
  });

  it("explains failures: offline, unsupported runtime, anything else", () => {
    expect(searchErrorKind(new Error("session_offline: the cutex session has no connected app-server"))).toBe("offline");
    expect(searchErrorKind(new Error("CutexApiError native_-32601: Method not found"))).toBe("unsupported");
    expect(searchErrorKind(new Error("native_-32600: Invalid request: unknown variant `thread/searchOccurrences`"))).toBe("unsupported");
    expect(searchErrorKind(new Error("native_method_denied"))).toBe("unsupported");
    expect(searchErrorKind(new Error("boom"))).toBe("other");
  });

  it("trims the term and searches nothing for blank input", () => {
    expect(searchTerm("  deploy ")).toBe("deploy");
    expect(searchTerm("   ")).toBeNull();
    expect(searchTerm("x".repeat(3000))!.length).toBe(2048);
  });

  it("needs cutex thread-search-occurrences and hides for Claude adapters without threadSearch", () => {
    expect(threadSearch.requires?.capabilities).toEqual([THREAD_SEARCH_CAPABILITY]);
    const gutter = threadSearch.contributes?.["conversation.gutter"]?.[0];
    expect(gutter?.agentFeature).toBe("threadSearch");
    expect(gutter?.anchor).toBe("top");
  });

  it("mock: finds user and final assistant text, pages by 50", async () => {
    const turns = [{ id: "t1", items: [
      { type: "userMessage", id: "u1", content: [{ type: "text", text: "Please deploy it" }] },
      { type: "commandExecution", id: "c1", aggregatedOutput: "deploy log" },
      { type: "agentMessage", id: "a1", text: "Deployed. The DEPLOY step passed." },
    ] }];
    const api = mock.api!({ threadRead: () => ({ thread: { id: "t", turns } }) } as never);
    const page = await api.searchThread!("s", "t", "deploy", null);
    expect(page.data.map((h) => h.itemId)).toEqual(["u1", "a1", "a1"]);
    expect(page.nextCursor).toBeNull();
    expect(splitSnippet(page.data[2]!).match).toBe("DEPLOY");
  });

  it("is translated", () => {
    for (const key of ["thread-search.title", "thread-search.unsupported", "subagents.claude.open", "subagents.claude.readOnly"] as const) {
      for (const dict of [zhCN, zhHantCN, en, enAU]) expect(dict[key]).toBeTruthy();
    }
  });
});
