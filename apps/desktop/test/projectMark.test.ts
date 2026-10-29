import { describe, expect, it, vi } from "vitest";
import { MARK_GLASS_TINT, MARK_TEXT_CHROMA_MAX, MARK_TEXT_L_DARK, MARK_TEXT_L_LIGHT, markTextColor, baseMark, distinctMarks, nameMark, projectMarkCrowded, projectMarkFont, projectMarkHeight, projectMarkText, PROJECT_MARK_MIN_AVATAR } from "../src/renderer/src/lib/projectMark";

vi.mock("../src/renderer/src/store", () => ({ useApp: () => null, pinnedOn: () => new Set() }));
const { agentIndex } = await import("../src/renderer/src/lib/agentLook");

describe("project mark text", () => {
  it("the chosen text / emoji icon wins, else the project's own distinct mark", () => {
    expect(projectMarkText({ kind: "text", value: "桌" }, "CD")).toBe("桌");
    expect(projectMarkText({ kind: "emoji", value: "🚀" }, "CD")).toBe("🚀");
    expect(projectMarkText({ kind: "icon", value: "folder" }, "CD")).toBe("CD");
    expect(projectMarkText(null, "CDX")).toBe("CDX");
  });
  it("keeps up to four columns whole: a hanzi counts two, a ZWJ emoji is never split", () => {
    expect(projectMarkText(null, "CT副")).toBe("CT副");
    expect(projectMarkText(null, "副总")).toBe("副总");
    expect(projectMarkText(null, "副总裁")).toBe("副总");
    expect(projectMarkText(null, "ABCDE")).toBe("ABCD");
    expect(projectMarkText({ kind: "emoji", value: "👩‍💻" }, "CD")).toBe("👩‍💻");
    expect(baseMark("kks", "CT副")).toBe("CT副");
  });
  it("text with a hanzi: the UI font, two px under the box; Latin stays small", () => {
    expect(projectMarkFont(12, "CT")).toEqual({ size: 8.5, sans: false });
    expect(projectMarkFont(12, "CT副")).toEqual({ size: 10, sans: true });
    expect(projectMarkFont(14, "副总")).toEqual({ size: 12, sans: true });
    expect(projectMarkFont(12, "CT副", true)).toEqual({ size: 9.5, sans: true });
    expect(projectMarkFont(12, "ABCD", true)).toEqual({ size: 8.5, sans: true });
  });
  it("crowded: more than two columns on an avatar under 36 px with a presence dot", () => {
    expect(projectMarkCrowded(28, "CT副", true)).toBe(true);
    expect(projectMarkCrowded(32, "ABCD", true)).toBe(true);
    expect(projectMarkCrowded(32, "AB", true)).toBe(false);
    expect(projectMarkCrowded(28, "副总", false)).toBe(false);
    expect(projectMarkCrowded(40, "CT副", true)).toBe(false);
  });
  it("initials from word boundaries", () => {
    expect(nameMark("cutex-desktop")).toBe("CD");
    expect(nameMark("cutex-E")).toBe("CE");
    expect(nameMark("sc-polya-v2")).toBe("SP");
    expect(nameMark("ifm_ema")).toBe("IE");
    expect(nameMark("cutexDesktop")).toBe("CD");
    expect(nameMark("cutex")).toBe("CU");
    expect(nameMark("x")).toBe("X");
    expect(nameMark("桌面项目")).toBe("桌");
    expect(nameMark("  ")).toBe("");
  });
  it("a deliberate badge label wins; the auto-filled one (name's first two letters) does not", () => {
    expect(baseMark("cutex-desktop", "CU")).toBe("CD");
    expect(baseMark("cutex-desktop", "桌")).toBe("桌");
    expect(baseMark("cutex-desktop", "")).toBe("CD");
    expect(baseMark("ifm-ema", "IE")).toBe("IE");
  });
  it("two projects never share a mark", () => {
    const m = distinctMarks([
      { key: "h/a", name: "cutex-desktop", badge: "CU" },
      { key: "h/b", name: "cutex-docs", badge: "CU" },
      { key: "h/c", name: "cutex-design", badge: "" },
    ]);
    expect(m.get("h/a")).toBe("CD");
    expect(new Set(m.values()).size).toBe(3);
    expect(m.get("h/b")).toBe("CO");
    expect(m.get("h/c")).toBe("CE");
  });
  it("sizes: none under 24 px, 14 / 16 / 18 above", () => {
    expect(PROJECT_MARK_MIN_AVATAR).toBe(24);
    expect([24, 32, 44].map(projectMarkHeight)).toEqual([12, 13, 14]);
  });
});

