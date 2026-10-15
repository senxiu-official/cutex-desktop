import { describe, expect, it } from "vitest";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { addGrant, addLink, domainLabel, domainOptions, externalCandidates, grantedProjects, grantsFor, parseDomain, removeGrant, removeLink } from "../src/renderer/src/lib/agentSecurity";
import { defaultableState } from "../src/renderer/src/lib/profileKind";

const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name }) as never;
const project = (id: string, name: string, lifecycle = "active") => ({ project_id: id, presentation: { display_name: name, badge_label: "", color: "cyan" }, lifecycle }) as never;
const sidebar = {
  active: [session("eva", "Eva"), session("wave", "Wave"), session("scratch", "scratch"), session("chat", "Chat")],
  retired: [session("old", "Old")],
  projects: { schema: "x", projects: [project("desktop", "cutex-desktop"), project("waveline", "waveline"), project("gone", "gone", "archived")] },
  hostRows: { eva: { projectId: "desktop" }, wave: { projectId: "waveline" }, scratch: { projectId: null }, chat: {} },
} as unknown as SidebarSnapshot;

describe("domains", () => {
  it("lists active projects, then agents outside every project", () => {
    expect(domainOptions(sidebar).map((d) => d.key)).toEqual(["project:desktop", "project:waveline", "agent:scratch", "agent:chat"]);
  });

  it("parses and labels domain keys, also unknown ones", () => {
    expect(parseDomain("agent:cutex.1")).toEqual({ kind: "agent", id: "cutex.1" });
    expect(parseDomain("group:x")).toBeNull();
    expect(domainLabel("project:desktop", sidebar)).toEqual({ label: "cutex-desktop", kind: "project", known: true });
    expect(domainLabel("agent:old", sidebar)).toEqual({ label: "Old", kind: "agent", known: true });
    expect(domainLabel("agent:nobody", sidebar)).toEqual({ label: "nobody", kind: "agent", known: false });
  });
});

describe("links", () => {
  it("refuses self links, duplicates in either order and overflow", () => {
    const links = addLink([], "project:a", "project:b");
    expect(links).toEqual([["project:a", "project:b"]]);
    expect(addLink(links as never, "project:b", "project:a")).toBe("duplicate");
    expect(addLink([], "project:a", "project:a")).toBe("self");
    expect(addLink([["project:x", "project:y"]], "project:a", "project:b", 1)).toBe("max");
  });

  it("removes a link given in either order", () => {
    expect(removeLink([["project:a", "project:b"], ["project:a", "agent:c"]], ["project:b", "project:a"])).toEqual([["project:a", "agent:c"]]);
  });
});

describe("external agent grants", () => {
  it("offers agents outside the project, independent ones first, minus granted ones", () => {
    const grants = [{ project: "desktop", agent: "chat" }];
    expect(externalCandidates(sidebar, "desktop", grants)).toEqual([
      { id: "scratch", name: "scratch", projectId: null, projectName: null },
      { id: "wave", name: "Wave", projectId: "waveline", projectName: "waveline" },
    ]);
  });

  it("adds and removes per project", () => {
    const one = addGrant([], "desktop", "wave");
    expect(one).toEqual([{ project: "desktop", agent: "wave" }]);
    expect(addGrant(one as never, "desktop", "wave")).toBe("duplicate");
    const two = addGrant(one as never, "waveline", "scratch") as never;
    expect(grantsFor(two, "desktop")).toEqual([{ project: "desktop", agent: "wave" }]);
    expect(removeGrant(two, "desktop", "wave")).toEqual([{ project: "waveline", agent: "scratch" }]);
    expect(addGrant(one as never, "x", "y", 1)).toBe("max");
  });
});

describe("profile defaultable option", () => {
  it("shows the default while nothing is stored", () => {
    expect(defaultableState(undefined, null, true)).toEqual({ checked: true, explicit: false });
    expect(defaultableState(undefined, undefined, false)).toEqual({ checked: false, explicit: false });
  });
  it("shows a stored value as explicit", () => {
    expect(defaultableState(undefined, false, true)).toEqual({ checked: false, explicit: true });
    expect(defaultableState(undefined, true, false)).toEqual({ checked: true, explicit: true });
  });
  it("prefers the draft: a toggle is explicit, a reset (null) is the default", () => {
    expect(defaultableState(true, false, false)).toEqual({ checked: true, explicit: true });
    expect(defaultableState(null, false, true)).toEqual({ checked: true, explicit: false });
  });
});

describe("grantedProjects (协作 → 可见的外部 agent)", () => {
  it("lists only projects with grants, sidebar order first, unknown ids last", () => {
    expect(grantedProjects(sidebar, undefined)).toEqual([]);
    expect(grantedProjects(sidebar, [])).toEqual([]);
    const grants = [
      { project: "ghost", agent: "eva" },
      { project: "waveline", agent: "eva" },
      { project: "gone", agent: "wave" },
      { project: "waveline", agent: "scratch" },
    ];
    expect(grantedProjects(sidebar, grants)).toEqual(["waveline", "gone", "ghost"]);
  });
});
