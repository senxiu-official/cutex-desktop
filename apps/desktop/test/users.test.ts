// P1 users and grants (desktop side): the non-owner feature set, the Settings → 用户 model helpers,
// the routeAccepted acting user, the pending SSH token, and the restricted menus' marker.
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { parseTokenIssue } from "../src/shared/hosts";
import { actingUserOf, hostFeatureSet, isOwnerFeatures, OWNER_ONLY_CAPABILITIES, RESTRICTED_FEATURE } from "../src/shared/users";
import type { UsersList } from "../src/shared/users";
import { bindingsOf, deviceRows, grantChoices, grantSummary, grantWithProject, projectAccess, refusalText, sameGrant, shownGrant, sortedUsers, toggleId, unknownIds } from "../src/renderer/src/modules/users/model";
import { en } from "../src/renderer/src/i18n/en";
import { countKey } from "../src/renderer/src/i18n";

const t = (key: string, vars: Record<string, string | number> = {}) => (en as Record<string, string>)[countKey(key, vars, en, en)]!.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));

describe("hostFeatureSet", () => {
  const featureList = ["terminal", "services", "users", "asks", "queue-pause", "peers-v2"];
  it("is exactly the featureList for the owner, an older cutex and a cutex without the route", () => {
    expect([...hostFeatureSet({ featureList, user: { id: "owner", name: "Me", isOwner: true, pending: false, grant: null } })]).toEqual(featureList);
    expect([...hostFeatureSet({ featureList })]).toEqual(featureList);
    expect(isOwnerFeatures(hostFeatureSet(null))).toBe(true);
  });
  it("drops the owner-only capabilities and marks a non-owner or pending connection", () => {
    const user = hostFeatureSet({ featureList, user: { id: "u-1", name: "Mia", isOwner: false, pending: false, grant: { projects: "all", standaloneAgents: [], send: true } } });
    expect([...user].sort()).toEqual(["asks", "queue-pause", RESTRICTED_FEATURE].sort());
    expect(isOwnerFeatures(user)).toBe(false);
    const pending = hostFeatureSet({ featureList, user: { id: null, name: null, isOwner: false, pending: true, grant: null } });
    expect(isOwnerFeatures(pending)).toBe(false);
    expect(OWNER_ONLY_CAPABILITIES).toContain("users");
  });
});

