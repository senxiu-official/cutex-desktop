// 本机备注 (lib/projectRemarks + prefs `projectRemarks`): sanitising, host keying, sidebar search.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { AgentRow, ProjectGroup, SidebarGroup } from "../src/renderer/src/lib/sidebar";
import { groupRemark, migrateRemarks, REMARK_MAX, sanitizeRemark, searchGroups, withRemark } from "../src/renderer/src/lib/projectRemarks";
import { hostKey } from "../src/renderer/src/lib/hostKeys";

function row(id: string, offline = false): AgentRow {
  const session = { cutexSessionId: id, displayName: id, runtime: {} } as unknown as SessionResource;
  return { id, name: id, subtitle: "", status: offline ? "offline" : "idle", isDirector: false, pinned: false, lastActivity: 0, profile: null, color: null, session };
}

function project(id: string, rows: AgentRow[], hostId?: string): ProjectGroup {
  return { kind: "project", id, name: id, badge: "", color: "blue", ...(hostId && { hostId, key: hostKey(hostId, id) }), online: rows.filter((r) => r.status !== "offline"), offline: rows.filter((r) => r.status === "offline") };
}

describe("sanitizeRemark", () => {
  it("makes one trimmed line", () => {
    expect(sanitizeRemark("  first\r\nsecond\n\tthird  ")).toBe("first second third");
    expect(sanitizeRemark("a    b")).toBe("a b");
    expect(sanitizeRemark(" \n ")).toBe("");
  });

  it("caps at REMARK_MAX code points", () => {
    expect(Array.from(sanitizeRemark("x".repeat(REMARK_MAX + 50))).length).toBe(REMARK_MAX);
    const emoji = "😀".repeat(REMARK_MAX + 1);
    expect(Array.from(sanitizeRemark(emoji)).length).toBe(REMARK_MAX);
    expect(sanitizeRemark(emoji)).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});

describe("remark records", () => {
  it("keys by host + project and removes on empty", () => {
    let r = withRemark({}, "local", "p1", " note\n2 ");
    expect(r).toEqual({ [hostKey("local", "p1")]: "note 2" });
    r = withRemark(r, "workstation", "p1", "other");
    expect(r[hostKey("workstation", "p1")]).toBe("other");
    expect(r[hostKey("local", "p1")]).toBe("note 2");
    const same = withRemark(r, "workstation", "p1", " other ");
    expect(same).toBe(r);
    r = withRemark(r, "local", "p1", "   ");
    expect(r).toEqual({ [hostKey("workstation", "p1")]: "other" });
  });

  it("migrates only host-keyed, non-empty strings", () => {
    expect(migrateRemarks(null)).toEqual({});
    expect(migrateRemarks(["x"])).toEqual({});
    expect(migrateRemarks({ p1: "bare", [hostKey("local", "p2")]: " ok\n", [hostKey("local", "p3")]: 3, [hostKey("local", "p4")]: "  " })).toEqual({ [hostKey("local", "p2")]: "ok" });
  });

  it("reads a group's note on its own host (focus when hostless); none for independent", () => {
    const remarks = { [hostKey("local", "p1")]: "here", [hostKey("workstation", "p1")]: "there" };
    expect(groupRemark(remarks, project("p1", []), "local")).toBe("here");
    expect(groupRemark(remarks, project("p1", [], "workstation"), "local")).toBe("there");
    expect(groupRemark(remarks, project("p1", []), "workstation")).toBe("there");
    const independent: SidebarGroup = { kind: "independent", id: "p1", online: [], offline: [] } as unknown as SidebarGroup;
    expect(groupRemark(remarks, independent, "local")).toBe("");
  });
});

describe("searchGroups", () => {
  const groups = [project("alpha", [row("a1"), row("a2", true)]), project("beta", [row("b1")]), project("gamma", [])];
  const remarks: Record<string, string> = { alpha: "Paper Draft", gamma: "empty but noted" };
  const rowMatch = (q: string) => (r: AgentRow) => r.name.includes(q);

  it("keeps a group whole when its note matches", () => {
    const out = searchGroups(groups, "draft", rowMatch("draft"), (g) => remarks[g.id] ?? "");
    expect(out.map((g) => g.id)).toEqual(["alpha"]);
    expect(out[0]!.online.length + out[0]!.offline.length).toBe(2);
  });

  it("lists a matching group even without agents; otherwise filters agents", () => {
    expect(searchGroups(groups, "noted", rowMatch("noted"), (g) => remarks[g.id] ?? "").map((g) => g.id)).toEqual(["gamma"]);
    const out = searchGroups(groups, "b1", rowMatch("b1"), (g) => remarks[g.id] ?? "");
    expect(out.map((g) => g.id)).toEqual(["beta"]);
    expect(searchGroups(groups, "", rowMatch(""), () => "")).toHaveLength(3);
  });
});

describe("prefs projectRemarks", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  });

  it("persists per host key and sanitises", async () => {
    const prefs = await import("../src/renderer/src/lib/prefs");
    prefs.setProjectRemark("workstation", "p1", "line one\nline two");
    prefs.setProjectRemark("local", "p1", "mine");
    expect(prefs.getUiPrefs().projectRemarks).toEqual({ [hostKey("workstation", "p1")]: "line one line two", [hostKey("local", "p1")]: "mine" });
    expect(JSON.parse(storage.get("cutex-desktop.ui")!).projectRemarks[hostKey("workstation", "p1")]).toBe("line one line two");
    prefs.setProjectRemark("local", "p1", "");
    expect(prefs.getUiPrefs().projectRemarks).toEqual({ [hostKey("workstation", "p1")]: "line one line two" });
  });

  it("drops malformed stored entries on load", async () => {
    storage.set("cutex-desktop.ui", JSON.stringify({ projectRemarks: { bare: "x", [hostKey("local", "p")]: "ok" } }));
    const prefs = await import("../src/renderer/src/lib/prefs");
    expect(prefs.getUiPrefs().projectRemarks).toEqual({ [hostKey("local", "p")]: "ok" });
  });
});
