// Identity button (sidebar bottom left): initials, role, shown name (renderer lib/identity).
import { describe, expect, it } from "vitest";
import { OWNER_ACCESS, userAccessOf } from "../src/shared/users";
import { adoptedIdentity, identityInitials, identityName, identityRole, observeHostIdentity, roleWords, splitUsage } from "../src/renderer/src/lib/identity";

describe("identityInitials", () => {
  it("takes the first letter of the first and last word", () => {
    expect(identityInitials("sam")).toBe("S");
    expect(identityInitials("Mia Katharina Ross")).toBe("MR");
    expect(identityInitials("alex-kim")).toBe("AK");
    expect(identityInitials("  lee.alex  ")).toBe("LA");
    expect(identityInitials("ölaf über")).toBe("ÖÜ");
  });
  it("uses one character for CJK names", () => {
    expect(identityInitials("李明")).toBe("李");
    expect(identityInitials("李 Alex")).toBe("李");
  });
  it("falls back to ? without letters", () => {
    expect(identityInitials("")).toBe("?");
    expect(identityInitials(null)).toBe("?");
    expect(identityInitials(" -- ")).toBe("?");
  });
  it("keeps digits", () => {
    expect(identityInitials("2b ops")).toBe("2O");
  });
});

describe("identityRole", () => {
  it("reads owner / member / pending from the access", () => {
    expect(identityRole(OWNER_ACCESS)).toBe("owner");
    expect(identityRole(userAccessOf({}))).toBe("owner"); // older cutex: no user block
    expect(identityRole(userAccessOf({ user: { id: "u-1", name: "Mia", isOwner: false, pending: false, grant: { projects: [], standaloneAgents: [], send: false } } }))).toBe("member");
    expect(identityRole(userAccessOf({ user: { id: null, name: null, isOwner: false, pending: true, grant: null } }))).toBe("pending");
    expect(identityRole(userAccessOf({ user: "garbage" }))).toBe("pending");
  });
  it("says the role in the words of Settings → 你; the button suffix only for read-only and pending", () => {
    const member = (send: boolean) => userAccessOf({ user: { id: "u-1", name: "Mia", isOwner: false, pending: false, grant: { projects: [], standaloneAgents: [], send } } });
    expect(roleWords(OWNER_ACCESS)).toEqual({ line: "identity.role.owner", suffix: null });
    expect(roleWords(member(true))).toEqual({ line: "identity.role.memberSend", suffix: null });
    expect(roleWords(member(false))).toEqual({ line: "identity.role.memberReadOnly", suffix: "identity.role.readOnly" });
    expect(roleWords(userAccessOf({ user: { id: null, name: null, isOwner: false, pending: true, grant: null } }))).toEqual({ line: "identity.role.pending", suffix: "identity.role.pending" });
  });
});

describe("identityName", () => {
  const member = { isOwner: false, name: "Mia" };
  it("owner: the local pref, else the OS account name", () => {
    expect(identityName(OWNER_ACCESS, "Alex", "sam")).toBe("Alex");
    expect(identityName(OWNER_ACCESS, "  ", "sam")).toBe("sam");
    expect(identityName({ isOwner: true, name: "Owner" }, "", null)).toBeNull();
  });
  it("member: the cutex user name; a pending device falls back to the local name", () => {
    expect(identityName(member, "Alex", "sam")).toBe("Mia");
    expect(identityName({ isOwner: false, name: null }, "Alex", "sam")).toBe("Alex");
    expect(identityName({ isOwner: false, name: null }, "", "sam")).toBe("sam");
  });
});

describe("identityName with users-self-profile", () => {
  it("is the local 「你」 everywhere, else what the host has for you, else the OS name", () => {
    expect(identityName({ isOwner: false, name: "Mia" }, "Alex", "sam", true)).toBe("Alex");
    expect(identityName({ isOwner: false, name: "Mia", displayName: "Mia Chen" }, "", "sam", true)).toBe("Mia Chen");
    expect(identityName({ isOwner: false, name: "Mia", displayName: null }, "", "sam", true)).toBe("Mia");
    // The owner's own label is not a display name: OS name instead.
    expect(identityName({ isOwner: true, name: "Owner", displayName: null }, "", "sam", true)).toBe("sam");
    expect(identityName({ isOwner: true, name: "Owner", displayName: "J" }, " ", "sam", true)).toBe("J");
  });
});

