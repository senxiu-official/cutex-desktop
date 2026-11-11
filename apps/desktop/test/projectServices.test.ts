// Project services (cutex r267 `services-project-scope`): scope display, the owner's promote / demote
// payloads, the claim-candidate rule, capability gating of the menu rows, youMayManage, the open
// tombstone reason union and directorChanged.projectServiceCount.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
import type { ServicePatch, ServiceReclaimReason, ServiceTombstone, ServiceView, SidebarSnapshot } from "../src/shared/ipc";
import { SERVICES_PROJECT_SCOPE_FEATURE } from "../src/shared/servicesSettings";
import {
  claimCandidates,
  claimProjectChoices,
  directorChangedServiceCount,
  formerDirectorsOf,
  registrantProject,
  scopePatch,
  serviceMayManage,
  serviceScope,
} from "../src/renderer/src/lib/projectServices";
import { serviceMenu, serviceScopeEntries } from "../src/renderer/src/lib/services";
import type { MenuAction, MenuEntry } from "../src/renderer/src/lib/contextMenu";

function staticSubmenu(entries: MenuAction["submenu"]): MenuEntry[] {
  expect(Array.isArray(entries)).toBe(true);
  if (!Array.isArray(entries)) throw new Error("Expected a static submenu fixture");
  return entries;
}
import { useApp } from "../src/renderer/src/store";

const svc = (slug: string, over: Partial<ServiceView> = {}): ServiceView =>
  ({ slug, displayName: slug, host: "h", port: 1, path: null, ownerCutexSessionId: null, projectId: null, runtime: "managed", createdAt: "", lastSeenAt: null, health: "reachable", url: "http://h:1/", localUrl: "http://127.0.0.1:1/", ...over }) as ServiceView;

const session = (id: string, name = id) => ({ cutexSessionId: id, displayName: name }) as unknown as SidebarSnapshot["active"][number];
const project = (id: string, director: string | null, name = id) =>
  ({ project_id: id, authority_epoch: 1, director_cutex_session_id: director, presentation: { display_name: name, badge_label: name[0], color: "blue" }, active_member_count: 1, lifecycle: "active" }) as never;
const sidebar: SidebarSnapshot = {
  active: [session("dir", "Director"), session("member", "Member"), session("elsewhere"), session("ex-dir", "Ex Director")],
  retired: [session("gone", "Gone")],
  projects: { schema: "x", projects: [project("p1", "dir", "Project One"), project("p2", "elsewhere", "Project Two")] },
  hostRows: {
    dir: { projectId: "p1" },
    member: { projectId: "p1" },
    elsewhere: { projectId: "p2" },
    "ex-dir": { projectId: "p1" },
    gone: { projectId: "p1" },
  } as unknown as SidebarSnapshot["hostRows"],
};

const actions = (entries: MenuEntry[]) => entries.filter((e): e is MenuAction => !!e && typeof e === "object");
const labels = (entries: MenuEntry[]) => actions(entries).map((e) => e.label);

describe("scope display", () => {
  it("treats a missing or unknown ownerScope as session (never widens)", () => {
    expect(serviceScope(svc("a"))).toBe("session");
    expect(serviceScope(svc("a", { ownerScope: "session" }))).toBe("session");
    expect(serviceScope(svc("a", { ownerScope: "team" as never }))).toBe("session");
    expect(serviceScope(svc("a", { ownerScope: "project", projectId: "p1" }))).toBe("project");
  });
  it("youMayManage: only an explicit false denies (the owner list omits it)", () => {
    expect(serviceMayManage(svc("a"))).toBe(true);
    expect(serviceMayManage(svc("a", { youMayManage: true }))).toBe(true);
    expect(serviceMayManage(svc("a", { youMayManage: false }))).toBe(false);
  });
});

