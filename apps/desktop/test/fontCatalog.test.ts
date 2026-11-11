// The fonts that come with the desktop (owner 2026-11-10): the generated catalog matches the bundled files and the
// license folder; the big CJK families are not bundled; the picker previews are tiny; the plan routes catalog fonts
// to their own files and loads only the regular face up front.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_LATIN_FONTS, catalogFont, FONT_CATALOG, PACK_FONTS, packFontUrl, parseFontPackRequest } from "../src/shared/fontCatalog";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { buildFontPlan, FontRoutingController, type RoutedFace } from "../src/renderer/src/lib/fontFaces";
import { catalogFaceSources } from "../src/renderer/src/lib/fontSources";

const ASSETS = join(__dirname, "../src/renderer/src/assets/fonts");
const LICENSES = join(__dirname, "../../../LICENSES/fonts");

describe("font catalog", () => {
  it("lists the eleven families: seven bundled Latin, four CJK in the pack", () => {
    expect(FONT_CATALOG).toHaveLength(11);
    expect(BUNDLED_LATIN_FONTS).toEqual(["Bitter", "Roboto Serif", "IBM Plex Serif", "Literata", "Alegreya", "Crimson Pro", "EB Garamond"]);
    expect(PACK_FONTS.map((e) => e.family)).toEqual(["Swei Spring Sugar SC", "Swei B2 Sugar SC", "Swei Spring SC", "Zhuque Fangsong"]);
    for (const entry of PACK_FONTS) {
      expect(entry.script).toBe("cjk");
      expect(entry.names?.zh).toBeTruthy();
      for (const face of entry.faces) {
        expect(face.sha256).toMatch(/^[0-9a-f]{64}$/);
        // Pinned upstream sources: a commit, or Zhuque's v0.212 release.
        expect(face.source?.url).toMatch(/^https:\/\/(raw\.githubusercontent\.com\/max32002\/[a-z0-9-]+\/[0-9a-f]{40}\/|github\.com\/TrionesType\/zhuque\/releases\/download\/v0\.212\/)/);
      }
    }
    expect(catalogFont("eb garamond")?.id).toBe("ebgaramond");
    expect(catalogFont("Inter")).toBeUndefined();
  });

  it("bundles exactly the Latin files as WOFF2 and no CJK font file", () => {
    const latin = readdirSync(join(ASSETS, "latin")).sort();
    const listed = FONT_CATALOG.filter((e) => e.delivery === "bundled").flatMap((e) => e.faces.map((f) => f.file)).sort();
    expect(latin).toEqual(listed);
    for (const entry of FONT_CATALOG.filter((e) => e.delivery === "bundled")) {
      for (const face of entry.faces) {
        expect(face.file).toMatch(/\.woff2$/);
        expect(statSync(join(ASSETS, "latin", face.file)).size).toBe(face.bytes);
      }
    }
    const total = readdirSync(join(ASSETS, "latin")).reduce((n, f) => n + statSync(join(ASSETS, "latin", f)).size, 0);
    expect(total).toBeLessThan(7 * 1024 * 1024);
  });

  it("bundles one small preview subset per pack family", () => {
    expect(readdirSync(join(ASSETS, "preview")).sort()).toEqual(PACK_FONTS.map((e) => e.preview!.file).sort());
    for (const entry of PACK_FONTS) expect(statSync(join(ASSETS, "preview", entry.preview!.file)).size).toBeLessThan(64 * 1024);
  });

  it("ships every family's OFL text, copyright notices and source", () => {
    for (const entry of FONT_CATALOG) {
      for (const file of ["OFL.txt", "COPYRIGHT-AND-NOTICES.txt", "SOURCE.txt"]) expect(existsSync(join(LICENSES, entry.id, file)), `${entry.id}/${file}`).toBe(true);
    }
  });

  it("accepts only the four pack ops with exact fields", () => {
    expect(parseFontPackRequest({ op: "state" })).toEqual({ op: "state" });
    expect(parseFontPackRequest({ op: "remove", id: "swei-spring" })).toEqual({ op: "remove", id: "swei-spring" });
    expect(parseFontPackRequest({ op: "remove", id: "bitter" })).toBeNull();
    expect(parseFontPackRequest({ op: "import", folder: "C:/" })).toBeNull();
    expect(parseFontPackRequest({ op: "read", file: "x" })).toBeNull();
    expect(parseFontPackRequest(null)).toBeNull();
  });
});

