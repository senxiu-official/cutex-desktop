// 项目 page tabs (contract v1.12, docs/desktop-modules.md §21): core tabs + `project.tab` items, and the
// pure filters of the two contributing modules (成果库 list request, a project's services).
import { describe, expect, it } from "vitest";
import type { ServiceView } from "../src/shared/ipc";
import { mergeProjectTabs, type ProjectTabEntry } from "../src/renderer/src/lib/projectTabs";
import { DEFAULT_LIBRARY, libraryQuery, libraryScopeKey } from "../src/renderer/src/modules/artifacts/model";
import { projectServiceList } from "../src/renderer/src/modules/services/model";
import type { MessageKey } from "../src/renderer/src/i18n";

const entry = (id: string, tab: string, order: number): ProjectTabEntry =>
  ({ moduleId: id.split(".")[0]!, mode: "show", item: { id, tab, order, titleKey: `${id}.title` as MessageKey, Body: () => null } }) as unknown as ProjectTabEntry;

describe("mergeProjectTabs", () => {
  it("is the core tabs alone without module items", () => {
    expect(mergeProjectTabs([]).map((x) => x.tab)).toEqual(["overview", "agents", "tasks", "memory", "settings"]);
    expect(mergeProjectTabs([])[0]).toEqual({ tab: "overview", titleKey: "projects.tab.overview", entry: null });
  });

  it("puts module tabs between the core ones by order (成果库 / 服务 after 委托)", () => {
    const tabs = mergeProjectTabs([entry("services.projectTab", "services", 320), entry("artifacts.projectTab", "artifacts", 310)]);
    expect(tabs.map((x) => x.tab)).toEqual(["overview", "agents", "tasks", "artifacts", "services", "memory", "settings"]);
    expect(tabs[3]!.entry?.item.id).toBe("artifacts.projectTab");
    expect(tabs[3]!.titleKey).toBe("artifacts.projectTab.title");
  });

  it("lets a core tab win an order tie and drops items reusing a taken tab name", () => {
    const tabs = mergeProjectTabs([entry("b.tab", "x", 300), entry("a.tab", "x", 300), entry("c.tab", "memory", 50), entry("d.tab", "last", 900)]);
    expect(tabs.map((x) => `${x.tab}:${x.entry?.item.id ?? "core"}`)).toEqual(["overview:core", "agents:core", "tasks:core", "x:a.tab", "memory:core", "settings:core", "last:d.tab"]);
  });
});

describe("libraryQuery", () => {
  it("asks for one project's scope on the 项目 page and the session's publish scope in the side card", () => {
    expect(libraryQuery({ project: "scp" }, DEFAULT_LIBRARY, 100)).toEqual({ project: "scp", archived: "false", limit: 100 });
    expect(libraryQuery({ forSession: "s1" }, { q: "fig", kind: "figure", archived: "all" }, 50, "100")).toEqual({ forSession: "s1", q: "fig", kind: "figure", archived: "all", limit: 50, cursor: "100" });
  });

  it("keys the two scopes apart", () => {
    expect(libraryScopeKey({ project: "a" })).not.toBe(libraryScopeKey({ forSession: "a" }));
  });
});

describe("projectServiceList", () => {
  const svc = (slug: string, projectId: string | null, health: ServiceView["health"], displayName = slug) => ({ slug, displayName, projectId, health, runtime: "managed", process: null }) as unknown as ServiceView;

  it("keeps only the project's services, problems first, then by name", () => {
    const list = [svc("b", "p", "reachable"), svc("a", "p", "reachable"), svc("x", "q", "unreachable"), svc("c", null, "stopped"), svc("d", "p", "unreachable")];
    expect(projectServiceList(list, "p").map((s) => s.slug)).toEqual(["d", "a", "b"]);
  });

  it("is empty for an unknown list or a project without services", () => {
    expect(projectServiceList(null, "p")).toEqual([]);
    expect(projectServiceList([svc("a", "q", "reachable")], "p")).toEqual([]);
  });
});