describe("promote / demote payloads", () => {
  it("promotes with ownerScope only when the record already has a projectId", () => {
    expect(scopePatch(svc("a", { projectId: "p1" }), "project")).toEqual({ ownerScope: "project" });
  });
  it("promotes a record without a projectId together with the picked project, or not at all", () => {
    expect(scopePatch(svc("a"), "project", "p2")).toEqual({ ownerScope: "project", projectId: "p2" });
    expect(scopePatch(svc("a"), "project")).toBeNull();
  });
  it("demotes with ownerScope session only (projectId stays for visibility)", () => {
    expect(scopePatch(svc("a", { ownerScope: "project", projectId: "p1" }), "session")).toEqual({ ownerScope: "session" });
  });
  it("sends nothing when the scope is already the target", () => {
    expect(scopePatch(svc("a", { projectId: "p1" }), "session")).toBeNull();
    expect(scopePatch(svc("a", { ownerScope: "project", projectId: "p1" }), "project")).toBeNull();
  });
  it("defaults the project pick to the registrant's project", () => {
    expect(registrantProject(svc("a", { ownerCutexSessionId: "elsewhere" }), sidebar)).toBe("p2");
    const choices = claimProjectChoices(svc("a", { ownerCutexSessionId: "elsewhere" }), sidebar);
    expect(choices.map((c) => [c.project.project_id, c.registrants])).toEqual([["p2", true], ["p1", false]]);
  });
});

describe("menu rows", () => {
  const t = (k: string, vars?: Record<string, string | number>) => (vars ? `${k}(${JSON.stringify(vars)})` : k);
  it("a session service with a project: one armed row that patches {ownerScope: project}", () => {
    const sent: ServicePatch[] = [];
    const [row] = actions(serviceScopeEntries(svc("a", { projectId: "p1" }), t, sidebar, (p) => sent.push(p)));
    expect(row!.label).toBe("services.ownerScope.toProject");
    expect(row!.armed).toContain("Project One");
    void row!.onSelect();
    expect(sent).toEqual([{ ownerScope: "project" }]);
  });
  it("a project service: an armed 转为个人服务 row that patches {ownerScope: session}", () => {
    const sent: ServicePatch[] = [];
    const [row] = actions(serviceScopeEntries(svc("a", { projectId: "p1", ownerScope: "project" }), t, sidebar, (p) => sent.push(p)));
    expect(row!.label).toBe("services.ownerScope.toSession");
    expect(row!.armed).toBeTruthy();
    void row!.onSelect();
    expect(sent).toEqual([{ ownerScope: "session" }]);
  });
  it("no projectId: a project submenu, registrant's project first, each armed and sending the projectId", () => {
    const sent: ServicePatch[] = [];
    const [row] = actions(serviceScopeEntries(svc("a", { ownerCutexSessionId: "elsewhere" }), t, sidebar, (p) => sent.push(p)));
    const items = actions(staticSubmenu(row!.submenu ?? []));
    expect(items.map((i) => i.label)).toEqual(["Project Two", "Project One"]);
    expect(items[0]!.hint).toBe("services.ownerScope.registrantsProject");
    expect(items.every((i) => !!i.armed)).toBe(true);
    void items[1]!.onSelect();
    expect(sent).toEqual([{ ownerScope: "project", projectId: "p1" }]);
  });
  it("no projects on the host: a disabled row", () => {
    const [row] = actions(serviceScopeEntries(svc("a"), t, { ...sidebar, projects: null }, () => {}));
    expect(row!.disabled).toBe(true);
  });

  describe("capability gating and youMayManage in serviceMenu", () => {
    beforeEach(() => useApp.setState({ hosts: null, features: new Set(), sidebar } as never));
    const menuLabels = (s: ServiceView) => labels(serviceMenu(s, (k) => k, () => {}, () => {}, "local"));
    it("an older host (no services-project-scope) offers no scope rows", () => {
      expect(menuLabels(svc("a", { projectId: "p1" }))).not.toContain("services.ownerScope.toProject");
    });
    it("a host with the capability offers them", () => {
      useApp.setState({ features: new Set([SERVICES_PROJECT_SCOPE_FEATURE]) } as never);
      expect(menuLabels(svc("a", { projectId: "p1" }))).toContain("services.ownerScope.toProject");
      expect(menuLabels(svc("a", { projectId: "p1", ownerScope: "project" }))).toContain("services.ownerScope.toSession");
      expect(menuLabels(svc("a", { projectId: "p1", archived: true }))).not.toContain("services.ownerScope.toProject");
    });
    it("youMayManage false hides the manage actions, keeps open / copy / logs", () => {
      useApp.setState({ features: new Set([SERVICES_PROJECT_SCOPE_FEATURE]) } as never);
      const l = menuLabels(svc("a", { projectId: "p1", youMayManage: false }));
      for (const k of ["services.stop", "services.restart", "services.delete", "services.ownerScope.toProject"]) expect(l).not.toContain(k);
      expect(l).toEqual(expect.arrayContaining(["services.open", "services.copyUrl", "services.logs"]));
    });
  });
});

