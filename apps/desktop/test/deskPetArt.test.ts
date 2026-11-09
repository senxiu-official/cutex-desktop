// The desk pet's art rules and window geometry (shared/deskPet.ts, main/deskPetArt.ts): what is refused and why. The
// images here are built by this test (a minimal real PNG); no art file exists in the repo.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasVisiblePixels, listCharacters, loadCharacter, type DecodeImage, type PackArt } from "../src/main/deskPetArt";
import { packArtOf } from "../src/main/deskPetPackArt";
import { artDisplaySize, checkDeskPetImage, DESK_PET_ART, keepOnDisplays, parseDeskPetManifest, parseDeskPetPatch, parseDeskPetRequest, petShapeRects, petWindowSize, readPngHeader, shownPose, mirrorRects } from "../src/shared/deskPet";
import { DESK_PET_PLACEHOLDER_SIZE, placeholderFrame } from "../src/shared/deskPetPlaceholder";

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}
function png(width = 128, height = 128, extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", deflateSync(Buffer.alloc(8))), chunk("IEND", Buffer.alloc(0))]);
}

const MANIFEST = JSON.stringify({ format: 1, name: "Test" });
let root: string;
let art: string;
function set(id: string, files: Record<string, Buffer | string> = {}): string {
  const dir = join(art, id);
  mkdirSync(dir, { recursive: true });
  const all = { "pet.json": MANIFEST, "both.png": png(), "left.png": png(), "right.png": png(), ...files };
  for (const [name, data] of Object.entries(all)) if (data !== "") writeFileSync(join(dir, name), data);
  return dir;
}
const codes = async (pack: PackArt | null = null) => {
  const { listed, problems } = await listCharacters(art, pack);
  return { ids: [...listed.keys()], problems: problems.map((p) => `${p.character}/${p.file}: ${p.code}`) };
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "desk-pet-art-"));
  art = join(root, "art");
  mkdirSync(art);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("art files", () => {
  it("accepts whole images and layers", async () => {
    set("whole", { "blink.png": png() });
    set("layered", { "face.png": png(), "face-blink.png": png(), "accessory.png": png() });
    expect(await codes()).toEqual({ ids: ["layered", "whole"], problems: [] });
  });

  it("refuses a fake PNG, wrong size, mismatched sizes, animated, oversize", async () => {
    set("fake", { "left.png": Buffer.from("not a picture, only named like one, long enough to pass the length check") });
    set("tiny", { "both.png": png(16, 16), "left.png": png(16, 16), "right.png": png(16, 16) });
    set("huge", { "both.png": png(4096, 4096), "left.png": png(4096, 4096), "right.png": png(4096, 4096) });
    set("uneven", { "left.png": png(128, 200) });
    set("moving", { "both.png": png(128, 128, [chunk("acTL", Buffer.alloc(8))]) });
    set("heavy", { "right.png": Buffer.concat([png(), Buffer.alloc(DESK_PET_ART.imageBytes)]) });
    const { ids, problems } = await codes();
    expect(ids).toEqual([]);
    expect(problems).toEqual(["fake/left.png: notPng", "heavy/right.png: tooLarge", "huge/both.png: badDimensions", "moving/both.png: animatedPng", "tiny/both.png: badDimensions", "uneven/left.png: sizeMismatch"]);
  });

  it("refuses missing files, a bad manifest, bad and reserved names", async () => {
    set("no-left", { "left.png": "" });
    set("no-json", { "pet.json": "" });
    set("bad-json", { "pet.json": "{" });
    set("bad-format", { "pet.json": JSON.stringify({ format: 2, name: "x" }) });
    set("Bad Name");
    set("placeholder");
    const { ids, problems } = await codes();
    expect(ids).toEqual([]);
    expect(problems.sort()).toEqual(["Bad Name/null: badName", "bad-format/pet.json: badManifest", "bad-json/pet.json: badManifest", "no-json/pet.json: noManifest", "no-left/left.png: missingFile", "placeholder/null: reservedName"]);
  });

  it("no symlink or junction escapes: a linked set, a linked file, a linked art root", async () => {
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.png"), png());
    writeFileSync(join(outside, "pet.json"), MANIFEST);
    writeFileSync(join(outside, "both.png"), png());
    writeFileSync(join(outside, "left.png"), png());
    writeFileSync(join(outside, "right.png"), png());
    symlinkSync(outside, join(art, "linked"), "junction");
    const dir = set("partly", { "left.png": "" });
    let fileLinks = true;
    try {
      symlinkSync(join(outside, "secret.png"), join(dir, "left.png"), "file");
    } catch {
      fileLinks = false; // no symlink privilege here; the set then reads as missing the file
    }
    const { ids, problems } = await codes();
    expect(ids).toEqual([]);
    expect(problems).toContain("linked/null: notPlainFolder");
    expect(problems).toContain(fileLinks ? "partly/left.png: notPlainFile" : "partly/left.png: missingFile");
    const linkedRoot = join(root, "art2");
    symlinkSync(outside, linkedRoot, "junction");
    expect((await listCharacters(linkedRoot, null)).listed.size).toBe(0);
  });

  it("caps the number of characters; other files are ignored", async () => {
    for (let i = 0; i < DESK_PET_ART.maxCharacters + 2; i++) set(`c${String(i).padStart(2, "0")}`);
    writeFileSync(join(art, "notes.txt"), "x");
    const { listed, problems } = await listCharacters(art, null);
    expect(listed.size).toBe(DESK_PET_ART.maxCharacters);
    expect(problems.map((p) => p.code)).toEqual(["tooMany", "tooMany"]);
  });

  it("pack art lists after the folder; the folder wins an id; a pack read is what it is", async () => {
    set("same");
    const files: Record<string, Buffer> = { "pet.json": Buffer.from(MANIFEST), "both.png": png(), "left.png": png(), "right.png": png() };
    const pack: PackArt = { characters: () => ["same", "shipped"], read: (_c, file) => files[file] ?? null };
    const { listed } = await listCharacters(art, pack);
    expect([...listed.keys()]).toEqual(["same", "shipped"]);
    expect(listed.get("same")!.character.source).toBe("folder");
    expect(listed.get("shipped")!.character.source).toBe("pack");
  });

  it("packArtOf lists only folders with a pet.json and asks the pack's verified read", () => {
    const asked: string[] = [];
    const art = packArtOf({
      paths: () => ["art/manifest.json", "art/a/pet.json", "art/a/both.png", "art/b/both.png"],
      read: (path) => {
        asked.push(path);
        return Buffer.alloc(1);
      },
    })!;
    expect(art.characters()).toEqual(["a"]);
    art.read("a", "both.png");
    expect(asked).toEqual(["art/a/both.png"]);
    expect(packArtOf({ paths: () => [], read: () => null })).toBeNull();
  });

  it("loading unions every layer's alpha and refuses what does not decode", async () => {
    set("ok", { "face.png": png(), "face-blink.png": png() });
    const { listed } = await listCharacters(art, null);
    const seen: number[] = [];
    const decode: DecodeImage = () => {
      const alpha = new Uint8Array(128 * 128);
      alpha[seen.length] = 200;
      seen.push(1);
      return { width: 128, height: 128, alpha, dataUrl: `data:image/png;base64,${seen.length}` };
    };
    const problems: never[] = [];
    const loaded = (await loadCharacter(listed.get("ok")!, decode, problems))!;
    expect(loaded.alpha.subarray(0, 6)).toEqual(new Uint8Array([200, 200, 200, 200, 200, 0]));
    expect(hasVisiblePixels(loaded)).toBe(true);
    expect(loaded.face).toBeTruthy();
    expect(loaded.faceBlink).toBeTruthy();
    const failed: { code: string }[] = [];
    expect(await loadCharacter(listed.get("ok")!, () => null, failed as never[])).toBeNull();
    expect(failed[0]!.code).toBe("undecodable");
    expect(hasVisiblePixels({ alpha: new Uint8Array(4) })).toBe(false);
  });

  it("icons: optional, square 32–256 px of their own size, by family; a bad one refuses the set", async () => {
    set("iconic", { "icon.png": png(64, 64), "icon-claude.png": png(32, 32), "icon-gpt.png": png(256, 256) });
    set("oblong", { "icon-kimi.png": png(32, 48) });
    set("big", { "icon.png": png(512, 512) });
    set("fake-icon", { "icon-glm.png": Buffer.from("no picture here, only named like one, long enough to pass the check") });
    set("other-name", { "icon-unknown.png": png(64, 64) });
    expect(await codes()).toEqual({ ids: ["iconic", "other-name"], problems: ["big/icon.png: badIconDimensions", "fake-icon/icon-glm.png: notPng", "oblong/icon-kimi.png: badIconDimensions"] });
    const { listed } = await listCharacters(art, null);
    const decode: DecodeImage = (bytes) => ({ width: 128, height: 128, alpha: new Uint8Array(128 * 128).fill(255), dataUrl: `data:${bytes.length}` });
    const loaded = (await loadCharacter(listed.get("iconic")!, decode, []))!;
    expect(Object.keys(loaded.icons).sort()).toEqual(["any", "claude", "gpt"]);
    expect((await loadCharacter(listed.get("other-name")!, decode, []))!.icons).toEqual({});
  });

  it("ticks: the mark is a boolean, an icon a known family or the coin", () => {
    expect(parseDeskPetRequest({ op: "tick", mark: true, icon: "claude" })).toEqual({ op: "tick", mark: true, icon: "claude" });
    expect(parseDeskPetRequest({ op: "tick", icon: "coin" })).toEqual({ op: "tick", icon: "coin" });
    for (const bad of [{ op: "tick", mark: "yes" }, { op: "tick", icon: "../x" }, { op: "tick", icon: "other" }]) expect(() => parseDeskPetRequest(bad)).toThrow();
    expect(parseDeskPetPatch({ currentOnly: true, waitingMark: false, tokenIcons: "yes" })).toEqual({ currentOnly: true, waitingMark: false });
  });

  it("manifests carry no paths and nothing unknown matters", () => {
    expect(parseDeskPetManifest({ format: 1, name: "A" })).toEqual({ name: "A", family: null, scale: 1, pixel: false, scene: null });
    expect(parseDeskPetManifest({ format: 1, name: { en: "A", "zh-CN": "甲" }, family: "gpt", scale: 0.5 })).toEqual({ name: { en: "A", "zh-CN": "甲" }, family: "gpt", scale: 0.5, pixel: false, scene: null });
    for (const bad of [{ format: 1 }, { format: 1, name: "" }, { format: 1, name: "A", scale: 9 }, { format: 1, name: "A", family: "../x" }, { format: "1", name: "A" }]) expect(parseDeskPetManifest(bad)).toBeNull();
    expect(checkDeskPetImage(png())).toEqual({ width: 128, height: 128 });
    expect(readPngHeader(Buffer.alloc(40))).toBeNull();
  });
});

