import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { DEFAULT_FLYOUT_DELAY, hoverOpensFlyout, isCollapsedRow, migrateFlyoutDelay } from "../src/renderer/src/lib/projectFlyout";
import { layoutSidebar, type LayoutContext, type LayoutPrefs } from "../src/renderer/src/lib/sidebarLayout";
import type { AgentRow, AgentStatus, ProjectGroup } from "../src/renderer/src/lib/sidebar";

function row(id: string, status: AgentStatus = "idle"): AgentRow {
  const session = { cutexSessionId: id, displayName: id, runtime: { activeTurnObservedAt: null } } as unknown as SessionResource;
  return { id, name: id, subtitle: "", status, isDirector: false, pinned: false, lastActivity: 0, profile: null, color: null, session };
}
function project(id: string, rows: AgentRow[]): ProjectGroup {
  return { kind: "project", id, name: id, badge: "", color: "blue", online: rows.filter((r) => r.status !== "offline"), offline: rows.filter((r) => r.status === "offline") };
}
const prefs: LayoutPrefs = { grouping: "all", noOnline: "collapse", running: "avatars", foldIdle: true };
const ctx = (over: Partial<LayoutContext> = {}): LayoutContext => ({ signalOf: () => undefined, selectedId: null, starred: new Set(), prefs, ...over });

/** What the sidebar does per project: hover opens the flyout? */
function hoverShows(layout: { mode: "full" | "collapsed" }, userFolded: boolean, hoverPreview = true, dragging = false): boolean {
  return hoverOpensFlyout({ collapsed: isCollapsedRow(layout, userFolded), hoverPreview, dragging });
}

describe("project flyout rule", () => {
  const { main } = layoutSidebar([project("quiet", [row("q1", "offline")]), project("busy", [row("b1", "running"), row("b2")])], ctx());
  const quiet = main.find((l) => l.group.id === "quiet")!;
  const busy = main.find((l) => l.group.id === "busy")!;

  it("shows for every collapsed row, whatever its online count", () => {
    expect(quiet.mode).toBe("collapsed");
    expect(busy.mode).toBe("full");
    // Auto-collapsed (nothing online).
    expect(hoverShows(quiet, false)).toBe(true);
    // Online agents, folded by the user with the chevron: same preview.
    expect(hoverShows(busy, true)).toBe(true);
  });

  it("never shows for an expanded project", () => {
    expect(hoverShows(busy, false)).toBe(false);
  });

  it("shows for 其他项目 rows (星标展开), online or not", () => {
    const { others } = layoutSidebar([project("busy", [row("b1", "running")])], ctx({ prefs: { ...prefs, grouping: "starred" } }));
    expect(others[0]!.mode).toBe("collapsed");
    expect(hoverShows(others[0]!, false)).toBe(true);
  });

  it("is off with the setting off and while a project is dragged", () => {
    expect(hoverShows(quiet, false, false)).toBe(false);
    expect(hoverShows(busy, true, false)).toBe(false);
    expect(hoverShows(quiet, false, true, true)).toBe(false);
    expect(hoverShows(busy, true, true, true)).toBe(false);
  });

  it("searching expands auto-collapsed rows (nothing to preview there)", () => {
    const { main: found } = layoutSidebar([project("quiet", [row("q1", "offline")])], ctx({ searching: true }));
    expect(found[0]!.mode).toBe("full");
    expect(hoverShows(found[0]!, false)).toBe(false);
  });

  it("reads the delay pref", () => {
    expect(migrateFlyoutDelay(300)).toBe(300);
    expect(migrateFlyoutDelay(999)).toBe(DEFAULT_FLYOUT_DELAY);
    expect(migrateFlyoutDelay(undefined)).toBe(DEFAULT_FLYOUT_DELAY);
  });
});
