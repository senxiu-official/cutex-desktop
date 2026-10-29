// 「Director 头像」 (owner 2026-10-21): the bundled glob, the personal folder in userData (main: top-level
// PNG / JPEG only, regular files within the caps, no symlinks, thumbnails via the injected shrink), the
// merged order, the stored avatar value, and the picker ordering for Directors.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectorAvatarStore, handleDirectorAvatarsRequest } from "../src/main/directorAvatars";
import { avatarStem, imageKind } from "../src/shared/directorAvatars";
import {
  avatarPickerSections,
  avatarTabs,
  BUNDLED_DIRECTOR_AVATARS,
  bundledDirectorAvatars,
  directorAvatarIdOf,
  directorAvatarList,
  directorAvatarOf,
  initialAvatarTab,
} from "../src/renderer/src/lib/directorAvatars";
import { avatarSwitchOf } from "../src/renderer/src/lib/avatarDefault";
import { cleanAvatar } from "../src/renderer/src/lib/avatar";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const THUMB = Buffer.from("thumb");

/**
 * A link entry at `path`: a file symlink to `target`; on Windows without the symlink privilege (EPERM) a junction —
 * the link anyone can make there — to a folder beside it. Either way not a regular file: the store must skip it.
 */
function linkEntry(target: string, path: string): void {
  try {
    symlinkSync(target, path, "file");
  } catch (e) {
    if (process.platform !== "win32" || (e as NodeJS.ErrnoException).code !== "EPERM") throw e;
    const folder = `${path}.target`;
    mkdirSync(folder);
    symlinkSync(folder, path, "junction");
  }
}

describe("names and signatures", () => {
  it("turns a file name into a stable id", () => {
    expect(avatarStem("Director 07 — Silver Fox.PNG")).toBe("director-07-silver-fox");
    expect(avatarStem("a_b.jpeg")).toBe("a_b");
    expect(avatarStem("x".repeat(60) + ".png")).toHaveLength(40);
    expect(avatarStem("notes.txt")).toBeNull();
    expect(avatarStem("——.png")).toBeNull();
  });
  it("accepts PNG and JPEG by signature only", () => {
    expect(imageKind(PNG)).toBe("png");
    expect(imageKind(JPEG)).toBe("jpeg");
    expect(imageKind(Buffer.from("GIF89a"))).toBeNull();
  });
});

describe("bundled collection", () => {
  it("ships the three placeholders, by name", () => {
    expect(BUNDLED_DIRECTOR_AVATARS.map((p) => p.id)).toEqual(["bundled/placeholder-01-ink", "bundled/placeholder-02-amber", "bundled/placeholder-03-sage"]);
    for (const p of BUNDLED_DIRECTOR_AVATARS) expect(p.url).toBeTruthy();
  });
  it("sorts naturally and drops duplicate stems", () => {
    const list = bundledDirectorAvatars({
      "../assets/avatars/director/d10.png": "/d10.png",
      "../assets/avatars/director/d2.png": "/d2.png",
      "../assets/avatars/director/d2.svg": "/d2.svg",
    });
    expect(list.map((p) => [p.id, p.url])).toEqual([["bundled/d2", "/d2.png"], ["bundled/d10", "/d10.png"]]);
  });
});

