// Desk pet art format 2 (shared/deskPetScene.ts, main/deskPetArt.ts; docs/desktop-modules.md §29.9): the scene is data
// a fixed renderer plays, checked strictly; anything unknown or pointing at nothing refuses the set.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listCharacters, loadCharacter, sceneAlpha, type DecodeImage } from "../src/main/deskPetArt";
import { parseDeskPetManifest, parseDeskPetRequest } from "../src/shared/deskPet";
import { deskPetSceneFiles, DESK_PET_SCENE, isGreenKeyed, parseDeskPetBooks, parseDeskPetScene, pileBookBox, sceneDipPerUnit, tinted } from "../src/shared/deskPetScene";

const READER = join(__dirname, "../src/renderer/src/modules/desk-pet/art/reader/pet.json");
const reader = () => JSON.parse(readFileSync(READER, "utf8")) as Record<string, unknown>;

/** A small valid scene; `patch` replaces top-level fields. */
function scene(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 2,
    name: "Scene",
    canvas: [320, 256],
    character: [0, 0, 256, 256],
    bodies: { up: { still: "up.png", breath: ["up-0.png", "up-1.png"] }, read: { still: "read.png" } },
    props: { open: { image: "open.png", cover: { quad: [[10, 10], [40, 10], [40, 40], [10, 40]], over: "over.png" } } },
    pages: { turn: "turn.png" },
    hands: "hands.png",
    covers: { green: { kind: "book" }, night: { kind: "diary", image: "night.png", tint: [0.6, 0.8, 1.2] } },
    pile: { image: "pile.png", at: [240, 226], size: [72, 24], step: 7, max: 20, deck: [{ cover: "green" }, { cover: "night", units: 2 }] },
    clips: {
      idle: [{ body: "up", ms: 2400 }],
      reading: [{ body: "read", prop: "open", ms: 1000 }, { body: "read", prop: "open", ms: 140, page: "turn" }],
      opening: [{ body: "read", prop: "open", ms: 90, magic: 0 }, { body: "read", prop: "open", ms: 90, magic: 1 }],
    },
    ...patch,
  };
}

