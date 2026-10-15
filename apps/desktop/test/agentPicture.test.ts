import { afterEach, describe, expect, it, vi } from "vitest";
import { agentPictureOf, avatarSourceProblem, MAX_SOURCE_BYTES, newPictureAvatar, pictureSize, saveAgentPicture } from "../src/renderer/src/lib/agentPicture";
import { cleanAvatar } from "../src/renderer/src/lib/avatar";

afterEach(() => vi.unstubAllGlobals());

// Real 128×128 WebP files (lossy VP8 and lossless VP8L), as the cropper writes them.
const WEBP = "data:image/webp;base64,UklGRmoAAABXRUJQVlA4IF4AAACwBgCdASqAAIAAPm02mUmkIyKhIIgAgA2JaW7hdJlwAAFBo/LBy68vz2xF4gqOe2IvEFRz2xF4gqOe2IvDQAD+/kDG//G7LOHB7//64D/5wH/zgP5c/y5lb1HAAAAA";
const WEBP_LOSSLESS = "data:image/webp;base64,UklGRiQAAABXRUJQVlA4TBcAAAAvf8AfAAdQmSJXpv9hABLC//9KRP9T/wA=";
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const pngHeader = (w: number, h: number) => `data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32(w), ...u32(h), 8, 2, 0, 0, 0])}`;
const jpegHeader = (w: number, h: number) => `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0])}`;

describe("uploaded agent pictures", () => {
  it("stores only an opaque icon id in metadata and reloads the picture from device storage", () => {
    const entries = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) });
    const avatar = newPictureAvatar();
    const picture = WEBP;
    expect(cleanAvatar(avatar)).toEqual(avatar);
    expect(agentPictureOf(avatar)).toBeNull();
    saveAgentPicture(avatar, picture);
    expect(agentPictureOf(JSON.parse(JSON.stringify(avatar)))).toBe(picture);
    expect(agentPictureOf(newPictureAvatar())).toBeNull();
  });

  it("falls back safely on another device, with unknown icons, or with invalid stored content", () => {
    vi.stubGlobal("localStorage", { getItem: () => "https://example.com/tracking.png" });
    expect(agentPictureOf(newPictureAvatar())).toBeNull();
    expect(agentPictureOf({ kind: "icon", value: "star" })).toBeNull();
    expect(agentPictureOf({ kind: "emoji", value: "🦊" })).toBeNull();
    expect(() => saveAgentPicture(newPictureAvatar(), "data:image/svg+xml;base64,YWJj")).toThrow();
  });

  it("surfaces storage failures so creation can retry saving the existing agent's appearance", () => {
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("QuotaExceeded"); }, getItem: () => { throw new Error("Unavailable"); } });
    const avatar = newPictureAvatar();
    expect(() => saveAgentPicture(avatar, WEBP)).toThrow("QuotaExceeded");
    expect(agentPictureOf(avatar)).toBeNull();
  });

  it("reads header dimensions and rejects corrupt or oversized pictures", () => {
    expect(pictureSize(WEBP)).toEqual({ width: 128, height: 128 });
    expect(pictureSize(WEBP_LOSSLESS)).toEqual({ width: 128, height: 128 });
    expect(pictureSize(pngHeader(128, 96))).toEqual({ width: 128, height: 96 });
    expect(pictureSize(jpegHeader(200, 100))).toEqual({ width: 200, height: 100 });
    expect(pictureSize("data:image/webp;base64,YWJj")).toBeNull();
    expect(pictureSize("data:image/png;base64,%%%")).toBeNull();
    const entries = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) });
    const avatar = newPictureAvatar();
    expect(() => saveAgentPicture(avatar, "data:image/webp;base64,YWJj")).toThrow();
    expect(() => saveAgentPicture(avatar, pngHeader(4096, 4096))).toThrow();
    expect(() => saveAgentPicture(avatar, `data:image/webp;base64,${"A".repeat(200 * 1024)}`)).toThrow();
    // A stored entry corrupted outside the app (or by an older build) falls back to the letter.
    entries.set(`cutex-desktop.agentPictures.${avatar.value}`, pngHeader(9000, 9000));
    expect(agentPictureOf(avatar)).toBeNull();
    entries.set(`cutex-desktop.agentPictures.${avatar.value}`, "data:image/png;base64,AAAA");
    expect(agentPictureOf(avatar)).toBeNull();
    saveAgentPicture(avatar, pngHeader(128, 128));
    expect(agentPictureOf(avatar)).toBe(pngHeader(128, 128));
  });

  it("only lets the cropper open bounded image files", () => {
    expect(avatarSourceProblem({ type: "image/png", size: 1000 })).toBeNull();
    expect(avatarSourceProblem({ type: "image/svg+xml", size: 1000 })).toBe("type");
    expect(avatarSourceProblem({ type: "", size: 1000 })).toBe("type");
    expect(avatarSourceProblem({ type: "image/jpeg", size: MAX_SOURCE_BYTES + 1 })).toBe("tooLarge");
  });
});
