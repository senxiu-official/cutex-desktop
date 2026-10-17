// Launcher artwork: the bundled glob (renderer lib/launchArt), the imported-over-bundled order, and the
// runtime import into userData (main/launchArt.ts: exact names only, regular PNG files within the cap,
// no symlinks, both files of a provider). Fixtures are tiny generated PNGs, never the real artwork.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleLaunchArtRequest, LaunchArtStore, readLaunchArtFile } from "../src/main/launchArt";
import { isPng, type LaunchArtImportResult, type LaunchArtState } from "../src/shared/launchArt";
import { LAUNCH_ART_FILES, launchArtFrom, launchArtSource, mergeLaunchArt } from "../src/renderer/src/lib/launchArt";

describe("launch artwork (optional, not in git)", () => {
  it("yields nothing when the images are missing", () => {
    expect(launchArtFrom({})).toEqual({});
  });
  it("needs both a portrait and a victory image per provider", () => {
    const art = launchArtFrom({
      [`../assets/launcher/${LAUNCH_ART_FILES.codex.portrait}`]: "/a.png",
      [`../assets/launcher/${LAUNCH_ART_FILES.codex.victory}`]: "/b.png",
      [`../assets/launcher/${LAUNCH_ART_FILES.claude.portrait}`]: "/c.png",
      "../assets/launcher/unrelated.png": "/d.png",
    });
    expect(art).toEqual({ codex: { portrait: "/a.png", victory: "/b.png" } });
  });
});

describe("imported over bundled", () => {
  const bundled = { codex: { portrait: "/bundled/codex-p.png", victory: "/bundled/codex-v.png" }, glm: { portrait: "/bundled/glm-p.png", victory: "/bundled/glm-v.png" } };
  const imported = { codex: { portrait: "data:image/png;base64,AA", victory: "data:image/png;base64,BB" }, kimi: { portrait: "data:image/png;base64,CC", victory: "data:image/png;base64,DD" } };
  it("replaces a provider's bundled art and adds new providers, leaving the rest bundled", () => {
    expect(mergeLaunchArt(bundled, imported)).toEqual({ codex: imported.codex, glm: bundled.glm, kimi: imported.kimi });
    expect(mergeLaunchArt(bundled, null)).toEqual(bundled);
  });
  it("never uses half an imported provider", () => {
    expect(mergeLaunchArt(bundled, { codex: { portrait: "data:image/png;base64,AA", victory: "" } })).toEqual(bundled);
    expect(mergeLaunchArt({}, { kimi: { portrait: "data:image/png;base64,AA" } as never })).toEqual({});
  });
  it("reports each provider's source for Settings", () => {
    expect(launchArtSource("codex", bundled, imported)).toBe("imported");
    expect(launchArtSource("glm", bundled, imported)).toBe("bundled");
    expect(launchArtSource("kimi", bundled, imported)).toBe("imported");
    expect(launchArtSource("gemini", bundled, imported)).toBe("none");
    // Cleared: back to bundled, else none.
    expect(launchArtSource("codex", bundled, {})).toBe("bundled");
    expect(launchArtSource("kimi", bundled, {})).toBe("none");
  });
});

// ── main/launchArt.ts ─────────────────────────────────────────────────────────────────────────────

function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
/** A real 1×1 grey PNG; `shade` makes each fixture distinguishable. */
function tinyPng(shade: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, shade]))), chunk("IEND", Buffer.alloc(0))]);
}
const dataUrlOf = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;