describe("requests from the renderer", () => {
  const labels = { mirror: "i", clickThrough: "a", translucent: "b", onlyInFront: "c", showCount: "d", size: "e", character: "f", hide: "g", settings: "h" };

  it("are fixed ops with fixed values", () => {
    expect(parseDeskPetRequest({ op: "start", labels, url: "http://x" })).toEqual({ op: "start", labels });
    expect(parseDeskPetRequest({ op: "tick", pose: "left", total: 3, path: "C:\\x" })).toEqual({ op: "tick", pose: "left", total: 3 });
    for (const bad of [null, { op: "openUrl" }, { op: "start" }, { op: "start", labels: { ...labels, hide: "" } }, { op: "tick", pose: "up" }, { op: "tick", total: -1 }, { op: "tick", summary: "x".repeat(500) }, { op: "preview", id: "../x" }, { op: "follow", family: 3 }]) expect(() => parseDeskPetRequest(bad)).toThrow();
  });

  it("settings keep only known values", () => {
    expect(parseDeskPetPatch({ hidden: true, size: 3, character: "../up", x: 5, clickThrough: "yes" })).toEqual({ hidden: true });
    expect(parseDeskPetPatch({ size: 1.5, character: null, opacity: 0.7, followModel: true })).toEqual({ size: 1.5, character: null, opacity: 0.7, followModel: true });
    expect(parseDeskPetPatch({ opacity: 0.01 })).toEqual({});
    expect(() => parseDeskPetPatch("hidden")).toThrow();
  });
});

