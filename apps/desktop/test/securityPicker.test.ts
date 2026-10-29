import { describe, expect, it } from "vitest";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { grantPickerOptions, linkPickerOptions, securityProjectIds } from "../src/renderer/src/lib/securityPicker";

const sidebar = {
  active: [
    { cutexSessionId: "alone", displayName: "AUTO_bridgeboard" },
    { cutexSessionId: "a", displayName: "小助手" },
    { cutexSessionId: "b", displayName: "Builder" },
    { cutexSessionId: "mine", displayName: "Mine" },
    { cutexSessionId: "granted", displayName: "Already visible" },
  ],
  hostRows: { a: { projectId: "alpha" }, b: { projectId: "beta" }, mine: { projectId: "mine" }, granted: { projectId: "beta" } },
  projects: { projects: ["mine", "alpha", "beta"].map(project_id => ({ project_id, lifecycle: "active", presentation: { display_name: project_id === "alpha" ? "中文项目" : project_id } })) },
} as unknown as SidebarSnapshot;

describe("security picker candidates", () => {
  it("groups by the sidebar's host-specific project order, with independent agents last", () => {
    const ids = securityProjectIds(sidebar, ['["other","alpha"]', '["local","beta"]'], "local");
    expect(ids).toEqual(["beta", "mine", "alpha"]);
    const options = grantPickerOptions(sidebar, "mine", [{ project: "mine", agent: "granted" }], ids, "独立");
    expect(options.map(option => [option.value, option.group])).toEqual([["b", "beta"], ["a", "中文项目"], ["alone", "独立"]]);
    expect(options[1]!.searchText).toContain("小助手 中文项目");
  });
  it("keeps only active project domains and standalone agents in the link picker", () => {
    const options = linkPickerOptions(sidebar, ["beta", "alpha", "mine"], "项目", "独立");
    expect(options.map(option => option.value)).toEqual(["project:beta", "project:alpha", "project:mine", "agent:alone"]);
    expect(options.map(option => option.group)).toEqual(["项目", "项目", "项目", "独立"]);
  });
});
