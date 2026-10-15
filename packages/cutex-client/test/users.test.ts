import { describe, expect, it } from "vitest";
import { canSend, grantBody, OWNER_ACCESS, userAccessOf } from "../src/index";

describe("userAccessOf", () => {
  it("treats a cutex without the user block (or without capabilities) as the owner", () => {
    expect(userAccessOf(null)).toBe(OWNER_ACCESS);
    expect(userAccessOf({ featureList: [] } as never)).toBe(OWNER_ACCESS);
    expect(userAccessOf({ user: { id: "owner", name: "Me", isOwner: true, pending: false, grant: null } })).toMatchObject({ isOwner: true, name: "Me" });
  });

  it("reads a user's grant and a pending token", () => {
    const user = userAccessOf({ user: { id: "u-1", name: "Mia", isOwner: false, pending: false, grant: { projects: ["p1"], standaloneAgents: [], send: false } } });
    expect(user).toEqual({ isOwner: false, pending: false, userId: "u-1", name: "Mia", grant: { projects: ["p1"], standaloneAgents: [], send: false } });
    expect(canSend(user)).toBe(false);
    const sender = userAccessOf({ user: { id: "u-1", name: "Mia", isOwner: false, pending: false, grant: { projects: "all", standaloneAgents: [], send: true } } });
    expect(canSend(sender)).toBe(true);
    const pending = userAccessOf({ user: { id: null, name: null, isOwner: false, pending: true, grant: null } });
    expect(pending).toMatchObject({ isOwner: false, pending: true });
    expect(canSend(pending)).toBe(false);
    expect(canSend(OWNER_ACCESS)).toBe(true);
  });

  it("reads a malformed block as the most restrictive", () => {
    expect(userAccessOf({ user: "owner" })).toMatchObject({ isOwner: false, pending: true });
    expect(userAccessOf({ user: { isOwner: "yes" } })).toMatchObject({ isOwner: false, pending: true });
  });
});

describe("grantBody", () => {
  it("keeps known fields, de-duplicates and caps the lists", () => {
    expect(grantBody({ projects: ["a", "a"], standaloneAgents: ["s"], send: true, extra: 1 } as never)).toEqual({ projects: ["a"], standaloneAgents: ["s"], send: true });
    expect(grantBody({ projects: "all", standaloneAgents: [], send: "yes" } as never)).toEqual({ projects: "all", standaloneAgents: [], send: false });
    expect(() => grantBody({ projects: Array.from({ length: 501 }, (_, i) => `p${i}`), standaloneAgents: [], send: false })).toThrow("too many");
  });
});

describe("users-self-profile", () => {
  it("reads displayName / avatarEtag of the capabilities user (bad values as null, pending without)", async () => {
    const { profileOf, selfProfileBody, shownUserName } = await import("../src/index");
    expect(userAccessOf({ user: { id: "u-1", name: "Mia", isOwner: false, pending: false, grant: null, displayName: "Mia Chen", avatarEtag: "0123456789abcdef" } })).toMatchObject({ displayName: "Mia Chen", avatarEtag: "0123456789abcdef" });
    expect(userAccessOf({ user: { id: "owner", name: "Owner", isOwner: true, pending: false, grant: null, displayName: "  ", avatarEtag: "x" } })).toMatchObject({ displayName: null, avatarEtag: null });
    expect(userAccessOf({ user: { id: "owner", name: "Owner", isOwner: true, pending: false, grant: null } })).not.toHaveProperty("displayName");
    expect(userAccessOf({ user: { id: null, name: null, isOwner: false, pending: true, grant: null, displayName: "x" } })).not.toHaveProperty("displayName");
    expect(profileOf({})).toEqual({});
    expect(shownUserName({ id: "u-1", name: "Mia", displayName: "Mia Chen" })).toBe("Mia Chen");
    expect(shownUserName({ id: "u-1", name: "Mia", displayName: null })).toBe("Mia");
    expect(selfProfileBody({ displayName: "  J ", avatar: null })).toEqual({ displayName: "J", avatar: null });
    expect(selfProfileBody({ avatar: { contentType: "image/webp", data: "AAAA" } })).toEqual({ avatar: { contentType: "image/webp", data: "AAAA" } });
    expect(() => selfProfileBody({})).toThrow("empty profile patch");
    expect(() => selfProfileBody({ displayName: "x".repeat(61) })).toThrow("bad display name");
    expect(() => selfProfileBody({ avatar: { contentType: "image/gif" as never, data: "AAAA" } })).toThrow("bad avatar type");
    expect(() => selfProfileBody({ avatar: { contentType: "image/png", data: "A".repeat(70_000) } })).toThrow("bad avatar data");
  });
});
