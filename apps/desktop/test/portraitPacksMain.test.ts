// 拟人头像包, the owner's folder (main/portraitPacks.ts): packs listed with only the pictures that exist, bad folders
// counted, pictures handed over as data URLs of their real type, nothing outside what was listed.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlePortraitPacksRequest, PortraitPackStore } from "../src/main/portraitPacks";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "portrait-packs-"));
});
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may hold a handle briefly */
  }
});

function put(rel: string, bytes: Buffer | string) {
  const path = join(dir, ...rel.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, bytes);
}

const entry = (theme: string, stem: string, ext = "png") => ({ theme, themeName: theme, model: stem.split("-")[0], avatarPath: `avatars/${theme}/${stem}.${ext}`, previewPath: `previews/${theme}/${stem}.${ext}` });

describe("PortraitPackStore", () => {
  it("lists a manifest pack with only the pictures that exist; previews optional", async () => {
    put("mine/manifest.json", JSON.stringify({ schemaVersion: 1, name: "Mine", entries: [entry("beach", "claude-v1"), entry("beach", "gpt-v1"), entry("beach", "kimi-v1")] }));
    put("mine/avatars/beach/claude-v1.png", PNG);
    put("mine/previews/beach/claude-v1.png", PNG);
    put("mine/avatars/beach/gpt-v1.png", PNG);
    const state = await new PortraitPackStore(dir).list();
    expect(state.packs).toHaveLength(1);
    expect(state.packs[0]!.name).toBe("Mine");
    expect(state.packs[0]!.themes[0]!.entries.map((e) => [e.stem, e.family, e.previewPath])).toEqual([["claude-v1", "claude", "previews/beach/claude-v1.png"], ["gpt-v1", "openai", null]]);
    expect(state.skipped).toBe(1);
  });

  it("a folder without manifest is read from avatars/<theme>/; bad folder names and empty packs are counted", async () => {
    put("plain/avatars/office/glm-v1.png", PNG);
    put("Bad Name/avatars/x/glm-v1.png", PNG);
    put("empty/manifest.json", JSON.stringify({ schemaVersion: 1, entries: [entry("a", "glm-v1")] }));
    put("broken/manifest.json", "{ nope");
    const state = await new PortraitPackStore(dir).list();
    expect(state.packs.map((p) => p.id)).toEqual(["plain"]);
    expect(state.packs[0]!.themes[0]!.entries[0]).toMatchObject({ stem: "glm-v1", family: "glm" });
    expect(state.skipped).toBe(4);
  });

  it("hands pictures over as data URLs of their real type; preview falls back to the full picture; unlisted = null", async () => {
    put("p/manifest.json", JSON.stringify({ schemaVersion: 1, entries: [entry("t", "claude-v1"), entry("t", "gemini-v1", "webp")] }));
    put("p/avatars/t/claude-v1.png", PNG);
    put("p/avatars/t/gemini-v1.webp", WEBP);
    put("p/avatars/t/secret.png", PNG);
    const store = new PortraitPackStore(dir);
    expect(await store.image("p", "t", "claude-v1", "full")).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    expect(await store.image("p", "t", "claude-v1", "preview")).toMatch(/^data:image\/png;base64,/);
    expect(await store.image("p", "t", "gemini-v1", "full")).toMatch(/^data:image\/webp;base64,/);
    expect(await store.image("p", "t", "secret", "full")).toBeNull();
    expect(await store.image("p", "..", "claude-v1", "full")).toBeNull();
    put("p/avatars/t/claude-v1.png", "not a picture");
    expect(await store.image("p", "t", "claude-v1", "full")).toBeNull();
  });

  it("a missing folder lists nothing; unknown ops are refused", async () => {
    const store = new PortraitPackStore(join(dir, "nope"));
    expect(await store.list()).toEqual({ packs: [], dir: join(dir, "nope"), skipped: 0 });
    await expect(handlePortraitPacksRequest(store, { op: "delete" } as never, async () => {})).rejects.toThrow();
    await expect(handlePortraitPacksRequest(store, { op: "image", pack: "p", theme: "t", stem: "s", kind: "huge" } as never, async () => {})).rejects.toThrow();
  });
});