describe("Settings → 用户 model", () => {
  const list: UsersList = {
    revision: 1,
    users: [
      { id: "u-b", name: "Bea", color: null, builtin: false, isOwner: false, grant: null, createdAt: "", updatedAt: "" },
      { id: "owner", name: "Zed", color: "cyan", builtin: true, isOwner: true, grant: null, createdAt: "", updatedAt: "" },
    ],
    tokens: [
      { tokenId: "t1", label: "phone", kind: "device", createdAt: "", userId: "owner", pending: false },
      { tokenId: "t2", label: "laptop", kind: "client", createdAt: "", userId: null, pending: true },
      { tokenId: "t3", label: "tab", kind: "device", createdAt: "", userId: "u-b", pending: false },
    ],
    peers: [{ peerId: "ci-1", label: "lab", hostId: "LAB", status: "online", userId: "u-b" }],
    settings: { ownerRequiresApproval: true },
  };
  it("groups tokens and peers by user, pending apart; the owner sorts first", () => {
    const b = bindingsOf(list);
    expect(b.pending.map((x) => x.tokenId)).toEqual(["t2"]);
    expect(b.tokens.get("owner")?.map((x) => x.tokenId)).toEqual(["t1"]);
    expect(b.tokens.get("u-b")?.map((x) => x.tokenId)).toEqual(["t3"]);
    expect(b.peers.get("u-b")?.map((x) => x.peerId)).toEqual(["ci-1"]);
    expect(sortedUsers(list.users).map((u) => u.id)).toEqual(["owner", "u-b"]);
  });
  it("lists devices flat: unassigned first, this desktop next, then by last use; filters by user or 待分配", () => {
    const tok = (tokenId: string, userId: string | null, lastUsedAt: string | null) => ({ tokenId, userId, pending: userId === null, lastUsedAt });
    const tokens = [tok("old", "owner", "2026-10-01T00:00:00Z"), tok("never", "u-b", null), tok("own", "owner", "2026-09-01T00:00:00Z"), tok("new", "u-b", "2026-10-14T00:00:00Z"), tok("wait", null, null)];
    expect(deviceRows(tokens, { kind: "all" }, "own").map((x) => x.tokenId)).toEqual(["wait", "own", "new", "old", "never"]);
    expect(deviceRows(tokens, { kind: "all" }, null).map((x) => x.tokenId)).toEqual(["wait", "new", "old", "own", "never"]);
    expect(deviceRows(tokens, { kind: "user", userId: "u-b" }, "own").map((x) => x.tokenId)).toEqual(["new", "never"]);
    expect(deviceRows(tokens, { kind: "pending" }, "own").map((x) => x.tokenId)).toEqual(["wait"]);
  });
  it("summarises grants", () => {
    expect(grantSummary(null, t)).toBe("Sees nothing");
    expect(grantSummary({ projects: "all", standaloneAgents: ["s"], send: true }, t)).toBe("All projects · 1 standalone {{agent}} · Can send");
    expect(grantSummary({ projects: ["p", "q"], standaloneAgents: [], send: false }, t)).toBe("2 projects · Read-only");
  });
  it("compares, toggles and finds unknown ids", () => {
    expect(sameGrant({ projects: ["a", "b"], standaloneAgents: [], send: true }, { projects: ["b", "a"], standaloneAgents: [], send: true })).toBe(true);
    expect(sameGrant({ projects: "all", standaloneAgents: [], send: true }, { projects: [], standaloneAgents: [], send: true })).toBe(false);
    expect(toggleId(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a", false)).toEqual(["b"]);
    expect(unknownIds(["a", "gone"], [{ id: "a", name: "A" }])).toEqual(["gone"]);
  });
  it("offers the host's active projects and the agents without a project", () => {
    const sidebar = {
      active: [{ cutexSessionId: "s1", displayName: "Solo" }, { cutexSessionId: "s2", displayName: "Member" }],
      retired: [],
      projects: { schema: "x", projects: [{ project_id: "p1", presentation: { display_name: "Desktop" }, lifecycle: "active" }, { project_id: "p0", presentation: { display_name: "Old" }, lifecycle: "archived" }] },
      hostRows: { s2: { projectId: "p1" } },
    } as never;
    expect(grantChoices(sidebar)).toEqual({ projects: [{ id: "p1", name: "Desktop" }], standalone: [{ id: "s1", name: "Solo" }] });
    expect(grantChoices(null)).toEqual({ projects: [], standalone: [] });
  });
  it("explains user_in_use with what is still bound", () => {
    expect(refusalText({ code: "user_in_use", message: "x", tokens: ["t3"], peers: ["ci-1"] }, t, "Bea")).toBe("Bea still owns devices (1) or linked hosts (1): move them to another user or remove them first");
    expect(refusalText({ code: "owner_required", message: "x" }, t)).toBe(en["users.error.owner_required"]);
    expect(refusalText({ code: "weird", message: "boom" }, t)).toBe("Failed: boom");
  });
});

describe("项目页 → 可见用户 model", () => {
  const grant = { projects: ["a", "b"], standaloneAgents: ["s-1"], send: true };
  it("adds or removes only this project id, keeping standalone agents and send", () => {
    expect(grantWithProject(grant, "c", true)).toEqual({ projects: ["a", "b", "c"], standaloneAgents: ["s-1"], send: true });
    expect(grantWithProject(grant, "a", false)).toEqual({ projects: ["b"], standaloneAgents: ["s-1"], send: true });
    // Idempotent both ways, and the input is not mutated.
    expect(grantWithProject(grant, "a", true).projects).toEqual(["a", "b"]);
    expect(grantWithProject(grant, "z", false).projects).toEqual(["a", "b"]);
    expect(grant.projects).toEqual(["a", "b"]);
  });
  it("leaves an all-projects grant as it is and starts a null grant empty", () => {
    expect(grantWithProject({ projects: "all", standaloneAgents: [], send: false }, "a", false)).toEqual({ projects: "all", standaloneAgents: [], send: false });
    expect(grantWithProject(null, "a", true)).toEqual({ projects: ["a"], standaloneAgents: [], send: false });
    expect(grantWithProject(null, "a", false)).toEqual({ projects: [], standaloneAgents: [], send: false });
  });
  it("reads a user's access to one project", () => {
    expect(projectAccess({ projects: "all", standaloneAgents: [], send: false }, "x")).toBe("all");
    expect(projectAccess(grant, "a")).toBe("granted");
    expect(projectAccess(grant, "x")).toBe("none");
    expect(projectAccess(null, "a")).toBe("none");
  });
  it("shows a write's reply until the listing has its revision", () => {
    const user = { id: "u-1", grant };
    const fresh = new Map([["u-1", { grant: { ...grant, projects: ["a", "b", "c"] }, revision: 8 }]]);
    expect(shownGrant(user, 7, fresh)!.projects).toEqual(["a", "b", "c"]);
    expect(shownGrant(user, 8, fresh)).toBe(grant);
    expect(shownGrant({ id: "u-2", grant: null }, 7, fresh)).toBeNull();
  });
});

describe("acting user of a routeAccepted event", () => {
  const envelope = (params: Record<string, unknown>, method = "cutex/userInput/routeAccepted") => ({ cutexSessionId: "s1", cutex: { method, params } }) as unknown as EventEnvelope;
  it("reads actingUser only when a non-owner sent it", () => {
    expect(actingUserOf(envelope({ clientUserMessageId: "m1", actingUser: { id: "u-1", name: "Mia" } }))).toEqual({ sessionId: "s1", clientUserMessageId: "m1", user: { id: "u-1", name: "Mia" } });
    expect(actingUserOf(envelope({ clientUserMessageId: "m1" }))).toBeNull();
    expect(actingUserOf(envelope({ clientUserMessageId: "m1", actingUser: { id: "u-1", name: "Mia" } }, "cutex/userInput/queued"))).toBeNull();
    expect(actingUserOf(envelope({ clientUserMessageId: "m1", actingUser: { id: "u-1" } }))?.user.name).toBe("u-1");
    // users-self-profile: the name / picture the user set on their own desktop.
    expect(actingUserOf(envelope({ clientUserMessageId: "m1", actingUser: { id: "u-1", name: "Mia", displayName: " Mia Chen ", avatarEtag: "0123456789abcdef" } }))?.user).toEqual({ id: "u-1", name: "Mia", displayName: "Mia Chen", avatarEtag: "0123456789abcdef" });
    expect(actingUserOf(envelope({ clientUserMessageId: "m1", actingUser: { id: "u-1", name: "Mia", displayName: 3, avatarEtag: "../x" } }))?.user).toEqual({ id: "u-1", name: "Mia", displayName: null, avatarEtag: null });
  });
});

describe("SSH pairing of a pending token", () => {
  it("keeps cutex's pending flag", () => {
    expect(parseTokenIssue(JSON.stringify({ tokenId: "ct_01", label: "x", token: "secret", createdAt: "", userId: null, pending: true }))?.pending).toBe(true);
    expect(parseTokenIssue(JSON.stringify({ tokenId: "ct_01", label: "x", token: "secret", createdAt: "", userId: "owner", pending: false }))).not.toHaveProperty("pending");
  });
});
