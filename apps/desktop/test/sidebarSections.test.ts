// Sidebar project sections (lib/sidebarSections) + local host marks (lib/scopedSidebarView sidebarMark).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { AgentRow, AgentStatus, ProjectGroup, SidebarGroup } from "../src/renderer/src/lib/sidebar";
import { layoutSidebar, type LayoutContext } from "../src/renderer/src/lib/sidebarLayout";
import {
  assignSection,
  createSection,
  deleteSection,
  memberKey,
  migrateSections,
  moveSection,
  renameSection,
  sectionOf,
  setSectionCollapsed,
  splitBySection,
  summarizeSection,
  visibleInSection,
  type SidebarSection,
} from "../src/renderer/src/lib/sidebarSections";
import { hostKey } from "../src/renderer/src/lib/hostKeys";
import type { AgentSignal } from "../src/renderer/src/lib/agentAttention";
import type { HostLook } from "../src/renderer/src/lib/hostScope";

function row(id: string, status: AgentStatus = "idle", hostId?: string): AgentRow {
  const session = { cutexSessionId: id, displayName: id, runtime: { activeTurnObservedAt: null } } as unknown as SessionResource;
  return { id, name: id, subtitle: "", status, isDirector: false, pinned: false, lastActivity: 0, profile: null, color: null, session, ...(hostId && { hostId, key: hostKey(hostId, id) }) };
}

function project(id: string, hostId: string, rows: AgentRow[]): ProjectGroup {
  return { kind: "project", id, name: id, badge: "", color: "blue", hostId, key: hostKey(hostId, id), online: rows.filter((r) => r.status !== "offline"), offline: rows.filter((r) => r.status === "offline") };
}

const ctx = (signals: Record<string, AgentSignal> = {}, searching = false): LayoutContext => ({
  signalOf: (k) => signals[k],
  selectedId: null,
  starred: new Set(),
  prefs: { grouping: "all", noOnline: "collapse", running: "avatars", foldIdle: true },
  searching,
});

