// The desk pet as a pack (docs/desktop-modules.md §29, §23): the real pack builds; the gate on images and names.
import { createHash } from "node:crypto";
import { DESK_PET_DEFAULT_CHARACTER, checkDeskPetImage, parseDeskPetManifest } from "../src/shared/deskPet";
import { deskPetSceneFiles } from "../src/shared/deskPetScene";
import { petFamilyOf } from "../src/renderer/src/modules/desk-pet/follow";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildPack, packDataFiles } from "../scripts/module-packs/build.mjs";
import { MODULE_API_VERSION, moduleApiSatisfies } from "@cutex-desktop/plugin-sdk";

const MODULE_DIR = join(__dirname, "../src/renderer/src/modules/desk-pet");
const out = mkdtempSync(join(tmpdir(), "desk-pet-pack-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i;

describe("desk-pet pack", () => {
  it("builds; the signed file set has code only, unless its art is listed; no image data inside the code; no app file bundled", async () => {
    const { entry, files } = await buildPack("desk-pet", out, { logLevel: "warn" });
    expect(entry.id).toBe("desk-pet");
    expect(moduleApiSatisfies(entry.moduleApi, MODULE_API_VERSION)).toBe(true);
    const art = files.filter((f) => f.path.startsWith("art/"));
    const listed = art.length ? new Set(JSON.parse(art.find((f) => f.path === "art/manifest.json")!.data.toString("utf8")).images.map((i: { path: string }) => `art/${i.path}`)) : new Set<string>();
    for (const f of files) if (IMAGE.test(f.path)) expect(listed.has(f.path), `${f.path} is not listed in art/manifest.json`).toBe(true);
    const code = files.find((f) => f.path === "index.js")!.data.toString("utf8");
    expect(code).not.toMatch(/data:image\/(png|jpe?g|gif|webp)/);
    expect(code).not.toMatch(/iVBORw0KGgo/);
    // Rendering happens in main's window: nothing of the window's document in the pack.
    expect(code).not.toContain("placeholderFrame");
    for (const spec of Object.keys(entry.host)) expect(spec).toMatch(/^(react|react\/jsx-runtime|@cutex-desktop\/app\/)/);
  }, 120_000);

  it("the art gate: unlisted, sourceless or non-PNG files stop the build", () => {
    const dir = mkdtempSync(join(out, "gate-"));
    expect(packDataFiles(dir)).toEqual([]);
    const art = join(dir, "art", "one");
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "pet.json"), "{}");
    writeFileSync(join(art, "both.png"), "x");
    expect(() => packDataFiles(dir)).toThrow(/manifest\.json is missing/);
    const manifest = (images: unknown[]) => writeFileSync(join(dir, "art", "manifest.json"), JSON.stringify({ images }));
    manifest([]);
    expect(() => packDataFiles(dir)).toThrow(/not listed/);
    manifest([{ path: "one/both.png", source: "generated", tool: "t" }]);
    expect(() => packDataFiles(dir)).toThrow(/not listed/);
    manifest([{ path: "one/both.png", source: "found", tool: "t", prompt: "p" }]);
    expect(() => packDataFiles(dir)).toThrow(/not listed/);
    manifest([{ path: "one/both.png", source: "generated", tool: "t", prompt: "p" }, { path: "one/gone.png", source: "generated", tool: "t", prompt: "p" }]);
    expect(() => packDataFiles(dir)).toThrow(/not there/);
    manifest([{ path: "one/both.png", source: "generated", tool: "t", prompt: "p" }]);
    expect(packDataFiles(dir).map((f: { path: string }) => f.path).sort()).toEqual(["art/manifest.json", "art/one/both.png", "art/one/pet.json"]);
    writeFileSync(join(art, "left.jpg"), "x");
    manifest([{ path: "one/both.png", source: "generated", tool: "t", prompt: "p" }, { path: "one/left.jpg", source: "generated", tool: "t", prompt: "p" }]);
    expect(() => packDataFiles(dir)).toThrow(/only PNG/);
  });

  it("no image lives in the module's source outside a listed art folder", () => {
    const files = walk(MODULE_DIR);
    const hasArt = files.some((f) => f.endsWith(join("art", "manifest.json")));
    for (const f of files) if (IMAGE.test(f)) expect(hasArt && f.includes(join("desk-pet", "art")), f).toBe(true);
  });

  it("the window's preload shares no runtime module with the app's: a shared chunk cannot load in a sandboxed preload", () => {
    const values = (file: string) => [...readFileSync(join(__dirname, "../src/preload", file), "utf8").matchAll(/^import (?!type )[^;]*? from "([^"]+)";/gms)].map((m) => m[1]!);
    const shared = values("index.ts").filter((spec) => spec.startsWith("../shared/"));
    for (const spec of values("deskPet.ts")) expect(shared, spec).not.toContain(spec);
  });

  it("packOnly: the source lives here without being a bundled copy", () => {
    expect(JSON.parse(readFileSync(join(MODULE_DIR, "pack.json"), "utf8")).packOnly).toBe(true);
    const registry = readFileSync(join(__dirname, "../src/renderer/src/modules/registry.ts"), "utf8");
    expect(registry).not.toMatch(/desk-pet/);
    const versions = readFileSync(join(__dirname, "../src/renderer/src/modules/packVersions.ts"), "utf8");
    expect(versions).toMatch(/!json\.packOnly/);
  });
});