let root = "";
let folder = "";
let store = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "launch-art-test-"));
  folder = join(root, "picked");
  store = join(root, "userData", "launcher-art");
  mkdirSync(folder, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (name: string, bytes: Buffer, dir = folder) => writeFileSync(join(dir, name), bytes);

describe("readLaunchArtFile", () => {
  it("accepts a regular PNG and refuses everything else", async () => {
    const png = tinyPng(1);
    expect(isPng(png)).toBe(true);
    put("ok.png", png);
    put("text.png", Buffer.from("not an image at all"));
    put("short.png", Buffer.from([0x89, 0x50]));
    mkdirSync(join(folder, "dir.png"));
    await expect(readLaunchArtFile(join(folder, "ok.png"))).resolves.toEqual({ kind: "ok", bytes: png });
    await expect(readLaunchArtFile(join(folder, "text.png"))).resolves.toEqual({ kind: "refused", reason: "notPng" });
    await expect(readLaunchArtFile(join(folder, "short.png"))).resolves.toEqual({ kind: "refused", reason: "notPng" });
    await expect(readLaunchArtFile(join(folder, "dir.png"))).resolves.toEqual({ kind: "refused", reason: "notFile" });
    await expect(readLaunchArtFile(join(folder, "missing.png"))).resolves.toEqual({ kind: "missing" });
    await expect(readLaunchArtFile(join(folder, "ok.png"), png.length - 1)).resolves.toEqual({ kind: "refused", reason: "tooLarge" });
  });
  it.skipIf(process.platform === "win32")("refuses a symlink, even to a valid PNG", async () => {
    put("real.png", tinyPng(2));
    symlinkSync(join(folder, "real.png"), join(folder, "link.png"));
    await expect(readLaunchArtFile(join(folder, "link.png"))).resolves.toEqual({ kind: "refused", reason: "symlink" });
  });
});

describe("LaunchArtStore", () => {
  it("copies only the exact launcher names, and only complete providers", async () => {
    const codexP = tinyPng(10);
    const codexV = tinyPng(11);
    put(LAUNCH_ART_FILES.codex.portrait, codexP);
    put(LAUNCH_ART_FILES.codex.victory, codexV);
    put(LAUNCH_ART_FILES.kimi.portrait, tinyPng(12)); // the victory pose is missing
    put(LAUNCH_ART_FILES.glm.portrait, tinyPng(13));
    put(LAUNCH_ART_FILES.glm.victory, Buffer.from("GIF89a fake")); // not a PNG
    put("codex-portrait-other-version.png", tinyPng(14)); // wrong name
    put("notes.txt", Buffer.from("ignored"));
    mkdirSync(join(folder, "sub"));
    put(LAUNCH_ART_FILES.claude.portrait, tinyPng(15), join(folder, "sub")); // not at the top of the folder
    put(LAUNCH_ART_FILES.claude.victory, tinyPng(16), join(folder, "sub"));
    const result = await new LaunchArtStore(store).importFrom(folder);
    expect(result.imported).toEqual(["codex"]);
    expect(result.incomplete.sort()).toEqual(["glm", "kimi"]);
    expect(result.refused).toEqual([{ file: LAUNCH_ART_FILES.glm.victory, reason: "notPng" }]);
    expect(readdirSync(store).sort()).toEqual([LAUNCH_ART_FILES.codex.portrait, LAUNCH_ART_FILES.codex.victory].sort());
    expect(readFileSync(join(store, LAUNCH_ART_FILES.codex.portrait))).toEqual(codexP);
    expect(result.state).toEqual({ imported: { codex: { portrait: dataUrlOf(codexP), victory: dataUrlOf(codexV) } } });
  });

  it("refuses an oversized file (the provider stays incomplete) and writes nothing", async () => {
    put(LAUNCH_ART_FILES.claude.portrait, tinyPng(1));
    put(LAUNCH_ART_FILES.claude.victory, Buffer.concat([tinyPng(2), Buffer.alloc(200)]));
    const result = await new LaunchArtStore(store, 120).importFrom(folder);
    expect(result).toMatchObject({ imported: [], incomplete: ["claude"], refused: [{ file: LAUNCH_ART_FILES.claude.victory, reason: "tooLarge" }] });
    expect(() => readdirSync(store)).toThrow();
  });

  it.skipIf(process.platform === "win32")("refuses symlinked launcher files", async () => {
    put("elsewhere.png", tinyPng(3));
    put(LAUNCH_ART_FILES.deepseek.portrait, tinyPng(4));
    symlinkSync(join(folder, "elsewhere.png"), join(folder, LAUNCH_ART_FILES.deepseek.victory));
    const result = await new LaunchArtStore(store).importFrom(folder);
    expect(result).toMatchObject({ imported: [], incomplete: ["deepseek"], refused: [{ file: LAUNCH_ART_FILES.deepseek.victory, reason: "symlink" }] });
  });

  it("a later import replaces only the providers it brings; clear removes every import", async () => {
    const art = new LaunchArtStore(store);
    put(LAUNCH_ART_FILES.codex.portrait, tinyPng(20));
    put(LAUNCH_ART_FILES.codex.victory, tinyPng(21));
    put(LAUNCH_ART_FILES.gemini.portrait, tinyPng(22));
    put(LAUNCH_ART_FILES.gemini.victory, tinyPng(23));
    await art.importFrom(folder);
    const second = join(root, "second");
    mkdirSync(second);
    const newCodex = tinyPng(30);
    put(LAUNCH_ART_FILES.codex.portrait, newCodex, second);
    put(LAUNCH_ART_FILES.codex.victory, tinyPng(31), second);
    const result = await art.importFrom(second);
    expect(result.imported).toEqual(["codex"]);
    expect(Object.keys(result.state.imported).sort()).toEqual(["codex", "gemini"]);
    expect(result.state.imported.codex?.portrait).toBe(dataUrlOf(newCodex));
    expect(readdirSync(store).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    put("keep-me.txt", Buffer.from("not ours"), store);
    await expect(art.clear()).resolves.toEqual({ imported: {} });
    expect(readdirSync(store)).toEqual(["keep-me.txt"]);
  });

  it("re-validates the store when serving it: a file swapped in by hand is not served", async () => {
    mkdirSync(store, { recursive: true });
    put(LAUNCH_ART_FILES.kimi.portrait, tinyPng(40), store);
    put(LAUNCH_ART_FILES.kimi.victory, Buffer.from("<svg/>"), store);
    put(LAUNCH_ART_FILES.glm.portrait, tinyPng(41), store);
    put(LAUNCH_ART_FILES.glm.victory, tinyPng(42), store);
    await expect(new LaunchArtStore(store).state()).resolves.toEqual({ imported: { glm: { portrait: dataUrlOf(tinyPng(41)), victory: dataUrlOf(tinyPng(42)) } } });
    await expect(new LaunchArtStore(join(root, "never-created")).state()).resolves.toEqual({ imported: {} });
  });

  it("needs an absolute folder", async () => {
    await expect(new LaunchArtStore(store).importFrom("relative/folder")).rejects.toThrow("absolute");
  });
});

describe("handleLaunchArtRequest", () => {
  it("imports from the folder main's dialog picked; a cancelled dialog changes nothing", async () => {
    const art = new LaunchArtStore(store);
    put(LAUNCH_ART_FILES.claude.portrait, tinyPng(50));
    put(LAUNCH_ART_FILES.claude.victory, tinyPng(51));
    const canceled = (await handleLaunchArtRequest(art, { op: "import" }, async () => null)) as LaunchArtImportResult;
    expect(canceled).toEqual({ canceled: true, imported: [], incomplete: [], refused: [], state: { imported: {} } });
    const done = (await handleLaunchArtRequest(art, { op: "import" }, async () => folder)) as LaunchArtImportResult;
    expect(done).toMatchObject({ canceled: false, imported: ["claude"] });
    expect(Object.keys(((await handleLaunchArtRequest(art, { op: "state" }, async () => null)) as LaunchArtState).imported)).toEqual(["claude"]);
    await expect(handleLaunchArtRequest(art, { op: "clear" }, async () => null)).resolves.toEqual({ imported: {} });
  });
  it("rejects unknown ops and extra fields (a renderer cannot name a folder)", async () => {
    const art = new LaunchArtStore(store);
    let asked = false;
    const pick = async () => {
      asked = true;
      return folder;
    };
    await expect(handleLaunchArtRequest(art, { op: "drop" } as never, pick)).rejects.toThrow("unknown launch-art op");
    await expect(handleLaunchArtRequest(art, { op: "import", folder } as never, pick)).rejects.toThrow("unknown launch-art op");
    await expect(handleLaunchArtRequest(art, null as never, pick)).rejects.toThrow("unknown launch-art op");
    await expect(handleLaunchArtRequest(art, [] as never, pick)).rejects.toThrow("unknown launch-art op");
    expect(asked).toBe(false);
  });
});