describe("format 2 scene", () => {
  it("the shipped example and a small scene parse; every file is listed once", () => {
    const parsed = parseDeskPetScene(reader())!;
    expect(parsed).toBeTruthy();
    expect(parsed.pile).toMatchObject({ max: 20, step: 7, width: 72, height: 24 });
    const small = parseDeskPetScene(scene())!;
    expect(deskPetSceneFiles(small).sort()).toEqual(["hands.png", "night.png", "open.png", "over.png", "pile.png", "read.png", "turn.png", "up-0.png", "up-1.png", "up.png"]);
    expect(small.clips.reading![1]).toEqual({ body: "read", prop: "open", ms: 140, magic: null, page: "turn" });
    expect(parseDeskPetManifest(scene())).toMatchObject({ name: "Scene", scene: { canvas: { width: 320, height: 256 } } });
  });

  it("refuses unknown fields anywhere, and dangling references", () => {
    const bad: Record<string, unknown>[] = [
      scene({ script: "alert(1)" }),
      scene({ bodies: { up: { still: "up.png", onload: "x" } } }),
      scene({ clips: { idle: [{ body: "up", ms: 100 }], reading: [{ body: "up", ms: 100 }], dance: [{ body: "up", ms: 100 }] } }),
      scene({ clips: { idle: [{ body: "nope", ms: 100 }], reading: [{ body: "up", ms: 100 }] } }),
      scene({ clips: { idle: [{ body: "up", ms: 100, prop: "nope" }], reading: [{ body: "up", ms: 100 }] } }),
      scene({ clips: { idle: [{ body: "up", ms: 100, page: "nope" }], reading: [{ body: "up", ms: 100 }] } }),
      scene({ clips: { idle: [{ body: "up", ms: 100, magic: 0.5 }], reading: [{ body: "up", ms: 100 }] } }),
      scene({ clips: { idle: [{ body: "up", ms: 100 }] } }),
      scene({ clips: { idle: [{ body: "up", ms: 100 }], reading: [{ body: "up", ms: 100 }], sleeping: [{ body: "up", ms: 100 }] } }),
      scene({ pile: { image: "pile.png", at: [240, 226], size: [72, 24], step: 7, max: 20, deck: [{ cover: "missing" }] } }),
    ];
    for (const raw of bad) expect(parseDeskPetScene(raw), JSON.stringify(raw).slice(0, 120)).toBeNull();
  });

  it("file names are plain lowercase PNG names beside pet.json: no folders, no way out", () => {
    for (const name of ["../up.png", "a/up.png", "a\\up.png", "UP.png", "up.PNG", "up", ".up.png", "up.png.exe", "C:up.png", "%2e%2e.png"]) {
      expect(parseDeskPetScene(scene({ hands: name })), name).toBeNull();
    }
    expect(parseDeskPetScene(scene({ hands: "hands_2-b.png" }))).toBeTruthy();
  });

  it("ranges: canvas, character box, frame time, pile inside the canvas, at most 20 books, magic 0–1, tints 0–2", () => {
    const bad = [
      { canvas: [32, 256] },
      { canvas: [2048, 256] },
      { character: [100, 0, 256, 256] },
      { character: [0, 0, 16, 256] },
      { pile: { image: "pile.png", at: [300, 226], size: [72, 24], step: 7, max: 20 } },
      { pile: { image: "pile.png", at: [240, 226], size: [72, 24], step: 12, max: 20 } },
      { pile: { image: "pile.png", at: [240, 226], size: [72, 24], step: 1, max: 21 } },
      { covers: { green: { tint: [3, 1, 1] } } },
      { clips: { idle: [{ body: "up", ms: 5 }], reading: [{ body: "up", ms: 100 }] } },
      { clips: { idle: [{ body: "up", ms: 100, prop: "open", magic: 2 }], reading: [{ body: "up", ms: 100 }] } },
      { props: { open: { image: "open.png", cover: { quad: [[10, 10], [400, 10], [40, 40], [10, 40]] } } } },
    ];
    for (const patch of bad) expect(parseDeskPetScene(scene(patch)), JSON.stringify(patch)).toBeNull();
    const many = Array.from({ length: DESK_PET_SCENE.maxBreath + 1 }, (_, i) => `b-${i}.png`);
    expect(parseDeskPetScene(scene({ bodies: { up: { still: "up.png", breath: many }, read: { still: "read.png" } } }))).toBeNull();
  });

  it("pile geometry, the green key and size on screen", () => {
    const pile = parseDeskPetScene(scene())!.pile!;
    expect(pileBookBox(pile, 0)).toEqual({ x: 240, y: 226, width: 72, height: 24 });
    expect(pileBookBox(pile, 19)).toEqual({ x: 240, y: 226 - 133, width: 72, height: 24 });
    expect(isGreenKeyed(70, 150, 90, 255)).toBe(true);
    expect(isGreenKeyed(70, 150, 90, 0)).toBe(false);
    expect(isGreenKeyed(200, 180, 150, 255)).toBe(false);
    expect(tinted(100, 160, 100, [2, 1, 0.5])).toEqual([240, 120, 60]);
    // The character is 160 DIP high at 100 %; the pile beside it widens the window: 320 × 256 → 200 × 160.
    const s = parseDeskPetScene(scene())!;
    expect(sceneDipPerUnit(s, 160, 1, 1, 640) * 320).toBe(200);
    expect(sceneDipPerUnit(s, 160, 2, 2, 640) * 320).toBe(640);
  });

  it("books in a tick: ids, known-shaped covers, at most 20", () => {
    expect(parseDeskPetRequest({ op: "tick", work: true, books: { active: { id: "book-2026-11-09-001", cover: "green" }, pile: [{ id: "b2", cover: "night" }] } })).toEqual({ op: "tick", work: true, books: { active: { id: "book-2026-11-09-001", cover: "green" }, pile: [{ id: "b2", cover: "night" }] } });
    expect(() => parseDeskPetRequest({ op: "tick", work: "yes" })).toThrow();
    expect(() => parseDeskPetBooks({ active: null, pile: Array.from({ length: 21 }, (_, i) => ({ id: `b${i}`, cover: "green" })) })).toThrow();
    expect(() => parseDeskPetBooks({ active: { id: "../x", cover: "green" }, pile: [] })).toThrow();
    expect(() => parseDeskPetBooks({ active: { id: "x", cover: "Green Cover" }, pile: [] })).toThrow();
  });
});