describe("a Director's project in the agent index", () => {
  const session = (id: string) => ({ cutexSessionId: id, displayName: id }) as never;
  const project = (id: string, director: string | null) => ({ project_id: id, director_cutex_session_id: director, presentation: { display_name: id, badge_label: id.slice(0, 2).toUpperCase(), color: "blue" } }) as never;
  const index = (projects: unknown[]) =>
    agentIndex({ sidebar: { active: [session("d1"), session("m1")], retired: [], hostRows: {}, projects: { projects } } as never, byHost: {}, pinned: new Set(), hosts: { active: "local" } });
  it("one project: the mark's source; a member: none", () => {
    const i = index([project("desk", "d1")]);
    expect(i.get("d1")!.project).toMatchObject({ id: "desk", badge: "DE", hostId: "local", mark: "DE" });
    expect(i.get("m1")!.project).toBeNull();
  });
  it("a Director of several projects: no mark", () => {
    const i = index([project("a", "d1"), project("b", "d1")]);
    expect(i.get("d1")!.isDirector).toBe(true);
    expect(i.get("d1")!.project).toBeNull();
  });
});

describe("the glass mark's text stays readable (WCAG ≥ 4.5, both themes)", () => {
  const PALETTE = ["#22b8cf", "#4c8dff", "#40c057", "#d6336c", "#fab005", "#fa5252", "#868e96"];
  // Custom hex colours too: the extremes and a hue sweep.
  const SWEEP = ["#ffffff", "#000000", "#ffff00", "#00ff00", "#ff00ff", "#00ffff", "#0000ff", "#ff0000", ...Array.from({ length: 12 }, (_, i) => `hsl(${i * 30} 80% 55%)`).map(hsl)];
  function hsl(css: string): string {
    const [h, s, l] = css.match(/[\d.]+/g)!.map(Number) as [number, number, number];
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => Math.round(255 * (l / 100 - a * Math.max(-1, Math.min((n + h / 30) % 12 - 3, 9 - ((n + h / 30) % 12), 1))));
    return "#" + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  const hx = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a: number[], b: number[], pa: number) => a.map((v, i) => v * pa + b[i]! * (1 - pa));
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const gam = (v: number) => {
    v = Math.max(0, Math.min(1, v));
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  };
  function chromaHue(c: number[]): [number, number] {
    const [r, g, b] = c.map(lin) as [number, number, number];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [Math.hypot(A, B), Math.atan2(B, A)];
  }
  function fromOklch(L: number, C: number, h: number): number[] {
    const A = C * Math.cos(h);
    const B = C * Math.sin(h);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(gam);
  }
  const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
  const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  // surface → the glass tray (46% of --bg) → the mark's glass (white ~14% + the project tint).
  const themes = {
    light: { surface: "#f0f1f4", bg: "#ffffff", L: MARK_TEXT_L_LIGHT },
    dark: { surface: "#26272b", bg: "#161616", L: MARK_TEXT_L_DARK },
  };
  for (const [name, t] of Object.entries(themes)) {
    it(name, () => {
      for (const hex of [...PALETTE, ...SWEEP]) {
        const c = hx(hex);
        let bg = mix(hx(t.bg), hx(t.surface), 0.46);
        bg = mix([255, 255, 255], bg, 0.14);
        bg = mix(c, bg, MARK_GLASS_TINT);
        const [C, h] = chromaHue(c);
        expect(ratio(fromOklch(t.L, Math.min(C, MARK_TEXT_CHROMA_MAX), h), bg), `${name} ${hex}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("the CSS the chip uses names both lightnesses and the chroma cap", () => {
    expect(markTextColor("#fab005")).toBe("light-dark(oklch(from #fab005 0.45 min(c, 0.13) h), oklch(from #fab005 0.9 min(c, 0.13) h))");
  });
});
