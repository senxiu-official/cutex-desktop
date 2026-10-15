// 归档项目 + 主管 (lib/projectArchive): the confirm's Director box, archive → retire order, a failed
// retire (project stays archived, retry offered), the restore's 「同时恢复主管」 option and the
// device-local fallback, and that every call goes to the project's host.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";

const mock = vi.hoisted(() => {
  const log: string[] = [];
  const daemon = (host: string) => ({
    projectMutation: vi.fn(async (id: string, _expected: unknown, op: { kind: string }) => {
      log.push(`${host}:project:${op.kind}:${id}`);
      if (mock.failProject) throw new Error("conflict");
      return {};
    }),
  });
  const apis = { local: daemon("local"), workstation: daemon("workstation") };
  return { log, apis, failProject: false, failRetire: 0, confirms: [] as boolean[], prompts: [] as (string | null)[], dialogs: [] as { message: string; check?: { label: string; detail?: string; checked: boolean }; labels?: unknown }[] };
});

vi.mock("../src/renderer/src/bridge", () => ({ api: mock.apis.local, apiFor: (host: string) => mock.apis[host as keyof typeof mock.apis], bridge: { on: () => () => {} }, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/lib/contextMenu", async (orig) => ({
  ...(await orig<typeof import("../src/renderer/src/lib/contextMenu")>()),
  confirmDialog: vi.fn(async (message: string, _danger?: boolean, labels?: unknown, check?: { label: string; checked: boolean }) => {
    mock.dialogs.push({ message, check, labels });
    return mock.confirms.shift() ?? false;
  }),
  promptDialog: vi.fn(async (message: string, _initial?: string, options?: { check?: { label: string; checked: boolean } }) => {
    mock.dialogs.push({ message, check: options?.check });
    return mock.prompts.shift() ?? null;
  }),
}));

const t = ((key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key)) as never;

function session(id: string, over: { busy?: boolean; retired?: boolean; projectId?: string } = {}): SessionResource {
  return {
    cutexSessionId: id,
    displayName: id.toUpperCase(),
    lifecycle: over.retired ? "retired" : "active",
    revision: 3,
    cwd: "/w",
    runtime: { status: "online", activeTurnId: over.busy ? "turn" : null, runtimeGeneration: 2 },
    ...(over.projectId && { projectId: over.projectId }),
  } as unknown as SessionResource;
}

const summary = (id: string, director: string | null) => ({ project_id: id, director_cutex_session_id: director, authority_epoch: 1, project_revision: 4, presentation: { display_name: id, badge_label: "", color: "blue" } });

async function setup(focus: string, host: string, snapshot: { active?: SessionResource[]; retired?: SessionResource[]; archived?: ReturnType<typeof summary>[] }) {
  const { useApp } = await import("../src/renderer/src/store");
  const sidebar = { active: snapshot.active ?? [], retired: snapshot.retired ?? [], hostRows: {}, projects: { projects: [], archived_projects: snapshot.archived ?? [] } };
  const sessionAction = vi.fn(async (id: string, method: string, _params: unknown, h: string) => {
    mock.log.push(`${h}:${method}:${id}`);
    if (mock.failRetire > 0 && method === "cutex/session/retire") {
      mock.failRetire--;
      throw new Error("busy");
    }
    return null;
  });
  const refreshHostSidebar = vi.fn(async () => {});
  useApp.setState({
    hosts: { active: focus } as never,
    sidebar: (host === focus ? sidebar : null) as never,
    byHost: (host === focus ? {} : { [host]: { sidebar, services: [] } }) as never,
    services: [],
    sessionAction: sessionAction as never,
    refreshHostSidebar,
  });
  return { sessionAction, refreshHostSidebar };
}

beforeEach(async () => {
  mock.log.length = 0;
  mock.dialogs.length = 0;
  mock.confirms = [];
  mock.prompts = [];
  mock.failProject = false;
  mock.failRetire = 0;
  const prefs = await import("../src/renderer/src/lib/prefs");
  for (const key of Object.keys(prefs.getUiPrefs().projectDirectors)) {
    const [h, p] = JSON.parse(key) as [string, string];
    prefs.setProjectDirector(h, p, null);
  }
});

