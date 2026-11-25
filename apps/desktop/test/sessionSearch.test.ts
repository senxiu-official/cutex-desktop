// Sidebar session search (harness C3, cutex r295 session-search-v1): the query checked before it leaves main, the reply
// checked before the renderer sees it, the narrow IPC method (GET, background priority), and the mock host's paging.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CutexClient } from "@cutex-desktop/cutex-client";
import type { SessionResource } from "@cutex-desktop/protocol";
import { isCursorRejected, parseSessionSearchResponse, sessionSearchParams, SESSION_SEARCH_PATH, type SessionSearchResponse } from "../src/shared/sessionSearch";
import { sessionSearchApi } from "../src/main/sessionSearchApi";
import { mockCwdMatches, mockSessionSearch, type MockSearchTurn } from "../src/renderer/src/dev/mockSessionSearch";

/** A tasks page's rows (the reply type is a union by mode). */
const taskItems = (page: SessionSearchResponse) => (page.mode === "tasks" ? page.items : []);
const row = (over: Record<string, unknown> = {}) => ({ hostId: "HOST-A", cutexSessionId: "s1", displayName: "Eva", cwd: "D:\\Work", lifecycle: "active", updatedAt: "2026-11-25T00:00:00Z", ...over });
const task = (over: Record<string, unknown> = {}) => ({ ...row(), turnId: "t1", title: "Fix the queue", snippet: "…the queue flush…", turnStatus: "completed", ...over });

describe("sessionSearchParams", () => {
  it("sends only known, checked fields", () => {
    expect(sessionSearchParams({ mode: "sessions", cwd: " D:\\Work ", q: "  eva " })).toEqual({ mode: "sessions", cwd: "D:\\Work", q: "eva" });
    expect(sessionSearchParams({ mode: "tasks", q: "queue", lifecycle: "retired", sessionId: "s1", cursor: "abc" })).toEqual({ mode: "tasks", q: "queue", lifecycle: "retired", sessionId: "s1", cursor: "abc" });
    // `active` is the default: not sent (cutex refuses repeated / unknown parameters, not this, but the query stays minimal).
    expect(sessionSearchParams({ mode: "sessions", lifecycle: "active" })).toEqual({ mode: "sessions" });
    expect(Object.keys(sessionSearchParams({ mode: "sessions", extra: "x" } as never))).toEqual(["mode"]);
  });

  it("refuses what cutex would refuse", () => {
    expect(() => sessionSearchParams({ mode: "tasks" })).toThrow(/requires text/);
    expect(() => sessionSearchParams({ mode: "tasks", q: "   " })).toThrow(/requires text/);
    expect(() => sessionSearchParams({ mode: "sessions", q: "x".repeat(129) })).toThrow(/too long/);
    expect(sessionSearchParams({ mode: "sessions", q: "字".repeat(128) }).q).toHaveLength(128);
    expect(() => sessionSearchParams({ mode: "sessions", cwd: "D:\\a\nb" })).toThrow(/directory/);
    expect(() => sessionSearchParams({ mode: "sessions", cwd: "" })).toThrow(/directory/);
    expect(() => sessionSearchParams({ mode: "sessions", cursor: "" })).toThrow(/cursor/);
    expect(() => sessionSearchParams({ mode: "nope" } as never)).toThrow(/mode/);
    expect(() => sessionSearchParams({ mode: "sessions", lifecycle: "gone" } as never)).toThrow(/lifecycle/);
  });
});

describe("parseSessionSearchResponse", () => {
  it("keeps well-formed rows, drops malformed ones and clips text", () => {
    const page = parseSessionSearchResponse({ contractVersion: 2, hostId: "HOST-A", mode: "tasks", nextCursor: "c2", partial: true, items: [task(), task({ turnId: 3 }), task({ turnStatus: "inProgress" }), task({ snippet: "x".repeat(20_000) })] });
    expect(page.mode).toBe("tasks");
    expect(page.items).toHaveLength(2);
    expect(taskItems(page)[1]!.snippet).toHaveLength(16_384);
    expect(page).toMatchObject({ nextCursor: "c2", partial: true, hostId: "HOST-A" });
    const sessions = parseSessionSearchResponse({ contractVersion: 2, hostId: "h", mode: "sessions", nextCursor: null, partial: false, items: [row(), row({ lifecycle: "deleted" }), row({ cutexSessionId: "a\u0000b" })] });
    expect(sessions.items.map((r) => r.cutexSessionId)).toEqual(["s1"]);
  });

  it("throws on a malformed page", () => {
    const ok = { contractVersion: 2, hostId: "h", mode: "sessions", nextCursor: null, partial: false, items: [] };
    expect(() => parseSessionSearchResponse(null)).toThrow();
    expect(() => parseSessionSearchResponse({ ...ok, contractVersion: 1 })).toThrow();
    expect(() => parseSessionSearchResponse({ ...ok, mode: "other" })).toThrow(/mode/);
    expect(() => parseSessionSearchResponse({ ...ok, nextCursor: "" })).toThrow(/cursor/);
    expect(() => parseSessionSearchResponse({ ...ok, partial: "no" })).toThrow();
  });

  it("`more` is true exactly when there is a cursor; an empty page with more is kept open; a disagreeing reply is refused", () => {
    const base = { contractVersion: 2, hostId: "h", mode: "tasks", partial: false, items: [] };
    expect(parseSessionSearchResponse({ ...base, nextCursor: "c", more: true })).toMatchObject({ items: [], nextCursor: "c", more: true });
    expect(parseSessionSearchResponse({ ...base, nextCursor: null, more: false })).toMatchObject({ more: false });
    // Older pre-merge replies without the field: derived.
    expect(parseSessionSearchResponse({ ...base, nextCursor: "c" }).more).toBe(true);
    expect(() => parseSessionSearchResponse({ ...base, nextCursor: null, more: true })).toThrow(/more/);
    expect(() => parseSessionSearchResponse({ ...base, nextCursor: "c", more: false })).toThrow(/more/);
  });

  it("recognises a rejected cursor (restart from the first page)", () => {
    expect(isCursorRejected(new Error("invalid_request: search cursor belongs to another query"))).toBe(true);
    expect(isCursorRejected(new Error("400 invalid_request: search cursor is invalid or expired"))).toBe(true);
    expect(isCursorRejected(new Error("owner_required"))).toBe(false);
  });
});

