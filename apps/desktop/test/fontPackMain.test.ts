// main/fontPack.ts: import only files whose name and SHA-256 match the catalog, serve only catalog names at their
// listed size, remove one family.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FontPackStore, handleFontPackRequest } from "../src/main/fontPack";
import type { FontCatalogEntry } from "../src/shared/fontCatalog";

const bytes = (text: string) => Buffer.from(text.repeat(64));
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const A400 = bytes("a400"), A700 = bytes("a700"), B400 = bytes("b400");
const CATALOG: FontCatalogEntry[] = [
  { id: "fam-a", family: "Fam A", script: "cjk", delivery: "pack", faces: [
    { weight: "400", style: "normal", file: "fam-a-400.woff2", bytes: A400.length, sha256: sha(A400) },
    { weight: "700", style: "normal", file: "fam-a-700.woff2", bytes: A700.length, sha256: sha(A700) },
  ] },
  { id: "fam-b", family: "Fam B", script: "cjk", delivery: "pack", faces: [{ weight: "400", style: "normal", file: "fam-b-400.ttf", bytes: B400.length, sha256: sha(B400) }] },
];

const noNetwork = () => { throw new Error("no network in this test"); };
const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "font-pack-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("font pack store", () => {
  it("imports matching files from nested folders, refuses changed content, ignores other names", async () => {
    const root = join(temp(), "fonts"), src = temp();
    mkdirSync(join(src, "handoff", "fonts"), { recursive: true });
    writeFileSync(join(src, "handoff", "fonts", "fam-a-400.woff2"), A400);
    writeFileSync(join(src, "handoff", "fonts", "fam-a-700.woff2"), bytes("tampered"));
    writeFileSync(join(src, "handoff", "fonts", "other.woff2"), B400);
    writeFileSync(join(src, "fam-b-400.ttf"), B400);
    const store = new FontPackStore(root, CATALOG);
    const result = await store.importFrom(src);
    expect(result.imported).toEqual(["fam-a-400.woff2", "fam-b-400.ttf"]);
    expect(result.refused).toEqual(["fam-a-700.woff2"]);
    expect(result.state.families).toEqual([
      { id: "fam-a", installed: 1, total: 2, bytes: A400.length + A700.length },
      { id: "fam-b", installed: 1, total: 1, bytes: B400.length },
    ]);
    expect(readFileSync(join(root, "fam-a-400.woff2"))).toEqual(A400);
    expect(existsSync(join(root, "other.woff2"))).toBe(false);
    expect(existsSync(join(root, "fam-a-700.woff2.import"))).toBe(false);
  });

  it("does not follow a symlinked folder", async () => {
    const root = join(temp(), "fonts"), src = temp(), outside = temp();
    writeFileSync(join(outside, "fam-b-400.ttf"), B400);
    try {
      symlinkSync(outside, join(src, "link"), "junction");
    } catch {
      return; // no link rights here
    }
    expect((await new FontPackStore(root, CATALOG).importFrom(src)).imported).toEqual([]);
  });

  it("serves only catalog names at their listed size, with CORS for the app window", async () => {
    const root = join(temp(), "fonts"), src = temp();
    writeFileSync(join(src, "fam-b-400.ttf"), B400);
    const store = new FontPackStore(root, CATALOG);
    await store.importFrom(src);
    const ok = await store.respond(new Request("cutex-font://pack/fam-b-400.ttf"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("font/ttf");
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(B400);
    for (const url of ["cutex-font://pack/fam-a-400.woff2", "cutex-font://pack/..%2Ffonts%2Ffam-b-400.ttf", "cutex-font://other/fam-b-400.ttf", "cutex-font://pack/fam-b-400.ttf?x=1", "cutex-module://pack/fam-b-400.ttf"]) {
      expect((await store.respond(new Request(url))).status, url).toBe(404);
    }
    // A file changed after import (other size) is not served.
    writeFileSync(join(root, "fam-b-400.ttf"), Buffer.concat([B400, Buffer.from("x")]));
    expect((await store.respond(new Request("cutex-font://pack/fam-b-400.ttf"))).status).toBe(404);
  });

  it("removes one family and reports a cancelled import", async () => {
    const root = join(temp(), "fonts"), src = temp();
    writeFileSync(join(src, "fam-a-400.woff2"), A400);
    writeFileSync(join(src, "fam-b-400.ttf"), B400);
    const store = new FontPackStore(root, CATALOG);
    await store.importFrom(src);
    const state = await store.remove("fam-a");
    expect(state.families.map((f) => f.installed)).toEqual([0, 1]);
    expect(await handleFontPackRequest(store, { op: "import" }, async () => null, async () => {}, root, noNetwork)).toMatchObject({ canceled: true, imported: [] });
    let opened = "";
    await handleFontPackRequest(store, { op: "openFolder" }, async () => null, async (dir) => { opened = dir; }, root, noNetwork);
    expect(opened).toBe(root);
  });
});
