// lib/projectCreate (DESIGN §4.18): one `create_project` on cutex with `project-optional-director`;
// older cutex needs a Director (`create`) and sets the directory in a second mutation.
import { describe, expect, it, vi } from "vitest";
import { createProject, directorCandidates, independentAgents, ProjectDirectoryError, slugifyProjectId } from "../src/renderer/src/lib/projectCreate";
import type { SidebarSnapshot } from "../src/shared/ipc";

const presentation = { display_name: "Alpha", badge_label: "AL", color: "cyan" };
const fresh = { authorityEpoch: 0, projectRevision: 0 };

describe("createProject", () => {
  it("optional Director: one create_project with directory and no Director", async () => {
    const projectMutation = vi.fn(async () => ({}));
    await createProject({ projectMutation }, { id: "alpha", presentation, workspaceRoot: "D:\alpha", director: null }, true);
    expect(projectMutation).toHaveBeenCalledTimes(1);
    expect(projectMutation).toHaveBeenCalledWith("alpha", fresh, { kind: "create_project", presentation, workspace_root: "D:\alpha", director_cutex_session_id: null });
  });

  it("older cutex: create, then set_workspace_root at epoch 1 / revision 1", async () => {
    const projectMutation = vi.fn(async () => ({}));
    await createProject({ projectMutation }, { id: "alpha", presentation, workspaceRoot: "D:\alpha", director: "eva" }, false);
    expect(projectMutation.mock.calls).toEqual([
      ["alpha", fresh, { kind: "create", director_cutex_session_id: "eva", presentation }],
      ["alpha", { authorityEpoch: 1, projectRevision: 1 }, { kind: "set_workspace_root", workspace_root: "D:\alpha" }],
    ]);
  });

  it("older cutex: no directory means a single create", async () => {
    const projectMutation = vi.fn(async () => ({}));
    await createProject({ projectMutation }, { id: "alpha", presentation, workspaceRoot: null, director: "eva" }, false);
    expect(projectMutation).toHaveBeenCalledTimes(1);
  });

  it("older cutex: a Director is required", async () => {
    const projectMutation = vi.fn(async () => ({}));
    await expect(createProject({ projectMutation }, { id: "alpha", presentation, workspaceRoot: null, director: null }, false)).rejects.toThrow("director_required");
    expect(projectMutation).not.toHaveBeenCalled();
  });

  it("older cutex: a failed directory step reports the created project", async () => {
    const projectMutation = vi.fn(async (_id: string, _e: unknown, op: { kind: string }) => {
      if (op.kind === "set_workspace_root") throw new Error("workspace_root_invalid");
      return {};
    });
    const err = await createProject({ projectMutation }, { id: "alpha", presentation, workspaceRoot: "rel", director: "eva" }, false).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectDirectoryError);
    expect(err.projectId).toBe("alpha");
    expect(err.message).toBe("workspace_root_invalid");
  });
});

describe("Director candidates", () => {
  const session = (id: string, lifecycle = "active") => ({ cutexSessionId: id, displayName: id.toUpperCase(), lifecycle });
  const sidebar = {
    active: [session("eva"), session("wave"), session("solo"), session("gone", "retired")],
    hostRows: { eva: { projectId: "p1" }, wave: { projectId: "p2" }, solo: { projectId: null }, gone: { projectId: null } },
  } as unknown as SidebarSnapshot;

  it("independent agents are active and in no project", () => {
    expect(independentAgents(sidebar)).toEqual([{ value: "solo", label: "SOLO" }]);
  });

  it("a project's candidates are its members plus independent agents (which join)", () => {
    expect(directorCandidates(sidebar, "p1")).toEqual([
      { id: "eva", name: "EVA", joins: false },
      { id: "solo", name: "SOLO", joins: true },
    ]);
  });

  it("project ids are slugs", () => {
    expect(slugifyProjectId("My Project!")).toBe("my-project");
    expect(slugifyProjectId("项目")).toMatch(/^project-[a-z0-9]+$/);
  });

  it("names with non-ASCII letters keep distinct, stable ids", () => {
    const one = slugifyProjectId("ABC中文一");
    const two = slugifyProjectId("ABC中文二");
    expect(one).toMatch(/^abc-[a-z0-9]+$/);
    expect(two).toMatch(/^abc-[a-z0-9]+$/);
    expect(one).not.toBe(two);
    expect(slugifyProjectId(" ABC中文一 ")).toBe(one);
    expect(slugifyProjectId("项目")).toBe(slugifyProjectId("项目"));
    expect(slugifyProjectId("项目一")).not.toBe(slugifyProjectId("项目二"));
    for (const id of [one, two, slugifyProjectId("Café"), slugifyProjectId("项目")]) expect(id).toMatch(/^[a-z0-9-]{1,128}$/);
    expect(slugifyProjectId("My Project")).toBe("my-project");
  });
});
