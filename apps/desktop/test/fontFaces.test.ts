import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { buildFontPlan, cssString, FontRoutingController, localStyles, type FontStatus, type FontVariables, type RoutedFace } from "../src/renderer/src/lib/fontFaces";
import { FONT_UNICODE_RANGES } from "../src/renderer/src/lib/fontRanges";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

class FakeFace {
  constructor(readonly spec: RoutedFace, private readonly loading: Promise<void>) {}
  async load(): Promise<this> { await this.loading; return this; }
}

function harness(load: (spec: RoutedFace) => Promise<void> = () => Promise.resolve(), timeoutMs = 4000) {
  const created: FakeFace[] = [], registered = new Set<FakeFace>(), events: string[] = [], publications: FontVariables[] = [], statuses: FontStatus[] = [];
  const controller = new FontRoutingController({
    createFace(spec: RoutedFace) { const face = new FakeFace(spec, load(spec)); created.push(face); return face; },
    add(face: FakeFace) { events.push("add"); registered.add(face); },
    remove(face: FakeFace) { events.push("remove"); registered.delete(face); },
    beforePublish() { events.push("before"); },
    publish(variables: FontVariables) { events.push("publish"); publications.push(variables); },
    afterPublish() { events.push("after"); },
    statusChanged(status: FontStatus) { statuses.push(status); },
  }, timeoutMs);
  return { controller, created, registered, events, publications, statuses };
}

describe("font plans", () => {
  it("restricts every selected and fallback source, with empty mono Latin first", () => {
    const plan = buildFontPlan({ ...DEFAULT_APPEARANCE, uiFont: "Broad Latin", cjkFont: "KingHwa_OldSong", chatFont: "Chat Latin", chatCjkFont: "Chat CJK" }, 7);
    for (const stack of Object.values(plan.variables)) {
      expect(stack).not.toContain("KingHwa");
      expect(stack).not.toContain("Broad Latin");
      expect(stack).toMatch(/^"cutex-font-7-\d+", /);
    }
    const monoFirst = /^"([^"]+)"/.exec(plan.variables["--font-mono"])![1];
    const monoFace = plan.faces.find((face) => face.alias === monoFirst)!;
    expect(monoFace.family).toBe("JetBrains Mono");
    expect(monoFace.descriptors.unicodeRange).toBe(FONT_UNICODE_RANGES.latinContext.latin);
    for (const face of plan.faces) {
      expect(face.source).toMatch(/^local\(/);
      expect(face.source).not.toContain("url(");
      expect(face.descriptors.unicodeRange).toMatch(/^U\+/);
      if (face.family === "KingHwa_OldSong" || face.family === "Chat CJK") {
        expect([FONT_UNICODE_RANGES.latinContext.cjk, FONT_UNICODE_RANGES.cjkContext.cjk]).toContain(face.descriptors.unicodeRange);
      }
    }
  });

  it("shares inherited chat aliases and escapes local font names as a single string", () => {
    const plan = buildFontPlan({ ...DEFAULT_APPEARANCE, uiFont: 'evil"), url(https://invalid/);\\\nfont' }, 1);
    expect(plan.variables["--font-chat"]).toBe(plan.variables["--font-sans"]);
    expect(plan.variables["--font-chat-cjk"]).toBe(plan.variables["--font-sans-cjk"]);
    expect(plan.faces[0]!.source.startsWith('local("evil\\22 ), url(https://invalid/);\\5c \\a font"), ')).toBe(true);
    // Every candidate name (full / PostScript spellings) is one escaped CSS string.
    expect(plan.faces[0]!.source.split(", local(").every((part) => /^(?:local\()?".*"\)$/s.test(part))).toBe(true);
    expect(plan.faces[0]!.source).not.toMatch(/(^|[^\\])"\)?,\s*url\(/);
    expect(cssString("a\u0000b")).toBe('"a\\0 b"');
  });

  it("uses actual bold/italic face names and does not invent custom variable axes", () => {
    expect(localStyles("Consolas").find((s) => s.weight === "700" && s.style === "normal")!.names).toContain("Consolas Bold");
    expect(localStyles("Consolas").filter((s) => s.weight === "700").flatMap((s) => s.names)).not.toContain("Consolas");
    expect(localStyles("My Variable Font")).toEqual([
      { weight: "400", style: "normal", names: ["My Variable Font", "My Variable Font Regular", "MyVariableFont-Regular", "MyVariableFont"] },
      { weight: "700", style: "normal", names: ["My Variable Font Bold", "MyVariableFont-Bold"] },
      { weight: "400", style: "italic", names: ["My Variable Font Italic", "MyVariableFont-Italic"] },
      { weight: "700", style: "italic", names: ["My Variable Font Bold Italic", "MyVariableFont-BoldItalic"] },
    ]);
    // Known families keep their exact lists (YaHei has no italic face: synthesized).
    expect(localStyles("Microsoft YaHei").map((s) => `${s.weight} ${s.style}`)).toEqual(["400 normal", "700 normal"]);
    // A regular face is never registered as another weight or style.
    for (const s of localStyles("My Variable Font").slice(1)) expect(s.names).not.toContain("My Variable Font");
  });

  it("finds regular faces whose full / PostScript name is not the bare family (local() never matches a family)", () => {
    // fontconfig on Linux: fullname "JetBrains Mono Regular" / "Noto Sans Regular"; DirectWrite: "Dubai Regular".
    for (const [family, name] of [["JetBrains Mono", "JetBrains Mono Regular"], ["Noto Sans", "NotoSans-Regular"], ["Liberation Sans", "LiberationSans"], ["Dubai", "Dubai Regular"]] as const) {
      expect(localStyles(family)[0]!.names).toContain(name);
    }
    expect(buildFontPlan(DEFAULT_APPEARANCE, 1).faces.find((face) => face.family === "JetBrains Mono" && face.descriptors.weight === "400" && face.descriptors.style === "normal")!.source).toContain('local("JetBrains Mono Regular")');
  });
});