// ---- the folder checks and loading ----

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}
function png(width: number, height: number, extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", deflateSync(Buffer.alloc(8))), chunk("IEND", Buffer.alloc(0))]);
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "desk-pet-scene-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeSet(id: string, manifest: Record<string, unknown>, sizes: Record<string, [number, number]> = {}, skip: string[] = []): void {
  const dir = join(root, "art", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pet.json"), JSON.stringify(manifest));
  const parsed = parseDeskPetScene(manifest);
  for (const file of parsed ? deskPetSceneFiles(parsed) : []) {
    if (skip.includes(file)) continue;
    const [w, h] = sizes[file] ?? [256, 256];
    writeFileSync(join(dir, file), png(w, h));
  }
}

describe("format 2 sets in the art folder", () => {
  it("lists a scene with its pile for the module; refuses a missing file, a bad image and a set too large to hold", async () => {
    writeSet("good", scene(), { "pile.png": [72, 24], "night.png": [1352, 1352] });
    writeSet("missing", scene(), {}, ["turn.png"]);
    writeSet("moving", scene(), {}, ["hands.png"]);
    writeFileSync(join(root, "art", "moving", "hands.png"), png(256, 256, [chunk("acTL", Buffer.alloc(8))]));
    writeSet("toobig", scene(), { "night.png": [3000, 100] });
    const bodies: Record<string, unknown> = {};
    const sizes: Record<string, [number, number]> = {};
    for (let i = 0; i < 16; i++) {
      bodies[`b${i}`] = { still: `s${i}.png` };
      sizes[`s${i}.png`] = [2048, 2048];
    }
    writeSet("heavy", scene({ bodies, clips: { idle: [{ body: "b0", ms: 100 }], reading: [{ body: "b1", ms: 100 }] }, props: {}, pages: {} }), sizes);
    const { listed, problems } = await listCharacters(join(root, "art"), null);
    expect([...listed.keys()]).toEqual(["good"]);
    expect(listed.get("good")!.character).toMatchObject({ format: 2, books: { max: 20, deck: [{ cover: "green", kind: "book", units: 1 }, { cover: "night", kind: "diary", units: 2 }] } });
    expect(problems.map((p) => `${p.character}/${p.file}: ${p.code}`).sort()).toEqual(["heavy/null: setTooLarge", "missing/turn.png: missingFile", "moving/hands.png: animatedPng", "toobig/night.png: badSceneDimensions"]);
  });

  it("loads scaled to the screen, the shape from the character's layers, the pile's added per book", async () => {
    writeSet("good", scene(), { "pile.png": [144, 48], "up.png": [512, 512] });
    const { listed } = await listCharacters(join(root, "art"), null);
    const fits: Record<string, unknown> = {};
    // Every image draws a solid block in its top-left quarter.
    const decode: DecodeImage = (bytes, fit) => {
      const w = bytes.readUInt32BE(16);
      const h = bytes.readUInt32BE(20);
      const alpha = new Uint8Array(w * h);
      for (let y = 0; y < h / 2; y++) for (let x = 0; x < w / 2; x++) alpha[y * w + x] = 255;
      fits[`${w}x${h}`] = fit;
      return { width: w, height: h, alpha, dataUrl: `data:image/png;base64,${w}` };
    };
    const problems: never[] = [];
    const loaded = (await loadCharacter(listed.get("good")!, decode, problems, 1.5))!;
    expect(problems).toEqual([]);
    expect(loaded).toMatchObject({ width: 320, height: 256, both: "" });
    expect(Object.keys(loaded.scene!.images).length).toBe(10);
    // The character's box at 1.5 px per unit; the pile at its own size.
    expect(fits["512x512"]).toEqual({ width: 384, height: 384 });
    expect(fits["144x48"]).toEqual({ width: 108, height: 36 });
    expect(loaded.alpha[0]).toBe(255);
    expect(loaded.alpha[200 * 320 + 200]).toBe(0);
    // Pile book 0 at (240, 226): its top-left quarter is drawn; book 2 is 14 units higher.
    expect(sceneAlpha(loaded, 0)[230 * 320 + 250]).toBe(0);
    expect(sceneAlpha(loaded, 1)[230 * 320 + 250]).toBe(255);
    expect(sceneAlpha(loaded, 1)[(230 - 14) * 320 + 250]).toBe(0);
    expect(sceneAlpha(loaded, 3)[(230 - 14) * 320 + 250]).toBe(255);
  });
});
