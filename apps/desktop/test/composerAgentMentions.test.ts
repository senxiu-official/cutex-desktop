import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { agentMentionCandidates, agentMentionInsert, type MentionHost } from "../src/renderer/src/lib/composerAgentMentions";

const session = (id: string, name: string, status = "online", extra = {}) => ({ cutexSessionId: id, displayName: name, runtime: { status }, visible: true, lifecycle: "active", ...extra }) as SessionResource;
function host(id: string, sessions: SessionResource[], projects: Record<string,string>, connected = true): MentionHost {
  return { id, label: id, connected, sidebar: { active: sessions, retired: [], projects: null, hostRows: Object.fromEntries(Object.entries(projects).map(([id,projectId])=>[id,{id,projectId}])) } as unknown as SidebarSnapshot };
}
const hosts = () => [host("local", [session("cutex.ag-self","Self"),session("cutex.ag-z","Zed"),session("cutex.ag-a","Ada"),session("cutex.ag-hidden","Hidden","online",{visible:false})], {"cutex.ag-self":"p","cutex.ag-z":"p","cutex.ag-a":"other"}), host("remote", [session("cutex.ag-remote","Ada","offline")], {"cutex.ag-remote":"p"})];
it("orders same-project members first and keeps host identity separate from duplicate names", () => {
  const rows = agentMentionCandidates(hosts(),"local","cutex.ag-self","");
  expect(rows.map(row=>row.id)).toEqual(["cutex.ag-z","cutex.ag-a","cutex.ag-remote"]);
  expect(rows.map(row=>row.label)).toEqual(["Zed","Ada","Ada@remote"]);
  expect(rows[2]).toMatchObject({sameProject:false,presence:"offline",hostId:"remote"});
});
it("filters names, full ids and name@host without allowing hidden or retired records", () => {
  expect(agentMentionCandidates(hosts(),"local","cutex.ag-self","ADA").map(row=>row.id)).toEqual(["cutex.ag-a","cutex.ag-remote"]);
  expect(agentMentionCandidates(hosts(),"local","cutex.ag-self","@remote").map(row=>row.id)).toEqual(["cutex.ag-remote"]);
  expect(agentMentionCandidates(hosts(),"local","cutex.ag-self","Hidden")).toEqual([]);
  const source = hosts(); source[1]!.sidebar!.active[0]!.lifecycle = "retired";
  expect(agentMentionCandidates(source,"local","cutex.ag-self","remote")).toEqual([]);
});
it("does not equate projects on different hosts or show cached online status as current", () => {
  const source=hosts(); source[1]!.connected=false;
  expect(agentMentionCandidates(source,"local","cutex.ag-self","remote")[0]).toMatchObject({sameProject:false,presence:"unknown"});
});
it("fences duplicate ids, malformed ids and list size while preserving filter access to later records", () => {
  const source=hosts(); source.push(host("other",[session("cutex.ag-z","Duplicate"),session("bad/id","Bad")],{}));
  expect(agentMentionCandidates(source,"local","cutex.ag-self","",1)).toHaveLength(1);
  expect(agentMentionCandidates(source,"local","cutex.ag-self","").map(row=>row.id)).toEqual(["cutex.ag-z","cutex.ag-a","cutex.ag-remote"]);
});

describe("agentMentionInsert", () => {
  const agent = { id: "cutex.ag-far", name: "Far", hostId: "ws", hostLabel: "remote" };
  it("the full id always; the host only for another host than the conversation's", () => {
    expect(agentMentionInsert(agent, "local")).toBe("[@Far@remote](cutex:agent/cutex.ag-far@remote)");
    expect(agentMentionInsert(agent, "ws")).toBe("[@Far](cutex:agent/cutex.ag-far)");
  });
  it("inserts the agent's own name, while the picker shows and matches the 显示名称 (owner 2026-11-05)", () => {
    const aliased = session("cutex.ag-astra", "小星", "online", { displayNameOverride: "小星", formalAgentName: "astra-composer" });
    const rows = agentMentionCandidates([host("local", [session("cutex.ag-self", "Self"), aliased], {})], "local", "cutex.ag-self", "小星");
    expect(rows.map((r) => r.label)).toEqual(["小星"]);
    expect(agentMentionCandidates([host("local", [aliased], {})], "local", "x", "astra-comp").map((r) => r.id)).toEqual(["cutex.ag-astra"]);
    expect(agentMentionInsert(rows[0]!, "local")).toBe("[@astra-composer](cutex:agent/cutex.ag-astra)");
    expect(agentMentionInsert(rows[0]!, "ws")).toBe("[@astra-composer@local](cutex:agent/cutex.ag-astra@local)");
  });
});

describe("owner 2026-11-09: recent mentions, project names, quick chats", () => {
  const withProjects = () => {
    const source = hosts();
    source[0]!.sidebar!.active.push(session("cutex.ag-b", "Bea"), session("cutex.ag-chat", "Fix the build", "online", { registrationClass: "local_only" }));
    (source[0]!.sidebar as { projects: unknown }).projects = { projects: [{ project_id: "other", presentation: { display_name: "Kestrel Studio" } }] };
    return source;
  };
  it("same project first, then recent mentions (newest first), then by name", () => {
    const rows = agentMentionCandidates(withProjects(), "local", "cutex.ag-self", "", 50, ["remote\ncutex.ag-remote", "local\ncutex.ag-b"]);
    expect(rows.map((row) => row.id)).toEqual(["cutex.ag-z", "cutex.ag-remote", "cutex.ag-b", "cutex.ag-a"]);
  });
  it("matches the agent's project name", () => {
    expect(agentMentionCandidates(withProjects(), "local", "cutex.ag-self", "kestrel").map((row) => row.id)).toEqual(["cutex.ag-a"]);
  });
  it("a quick chat outside any project shows only when searched or recently mentioned", () => {
    expect(agentMentionCandidates(withProjects(), "local", "cutex.ag-self", "").map((row) => row.id)).not.toContain("cutex.ag-chat");
    expect(agentMentionCandidates(withProjects(), "local", "cutex.ag-self", "build").map((row) => row.id)).toEqual(["cutex.ag-chat"]);
    expect(agentMentionCandidates(withProjects(), "local", "cutex.ag-self", "", 50, ["local\ncutex.ag-chat"]).map((row) => row.id)).toContain("cutex.ag-chat");
  });
});