describe("claim candidates", () => {
  const services = [
    svc("dir-own", { projectId: "p1", ownerCutexSessionId: "dir" }),
    svc("member-own", { projectId: "p1", ownerCutexSessionId: "member" }),
    svc("archived-registrant", { projectId: "p1", ownerCutexSessionId: "gone" }),
    svc("left-project", { projectId: "p1", ownerCutexSessionId: "elsewhere" }),
    svc("no-registrant", { projectId: "p1" }),
    svc("unknown-registrant", { projectId: "p1", ownerCutexSessionId: "deleted" }),
    svc("former-director", { projectId: "p1", ownerCutexSessionId: "ex-dir" }),
    svc("already-project", { projectId: "p1", ownerCutexSessionId: "gone", ownerScope: "project" }),
    svc("archived-service", { projectId: "p1", ownerCutexSessionId: "gone", archived: true }),
    svc("other-project", { projectId: "p2", ownerCutexSessionId: "gone" }),
  ];
  it("lists the project's session services of former Directors / archived / gone / departed registrants", () => {
    const got = claimCandidates(services, "p1", sidebar, new Set(["ex-dir"]));
    expect(Object.fromEntries(got.map((c) => [c.service.slug, c.reason]))).toEqual({
      "archived-registrant": "archived",
      "left-project": "left",
      "no-registrant": "noRegistrant",
      "unknown-registrant": "noRegistrant",
      "former-director": "formerDirector",
    });
  });
  it("without Director history a former Director still in the project is not a candidate", () => {
    expect(claimCandidates(services, "p1", sidebar).map((c) => c.service.slug)).not.toContain("former-director");
  });
  it("nothing without a sidebar", () => {
    expect(claimCandidates(services, "p1", null)).toEqual([]);
  });
  it("former Directors come from finalized changes that replaced them, never the current one", () => {
    const ids = formerDirectorsOf([
      { state: "finalized", oldDirector: "a", newDirector: "b" },
      { state: "prepared", oldDirector: "x", newDirector: "b" },
      { state: "finalized", oldDirector: null, newDirector: "a" },
      { state: "finalized", oldDirector: "b", newDirector: "b" },
      { state: "finalized", oldDirector: "cur", newDirector: null },
    ], "cur");
    expect([...ids]).toEqual(["a"]);
  });
});

describe("protocol", () => {
  it("tombstone reasons are an open union (r267 project_archived and future values parse)", () => {
    const reasons: ServiceReclaimReason[] = ["idle", "ttl", "owner_archived", "project_archived", "some_future_reason"];
    const stone: ServiceTombstone = { slug: "a", displayName: "A", ownerCutexSessionId: null, lifetime: "ephemeral", reason: "project_archived", reclaimedAt: "" };
    expect(reasons).toContain(stone.reason);
  });
  it("directorChanged.projectServiceCount: a count, else null (absent / null / malformed)", () => {
    expect(directorChangedServiceCount({ projectId: "p", projectServiceCount: 3 })).toBe(3);
    expect(directorChangedServiceCount({ projectId: "p", projectServiceCount: 0 })).toBe(0);
    expect(directorChangedServiceCount({ projectId: "p", projectServiceCount: null })).toBeNull();
    expect(directorChangedServiceCount({ projectId: "p" })).toBeNull();
    expect(directorChangedServiceCount({ projectId: "p", projectServiceCount: -1 })).toBeNull();
    expect(directorChangedServiceCount({ projectId: "p", projectServiceCount: "2" })).toBeNull();
    expect(directorChangedServiceCount(null)).toBeNull();
  });
});