describe("archive confirm", () => {
  it("offers 「同时归档主管」 checked by default, with the busy / services warnings", async () => {
    const { useApp } = await import("../src/renderer/src/store");
    await setup("local", "local", {});
    useApp.setState({ services: [{ slug: "web", displayName: "Web", ownerCutexSessionId: "dir" }] as never });
    const { confirmProjectArchive } = await import("../src/renderer/src/lib/projectArchive");
    mock.prompts = ["P1"];
    const answer = await confirmProjectArchive({ displayName: "P1", memberCount: 2, director: session("dir", { busy: true }), hostId: "local", t });
    expect(answer).toEqual({ ok: true, mismatch: false, withDirector: true });
    const check = mock.dialogs[0]!.check!;
    expect(check.label).toBe("projects.archiveWithDirector(DIR)");
    expect(check.detail).toContain("projects.archiveDirectorBusy");
    expect(check.detail).toContain("menu.archiveOwnsServices(1,Web)");
    expect(check.detail).toContain("projects.archiveOthersStay");
  });

  it("an unchecked box keeps the Director; an empty project uses a plain confirm; no Director → no box", async () => {
    await setup("local", "local", {});
    const { confirmProjectArchive } = await import("../src/renderer/src/lib/projectArchive");
    const { confirmDialog } = await import("../src/renderer/src/lib/contextMenu");
    vi.mocked(confirmDialog).mockImplementationOnce(async (_m, _d, _l, check) => {
      check!.checked = false;
      return true;
    });
    expect(await confirmProjectArchive({ displayName: "P1", memberCount: 0, director: session("dir"), hostId: "local", t })).toEqual({ ok: true, mismatch: false, withDirector: false });
    mock.prompts = ["P1"];
    expect(await confirmProjectArchive({ displayName: "P1", memberCount: 1, director: null, hostId: "local", t })).toEqual({ ok: true, mismatch: false, withDirector: false });
    expect(mock.dialogs.at(-1)!.check).toBeUndefined();
    mock.prompts = ["nope"];
    expect(await confirmProjectArchive({ displayName: "P1", memberCount: 1, director: session("dir"), hostId: "local", t })).toEqual({ ok: false, mismatch: true, withDirector: false });
  });
});

describe("archiveProject", () => {
  const base = { projectId: "p1", displayName: "P1", expected: { authorityEpoch: 1, projectRevision: 4 }, directorId: "dir", t };

  it("archives the project first, then retires the Director through the menu's retire", async () => {
    const { sessionAction } = await setup("local", "local", { active: [session("dir")] });
    const { archiveProject } = await import("../src/renderer/src/lib/projectArchive");
    expect(await archiveProject({ ...base, hostId: "local", withDirector: true })).toBe(true);
    expect(mock.log).toEqual(["local:project:archive:p1", "local:cutex/session/retire:dir"]);
    expect(sessionAction.mock.calls[0]![2]).toMatchObject({ reason: "desktop", expectedRevision: 3, expectedRuntimeGeneration: 2 });
    const { getUiPrefs } = await import("../src/renderer/src/lib/prefs");
    expect(getUiPrefs().projectDirectors['["local","p1"]']).toBe("dir");
  });

  it("without the box only the project is archived", async () => {
    await setup("local", "local", { active: [session("dir")] });
    const { archiveProject } = await import("../src/renderer/src/lib/projectArchive");
    expect(await archiveProject({ ...base, hostId: "local", withDirector: false })).toBe(false);
    expect(mock.log).toEqual(["local:project:archive:p1"]);
  });

  it("a failed project archive retires nothing", async () => {
    await setup("local", "local", { active: [session("dir")] });
    mock.failProject = true;
    const { archiveProject } = await import("../src/renderer/src/lib/projectArchive");
    await expect(archiveProject({ ...base, hostId: "local", withDirector: true })).rejects.toThrow("conflict");
    expect(mock.log).toEqual(["local:project:archive:p1"]);
  });

  it("a failed retire keeps the project archived and offers a retry", async () => {
    await setup("local", "local", { active: [session("dir")] });
    mock.failRetire = 1;
    mock.confirms = [true];
    const { archiveProject } = await import("../src/renderer/src/lib/projectArchive");
    expect(await archiveProject({ ...base, hostId: "local", withDirector: true })).toBe(true);
    expect(mock.log).toEqual(["local:project:archive:p1", "local:cutex/session/retire:dir", "local:cutex/session/retire:dir"]);
    expect(mock.dialogs[0]!.message).toBe("projects.archiveDirectorFailed(P1,DIR,busy)");
    expect(mock.dialogs[0]!.labels).toEqual({ ok: "projects.archiveDirectorRetry", cancel: "projects.archiveDirectorLater" });
  });

  it("giving up after a failed retire: no rollback of the project", async () => {
    await setup("local", "local", { active: [session("dir")] });
    mock.failRetire = 5;
    mock.confirms = [false];
    const { archiveProject } = await import("../src/renderer/src/lib/projectArchive");
    expect(await archiveProject({ ...base, hostId: "local", withDirector: true })).toBe(false);
    expect(mock.log).toEqual(["local:project:archive:p1", "local:cutex/session/retire:dir"]);
    expect(mock.log.some((l) => l.includes("restore"))).toBe(false);
  });

  it("goes to the project's host, not the focus host", async () => {
    const { sessionAction, refreshHostSidebar } = await setup("local", "workstation", { active: [session("dir")] });
    const { archiveProject } = await import("../src/renderer/src/lib/projectArchive");
    expect(await archiveProject({ ...base, hostId: "workstation", withDirector: true })).toBe(true);
    expect(mock.log).toEqual(["workstation:project:archive:p1", "workstation:cutex/session/retire:dir"]);
    expect(mock.apis.local.projectMutation).not.toHaveBeenCalledWith("p1", expect.anything(), expect.anything());
    expect(sessionAction.mock.calls[0]![3]).toBe("workstation");
    expect(refreshHostSidebar).toHaveBeenCalledWith("workstation");
  });
});