describe("section membership", () => {
  it("is keyed by host + project, so each host's same-named project moves on its own", () => {
    const local = project("waveline", "local", [row("a", "idle", "local")]);
    const workstation = project("waveline", "workstation", [row("b", "idle", "workstation")]);
    const indep: SidebarGroup = { kind: "independent", id: "__independent__", name: "", hostId: "local", online: [], offline: [] } as unknown as SidebarGroup;
    expect(memberKey(local, "local")).toBe(hostKey("local", "waveline"));
    expect(memberKey({ id: "waveline" }, "workstation")).toBe(hostKey("workstation", "waveline"));
    const sections = createSection([], "不重要", [memberKey(workstation, "local")], "s1");
    const { rest, bySection } = splitBySection([local, workstation, indep], sections, "local");
    expect(rest).toEqual([local, indep]);
    expect(bySection.get("s1")).toEqual([workstation]);
  });

  it("a project sits in one section; leaving the last member removes the section", () => {
    let s: SidebarSection[] = createSection([], "A", ["k1", "k2"], "a");
    s = createSection(s, "  B  ", ["k2"], "b");
    expect(s.map((x) => [x.name, x.members])).toEqual([["A", ["k1"]], ["B", ["k2"]]]);
    s = assignSection(s, "k1", "b");
    expect(s.map((x) => x.id)).toEqual(["b"]);
    expect(sectionOf(s, "k1")?.id).toBe("b");
    s = assignSection(s, "k1", null);
    expect(s[0]!.members).toEqual(["k2"]);
    expect(assignSection(s, "k2", "b")).toEqual(s);
  });

  it("rename / delete / collapse / move among visible sections", () => {
    let s = [createSection([], "A", ["x"], "a"), createSection([], "B", ["y"], "b"), createSection([], "C", ["z"], "c")].flat();
    expect(renameSection(s, "a", "  ")[0]!.name).toBe("A");
    expect(renameSection(s, "a", " Low ")[0]!.name).toBe("Low");
    s = setSectionCollapsed(s, "b", true);
    expect(s[1]!.collapsed).toBe(true);
    // B is hidden in this scope: C moves up past it, swapping with A.
    expect(moveSection(s, "c", -1, ["a", "c"]).map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(moveSection(s, "a", -1).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(deleteSection(s, "b").map((x) => x.id)).toEqual(["a", "c"]);
  });
});

describe("section prefs", () => {
  it("migrateSections sanitises stored values", () => {
    expect(migrateSections(undefined)).toEqual([]);
    expect(migrateSections("x")).toEqual([]);
    const k = hostKey("local", "p");
    expect(
      migrateSections([
        { id: "a", name: "A", collapsed: true, members: [k, "bare-legacy", 3, k] },
        { id: "a", name: "dup", members: [] },
        { id: "b", name: "B", members: [k, hostKey("workstation", "p")] },
        { name: "no id" },
        null,
      ]),
    ).toEqual([
      { id: "a", name: "A", collapsed: true, members: [k] },
      { id: "b", name: "B", collapsed: false, members: [hostKey("workstation", "p")] },
    ]);
  });

  describe("persistence", () => {
    const storage = new Map<string, string>();
    beforeEach(() => {
      vi.resetModules();
      storage.clear();
      vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
    });

    it("new fields default cleanly on old prefs", async () => {
      storage.set("cutex-desktop.ui", JSON.stringify({ sendKeys: "cli", sidebarSections: "garbage", sectionCollapsedShows: "nope" }));
      const prefs = await import("../src/renderer/src/lib/prefs");
      const p = prefs.getUiPrefs();
      expect(p.sidebarSections).toEqual([]);
      expect(p.sectionCollapsedShows).toBe("summary");
      expect(p.hostMarkLocal).toBe(false);
      expect(p.sendKeys).toBe("cli");
    });

    it("项目图标样式: tint by default, line kept, anything else back to tint", async () => {
      for (const [stored, want] of [[undefined, "tint"], ["line", "line"], ["tint", "tint"], ["solid", "tint"]] as const) {
        vi.resetModules();
        storage.set("cutex-desktop.ui", JSON.stringify(stored === undefined ? {} : { projectIconStyle: stored }));
        const prefs = await import("../src/renderer/src/lib/prefs");
        expect(prefs.getUiPrefs().projectIconStyle).toBe(want);
      }
    });

    it("updateSections persists and reloads, host keys untouched by the focus projection", async () => {
      const prefs = await import("../src/renderer/src/lib/prefs");
      const k = hostKey("workstation", "waveline");
      prefs.updateSections((list) => setSectionCollapsed(createSection(list, "不重要", [k], "s1"), "s1", true));
      expect(JSON.parse(storage.get("cutex-desktop.ui")!).sidebarSections).toEqual([{ id: "s1", name: "不重要", collapsed: true, members: [k] }]);
      vi.resetModules();
      const again = await import("../src/renderer/src/lib/prefs");
      expect(again.getUiPrefs().sidebarSections).toEqual([{ id: "s1", name: "不重要", collapsed: true, members: [k] }]);
    });
  });
});

describe("folded section", () => {
  const groups = [
    project("quiet", "local", [row("q", "offline", "local")]),
    project("busy", "local", [row("r", "running", "local"), row("n", "needsInput", "local")]),
    project("done", "workstation", [row("d", "idle", "workstation")]),
  ];
  const signals: Record<string, AgentSignal> = { [hostKey("local", "r")]: "running", [hostKey("local", "n")]: "needsYou", [hostKey("workstation", "d")]: "done" };

  it("sums needs-you / results / running so nothing important hides", () => {
    const l = layoutSidebar(groups, ctx(signals));
    const sum = summarizeSection([...l.main, ...l.others]);
    expect(sum).toEqual({ projects: 3, needsYou: 1, attention: 2, running: 1, hasSelected: false });
  });

  it("lists nothing (summary) or only projects that want the owner (attention)", () => {
    const l = layoutSidebar(groups, ctx(signals));
    const all = [...l.main, ...l.others];
    expect(visibleInSection(all, false, false, "summary")).toHaveLength(3);
    expect(visibleInSection(all, true, false, "summary")).toEqual([]);
    expect(visibleInSection(all, true, false, "attention").map((x) => x.group.id)).toEqual(["busy", "done"]);
  });

  it("searching auto-expands a folded section to its matches", () => {
    // The sidebar filters groups to matches first; a folded section then lists all of them.
    const matches = groups.filter((g) => g.id === "quiet");
    const l = layoutSidebar(matches, ctx(signals, true));
    expect(visibleInSection([...l.main, ...l.others], true, true, "summary").map((x) => x.group.id)).toEqual(["quiet"]);
  });
});

describe("local host marks", () => {
  it("marks only other hosts unless localMarks", async () => {
    const { sidebarMark } = await import("../src/renderer/src/lib/hostScope");
    const looks: Record<string, HostLook> = { local: { id: "local", local: true } as HostLook, workstation: { id: "workstation", local: false } as HostLook };
    const hosts = { marks: true, localMarks: false, look: (id: string | undefined) => looks[id ?? "local"] ?? null };
    expect(sidebarMark(hosts, "local")).toBeNull();
    expect(sidebarMark(hosts, undefined)).toBeNull();
    expect(sidebarMark(hosts, "workstation")?.id).toBe("workstation");
    expect(sidebarMark({ ...hosts, localMarks: true }, "local")?.id).toBe("local");
    expect(sidebarMark({ ...hosts, marks: false }, "workstation")).toBeNull();
    expect(sidebarMark(null, "workstation")).toBeNull();
  });
});
