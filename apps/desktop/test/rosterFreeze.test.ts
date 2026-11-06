// Design 060 phase 2: the roster holds still while the owner is in it (lib/rosterFreeze). Places are
// held, rows are live.
import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { AgentSignal } from "../src/renderer/src/lib/agentAttention";
import { holdLayout, placementOf } from "../src/renderer/src/lib/rosterFreeze";
import { layoutSidebar, type LayoutContext } from "../src/renderer/src/lib/sidebarLayout";
import type { AgentRow, AgentStatus, ProjectGroup } from "../src/renderer/src/lib/sidebar";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = Date.parse("2026-11-05T07:00:00Z");

function row(id: string, status: AgentStatus, last: number): AgentRow {
  const session = { cutexSessionId: id, displayName: id, lifecycle: "active", createdAt: null, runtime: { status: status === "offline" ? "offline" : "online", activeTurnId: status === "running" ? "t" : null, activeTurnObservedAt: null } } as unknown as SessionResource;
  return { id, name: id, subtitle: "", status, isDirector: false, pinned: false, lastActivity: last, profile: null, color: null, session };
}
function project(id: string, rows: AgentRow[]): ProjectGroup {
  return { kind: "project", id, name: id, badge: "", color: "blue", online: rows.filter((r) => r.status !== "offline"), offline: rows.filter((r) => r.status === "offline") };
}
const ctx = (signals: Record<string, AgentSignal> = {}, now = NOW): LayoutContext => ({ signalOf: (k) => signals[k], selectedId: null, starred: new Set(), prefs: { grouping: "all", noOnline: "collapse", running: "full", olderAfter: 7 }, now });
const ids = (rows: readonly AgentRow[]) => rows.map((r) => r.id);

describe("holdLayout", () => {
  const a = row("a", "idle", NOW - 2 * MIN);
  const b = row("b", "idle", NOW - 5 * MIN);
  const c = row("c", "offline", NOW - 6 * DAY);
  const before = layoutSidebar([project("p", [a, b, c]), project("q", [row("q1", "idle", NOW - DAY)])], ctx());
  const held = placementOf(before);

  it("nothing changed: the same places", () => {
    const layout = holdLayout(held, before);
    expect(ids(layout.main[0]!.recent)).toEqual(["a", "b", "c"]);
  });

  it("activity alone moves nothing (rows are ordered by name)", () => {
    const fresh = layoutSidebar([project("p", [a, { ...b, lastActivity: NOW }, c]), project("q", [row("q1", "idle", NOW - DAY)])], ctx());
    expect(ids(fresh.main[0]!.recent)).toEqual(["a", "b", "c"]);
    expect(ids(holdLayout(held, fresh).main[0]!.recent)).toEqual(["a", "b", "c"]);
  });

  it("going offline reorders 最近 in the fresh layout, but held rows keep their order", () => {
    const aOff = row("a", "offline", a.lastActivity);
    const fresh = layoutSidebar([project("p", [aOff, b, c]), project("q", [row("q1", "idle", NOW - DAY)])], ctx());
    expect(ids(fresh.main[0]!.recent)).toEqual(["b", "a", "c"]);
    const layout = holdLayout(held, fresh);
    expect(ids(layout.main[0]!.recent)).toEqual(["a", "b", "c"]);
    // The live row object (now offline) in the held place.
    expect(layout.main[0]!.recent[0]).toBe(aOff);
  });

  it("a new 需要你 does not move the row, but the counts say it at once", () => {
    const fresh = layoutSidebar([project("p", [a, b, c]), project("q", [row("q1", "idle", NOW - DAY)])], ctx({ c: "needsYou" }));
    expect(ids(fresh.main[0]!.big)).toEqual(["c"]);
    const layout = holdLayout(held, fresh);
    expect(ids(layout.main[0]!.big)).toEqual([]);
    expect(ids(layout.main[0]!.recent)).toEqual(["a", "b", "c"]);
    expect(layout.main[0]!.needsYouCount).toBe(1);
  });

  it("time passing does not fold a project or a row while held", () => {
    const later = layoutSidebar([project("p", [a, b, c]), project("q", [row("q1", "idle", NOW - DAY)])], ctx({}, NOW + 7 * DAY));
    expect(later.older.map((l) => l.group.id)).toEqual(["p", "q"]);
    const layout = holdLayout(held, later);
    expect(layout.main.map((l) => l.group.id)).toEqual(["p", "q"]);
    expect(layout.older).toEqual([]);
    expect(ids(layout.main[0]!.recent)).toEqual(["a", "b", "c"]);
  });

  it("new rows and projects come in at the end of where they belong; gone ones leave", () => {
    const d = row("d", "idle", NOW - MIN);
    const fresh = layoutSidebar([project("p", [a, b, d]), project("q", [row("q1", "idle", NOW - DAY)]), project("n", [row("n1", "idle", NOW)])], ctx());
    const layout = holdLayout(held, fresh);
    expect(ids(layout.main[0]!.recent)).toEqual(["a", "b", "d"]);
    expect(layout.main.map((l) => l.group.id)).toEqual(["p", "q", "n"]);
  });

  it("a folded agent whose runtime stops moves from 在线空闲 to 离线: held in place", () => {
    const quiet = row("z", "idle", NOW - 20 * DAY);
    const start = layoutSidebar([project("p", [a, b, c, quiet])], ctx());
    expect(ids(start.main[0]!.idle)).toEqual(["z"]);
    const zOff = row("z", "offline", quiet.lastActivity);
    const fresh = layoutSidebar([project("p", [a, b, c, zOff])], ctx());
    expect([ids(fresh.main[0]!.idle), ids(fresh.main[0]!.offline)]).toEqual([[], ["z"]]);
    const layout = holdLayout(placementOf(start), fresh);
    expect(ids(layout.main[0]!.idle)).toEqual(["z"]);
    expect(layout.main[0]!.offline).toEqual([]);
  });

  it("a row pushed past the cap of recently worked would move into its fold: held listed", () => {
    const rows = ["r1", "r2", "r3", "r4", "r5"].map((id, i) => row(id, "idle", NOW - (i + 1) * MIN));
    const start = layoutSidebar([project("p", rows)], ctx());
    const fresh = layoutSidebar([project("p", [...rows, row("r0", "idle", NOW)])], ctx());
    expect(ids(fresh.main[0]!.idle)).toEqual(["r5"]);
    const layout = holdLayout(placementOf(start), fresh);
    // Held: r5 stays listed, the new one comes in at the end of where it belongs.
    expect(ids(layout.main[0]!.recent)).toEqual(["r1", "r2", "r3", "r4", "r5", "r0"]);
  });

  it("project order changes are held too", () => {
    const fresh = layoutSidebar([project("q", [row("q1", "idle", NOW - DAY)]), project("p", [a, b, c])], ctx());
    const layout = holdLayout(held, fresh);
    expect(layout.main.map((l) => l.group.id)).toEqual(["p", "q"]);
  });
});