describe("restoreWithDirector", () => {
  it("offers 「同时恢复主管」 for a member of an archived project whose Director is archived: project, member, Director", async () => {
    await setup("local", "workstation", { retired: [session("m", { retired: true, projectId: "p1" }), session("dir", { retired: true, projectId: "p1" })], archived: [summary("p1", "dir")] });
    mock.confirms = [true];
    const { restoreWithDirector } = await import("../src/renderer/src/lib/projectArchive");
    const member = session("m", { retired: true, projectId: "p1" });
    expect(await restoreWithDirector(member, t, "workstation")).toBe(true);
    expect(mock.dialogs[0]!.check).toMatchObject({ label: "archive.restoreDirector(DIR)", checked: true });
    expect(mock.log).toEqual(["workstation:project:restore:p1", "workstation:cutex/session/restore:m", "workstation:cutex/session/restore:dir"]);
  });

  it("unchecked: only the project and the member; cancelled: nothing", async () => {
    await setup("local", "local", { retired: [session("dir", { retired: true, projectId: "p1" })], archived: [summary("p1", "dir")] });
    const { restoreWithDirector } = await import("../src/renderer/src/lib/projectArchive");
    const { confirmDialog } = await import("../src/renderer/src/lib/contextMenu");
    const member = session("m", { retired: true, projectId: "p1" });
    expect(await restoreWithDirector(member, t, "local")).toBe(false);
    expect(mock.log).toEqual([]);
    vi.mocked(confirmDialog).mockImplementationOnce(async (_m, _d, _l, check) => {
      check!.checked = false;
      return true;
    });
    expect(await restoreWithDirector(member, t, "local")).toBe(true);
    expect(mock.log.filter((l) => !l.includes("project:"))).toEqual(["local:cutex/session/restore:m"]);
  });

  it("restoring the Director itself asks nothing (its project comes back first, as before)", async () => {
    // (own project id: restoreArchived shares one project restore per project revision)
    await setup("local", "local", { retired: [session("dir", { retired: true, projectId: "p3" })], archived: [summary("p3", "dir")] });
    const { restoreWithDirector } = await import("../src/renderer/src/lib/projectArchive");
    expect(await restoreWithDirector(session("dir", { retired: true, projectId: "p3" }), t, "local")).toBe(true);
    expect(mock.dialogs).toEqual([]);
    expect(mock.log).toEqual(["local:project:restore:p3", "local:cutex/session/restore:dir"]);
  });

  it("falls back to the Director remembered at archive time; unknown → no option", async () => {
    const prefs = await import("../src/renderer/src/lib/prefs");
    const { archivedDirectorOf } = await import("../src/renderer/src/lib/projectArchive");
    const member = session("m", { retired: true, projectId: "p1" });
    await setup("local", "local", { retired: [session("dir", { retired: true })], archived: [summary("p1", null)] });
    expect(archivedDirectorOf(member, "local")).toBeNull();
    prefs.setProjectDirector("local", "p1", "dir");
    expect(archivedDirectorOf(member, "local")?.director.cutexSessionId).toBe("dir");
    // Another host's memory does not apply.
    expect(archivedDirectorOf(member, "workstation")).toBeNull();
  });

  it("no option when the Director is still active or the project is not archived", async () => {
    const { archivedDirectorOf } = await import("../src/renderer/src/lib/projectArchive");
    const member = session("m", { retired: true, projectId: "p1" });
    await setup("local", "local", { active: [session("dir")], archived: [summary("p1", "dir")] });
    expect(archivedDirectorOf(member, "local")).toBeNull();
    await setup("local", "local", { retired: [session("dir", { retired: true })], archived: [] });
    expect(archivedDirectorOf(member, "local")).toBeNull();
  });
});
