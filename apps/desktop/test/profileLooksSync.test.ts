// cutex `profile-avatar` (2026-10-18): Profile pictures and openings (portrait + greeting) live on a
// host that stores them, so every device shows the same; an older host keeps this device's copies.
// One-time import of the local copies; fallback for hosts without the capability.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
});
// Focus host "local" is daemon "laptop-01"; host "hosta" is daemon "hosta-host".
const state = vi.hoisted(() => ({
  daemon: { kind: "connected", hostId: "laptop-01" },
  hosts: { active: "local" },
  byHost: { hosta: { daemon: { kind: "connected", hostId: "hosta-host" } } },
}));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign((select: (s: unknown) => unknown) => select(state), { getState: () => state }) }));

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const WEBP = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

type Look = { id: string; name: string; model: string | null; cliKind: string; avatarEtag?: string | null; introPortraitEtag?: string | null; appearance: { color: null; effectiveColor: null; providerCategory: null; avatarThemes?: string[] | null; introGreeting?: string | null } };
const look = (id: string, over: Partial<Look> = {}, appearance: Partial<Look["appearance"]> = {}): Look => ({
  id,
  name: id,
  model: "gpt-5.5",
  cliKind: "codex",
  avatarEtag: null,
  introPortraitEtag: null,
  ...over,
  appearance: { color: null, effectiveColor: null, providerCategory: null, avatarThemes: null, introGreeting: null, ...appearance },
});
const old = (id: string): Look => ({ id, name: id, model: null, cliKind: "codex", appearance: { color: null, effectiveColor: null, providerCategory: null } });

async function setup(seed: Record<string, unknown> = {}) {
  storage.clear();
  for (const [k, v] of Object.entries(seed)) storage.set(k, JSON.stringify(v));
  vi.resetModules();
  const looks = await import("../src/renderer/src/lib/profileLooks");
  const images = await import("../src/renderer/src/lib/profileImages");
  const avatar = await import("../src/renderer/src/lib/profileAvatar");
  const intro = await import("../src/renderer/src/lib/introAppearance");
  let n = 0;
  const api = {
    putProfileImage: vi.fn(async (_id: string, _kind: string, dataUrl: string | null) => ({ etag: dataUrl ? `${String(++n).padStart(16, "0")}` : null })),
    profileImage: vi.fn(async (id: string, kind: string) => ({ dataUrl: `${kind}:${id}`, etag: null })),
    patchProfile: vi.fn(async (_id: string, patch: { introGreeting?: string | null }) => ({ appearance: { introGreeting: patch.introGreeting ?? null } })),
  };
  looks.setProfileLooksApi((hostId) => (hostId === "hosta" || hostId === "local" ? (api as never) : (null as never)));
  return { looks, images, avatar, intro, api };
}