describe("font generation lifecycle", () => {
  it("publishes only after loading, and cannot let a slow old selection overwrite a new one", async () => {
    const slow = deferred();
    const h = harness((spec) => spec.family === "Slow" ? slow.promise : Promise.resolve());
    const old = h.controller.update({ ...DEFAULT_APPEARANCE, uiFont: "Slow" });
    expect(h.controller.getStatus().phase).toBe("loading");
    expect(h.registered.size).toBe(0);
    await h.controller.update({ ...DEFAULT_APPEARANCE, uiFont: "Fast" });
    expect(h.publications).toHaveLength(1);
    expect(h.publications[0]!["--font-sans"]).toContain("cutex-font-2-");
    slow.resolve();
    await old;
    expect(h.publications).toHaveLength(1);
    expect([...h.registered].every((face) => face.spec.alias.startsWith("cutex-font-2-"))).toBe(true);
    expect(h.statuses.map((s) => `${s.phase}:${s.generation}`)).toEqual(["loading:1", "loading:2", "ready:2"]);
    expect(h.events[0]).toBe("before");
    expect(h.events.at(-2)).toBe("publish");
    expect(h.events.at(-1)).toBe("after");
  });

  it("keeps the active generation during loading, cleans old faces after publication, and ignores size-only changes", async () => {
    const slow = deferred();
    const h = harness((spec) => spec.family === "Slow" ? slow.promise : Promise.resolve());
    await h.controller.update(DEFAULT_APPEARANCE);
    const initialFaces = [...h.registered];
    const initialCount = h.created.length;
    await h.controller.update({ ...DEFAULT_APPEARANCE, monoFontSize: 20 });
    expect(h.created).toHaveLength(initialCount);
    const pending = h.controller.update({ ...DEFAULT_APPEARANCE, cjkFont: "Slow" });
    expect([...h.registered]).toEqual(initialFaces);
    slow.resolve(); await pending;
    expect(initialFaces.every((face) => !h.registered.has(face))).toBe(true);
    expect(h.events.indexOf("remove")).toBeGreaterThan(h.events.lastIndexOf("after"));
    h.controller.dispose();
    expect(h.registered.size).toBe(0);
  });

  it("reports missing selected families, preserves restricted fallback, and permits synthetic styles", async () => {
    const h = harness((spec) => spec.family === "Missing" || spec.descriptors.weight === "700" ? Promise.reject(new Error("missing")) : Promise.resolve());
    await h.controller.update({ ...DEFAULT_APPEARANCE, uiFont: "Missing", monoFont: "Consolas" });
    expect(h.controller.getStatus()).toEqual({ phase: "ready", generation: 1, failedFamilies: ["Missing"] });
    expect(h.publications).toHaveLength(1);
    expect([...h.registered].some((face) => face.spec.family === "Consolas")).toBe(true);
    expect([...h.registered].every((face) => Boolean(face.spec.descriptors.unicodeRange))).toBe(true);
    expect(h.publications[0]!["--font-sans"]).not.toContain("Missing");
  });

  it("bounds an unresolved local load and never registers a late timed-out face", async () => {
    vi.useFakeTimers();
    try {
      const stuck = deferred();
      const h = harness((spec) => spec.family === "Stuck" ? stuck.promise : Promise.resolve(), 100);
      const pending = h.controller.update({ ...DEFAULT_APPEARANCE, uiFont: "Stuck" });
      await vi.advanceTimersByTimeAsync(100);
      await pending;
      expect(h.controller.getStatus().failedFamilies).toEqual(["Stuck"]);
      stuck.resolve();
      await Promise.resolve();
      expect([...h.registered].some((face) => face.spec.family === "Stuck")).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