describe("catalog fonts in the font plan", () => {
  it("routes a bundled family to its own files and a pack family to main's cutex-font URLs, never local()", () => {
    const plan = buildFontPlan({ ...DEFAULT_APPEARANCE, uiFont: "IBM Plex Serif", cjkFont: "Swei Spring SC" }, 3);
    const plex = plan.faces.filter((f) => f.family === "IBM Plex Serif");
    expect(plex.length).toBeGreaterThan(0);
    for (const face of plex) expect(face.source).toMatch(/^url\(".*ibmplexserif-(normal|italic)-[0-9]+.*\.woff2"\) format\("woff2"\)$/);
    const swei = plan.faces.filter((f) => f.family === "Swei Spring SC");
    for (const face of swei) expect(face.source).toMatch(/^url\("cutex-font:\/\/pack\/swei-spring-normal-[457]00\.woff2"\) format\("woff2"\)$/);
    // Only the regular face is loaded up front; the other weights / styles wait until text uses them.
    expect(plex.filter((f) => !f.lazy).map((f) => [f.descriptors.weight, f.descriptors.style])).toEqual(plex.filter((f) => !f.lazy).map(() => ["400", "normal"]));
    expect(swei.filter((f) => !f.lazy).every((f) => f.descriptors.weight === "400")).toBe(true);
    expect(swei.filter((f) => f.lazy).length).toBe(swei.length * 2 / 3);
    // A variable family is one face per style with its weight range.
    const literata = buildFontPlan({ ...DEFAULT_APPEARANCE, uiFont: "Literata" }, 1).faces.filter((f) => f.family === "Literata");
    expect(new Set(literata.map((f) => f.descriptors.weight))).toEqual(new Set(["200 900"]));
  });

  it("serves a pack file by its catalog name only", () => {
    expect(packFontUrl("zhuque-fangsong-normal-400.ttf")).toBe("cutex-font://pack/zhuque-fangsong-normal-400.ttf");
    expect(catalogFaceSources("Zhuque Fangsong")).toEqual([{ weight: "400", style: "normal", source: 'url("cutex-font://pack/zhuque-fangsong-normal-400.ttf") format("truetype")' }]);
  });

  it("registers the other faces only after the regular one loaded, without loading them", async () => {
    const loads: string[] = [], added: RoutedFace[] = [];
    const harness = (failRegular: boolean) => new FontRoutingController<{ spec: RoutedFace; load(): Promise<unknown> }>({
      createFace: (spec) => ({ spec, load: () => (loads.push(`${spec.family} ${spec.descriptors.weight} ${spec.descriptors.style}`), failRegular && spec.family === "Swei Spring SC" ? Promise.reject(new Error("404")) : Promise.resolve()) }),
      add: (face) => { added.push(face.spec); },
      remove: () => {},
      publish: () => {},
    });
    await harness(false).update({ ...DEFAULT_APPEARANCE, cjkFont: "Swei Spring SC" });
    expect(loads.filter((l) => l.startsWith("Swei"))).toEqual(loads.filter((l) => l.startsWith("Swei")).map(() => "Swei Spring SC 400 normal"));
    expect(added.filter((s) => s.family === "Swei Spring SC").map((s) => s.descriptors.weight).sort()).toEqual(expect.arrayContaining(["400", "500", "700"]));
    loads.length = 0; added.length = 0;
    // Not imported (main answers 404): no face of that family is registered, the fallback status names it.
    const controller = harness(true);
    await controller.update({ ...DEFAULT_APPEARANCE, cjkFont: "Swei Spring SC" });
    expect(added.some((s) => s.family === "Swei Spring SC")).toBe(false);
    expect(controller.getStatus().failedFamilies).toEqual(["Swei Spring SC"]);
  });

  it("plans again with the same choices on reload (a pack family was imported)", async () => {
    let creates = 0;
    const controller = new FontRoutingController<{ load(): Promise<unknown> }>({ createFace: () => (creates++, { load: () => Promise.resolve() }), add: () => {}, remove: () => {}, publish: () => {} });
    const a = { ...DEFAULT_APPEARANCE, cjkFont: "Swei Spring SC" };
    await controller.update(a);
    const first = creates;
    await controller.update(a);
    expect(creates).toBe(first);
    await controller.reload(a);
    expect(creates).toBe(first * 2);
  });
});
