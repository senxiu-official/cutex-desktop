// Design 060 §8: the roster's layout cost at the owner's scale (200 agents in 16 projects). Laying out and
// holding the whole sidebar once must stay far below a frame; the bound is loose (CI machines vary), the
// printed numbers are what the design asked to measure.
import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { holdLayout, placementOf } from "../src/renderer/src/lib/rosterFreeze";
import { layoutSidebar, type LayoutContext } from "../src/renderer/src/lib/sidebarLayout";
import type { AgentRow, ProjectGroup } from "../src/renderer/src/lib/sidebar";

const DAY = 24 * 60 * 60_000;
const NOW = Date.parse("2026-11-05T07:00:00Z");

function row(id: string, online: boolean, running: boolean, last: number): AgentRow {
  const session = { cutexSessionId: id, displayName: id, lifecycle: "active", createdAt: null, runtime: { status: online ? "online" : "offline", activeTurnId: running ? "t" : null, activeTurnObservedAt: null } } as unknown as SessionResource;
  return { id, name: id, subtitle: "", status: running ? "running" : online ? "idle" : "offline", isDirector: false, pinned: false, lastActivity: last, profile: null, color: null, session };
}

function scale(): ProjectGroup[] {
  const sizes = [44, 42, 30, 20, 12, 10, 8, 6, 5, 5, 4, 4, 3, 3, 2, 2];
  return sizes.map((n, p) => {
    const rows = Array.from({ length: n }, (_, i) => row(`p${p}-a${i}`, i < 7, i < 2, NOW - ((i * 37 + p * 11) % 40) * DAY * 0.5));
    return { kind: "project", id: `p${p}`, name: `p${p}`, badge: "", color: "blue", online: rows.filter((r) => r.status !== "offline"), offline: rows.filter((r) => r.status === "offline") };
  });
}

describe("roster at scale", () => {
  it("lays out and holds 200 agents well under a frame", () => {
    const groups = scale();
    expect(groups.reduce((n, g) => n + g.online.length + g.offline.length, 0)).toBe(200);
    const ctx: LayoutContext = { signalOf: () => undefined, selectedId: null, starred: new Set(), prefs: { grouping: "all", noOnline: "collapse", running: "compact", olderAfter: 7 }, now: NOW };
    const runs = 200;
    let t = performance.now();
    let layout = layoutSidebar(groups, ctx);
    for (let i = 0; i < runs; i++) layout = layoutSidebar(groups, { ...ctx, now: NOW + i * 1000 });
    const layoutMs = (performance.now() - t) / runs;
    const held = placementOf(layout);
    t = performance.now();
    for (let i = 0; i < runs; i++) holdLayout(held, layout);
    const holdMs = (performance.now() - t) / runs;
    console.info(`[roster scale] layoutSidebar ${layoutMs.toFixed(3)} ms, holdLayout ${holdMs.toFixed(3)} ms per pass (200 agents, 16 projects)`);
    expect(layoutMs).toBeLessThan(8);
    expect(holdMs).toBeLessThan(8);
  });
});
