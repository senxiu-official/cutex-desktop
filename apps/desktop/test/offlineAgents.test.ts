import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { archivedOf, defaultAgentListTab, filterSortAgents, modelOf, rangeIds, runLimited, runtimeOf, selectionState, selectRange, tabActions, tabRows } from "../src/renderer/src/lib/agentList";
import { lastSeen, migrateOfflineLimit, offlineSlice } from "../src/renderer/src/lib/offlineAgents";
import type { AgentRow } from "../src/renderer/src/lib/sidebar";

function row(id: string, lastActivity: number, over: { name?: string; note?: string; pinned?: boolean; createdAt?: string; session?: Partial<SessionResource> } = {}): AgentRow {
  const session = {
    cutexSessionId: id,
    displayName: over.name ?? id,
    note: over.note ?? null,
    profile: "omega",
    configuredProfile: "omega",
    launchedProfile: null,
    effectiveNextLaunch: { profile: "omega", source: "session_configured" },
    native: { threadId: null, schema: null },
    runtime: { backend: "host", status: "offline", threadSettings: null },
    runtimeDefaults: null,
    createdAt: over.createdAt ?? null,
    ...over.session,
  } as unknown as SessionResource;
  return { id, name: over.name ?? id, subtitle: "", status: "offline", isDirector: false, pinned: over.pinned ?? false, lastActivity, profile: "omega", color: null, session };
}

describe("offline limit pref", () => {
  it("migrates the old display modes", () => {
    expect(migrateOfflineLimit("list")).toBe("all");
    expect(migrateOfflineLimit("avatars")).toBe(5);
    expect(migrateOfflineLimit("folded")).toBe(5);
    expect(migrateOfflineLimit(undefined)).toBe(5);
    expect(migrateOfflineLimit(7)).toBe(5);
  });
  it("keeps valid limits", () => {
    for (const v of [0, 3, 5, 10, "all"] as const) expect(migrateOfflineLimit(v)).toBe(v);
  });
});

describe("offlineSlice", () => {
  const rows = [row("a", 10), row("b", 50), row("c", 30), row("d", 40), row("e", 20)];
  const last = (r: AgentRow) => r.lastActivity;
  it("lists the newest K first and counts the rest", () => {
    const { shown, hidden } = offlineSlice(rows, 3, last);
    expect(shown.map((r) => r.id)).toEqual(["b", "d", "c"]);
    expect(hidden).toBe(2);
  });
  it("keeps a pinned / open row beyond K, in recency order", () => {
    const { shown, hidden } = offlineSlice(rows, 3, last, { keep: (r) => r.id === "a" });
    expect(shown.map((r) => r.id)).toEqual(["b", "d", "c", "a"]);
    expect(hidden).toBe(1);
  });
  it("lists nothing at 0 and everything for all / while searching", () => {
    expect(offlineSlice(rows, 0, last)).toEqual({ shown: [], hidden: 5 });
    expect(offlineSlice(rows, "all", last).hidden).toBe(0);
    expect(offlineSlice(rows, 3, last, { searching: true }).shown).toHaveLength(5);
  });
  it("uses a newer activity preview as last seen", () => {
    expect(lastSeen(row("x", 100), 250)).toBe(250);
    expect(lastSeen(row("x", 100))).toBe(100);
  });
});

