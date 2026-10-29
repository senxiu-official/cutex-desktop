import { expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { buildFontPlan, FontRoutingController, type FontVariables, type RoutedFace } from "../src/renderer/src/lib/fontFaces";

// Evaluate each routed face's declared coverage, independent of any font installed on the test host.
function covers(face: RoutedFace, text: string): boolean {
  const ranges = face.descriptors.unicodeRange.split(",").map((range) => {
    const [lo, hi] = range.slice(2).split("-").map((n) => parseInt(n, 16));
    return [lo!, hi ?? lo!] as const;
  });
  return [...text].some((character) => ranges.some(([lo, hi]) => character.codePointAt(0)! >= lo && character.codePointAt(0)! <= hi));
}

it("does not let a selected CJK serif supply Latin text in either UI context", () => {
  const plan = buildFontPlan({ ...DEFAULT_APPEARANCE, cjkFont: "KingHwa_OldSong", chatCjkFont: "SimSun" }, 1);
  const selectedCjk = plan.faces.filter((face) => face.family === "KingHwa_OldSong" || face.family === "SimSun");
  expect(selectedCjk.length).toBeGreaterThan(0);
  expect(selectedCjk.every((face) => !covers(face, "Project Maidling 0123456789"))).toBe(true);
  expect(selectedCjk.every((face) => covers(face, "项目视图"))).toBe(true);
});

it("retains a sans fallback when every local face fails to load", async () => {
  let published: FontVariables | null = null;
  let registered = 0;
  const controller = new FontRoutingController({
    createFace: (_spec: RoutedFace) => ({ load: async () => { throw Error("not installed"); } }),
    add: () => { registered++; }, remove: () => {}, publish: (variables) => { published = variables; },
  });
  await controller.update({ ...DEFAULT_APPEARANCE, uiFont: "Missing UI font", cjkFont: "Missing CJK font" });
  expect(registered).toBe(0);
  for (const name of ["--font-sans", "--font-sans-latin", "--font-sans-cjk", "--font-chat"] as const) {
    expect(published![name]).toMatch(/, system-ui, sans-serif$/);
    expect(published![name]).not.toMatch(/(?:^|, )serif(?:,|$)/);
  }
  expect(published!["--font-mono"]).toMatch(/, monospace$/);
  expect(controller.getStatus().failedFamilies).toEqual(["Missing UI font", "Missing CJK font"]);
});

it("preserves an explicit Latin serif choice without leaking it into the CJK route", () => {
  const appearance = { ...DEFAULT_APPEARANCE, uiFont: "Georgia", chatFont: "Source Serif 4", cjkFont: "Microsoft YaHei" };
  const before = { ...appearance };
  const plan = buildFontPlan(appearance, 2);
  const first = (stack: string) => /^"([^"]+)"/.exec(stack)![1];
  expect(plan.faces.find((face) => face.alias === first(plan.variables["--font-sans"]))!.family).toBe("Georgia");
  expect(plan.faces.find((face) => face.alias === first(plan.variables["--font-chat"]))!.family).toBe("Source Serif 4");
  expect(plan.faces.filter((face) => face.family === "Georgia").every((face) => !covers(face, "项目"))).toBe(true);
  expect(appearance).toEqual(before);
});
