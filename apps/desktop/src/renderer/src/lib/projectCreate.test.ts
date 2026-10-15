import { describe, expect, it } from "vitest";
import type { ProjectSummary, ProjectsResponse } from "@cutex-desktop/protocol";
import { createProject, ensureNewProject, existingProjectChoice, isProjectIdTakenError, ProjectNameTakenError, sameProjectElsewhere, type NewProjectSpec } from "./projectCreate";

const summary = (id: string, name: string, patch: Partial<ProjectSummary> = {}): ProjectSummary => ({
  project_id: id,
  authority_epoch: 0,
  director_cutex_session_id: null,
  presentation: { display_name: name, badge_label: name.slice(0, 2), color: "cyan" },
  active_member_count: 0,
  lifecycle: "active",
  project_revision: 1,
  ...patch,
});
const list = (projects: ProjectSummary[], archived: ProjectSummary[] = []): ProjectsResponse => ({ schema: "v1", projects, archived_projects: archived });
const spec = (id = "reader", name = "Reader"): NewProjectSpec => ({ id, presentation: { display_name: name, badge_label: "RE", color: "cyan" }, workspaceRoot: "E:\\Project (Beta)\\Reader", director: null });

describe("existingProjectChoice", () => {
  it("creates when the id is free", () => {
    expect(existingProjectChoice(list([summary("other", "Other")]), "reader", "Reader")).toEqual({ kind: "create" });
    expect(existingProjectChoice(null, "reader", "Reader")).toEqual({ kind: "create" });
  });
  it("reuses an empty project of the same name", () => {
    expect(existingProjectChoice(list([summary("reader", "Reader")]), "reader", " reader ")).toEqual({ kind: "reuse", projectId: "reader" });
  });
  it("refuses a project with members, a Director, another name or archived", () => {
    expect(existingProjectChoice(list([summary("reader", "Reader", { active_member_count: 1 })]), "reader", "Reader").kind).toBe("taken");
    expect(existingProjectChoice(list([summary("reader", "Reader", { director_cutex_session_id: "d" })]), "reader", "Reader").kind).toBe("taken");
    expect(existingProjectChoice(list([summary("reader", "Reader!")]), "reader", "Reader").kind).toBe("taken");
    expect(existingProjectChoice(list([], [summary("reader", "Reader", { lifecycle: "archived" })]), "reader", "Reader").kind).toBe("taken");
  });
});

describe("isProjectIdTakenError", () => {
  it("recognises cutex's create_project conflict", () => {
    expect(isProjectIdTakenError(new Error("conflict: conflict: project_id_already_used"))).toBe(true);
    expect(isProjectIdTakenError(new Error("persistence_unavailable"))).toBe(false);
  });
});

function host(initial: ProjectSummary[] = []) {
  let projects = [...initial];
  const calls: string[] = [];
  let failNext: Error | null = null;
  let landAnyway = false;
  const deps = {
    listProjects: async () => {
      calls.push("list");
      return list(projects);
    },
    create: async (s: NewProjectSpec) => {
      calls.push(`create(${s.id})`);
      await Promise.resolve();
      if (projects.some((p) => p.project_id === s.id)) throw new Error("conflict: conflict: project_id_already_used");
      if (failNext) {
        const e = failNext;
        failNext = null;
        if (landAnyway) projects.push(summary(s.id, s.presentation.display_name));
        throw e;
      }
      projects.push(summary(s.id, s.presentation.display_name));
    },
  };
  return {
    deps,
    calls,
    fail(e: Error, lands = false) {
      failNext = e;
      landAnyway = lands;
    },
  };
}

describe("ensureNewProject", () => {
  it("creates once when two submits run at the same time", async () => {
    const h = host();
    const [a, b] = await Promise.all([ensureNewProject(h.deps, "host-a", spec()), ensureNewProject(h.deps, "host-a", spec())]);
    expect(a).toEqual({ projectId: "reader", outcome: "created" });
    expect(b).toEqual(a);
    expect(h.calls.filter((c) => c.startsWith("create"))).toEqual(["create(reader)"]);
  });
  it("a later submit reuses the project it created instead of creating again", async () => {
    const h = host();
    await ensureNewProject(h.deps, "host-a", spec());
    await expect(ensureNewProject(h.deps, "host-a", spec())).resolves.toEqual({ projectId: "reader", outcome: "reused" });
    expect(h.calls.filter((c) => c.startsWith("create"))).toHaveLength(1);
  });
  it("other hosts are independent", async () => {
    const h = host();
    await Promise.all([ensureNewProject(h.deps, "local", spec("chores", "Chores")), ensureNewProject(h.deps, "host-a", spec("chores", "Chores")).catch(() => null)]);
    expect(h.calls.filter((c) => c.startsWith("create"))).toHaveLength(2);
  });
  it("refuses an id used by a project with members without calling create", async () => {
    const h = host([summary("reader", "Reader", { active_member_count: 2 })]);
    await expect(ensureNewProject(h.deps, "host-a", spec())).rejects.toBeInstanceOf(ProjectNameTakenError);
    expect(h.calls).toEqual(["list"]);
  });
  it("a create that landed but answered an error is used, not repeated", async () => {
    const h = host();
    h.fail(new Error("persistence_unavailable: store write"), true);
    await expect(ensureNewProject(h.deps, "host-a", spec())).resolves.toEqual({ projectId: "reader", outcome: "created" });
  });
  it("maps cutex's duplicate refusal (e.g. a removed project's id) to ProjectNameTakenError", async () => {
    const h = host();
    h.fail(new Error("conflict: conflict: project_id_already_used"));
    await expect(ensureNewProject(h.deps, "host-a", spec())).rejects.toBeInstanceOf(ProjectNameTakenError);
  });
  it("passes other errors through", async () => {
    const h = host();
    h.fail(new Error("invalid_request: workspace root"));
    await expect(ensureNewProject(h.deps, "host-a", spec())).rejects.toThrow("workspace root");
  });
});

describe("sameProjectElsewhere", () => {
  const hosts = [
    { hostId: "local", projects: list([summary("chores", "Chores")]) },
    { hostId: "host-a", projects: list([summary("reader", "Reader"), summary("chores", "Chores")]) },
  ];
  it("finds the name on another host only", () => {
    expect(sameProjectElsewhere(hosts, "local", "reader")).toEqual({ hostId: "host-a", projectId: "reader", displayName: "Reader" });
    expect(sameProjectElsewhere(hosts, "host-a", "Reader")).toBeNull();
    expect(sameProjectElsewhere(hosts, "host-a", "Chores")?.hostId).toBe("local");
    expect(sameProjectElsewhere(hosts, "local", " ")).toBeNull();
  });
});

describe("createProject", () => {
  const capture = () => {
    const ops: unknown[] = [];
    return { ops, api: { projectMutation: async (_id: string, _expected: unknown, op: unknown) => void ops.push(op) } };
  };
  it("asks cutex to create a missing directory only when told to and a directory is given", async () => {
    const a = capture();
    await createProject(a.api, { ...spec(), createDirectory: true }, true);
    expect(a.ops[0]).toMatchObject({ kind: "create_project", workspace_root: "E:\\Project (Beta)\\Reader", create_workspace_root: true });
    const b = capture();
    await createProject(b.api, spec(), true);
    expect(b.ops[0]).not.toHaveProperty("create_workspace_root");
    const c = capture();
    await createProject(c.api, { ...spec(), workspaceRoot: null, createDirectory: true }, true);
    expect(c.ops[0]).not.toHaveProperty("create_workspace_root");
  });
});