describe("agent list", () => {
  const rows = [
    row("r1", 30, { name: "AUTO_lint", note: "nightly cargo test", createdAt: "2026-10-01T00:00:00Z" }),
    row("r2", 10, { name: "aria", createdAt: "2026-10-05T00:00:00Z", session: { runtime: { backend: "claude_subscription", status: "offline" } as SessionResource["runtime"] } }),
    row("r3", 20, { name: "atlas", createdAt: "2026-09-01T00:00:00Z" }),
  ];
  const last = (r: AgentRow) => r.lastActivity;
  it("searches name and note, filters by runtime, sorts", () => {
    expect(filterSortAgents(rows, { query: "NIGHTLY", sort: "recent", runtime: "all" }, last).map((r) => r.id)).toEqual(["r1"]);
    expect(filterSortAgents(rows, { query: "", sort: "recent", runtime: "claude" }, last).map((r) => r.id)).toEqual(["r2"]);
    expect(filterSortAgents(rows, { query: "", sort: "recent", runtime: "codex" }, last).map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(filterSortAgents(rows, { query: "", sort: "name", runtime: "all" }, last).map((r) => r.id)).toEqual(["aria", "atlas", "AUTO_lint"].map((n) => rows.find((r) => r.name === n)!.id));
    expect(filterSortAgents(rows, { query: "", sort: "created", runtime: "all" }, last).map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
  });
  it("tells Claude from Codex agents", () => {
    expect(runtimeOf(rows[1]!.session)).toBe("claude");
    expect(runtimeOf(rows[0]!.session)).toBe("codex");
    expect(runtimeOf({ ...rows[0]!.session, effectiveNextLaunch: { profile: null, source: "claude_subscription", model: "opus" } })).toBe("claude");
  });
  it("finds the model: launch model, session default, then the profile's", () => {
    const s = rows[0]!.session;
    expect(modelOf(s)).toBeNull();
    expect(modelOf(s, new Map([["omega", "deepseek-v4-flash"]]))).toBe("deepseek-v4-flash");
    expect(modelOf({ ...s, runtimeDefaults: { model: "deepseek-v4-pro" } }, new Map([["omega", "x"]]))).toBe("deepseek-v4-pro");
    expect(modelOf({ ...s, effectiveNextLaunch: { profile: null, source: "claude_subscription", model: "opus" } })).toBe("opus");
  });
  it("scopes archived agents by projectId only when cutex sends it", () => {
    const legacy = [row("x", 1), row("y", 2)];
    expect(archivedOf(legacy, "desktop")).toEqual({ rows: legacy, scoped: false });
    const scoped = [row("x", 1, { session: { projectId: "desktop" } as Partial<SessionResource> }), row("y", 2, { session: { projectId: null } as Partial<SessionResource> })];
    expect(archivedOf(scoped, "desktop").rows.map((r) => r.id)).toEqual(["x"]);
    expect(archivedOf(scoped, "__independent__").rows.map((r) => r.id)).toEqual(["y"]);
  });
});

describe("selection", () => {
  const order = ["a", "b", "c", "d", "e"];
  it("selects a range from the anchor either way", () => {
    expect(rangeIds(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeIds(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeIds(order, null, "c")).toEqual(["c"]);
    expect(rangeIds(order, "gone", "c")).toEqual(["c"]);
    expect(rangeIds(order, "a", "gone")).toEqual([]);
  });
  it("sets or clears the range", () => {
    expect([...selectRange(new Set(["a"]), order, "b", "d", true)].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...selectRange(new Set(order), order, "b", "d", false)].sort()).toEqual(["a", "e"]);
  });
  it("reports the header checkbox state", () => {
    expect(selectionState(order, new Set())).toBe("none");
    expect(selectionState(order, new Set(["a", "x"]))).toBe("some");
    expect(selectionState(order, new Set(order))).toBe("all");
  });
});

describe("runLimited", () => {
  it("runs everything with at most `limit` in flight, despite failures", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await runLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n % 3));
      running--;
      if (n === 4) throw new Error("boom");
      done.push(n);
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 5, 6, 7]);
  });
  it("handles an empty list", async () => {
    await expect(runLimited([], 3, async () => {})).resolves.toBeUndefined();
  });
});

describe("全部 agent tabs", () => {
  it("opens the project page on 在线 and the sidebar dialog on 离线", () => {
    expect(defaultAgentListTab("page")).toBe("online");
    expect(defaultAgentListTab("dialog")).toBe("offline");
  });

  it("lists the group's online, offline or archived rows per tab", () => {
    const group = { online: [row("on-1", 3), row("on-2", 2)], offline: [row("off-1", 1)] };
    const archived = [row("arch-1", 0)];
    expect(tabRows(group, archived, "online").map((r) => r.id)).toEqual(["on-1", "on-2"]);
    expect(tabRows(group, archived, "offline").map((r) => r.id)).toEqual(["off-1"]);
    expect(tabRows(group, archived, "archived").map((r) => r.id)).toEqual(["arch-1"]);
    expect(tabRows(undefined, archived, "online")).toEqual([]);
  });

  it("offers stop / archive for online rows, start / archive for offline, restore for archived", () => {
    expect(tabActions("online")).toEqual(["archive", "stop"]);
    expect(tabActions("offline")).toEqual(["archive", "start"]);
    expect(tabActions("archived")).toEqual(["restore", "restoreStart"]);
  });

  it("filters and sorts online rows like the other tabs", () => {
    const rows = [row("a", 1, { name: "alpha", session: { runtime: { backend: "claude_subscription", status: "online", threadSettings: null } as never } }), row("b", 5, { name: "beta" })];
    expect(filterSortAgents(rows, { query: "", sort: "recent", runtime: "all" }, (r) => r.lastActivity).map((r) => r.id)).toEqual(["b", "a"]);
    expect(filterSortAgents(rows, { query: "", sort: "recent", runtime: "claude" }, (r) => r.lastActivity).map((r) => r.id)).toEqual(["a"]);
  });
});
