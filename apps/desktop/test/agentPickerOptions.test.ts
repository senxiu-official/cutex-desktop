// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { agentPickerOptions, listPickerRows, pickerProjectRank, recentAgentPicks, rememberAgentPick, sidebarPickerRows } from "../src/renderer/src/lib/agentPickerOptions";

const labels = { top: "当前与最近", independent: "独立", archived: "已归档", chats: "快速会话" };

const sidebar = {
  active: [
    { cutexSessionId: "solo", displayName: "Zed", lifecycle: "active" },
    { cutexSessionId: "a1", displayName: "Builder", formalAgentName: "ctx-builder", note: "renderer work", lifecycle: "active" },
    { cutexSessionId: "a2", displayName: "Alice", lifecycle: "active" },
    { cutexSessionId: "b1", displayName: "Bob", lifecycle: "active" },
  ],
  retired: [{ cutexSessionId: "old", displayName: "Old one", lifecycle: "retired" }],
  hostRows: { a1: { projectId: "alpha" }, a2: { projectId: "alpha" }, b1: { projectId: "beta", projectName: "Beta 项目" }, old: { projectId: "alpha" } },
  projects: { projects: ["alpha", "beta"].map((project_id) => ({ project_id, lifecycle: "active", presentation: { display_name: project_id === "alpha" ? "Alpha" : project_id } })) },
} as unknown as SidebarSnapshot;

describe("agent picker options", () => {
  it("groups by project in the sidebar's order, independent next, archived last; names sorted inside", () => {
    const rank = pickerProjectRank(sidebar, ['["local","beta"]'], "local");
    const options = agentPickerOptions(sidebarPickerRows(sidebar, { include: "all" }), labels, { rank });
    expect(options.map((o) => [o.value, o.group])).toEqual([
      ["b1", "Beta 项目"],
      ["a2", "Alpha"],
      ["a1", "Alpha"],
      ["solo", "独立"],
      ["old", "已归档"],
    ]);
  });

  it("puts the current agent and recent picks on top, each with its project as detail", () => {
    const options = agentPickerOptions(sidebarPickerRows(sidebar), labels, { top: ["b1", null, "solo", "b1", "missing"] });
    expect(options.slice(0, 2).map((o) => [o.value, o.group, o.detail])).toEqual([
      ["b1", "当前与最近", "Beta 项目"],
      ["solo", "当前与最近", "独立"],
    ]);
    expect(options.filter((o) => o.value === "b1")).toHaveLength(1);
    expect(options.some((o) => o.value === "old")).toBe(false);
  });

  it("searches by own name, project, note and id", () => {
    const [a1] = sidebarPickerRows(sidebar, { only: ["a1"] });
    expect(a1!.searchText).toContain("ctx-builder");
    expect(a1!.searchText).toContain("Alpha");
    expect(a1!.searchText).toContain("renderer work");
    expect(a1!.searchText).toContain("a1");
  });

  it("names the host in the group when a list spans hosts", () => {
    const rows = sidebarPickerRows(sidebar, { only: ["b1"], hostLabel: "Remote", keyOf: (id) => `remote\n${id}` });
    expect(agentPickerOptions(rows, labels)).toEqual([expect.objectContaining({ value: "remote\nb1", group: "Beta 项目 · Remote" })]);
  });

  it("places an outside list (unknown ids stay independent under their given name)", () => {
    const options = agentPickerOptions(listPickerRows([{ id: "a2", name: "x" }, { id: "ghost", name: "Ghost" }], sidebar), labels);
    expect(options.map((o) => [o.value, o.label, o.group])).toEqual([
      ["a2", "Alice", "Alpha"],
      ["ghost", "Ghost", "独立"],
    ]);
  });

  it("scales: 300 agents over 30 projects stay grouped, every agent reachable", () => {
    const big = {
      active: Array.from({ length: 300 }, (_, i) => ({ cutexSessionId: `s${i}`, displayName: `Agent ${i}`, lifecycle: "active" })),
      retired: [],
      hostRows: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`s${i}`, { projectId: i % 10 === 9 ? null : `p${i % 30}` }])),
      projects: { projects: Array.from({ length: 30 }, (_, i) => ({ project_id: `p${i}`, lifecycle: "active", presentation: { display_name: `Project ${i}` } })) },
    } as unknown as SidebarSnapshot;
    const options = agentPickerOptions(sidebarPickerRows(big), labels, { rank: pickerProjectRank(big, [], "local") });
    expect(options).toHaveLength(300);
    const groups = options.map((o) => o.group).filter((g, i, all) => all.indexOf(g) === i);
    expect(groups.at(-1)).toBe("独立");
    // Each group is contiguous.
    expect(groups.length).toBe(new Set(options.map((o) => o.group)).size);
  });
});

describe("recent agent picks", () => {
  beforeEach(() => localStorage.clear());
  it("keeps the newest five per picker and host", () => {
    for (const id of ["a", "b", "c", "d", "e", "f", "b"]) rememberAgentPick("notes", "local", id);
    expect(recentAgentPicks("notes", "local")).toEqual(["b", "f", "e", "d", "c"]);
    expect(recentAgentPicks("notes", "remote")).toEqual([]);
    expect(recentAgentPicks("harness", "local")).toEqual([]);
  });
});

describe("quick chats", () => {
  const withChats = {
    ...sidebar,
    active: [
      ...sidebar.active,
      { cutexSessionId: "chat1", displayName: "Fix the build", registrationClass: "local_only", lifecycle: "active" },
      { cutexSessionId: "chat2", displayName: "Session 0a1b2c3d", registrationClass: "local_only", lifecycle: "active" },
      { cutexSessionId: "named", displayName: "Named", formalAgentName: "named", registrationClass: "local_only", lifecycle: "active" },
    ],
  } as unknown as SidebarSnapshot;

  it("go to their own group after 独立, marked hidden until searched; named agents are not quick chats", () => {
    const options = agentPickerOptions(sidebarPickerRows(withChats), labels);
    expect(options.filter((o) => o.hiddenUntilSearch).map((o) => [o.value, o.group])).toEqual([
      ["chat1", "快速会话"],
      ["chat2", "快速会话"],
    ]);
    expect(options.find((o) => o.value === "named")!.group).toBe("独立");
    const groups = options.map((o) => o.group);
    expect(groups.lastIndexOf("独立")).toBeLessThan(groups.indexOf("快速会话"));
  });

  it("a current or recent quick chat stays visible on top", () => {
    const options = agentPickerOptions(sidebarPickerRows(withChats), labels, { top: ["chat1"] });
    expect(options[0]).toEqual(expect.objectContaining({ value: "chat1", group: "当前与最近", detail: "快速会话" }));
    expect(options[0]!.hiddenUntilSearch).toBeUndefined();
  });
});
