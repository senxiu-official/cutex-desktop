// Sidebar top entries: pinned first screen + 「更多」 (renderer lib/navPins).
import { describe, expect, it } from "vitest";
import { DEFAULT_NAV_PINS, layoutNav, migrateNavPins, navPins, withNavPin } from "../src/renderer/src/lib/navPins";

const ALL = ["quick-chats.nav", "agent-config.newAgent", "projects.nav", "services.nav", "delegations.nav", "workflows.nav", "jobs.nav", "approvals.nav", "plugin.x"];
const none = new Set<string>();

describe("layoutNav", () => {
  it("defaults: 新建智能体, 快速启动, 委托, 审批 in that order; the rest folded in entry order", () => {
    expect(layoutNav(ALL, null, none)).toEqual({
      pinned: ["agent-config.newAgent", "quick-chats.nav", "delegations.nav", "approvals.nav"],
      surfaced: [],
      folded: ["projects.nav", "services.nav", "workflows.nav", "jobs.nav", "plugin.x"],
      moreAttention: false,
    });
  });
  it("keeps pin order and skips pins that are not here (another host / capability)", () => {
    const l = layoutNav(["projects.nav", "jobs.nav", "approvals.nav"], ["jobs.nav", "gone.nav", "projects.nav"], none);
    expect(l.pinned).toEqual(["jobs.nav", "projects.nav"]);
    expect(l.folded).toEqual(["approvals.nav"]);
  });
  it("surfaces an unpinned entry with attention until it clears", () => {
    const pins = withNavPin(null, "approvals.nav", false);
    const busy = layoutNav(ALL, pins, new Set(["approvals.nav", "workflows.nav", "quick-chats.nav"]));
    expect(busy.surfaced).toEqual(["workflows.nav", "approvals.nav"]);
    expect(busy.folded).not.toContain("approvals.nav");
    expect(busy.moreAttention).toBe(false);
    const calm = layoutNav(ALL, pins, none);
    expect(calm.surfaced).toEqual([]);
    expect(calm.folded).toContain("approvals.nav");
  });
  it("an unavailable entry with attention stays folded and dots 「更多」", () => {
    const l = layoutNav(ALL, null, new Set(["jobs.nav"]), (id) => id !== "jobs.nav");
    expect(l.surfaced).toEqual([]);
    expect(l.moreAttention).toBe(true);
  });
});

describe("pins", () => {
  it("pinning appends, unpinning removes; defaults until changed", () => {
    expect(navPins(null)).toBe(DEFAULT_NAV_PINS);
    expect(withNavPin(null, "jobs.nav", true)).toEqual([...DEFAULT_NAV_PINS, "jobs.nav"]);
    expect(withNavPin(null, "quick-chats.nav", false)).toEqual(["agent-config.newAgent", "delegations.nav", "approvals.nav"]);
    expect(withNavPin(["a", "b"], "a", true)).toEqual(["b", "a"]);
    expect(withNavPin([], "a", false)).toEqual([]);
  });
  it("migrates stored values", () => {
    expect(migrateNavPins(undefined)).toBeNull();
    expect(migrateNavPins("x")).toBeNull();
    expect(migrateNavPins(["a", "a", 3, "", "b c", "plugin:x.nav"])).toEqual(["a", "plugin:x.nav"]);
    expect(migrateNavPins([])).toEqual([]);
  });
});