describe("identity across hosts (owner 2026-10-20: a fresh desktop showed its OS account name)", () => {
  const user = (displayName: string | null, avatarEtag: string | null = null, userId = "owner") => ({ pending: false, userId, displayName, avatarEtag });
  const E1 = "1111111111111111";
  const E2 = "2222222222222222";

  it("name order: local name → the hosts' display name → (member) cutex name → OS account name", () => {
    const owner = { isOwner: true, name: "Owner", displayName: null };
    expect(identityName(owner, "Local", "Lixinyu", true, "林青")).toBe("Local");
    expect(identityName(owner, "", "Lixinyu", true, "林青")).toBe("林青");
    expect(identityName(owner, "", "Lixinyu", true, null)).toBe("Lixinyu");
    expect(identityName({ isOwner: false, name: "Mia", displayName: null }, "", "sam", true, null)).toBe("Mia");
    // Older focus host: an owner still prefers your hosts' name over the OS name.
    expect(identityName(owner, "", "Lixinyu", false, "林青")).toBe("林青");
    expect(identityName({ isOwner: false, name: "Mia" }, "", "sam", false, "林青")).toBe("Mia");
  });

  it("adopts the display name another host has when the focus host has none", () => {
    const access = { hachimi: user(null), remote: user("林青") };
    const seen = { hachimi: observeHostIdentity(undefined, access.hachimi, 5), remote: observeHostIdentity(undefined, access.remote, 5) };
    const got = adoptedIdentity(access, seen, "hachimi");
    expect(got.name).toBe("林青");
    expect(identityName({ isOwner: true, name: null, displayName: null }, "", "Lixinyu", true, got.name)).toBe("林青");
  });

  it("when hosts disagree, the most recently changed wins; ties go to the focus host", () => {
    const access = { a: user("Old", E1), b: user("New", E2, "u2") };
    let seen = { a: observeHostIdentity(undefined, access.a, 100), b: observeHostIdentity(undefined, access.b, 100) };
    // First seen together (age unknown): the focus host's.
    expect(adoptedIdentity(access, seen, "a")).toEqual({ name: "Old", picture: { hostId: "a", userId: "owner", etag: E1 } });
    expect(adoptedIdentity(access, seen, "b")).toEqual({ name: "New", picture: { hostId: "b", userId: "u2", etag: E2 } });
    // b changed later (seen at 200): b wins on any focus.
    const b2 = user("Newer", E2, "u2");
    seen = { ...seen, b: observeHostIdentity(seen.b, b2, 200) };
    expect(seen.b).toEqual({ name: "Newer", nameAt: 200, etag: E2, etagAt: 0 });
    expect(adoptedIdentity({ a: access.a, b: b2 }, seen, "a").name).toBe("Newer");
    // Pending connections and hosts without a name contribute nothing; the OS name is never adopted.
    expect(adoptedIdentity({ p: { pending: true, userId: null, displayName: "X", avatarEtag: E1 } }, {}, "p")).toEqual({ name: null, picture: null });
    expect(adoptedIdentity({ a: user(null) }, {}, "a")).toEqual({ name: null, picture: null });
  });
});

describe("splitUsage", () => {
  it("splits profiles by their quota answers", () => {
    const quotas = { GLM: [1, 2], deepseek: [1], Kimi: [], relay: undefined };
    expect(splitUsage(["Kimi", "GLM", "relay", "deepseek"], quotas)).toEqual({ withQuota: ["GLM", "deepseek"], without: ["Kimi"], waiting: true });
    expect(splitUsage(["Kimi", "GLM"], quotas)).toEqual({ withQuota: ["GLM"], without: ["Kimi"], waiting: false });
    expect(splitUsage([], quotas)).toEqual({ withQuota: [], without: [], waiting: false });
  });
});
