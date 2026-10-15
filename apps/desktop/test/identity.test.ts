// Identity button (sidebar bottom left): initials, role, shown name (renderer lib/identity).
import { describe, expect, it } from "vitest";
import { OWNER_ACCESS, userAccessOf } from "../src/shared/users";
import { identityInitials, identityName, identityRole, roleWords, splitUsage } from "../src/renderer/src/lib/identity";

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

describe("splitUsage", () => {
  it("splits profiles by their quota answers", () => {
    const quotas = { GLM: [1, 2], deepseek: [1], Kimi: [], relay: undefined };
    expect(splitUsage(["Kimi", "GLM", "relay", "deepseek"], quotas)).toEqual({ withQuota: ["GLM", "deepseek"], without: ["Kimi"], waiting: true });
    expect(splitUsage(["Kimi", "GLM"], quotas)).toEqual({ withQuota: ["GLM"], without: ["Kimi"], waiting: false });
    expect(splitUsage([], quotas)).toEqual({ withQuota: [], without: [], waiting: false });
  });
});