describe("window geometry", () => {
  it("the shape follows the art's alpha: art catches, transparent passes, nothing drawn is clipped", () => {
    // An L: the left column and the bottom row of a 100 × 100 picture shown at 50 × 50.
    const alpha = new Uint8Array(100 * 100);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) if (x < 10 || y >= 90) alpha[y * 100 + x] = 255;
    const rects = petShapeRects(alpha, 100, 100, 50, 50);
    const inside = (x: number, y: number) => rects.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
    expect(inside(1, 1)).toBe(true);
    expect(inside(25, 48)).toBe(true);
    expect(inside(30, 10)).toBe(false);
    expect(rects.length).toBeLessThan(6);
    // Faint pixels (a soft shadow below the threshold) do not catch clicks.
    expect(petShapeRects(new Uint8Array(100 * 100).fill(5), 100, 100, 50, 50)).toEqual([]);
  });

  it("a noisy picture falls back to coarser cells, not to thousands of rectangles", () => {
    const alpha = new Uint8Array(512 * 512);
    for (let i = 0; i < alpha.length; i += 3) alpha[i] = 255;
    const noisy = new Uint8Array(512 * 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) if ((x >> 2) % 2 === (y >> 2) % 2) noisy[y * 512 + x] = 255;
    expect(petShapeRects(noisy, 512, 512, 640, 640, 1).length).toBeLessThanOrEqual(1200);
  });

  it("the placeholder is real art with a body and transparent corners; hands differ between frames", () => {
    const S = DESK_PET_PLACEHOLDER_SIZE;
    const both = placeholderFrame("both");
    expect(both.length).toBe(S * S * 4);
    expect(both[3]).toBe(0);
    expect(both[(128 * S + 128) * 4 + 3]).toBe(255);
    const left = placeholderFrame("left");
    expect(Buffer.from(left).equals(Buffer.from(both))).toBe(false);
    // The head does not move between frames.
    for (const [x, y] of [[128, 100], [128, 132], [101, 124]] as const) expect(left[(y * S + x) * 4]).toBe(both[(y * S + x) * 4]);
    expect(placeholderFrame("blink")[3]).toBe(0);
  });

  it("sizes and positions", () => {
    expect(artDisplaySize(512, 512, 1, 1, 640)).toEqual({ width: 160, height: 160 });
    expect(artDisplaySize(512, 256, 2, 1, 640)).toEqual({ width: 320, height: 160 });
    expect(artDisplaySize(512, 512, 2, 2, 400)).toEqual({ width: 400, height: 400 });
    expect(petWindowSize({ width: 80, height: 80 }, true)).toEqual({ width: 96, height: 104 });
    expect(petWindowSize({ width: 160, height: 160 }, false)).toEqual({ width: 160, height: 160 });
    const a = [{ x: 0, y: 0, width: 1000, height: 800 }, { x: 1000, y: 0, width: 1000, height: 800 }];
    expect(keepOnDisplays({ x: 100, y: 100 }, { width: 160, height: 160 }, a)).toEqual({ x: 100, y: 100 });
    expect(keepOnDisplays({ x: 5000, y: 5000 }, { width: 160, height: 160 }, a)).toEqual({ x: 1976, y: 776 });
    expect(keepOnDisplays({ x: -500, y: -500 }, { width: 160, height: 160 }, a)).toEqual({ x: -136, y: 0 });
    expect(keepOnDisplays({ x: 0, y: 0 }, { width: 1, height: 1 }, [])).toBeNull();
  });
});

