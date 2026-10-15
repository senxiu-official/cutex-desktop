import { describe, expect, it } from "vitest";
import type { ProjectsResponse, ProjectSummary, SessionResource } from "@cutex-desktop/protocol";
import { archivedProjectOf, isArchived, lifecycleFlip, projectOfArchived } from "../src/renderer/src/lib/archivedAgent";

const s = (id: string, extra: Record<string, unknown> = {}) => ({ cutexSessionId: id, lifecycle: "active", ...extra }) as unknown as SessionResource;
const retired = (id: string, extra: Record<string, unknown> = {}) => s(id, { lifecycle: "retired", ...extra });

const project = (id: string, name: string, lifecycle: string, revision = 2): ProjectSummary => ({
  project_id: id,
  authority_epoch: 3,
  director_cutex_session_id: "d",
  presentation: { display_name: name, badge_label: "P", color: "blue" },
  active_member_count: 0,
  lifecycle,
  project_revision: revision,
});

describe("isArchived", () => {
  it("is true only for retired sessions", () => {
    expect(isArchived(retired("a"))).toBe(true);
    expect(isArchived(s("a"))).toBe(false);
    expect(isArchived(undefined)).toBe(false);
  });
});

describe("lifecycleFlip", () => {
  const before = { active: [s("a"), s("b")], retired: [retired("c")] };
  it("reports the selected agent being archived or restored", () => {
    expect(lifecycleFlip(before, { active: [s("b")], retired: [retired("c"), retired("a")] }, "a")).toBe("archived");
    expect(lifecycleFlip(before, { active: [s("a"), s("b"), s("c")], retired: [] }, "c")).toBe("restored");
  });
  it("is null when nothing changed, nothing is selected, or the agent is gone / new", () => {
    expect(lifecycleFlip(before, before, "a")).toBeNull();
    expect(lifecycleFlip(before, before, null)).toBeNull();
    expect(lifecycleFlip(null, before, "a")).toBeNull();
    expect(lifecycleFlip(before, { active: [s("b")], retired: [retired("c")] }, "a")).toBeNull();
    expect(lifecycleFlip(before, { active: [s("x")], retired: [] }, "x")).toBeNull();
  });
});

describe("archived project", () => {
  const projects: ProjectsResponse = {
    schema: "cutex/human-management-projects/v1",
    projects: [project("live", "Live", "active")],
    archived_projects: [project("gone", "Gone lab", "archived", 7)],
  };
  it("reads cutex's projectId / projectName annotation", () => {
    expect(projectOfArchived(retired("a", { projectId: "gone", projectName: "Gone lab" }))).toEqual({ id: "gone", name: "Gone lab" });
    expect(projectOfArchived(retired("a", { projectId: null, projectName: null }))).toBeNull();
    expect(projectOfArchived(retired("a"))).toBeNull(); // older cutex: unknown
  });
  it("finds the project only when it is archived too, with its restore CAS", () => {
    expect(archivedProjectOf(retired("a", { projectId: "gone" }), projects)).toEqual({ id: "gone", name: "Gone lab", expected: { authorityEpoch: 3, projectRevision: 7 } });
    expect(archivedProjectOf(retired("a", { projectId: "live" }), projects)).toBeNull();
    expect(archivedProjectOf(retired("a"), projects)).toBeNull();
    expect(archivedProjectOf(retired("a", { projectId: "gone" }), null)).toBeNull();
  });
});