describe("main: sessionSearch", () => {
  it("is a background GET of the checked query, and the reply is checked", async () => {
    const request = vi.fn(async () => ({ contractVersion: 2, hostId: "HOST-A", mode: "tasks", nextCursor: null, partial: false, items: [task(), { junk: true }] }));
    const api = sessionSearchApi({ request } as unknown as CutexClient);
    const page = await api.sessionSearch({ mode: "tasks", q: " queue ", cwd: "D:\\Work" });
    expect(request).toHaveBeenCalledWith("GET", SESSION_SEARCH_PATH, { query: { mode: "tasks", q: "queue", cwd: "D:\\Work" }, background: true });
    expect(page.items).toHaveLength(1);
    await expect(api.sessionSearch({ mode: "tasks" })).rejects.toThrow(/requires text/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("is on the main and preload allow lists, nothing broader", () => {
    for (const file of ["../src/main/index.ts", "../src/preload/index.ts"]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(text).toMatch(/"sideClose",\n\s+"sessionSearch",/);
    }
  });
});

describe("mock host search", () => {
  it("matches a directory lexically on component boundaries (Windows case-insensitive)", () => {
    expect(mockCwdMatches("D:\\Research\\demo", "D:\\Research")).toBe(true);
    expect(mockCwdMatches("d:\\research\\demo\\sub", "D:\\Research\\Demo\\")).toBe(true);
    expect(mockCwdMatches("D:\\Research2", "D:\\Research")).toBe(false);
    expect(mockCwdMatches("/home/alex/projects", "/home/alex")).toBe(true);
    expect(mockCwdMatches("/home/Alex", "/home/alex")).toBe(false);
    expect(mockCwdMatches("/home/alexander", "/home/alex")).toBe(false);
  });

  const sessions = Array.from({ length: 3 }, (_, i) => ({ cutexSessionId: `s${i}`, displayName: `Agent ${i}`, cwd: i === 2 ? "/elsewhere" : "/work", lifecycle: "active", updatedAt: "2026-11-25T00:00:00Z" }) as unknown as SessionResource);
  const turns = (id: string): MockSearchTurn[] | null => (id === "s1" ? null : Array.from({ length: 14 }, (_, i) => ({ id: `${id}-t${i}`, status: "completed", items: [{ type: "userMessage", content: [{ type: "text", text: i % 2 ? "flush the queue" : "other" }] }, { type: "agentMessage", text: "done" }] })));
  const host = { name: "HOST-A", sessions: () => sessions, turns, delayMs: 0 };

  it("pages tasks per session, 12 turns at a time, newest first; partial when history is missing", async () => {
    const first = await mockSessionSearch(host, { mode: "tasks", q: "QUEUE", cwd: "/work" });
    expect(taskItems(first).map((t) => t.turnId)).toEqual(["s0-t13", "s0-t11", "s0-t9", "s0-t7", "s0-t5", "s0-t3"]);
    const second = await mockSessionSearch(host, { mode: "tasks", q: "QUEUE", cwd: "/work", cursor: first.nextCursor! });
    expect(taskItems(second).map((t) => t.turnId)).toEqual(["s0-t1"]);
    const third = await mockSessionSearch(host, { mode: "tasks", q: "QUEUE", cwd: "/work", cursor: second.nextCursor! });
    expect(third).toMatchObject({ items: [], partial: true, nextCursor: null });
    // A cursor of another query is refused like cutex does.
    await expect(mockSessionSearch(host, { mode: "tasks", q: "other", cursor: first.nextCursor! })).rejects.toThrow(/search cursor/);
  });

  it("lists sessions under a directory", async () => {
    const page = await mockSessionSearch(host, { mode: "sessions", cwd: "/work" });
    expect(page.items.map((r) => r.cutexSessionId)).toEqual(["s0", "s1"]);
    expect(page.nextCursor).toBeNull();
  });
});