describe("mirror", () => {
  it("swaps the hand frames so a pose stays that hand on screen; rest stays", () => {
    expect(shownPose("left", false)).toBe("left");
    expect(shownPose("left", true)).toBe("right");
    expect(shownPose("right", true)).toBe("left");
    expect(shownPose("both", true)).toBe("both");
  });

  it("the shape follows the flipped picture", () => {
    // Art only in the left quarter of a 100 × 10 picture.
    const alpha = new Uint8Array(100 * 10);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 25; x++) alpha[y * 100 + x] = 255;
    const plain = petShapeRects(alpha, 100, 10, 100, 10);
    const flipped = mirrorRects(plain, 100);
    expect(Math.min(...plain.map((r) => r.x))).toBe(0);
    expect(Math.max(...plain.map((r) => r.x + r.width))).toBeLessThanOrEqual(26);
    expect(Math.min(...flipped.map((r) => r.x))).toBeGreaterThanOrEqual(74);
    expect(Math.max(...flipped.map((r) => r.x + r.width))).toBe(100);
  });

  it("is a saved setting, and pixel a manifest field", () => {
    expect(parseDeskPetPatch({ mirror: true })).toEqual({ mirror: true });
    expect(parseDeskPetPatch({ mirror: "yes" })).toEqual({});
    expect(parseDeskPetManifest({ format: 1, name: "x", pixel: true })?.pixel).toBe(true);
    expect(parseDeskPetManifest({ format: 1, name: "x" })?.pixel).toBe(false);
    expect(parseDeskPetManifest({ format: 1, name: "x", pixel: "yes" })).toBeNull();
  });
});
