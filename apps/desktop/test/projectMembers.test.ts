// lib/projectMembers (DESIGN §4.18): the project page's 添加成员 / Director pickers — who can be
// picked (cutex add_member / Director rules), search, filters and sort.
import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { addCandidates, DEFAULT_PICKER_QUERY, detachable, directorChoices, filterCandidates } from "../src/renderer/src/lib/projectMembers";
import type { AgentRow, SidebarGroup } from "../src/renderer/src/lib/sidebar";

function row(id: string, name: string, over: { status?: AgentRow["status"]; last?: number; note?: string; claude?: boolean; director?: boolean } = {}): AgentRow {
  const session = {
    cutexSessionId: id,
    displayName: name,
    note: over.note ?? null,
    runtime: { backend: over.claude ? "claude_subscription" : "codex" },
  } as unknown as SessionResource;
  return { id, name, subtitle: "", status: over.status ?? "offline", isDirector: !!over.director, pinned: false, lastActivity: over.last ?? 0, profile: null, color: null, session };
}

const groups: SidebarGroup[] = [
  {
    kind: "project",
    id: "demo",
    name: "demo-study",
    badge: "S",
    color: "green",
    online: [row("dir", "demo-director", { status: "running", last: 50, director: true }), row("run", "demo-sampler", { status: "idle", last: 40 })],
    offline: [row("lit", "demo-lit", { last: 10, note: "文献表" }), row("rev", "demo-reviewer", { last: 30, claude: true })],
  },
  { kind: "project", id: "kks", name: "kks", badge: "K", color: "red", online: [], offline: [row("web", "kks-web", { last: 20 })] },
  { kind: "independent", id: "__independent__", online: [row("solo", "Atlas", { status: "idle", last: 60 })], offline: [row("old", "aria", { last: 5, claude: true })] },
];
const lastOf = (r: AgentRow) => r.lastActivity;
const ids = (list: { row: AgentRow }[]) => list.map((c) => c.row.id);

describe("addCandidates", () => {
  it("lists every agent outside the project; only independent ones are pickable", () => {
    const list = addCandidates(groups, "demo");
    expect(ids(list).sort()).toEqual(["old", "solo", "web"]);
    expect(list.find((c) => c.row.id === "web")).toMatchObject({ projectId: "kks", projectName: "kks", pickable: false, online: false });
    expect(list.find((c) => c.row.id === "solo")).toMatchObject({ projectId: null, pickable: true, online: true });
  });

  it("keeps to cutex's managed agents when the host lists them", () => {
    expect(ids(addCandidates(groups, "demo", new Set(["solo", "web"]))).sort()).toEqual(["solo", "web"]);
  });
});

describe("directorChoices", () => {
  it("offers this project's members; the current Director is listed but not pickable", () => {
    const list = directorChoices(groups, "demo", "dir");
    expect(ids(list)).toEqual(["dir", "run", "lit", "rev"]);
    expect(list.filter((c) => !c.pickable).map((c) => c.row.id)).toEqual(["dir"]);
  });

  it("is empty for an unknown project", () => {
    expect(directorChoices(groups, "nope", null)).toEqual([]);
  });
});

describe("filterCandidates", () => {
  const all = addCandidates(groups, "demo");
  it("puts pickable agents first, then sorts by recent activity (default) or name", () => {
    expect(ids(filterCandidates(all, DEFAULT_PICKER_QUERY, lastOf))).toEqual(["solo", "old", "web"]);
    expect(ids(filterCandidates(all, { ...DEFAULT_PICKER_QUERY, sort: "name" }, lastOf))).toEqual(["old", "solo", "web"]);
  });

  it("filters by runtime, status and membership", () => {
    expect(ids(filterCandidates(all, { ...DEFAULT_PICKER_QUERY, runtime: "claude" }, lastOf))).toEqual(["old"]);
    expect(ids(filterCandidates(all, { ...DEFAULT_PICKER_QUERY, status: "online" }, lastOf))).toEqual(["solo"]);
    expect(ids(filterCandidates(all, { ...DEFAULT_PICKER_QUERY, status: "offline" }, lastOf))).toEqual(["old", "web"]);
    expect(ids(filterCandidates(all, { ...DEFAULT_PICKER_QUERY, membership: "independent" }, lastOf))).toEqual(["solo", "old"]);
    expect(ids(filterCandidates(all, { ...DEFAULT_PICKER_QUERY, membership: "elsewhere" }, lastOf))).toEqual(["web"]);
  });

  it("searches names and notes (case-insensitive) and exact ids", () => {
    const members = directorChoices(groups, "demo", "dir");
    expect(ids(filterCandidates(members, { ...DEFAULT_PICKER_QUERY, query: "文献" }, lastOf))).toEqual(["lit"]);
    expect(ids(filterCandidates(members, { ...DEFAULT_PICKER_QUERY, query: "SAMPLER" }, lastOf))).toEqual(["run"]);
    expect(ids(filterCandidates(members, { ...DEFAULT_PICKER_QUERY, query: "rev" }, lastOf))).toEqual(["rev"]);
    expect(ids(filterCandidates(all, { ...DEFAULT_PICKER_QUERY, query: "zzz" }, lastOf))).toEqual([]);
  });
});

describe("detachable", () => {
  it("never includes the Director", () => {
    expect(detachable(["a", "dir", "b"], "dir")).toEqual(["a", "b"]);
    expect(detachable(["a"], null)).toEqual(["a"]);
  });
});
