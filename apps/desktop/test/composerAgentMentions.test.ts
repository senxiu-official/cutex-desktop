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
});