describe("desk-pet shipped art", () => {
  const artDir = join(__dirname, "../src/renderer/src/modules/desk-pet/art");
  const FAMILIES = ["claude", "gpt", "gemini", "deepseek", "kimi", "glm"];

  it("one set per model family, the default among them, each the same format; every image listed with its recorded bytes and prompt", () => {
    const manifest = JSON.parse(readFileSync(join(artDir, "manifest.json"), "utf8")) as { images: { path: string; source: string; tool: string; prompt: string; sha256: string }[] };
    const folders = readdirSync(artDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect(folders).toEqual([...FAMILIES, "reader"].sort());
    expect(folders).toContain(DESK_PET_DEFAULT_CHARACTER);
    for (const id of FAMILIES) {
      expect(readdirSync(join(artDir, id)).sort()).toEqual(["blink.png", "both.png", "left.png", "pet.json", "right.png"]);
      const pet = parseDeskPetManifest(JSON.parse(readFileSync(join(artDir, id, "pet.json"), "utf8")));
      expect(pet).toMatchObject({ family: id, pixel: true });
      for (const file of ["both.png", "left.png", "right.png", "blink.png"]) {
        const bytes = readFileSync(join(artDir, id, file));
        expect(checkDeskPetImage(bytes)).toMatchObject({ width: 512, height: 512 });
        const listed = manifest.images.find((i) => i.path === `${id}/${file}`);
        expect(listed, `${id}/${file}`).toBeTruthy();
        expect(listed!.source).toBe("generated");
        expect(listed!.prompt.length).toBeGreaterThan(0);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(listed!.sha256);
      }
    }
    expect(manifest.images.filter((i) => !i.path.startsWith("reader/"))).toHaveLength(FAMILIES.length * 4);
  });

  it("the format 2 example is original, drawn by its script: a scene whose every file is listed with its bytes", () => {
    const manifest = JSON.parse(readFileSync(join(artDir, "manifest.json"), "utf8")) as { images: { path: string; source: string; tool: string; prompt: string; sha256: string }[] };
    const pet = parseDeskPetManifest(JSON.parse(readFileSync(join(artDir, "reader", "pet.json"), "utf8")))!;
    expect(pet.scene).toBeTruthy();
    expect(pet.family).toBeNull();
    const files = deskPetSceneFiles(pet.scene!);
    expect(readdirSync(join(artDir, "reader")).sort()).toEqual([...files, "pet.json"].sort());
    for (const file of files) {
      const listed = manifest.images.find((i) => i.path === `reader/${file}`)!;
      expect(listed.tool).toMatch(/desk-pet-reader\.mjs/);
      expect(createHash("sha256").update(readFileSync(join(artDir, "reader", file))).digest("hex")).toBe(listed.sha256);
    }
  });

  it("every model family the option can ask for has a pet", () => {
    for (const family of ["claude", "openai", "gemini", "deepseek", "kimi", "glm"] as const) expect(FAMILIES).toContain(petFamilyOf("s", () => family));
    expect(petFamilyOf("s", () => "other")).toBeNull();
  });

  it("stays well inside the pack limits (64 files, 4 MiB each, 16 MiB in all)", () => {
    const files = packDataFiles(join(__dirname, "../src/renderer/src/modules/desk-pet"));
    expect(files.length + 3).toBeLessThanOrEqual(64);
    expect(Math.max(...files.map((f) => f.data.length))).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(files.reduce((n, f) => n + f.data.length, 0)).toBeLessThanOrEqual(16 * 1024 * 1024);
  });

  it("the gate refuses a changed image", () => {
    const dir = mkdtempSync(join(tmpdir(), "desk-pet-art-"));
    const set = join(dir, "art", "one");
    mkdirSync(set, { recursive: true });
    writeFileSync(join(set, "pet.json"), "{}");
    writeFileSync(join(set, "both.png"), "x");
    writeFileSync(join(dir, "art", "manifest.json"), JSON.stringify({ images: [{ path: "one/both.png", source: "generated", tool: "t", prompt: "p", sha256: "0".repeat(64) }] }));
    expect(() => packDataFiles(dir)).toThrow(/recorded/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("desk-pet in the preview", () => {
  it("the mock's install keeps the index's moduleApi, or the pack loader refuses a pack on a newer contract", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const { mockModulePacks } = await import("../src/renderer/src/dev/mockModulePacks");
    const packs = mockModulePacks();
    vi.useFakeTimers();
    const installing = packs.install({ id: "desk-pet" });
    await vi.runAllTimersAsync();
    const view = await installing;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    const pack = JSON.parse(readFileSync(join(__dirname, "../src/renderer/src/modules/desk-pet/pack.json"), "utf8")) as { moduleApi: string };
    expect(view.installed.find((p) => p.id === "desk-pet")?.moduleApi).toBe(pack.moduleApi);
  });
});