describe("personal folder (main)", () => {
  let dir: string;
  const shrink = vi.fn((bytes: Buffer) => (bytes.equals(PNG) || bytes.equals(JPEG) ? THUMB : null));
  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), "director-avatars-")), "avatars", "director");
    shrink.mockClear();
  });
  afterEach(() => rmSync(join(dir, "..", ".."), { recursive: true, force: true }));

  it("is empty (not an error) before the folder exists", async () => {
    const state = await new DirectorAvatarStore(dir, shrink).list();
    expect(state).toEqual({ files: [], dir, skipped: 0 });
  });

  it("lists top-level PNG / JPEG files as PNG thumbnails and skips everything else", async () => {
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "b-portrait.png"), PNG);
    writeFileSync(join(dir, "A Portrait.jpg"), JPEG);
    writeFileSync(join(dir, "fake.png"), Buffer.from("not a png"));
    writeFileSync(join(dir, "big.png"), Buffer.concat([PNG, Buffer.alloc(64)]));
    writeFileSync(join(dir, "notes.txt"), "x");
    writeFileSync(join(dir, ".hidden.png"), PNG);
    writeFileSync(join(dir, "sub", "nested.png"), PNG);
    linkEntry(join(dir, "b-portrait.png"), join(dir, "link.png"));
    const store = new DirectorAvatarStore(dir, shrink, { maxBytes: 32, maxFiles: 120 });
    const state = await store.list();
    const url = `data:image/png;base64,${THUMB.toString("base64")}`;
    expect(state.files).toEqual([{ stem: "a-portrait", url }, { stem: "b-portrait", url }]);
    expect(state.skipped).toBe(3); // fake, big, link
    // Cached per name + size + mtime: a rescan decodes nothing again.
    await store.list();
    expect(shrink).toHaveBeenCalledTimes(2);
  });

  it("caps the count and counts the rest as skipped; a file that does not decode is skipped", async () => {
    mkdirSync(dir, { recursive: true });
    for (const n of [1, 2, 3]) writeFileSync(join(dir, `p${n}.png`), PNG);
    const failing = vi.fn(() => null);
    expect((await new DirectorAvatarStore(dir, failing).list()).files).toEqual([]);
    const state = await new DirectorAvatarStore(dir, shrink, { maxBytes: 1024, maxFiles: 2 }).list();
    expect(state.files.map((f) => f.stem)).toEqual(["p1", "p2"]);
    expect(state.skipped).toBe(1);
  });

  it("openFolder creates the folder before opening it; unknown ops are refused", async () => {
    const store = new DirectorAvatarStore(dir, shrink);
    const opened: string[] = [];
    const state = await handleDirectorAvatarsRequest(store, { op: "openFolder" }, async (d) => opened.push(d));
    expect(opened).toEqual([dir]);
    expect(state.files).toEqual([]);
    await expect(handleDirectorAvatarsRequest(store, { op: "delete" } as never, async () => {})).rejects.toThrow();
    await expect(handleDirectorAvatarsRequest(store, { op: "list", path: "/etc" } as never, async () => {})).rejects.toThrow();
  });
});

describe("merged collection and stored value", () => {
  const bundled = bundledDirectorAvatars({ "../x/zeta.svg": "/zeta.svg", "../x/alpha.svg": "/alpha.svg" });
  it("lists bundled first, then personal ones; drops malformed personal entries", () => {
    const list = directorAvatarList(bundled, [
      { stem: "mine-2", url: "data:image/png;base64,AA" },
      { stem: "mine-10", url: "data:image/png;base64,BB" },
      { stem: "Bad Name", url: "data:image/png;base64,CC" },
      { stem: "remote", url: "https://example.com/x.png" },
      { stem: "mine-2", url: "data:image/png;base64,DD" },
    ]);
    expect(list.map((p) => p.id)).toEqual(["bundled/alpha", "bundled/zeta", "user/mine-2", "user/mine-10"]);
  });
  it("stores an icon avatar cutex accepts and reads it back", () => {
    const avatar = directorAvatarOf({ id: `user/${"x".repeat(40)}` });
    expect(cleanAvatar(avatar)).toEqual(avatar);
    expect(directorAvatarIdOf(avatar)).toBe(`user/${"x".repeat(40)}`);
    expect(directorAvatarIdOf({ kind: "icon", value: "desktop-picture:0b6f2d1e-4f0a-4c33-9a7e-2f1b7c1d9e00" })).toBeNull();
    expect(directorAvatarIdOf({ kind: "emoji", value: "director:bundled/a" })).toBeNull();
    expect(directorAvatarIdOf({ kind: "icon", value: "director:other/a" })).toBeNull();
  });
  it("is a picture for the avatar switch: never offered 隐藏头像", () => {
    expect(avatarSwitchOf("important", { isDirector: false, pinned: false, avatar: directorAvatarOf({ id: "bundled/a" }) })).toBeNull();
  });
});

describe("picker ordering for Directors", () => {
  it("new-agent picker: portraits above the emoji for a Director, below for anyone else", () => {
    expect(avatarPickerSections(true)).toEqual(["director", "emoji"]);
    expect(avatarPickerSections(false)).toEqual(["emoji", "director"]);
  });
  it("编辑信息: the portrait tab comes first for a Director and last otherwise", () => {
    expect(avatarTabs(true)[0]).toBe("portrait");
    expect(avatarTabs(false)).toEqual(["default", "emoji", "color", "picture", "portrait"]);
  });
  it("a Director without an avatar opens on its portraits; an existing avatar keeps its tab", () => {
    expect(initialAvatarTab(null, true)).toBe("portrait");
    expect(initialAvatarTab(null, false)).toBe("default");
    expect(initialAvatarTab({ kind: "emoji", value: "🦊" }, true)).toBe("emoji");
    expect(initialAvatarTab(directorAvatarOf({ id: "bundled/a" }), false)).toBe("portrait");
    expect(initialAvatarTab({ kind: "icon", value: "desktop-picture:0b6f2d1e-4f0a-4c33-9a7e-2f1b7c1d9e00" }, true)).toBe("picture");
  });
});