describe("profile pictures", () => {
  afterEach(() => vi.clearAllMocks());

  it("an older host keeps the device-local picture, keyed by daemon host", async () => {
    const { looks, avatar, api } = await setup();
    looks.noteProfileLooks("local", [old("p1")]);
    expect(looks.profileLooksSynced("local")).toBe(false);
    avatar.setProfileAvatar("laptop-01", "p1", PNG);
    expect(avatar.profileAvatarOf("laptop-01", "p1")).toBe(PNG);
    expect(JSON.parse(storage.get("cutex-desktop.profileAvatars")!)).toEqual({ "laptop-01": { p1: PNG } });
    expect(api.putProfileImage).not.toHaveBeenCalled();
  });

  it("a syncing host: the picture is uploaded (shown at once), read back by ETag, removed with null", async () => {
    const { looks, avatar, api } = await setup();
    looks.noteProfileLooks("hosta", [look("p9")]);
    expect(looks.profileLooksSynced("hosta")).toBe(true);
    // The Settings editor passes the focus daemon key; the profile id finds its own host.
    avatar.setProfileAvatar("laptop-01", "p9", PNG);
    expect(avatar.profileAvatarOf("laptop-01", "p9")).toBe(PNG);
    await vi.waitFor(() => expect(api.putProfileImage).toHaveBeenCalledWith("p9", "avatar", PNG));
    await vi.waitFor(() => expect(looks.profileLookOf("hosta", "p9")?.avatarEtag).toBe("0000000000000001"));
    expect(avatar.profileAvatarOf("hosta-host", "p9")).toBe(PNG); // our own upload: no fetch
    expect(api.profileImage).not.toHaveBeenCalled();
    expect(storage.get("cutex-desktop.profileAvatars")).toBeUndefined();
    avatar.setProfileAvatar("hosta-host", "p9", null);
    await vi.waitFor(() => expect(looks.profileLookOf("hosta", "p9")?.avatarEtag).toBeNull());
    expect(avatar.profileAvatarOf("hosta-host", "p9")).toBeNull();
  });

  it("another device's picture is fetched once per ETag", async () => {
    const { looks, avatar, api } = await setup();
    looks.noteProfileLooks("hosta", [look("p2", { avatarEtag: "00000000000000aa" })]);
    expect(avatar.profileAvatarOf("hosta-host", "p2")).toBeNull(); // loading
    await vi.waitFor(() => expect(avatar.profileAvatarOf("hosta-host", "p2")).toBe("avatar:p2"));
    avatar.profileAvatarOf("hosta-host", "p2");
    expect(api.profileImage).toHaveBeenCalledTimes(1);
  });

  it("one-time import: a local picture goes up when the host has none, then the local copy goes", async () => {
    const { looks, avatar, api } = await setup({ "cutex-desktop.profileAvatars": { "hosta-host": { p1: PNG, p2: WEBP }, "laptop-01": { p1: WEBP } } });
    looks.noteProfileLooks("hosta", [look("p1"), look("p2", { avatarEtag: "00000000000000bb" })]);
    await vi.waitFor(() => expect(api.putProfileImage).toHaveBeenCalledTimes(1));
    expect(api.putProfileImage).toHaveBeenCalledWith("p1", "avatar", PNG);
    await vi.waitFor(() => expect(avatar.localProfileAvatarOf("hosta-host", "p1")).toBeNull());
    // p2 already has a host picture: nothing uploaded, the local copy is left alone; other hosts untouched.
    expect(avatar.localProfileAvatarOf("hosta-host", "p2")).toBe(WEBP);
    expect(avatar.localProfileAvatarOf("laptop-01", "p1")).toBe(WEBP);
    looks.noteProfileLooks("hosta", [look("p1")]);
    await Promise.resolve();
    expect(api.putProfileImage).toHaveBeenCalledTimes(1);
  });

  it("a refused upload keeps the local copy (retried in a later run)", async () => {
    const { looks, avatar, api } = await setup({ "cutex-desktop.profileAvatars": { "hosta-host": { p1: PNG } } });
    api.putProfileImage.mockRejectedValueOnce(new Error("invalid_avatar"));
    looks.noteProfileLooks("hosta", [look("p1")]);
    await vi.waitFor(() => expect(api.putProfileImage).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(avatar.localProfileAvatarOf("hosta-host", "p1")).toBe(PNG);
    expect(looks.profileLookOf("hosta", "p1")?.avatarEtag).toBeNull();
  });
});

describe("openings (intro portrait + greeting)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("an older host keeps the device-local opening", async () => {
    const { looks, intro, api } = await setup();
    looks.noteProfileLooks("local", [old("p1")]);
    expect(intro.setIntroAppearance("local", "p1", { portrait: WEBP, greeting: " Hi {{owner}} " })).toBe(true);
    expect(intro.introAppearanceOf("local", "p1")).toEqual({ portrait: WEBP, greeting: "Hi {{owner}}" });
    expect(api.patchProfile).not.toHaveBeenCalled();
    expect(api.putProfileImage).not.toHaveBeenCalled();
  });

  it("a syncing host stores both: the greeting as appearance.introGreeting, the portrait as an image", async () => {
    const { looks, intro, api } = await setup();
    looks.noteProfileLooks("hosta", [look("p1", {}, { introGreeting: "From the host" })]);
    expect(intro.introAppearanceOf("hosta", "p1")).toEqual({ portrait: null, greeting: "From the host" });
    intro.setIntroAppearance("hosta", "p1", { portrait: WEBP, greeting: "Line one\r\nline two\u0007" });
    expect(intro.introAppearanceOf("hosta", "p1")).toEqual({ portrait: WEBP, greeting: "Line one\nline two" });
    await vi.waitFor(() => expect(api.patchProfile).toHaveBeenCalledWith("p1", { introGreeting: "Line one\nline two" }));
    expect(api.putProfileImage).toHaveBeenCalledWith("p1", "intro-portrait", WEBP);
    await vi.waitFor(() => expect(looks.profileLookOf("hosta", "p1")?.introPortraitEtag).toBe("0000000000000001"));
    expect(storage.get("cutex-desktop.introAppearance")).toBeUndefined();
    intro.setIntroAppearance("hosta", "p1", { greeting: "" });
    await vi.waitFor(() => expect(api.patchProfile).toHaveBeenLastCalledWith("p1", { introGreeting: null }));
    expect(intro.introAppearanceOf("hosta", "p1").greeting).toBeNull();
  });

  it("a refused greeting write shows the host's greeting again", async () => {
    const { looks, intro, api } = await setup();
    looks.noteProfileLooks("hosta", [look("p1", {}, { introGreeting: "Kept" })]);
    api.patchProfile.mockRejectedValueOnce(new Error("invalid_request"));
    intro.setIntroAppearance("hosta", "p1", { greeting: "New" });
    await vi.waitFor(() => expect(intro.introAppearanceOf("hosta", "p1").greeting).toBe("Kept"));
  });

  it("one-time import: local portrait / greeting go up where the host has none; the uploaded parts leave this device", async () => {
    const { looks, intro, api } = await setup({
      "cutex-desktop.introAppearance": { hosta: { p1: { portrait: WEBP, greeting: "Local hello" }, p2: { portrait: WEBP, greeting: "Local two" } } },
    });
    looks.noteProfileLooks("hosta", [look("p1"), look("p2", { introPortraitEtag: "00000000000000cc" }, { introGreeting: "Host two" })]);
    await vi.waitFor(() => expect(intro.localIntroAppearanceOf("hosta", "p1")).toEqual({ portrait: null, greeting: null }));
    expect(api.putProfileImage).toHaveBeenCalledTimes(1);
    expect(api.putProfileImage).toHaveBeenCalledWith("p1", "intro-portrait", WEBP);
    expect(api.patchProfile).toHaveBeenCalledTimes(1);
    expect(api.patchProfile).toHaveBeenCalledWith("p1", { introGreeting: "Local hello" });
    // p2: the host already has both, the local copy stays (used again only if the host goes back to an older cutex).
    expect(intro.localIntroAppearanceOf("hosta", "p2")).toEqual({ portrait: WEBP, greeting: "Local two" });
    expect(intro.introAppearanceOf("hosta", "p1").greeting).toBe("Local hello");
  });
});
