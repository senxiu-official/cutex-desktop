// @vitest-environment jsdom
// The Director's headwear (owner 2026-10-24, lib/directorHeadwear): a project Director's avatar wears the picked style
// (Settings → 外观 → 主管头饰, default 女仆头饰) at 28 px and more, in the owner's fit (width 1.12 d, height 0.70 d,
// centred, top 0.14 d above the avatar); 不显示 turns it off; other agents, small avatars, minor dots and cut-out
// portraits wear nothing. 王冠 and 冕冠 (2026-10-25): narrower and higher / wide and flat, each box in its picture's
// aspect ratio, neither reaching far into the face. More styles, the Operator's companion (副主管也戴) and festival
// headwear (节日头饰, by the local date: Dec 20–26, Lunar New Year's eve – 15th day) on 2026-10-25.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/directorAvatars", () => ({ useDirectorAvatarUrl: () => null }));
vi.mock("../src/renderer/src/lib/avatarStylePreview", () => ({ useStyleAssignmentPreview: () => null }));
const look = { color: "#3366cc", themes: ["all"], family: "claude", isDirector: true, isOperator: false, pinned: false, project: null };
let minorDot = false;
vi.mock("../src/renderer/src/lib/agentLook", () => ({ useAgentLook: (seed: string | null | undefined) => (seed ? look : null), useMinorDot: () => minorDot, useProjectPortraitsWorn: () => new Set(), useProjectStyleWorn: () => new Set() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { Avatar } from "../src/renderer/src/components/Avatar";
import { getUiPrefs, setUiPref } from "../src/renderer/src/lib/prefs";
import { DIRECTOR_HEADWEARS, HEADWEAR_MIN_AVATAR, LUNAR_NEW_YEAR, OPERATOR_COMPANION, headwearBox, headwearFor, headwearSources, migrateDirectorHeadwear, msToLocalMidnight, seasonalHeadwear, type HeadwearPicture, type HeadwearStyle } from "../src/renderer/src/lib/directorHeadwear";

const DIRECTOR = { isDirector: true }, OPERATOR = { isDirector: false, isOperator: true }, MEMBER = { isDirector: false };
const ALL_PICTURES: HeadwearPicture[] = [...(DIRECTOR_HEADWEARS.filter((v) => v !== "none") as HeadwearStyle[]), "operator-maid", "operator-tiara", "operator-hairpin", "christmas", "lunar-new-year"];

/** A PNG's width / height (IHDR). */
function pngAspect(style: string, width: number): number {
  const bytes = readFileSync(join(__dirname, "../src/renderer/src/assets/headwear", `${style}-${width}.png`));
  return bytes.readUInt32BE(16) / bytes.readUInt32BE(20);
}

describe("directorHeadwear (pure)", () => {
  it("maid (default) … headphones, none; stored values are kept, unknown ones fall back to the default", () => {
    expect(DIRECTOR_HEADWEARS).toEqual(["maid", "crown", "mianguan", "detective", "graduation", "chef", "wizard", "halo", "cat-ears", "headphones", "none"]);
    expect(getUiPrefs().directorHeadwear).toBe("maid");
    for (const v of DIRECTOR_HEADWEARS) expect(migrateDirectorHeadwear(v)).toBe(v);
    expect(migrateDirectorHeadwear("tiara")).toBe("maid");
    expect(migrateDirectorHeadwear(undefined)).toBe("maid");
    expect(migrateDirectorHeadwear(null)).toBe("maid");
  });

  it("Director only, the setting honoured, nothing under 28 px", () => {
    expect(HEADWEAR_MIN_AVATAR).toBe(28);
    expect(headwearFor("maid", DIRECTOR, 32)).toBe("maid");
    expect(headwearFor("maid", DIRECTOR, 28)).toBe("maid");
    expect(headwearFor("maid", DIRECTOR, 27)).toBeNull();
    expect(headwearFor("maid", MEMBER, 64)).toBeNull();
    expect(headwearFor("none", DIRECTOR, 64)).toBeNull();
  });

  it("the owner's fit: 1.12 d × 0.70 d, centred, top −0.14 d", () => {
    const b = headwearBox("maid", 100);
    expect(b.width).toBeCloseTo(112);
    expect(b.height).toBeCloseTo(70);
    expect(b.left).toBeCloseTo(-6);
    expect(b.top).toBeCloseTo(-14);
    const { src, srcSet } = headwearSources("maid");
    expect(src).toBeTruthy();
    expect(srcSet.split(", ").map((s) => s.split(" ")[1])).toEqual(["64w", "128w", "512w"]);
  });

  it("every picture: a box in its PNG's aspect ratio, centred, 64 / 128 / 512 sources", () => {
    for (const style of ALL_PICTURES) {
      const b = headwearBox(style, 100);
      for (const w of [64, 128, 512]) expect(b.width / b.height).toBeCloseTo(pngAspect(style, w), 0);
      expect(Math.abs(b.width / b.height - pngAspect(style, 512)) / pngAspect(style, 512)).toBeLessThan(0.02);
      expect(headwearSources(style).srcSet.split(", ").map((s) => s.split(" ")[1])).toEqual(["64w", "128w", "512w"]);
      // Centred.
      expect(b.left + b.width / 2).toBeCloseTo(50);
    }
  });

  it("placements: the halo floats above the head, the headphones' cups beside the face, the hats on top; companions are smaller", () => {
    const at = (p: HeadwearPicture) => headwearBox(p, 100);
    // The halo's lower edge 0.10 d above the avatar.
    expect(at("halo").top + at("halo").height).toBeCloseTo(-10);
    // The headphones: wider than the avatar, from just above it to below its middle (the cups at the sides).
    expect(at("headphones").width).toBeGreaterThan(100);
    expect(at("headphones").top).toBeLessThan(0);
    expect(at("headphones").top + at("headphones").height).toBeGreaterThan(60);
    // Hats and ears sit on the head: their lower edge at most 0.18 d into the avatar.
    for (const p of ["detective", "graduation", "chef", "wizard", "cat-ears", "christmas", "lunar-new-year"] as HeadwearPicture[]) {
      expect(at(p).top).toBeLessThan(0);
      expect(at(p).top + at(p).height).toBeLessThanOrEqual(18.5);
    }
    // Companions: about two thirds of a Director's width, on the head's top.
    for (const p of ["operator-maid", "operator-tiara", "operator-hairpin"] as HeadwearPicture[]) {
      expect(at(p).width).toBeLessThan(at("crown").width);
      expect(at(p).top + at(p).height).toBeLessThanOrEqual(10.5);
    }
  });

  it("the crown sits higher and narrower than the maid one; the 冕冠 is wider and flat; neither covers the face", () => {
    const maid = headwearBox("maid", 100), crown = headwearBox("crown", 100), mian = headwearBox("mianguan", 100);
    expect(crown.width).toBeLessThan(maid.width);
    expect(crown.top).toBeLessThan(maid.top);
    expect(mian.width).toBeGreaterThan(maid.width);
    expect(mian.height).toBeLessThan(maid.height / 1.5);
    // How far each reaches into the avatar (its bottom below the avatar's top), in diameters: the maid's 0.56 frames
    // the face from above; the crown and the 冕冠's middle beads stop at the hairline.
    expect((crown.top + crown.height) / 100).toBeLessThanOrEqual(0.11);
    expect((mian.top + mian.height) / 100).toBeLessThanOrEqual(0.14);
    // At 28 px: a few pixels at most.
    for (const style of ["crown", "mianguan"] as HeadwearStyle[]) {
      const b = headwearBox(style, 28);
      expect(b.top + b.height).toBeLessThanOrEqual(4);
    }
  });
});

describe("the Operator's companion (副主管也戴)", () => {
  it("maid → operator-maid, crown → operator-tiara, 冕冠 → operator-hairpin; other styles: nothing", () => {
    expect(OPERATOR_COMPANION).toEqual({ maid: "operator-maid", crown: "operator-tiara", mianguan: "operator-hairpin" });
    expect(headwearFor("maid", OPERATOR, 32)).toBe("operator-maid");
    expect(headwearFor("crown", OPERATOR, 32)).toBe("operator-tiara");
    for (const style of ["detective", "halo", "headphones"] as const) expect(headwearFor(style, OPERATOR, 64)).toBeNull();
  });

  it("the hairpin only from 40 px; switched off: nothing; 不显示: nothing; a Director who is also an Operator wears the Director's", () => {
    expect(headwearFor("mianguan", OPERATOR, 39)).toBeNull();
    expect(headwearFor("mianguan", OPERATOR, 40)).toBe("operator-hairpin");
    expect(headwearFor("maid", OPERATOR, 64, { operators: false })).toBeNull();
    expect(headwearFor("none", OPERATOR, 64)).toBeNull();
    expect(headwearFor("maid", { isDirector: true, isOperator: true }, 64)).toBe("maid");
    expect(headwearFor("maid", OPERATOR, 27)).toBeNull();
  });
});

describe("festival headwear (节日头饰)", () => {
  const on = (y: number, m: number, d: number, h = 12) => seasonalHeadwear(new Date(y, m - 1, d, h));
  it("Christmas: Dec 20 00:00 – Dec 26 23:59 local", () => {
    expect(on(2026, 12, 19, 23)).toBeNull();
    expect(on(2026, 12, 20, 0)).toBe("christmas");
    expect(on(2026, 12, 26, 23)).toBe("christmas");
    expect(on(2026, 12, 27, 0)).toBeNull();
    expect(on(2040, 12, 24)).toBe("christmas");
  });

  it("Lunar New Year: the eve through the 15th day, every year of the table (2026–2035)", () => {
    expect(Object.keys(LUNAR_NEW_YEAR).map(Number)).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035]);
    for (const [year, [m, d]] of Object.entries(LUNAR_NEW_YEAR)) {
      const y = Number(year);
      const day = (offset: number, h = 12) => seasonalHeadwear(new Date(y, m - 1, d + offset, h));
      expect(day(-2, 23)).toBeNull();
      expect(day(-1, 0)).toBe("lunar-new-year");
      expect(day(0)).toBe("lunar-new-year");
      expect(day(14, 23)).toBe("lunar-new-year");
      expect(day(15, 0)).toBeNull();
    }
    // 2026: 除夕 Feb 16, 正月十五 Mar 3; 2028's window starts in January.
    expect(on(2026, 2, 16)).toBe("lunar-new-year");
    expect(on(2026, 3, 3)).toBe("lunar-new-year");
    expect(on(2026, 3, 4)).toBeNull();
    expect(on(2028, 1, 25)).toBe("lunar-new-year");
    // Outside the table: nothing (no guess).
    expect(on(2036, 1, 28)).toBeNull();
    expect(on(2025, 1, 29)).toBeNull();
  });

  it("goes by the local calendar date, not UTC", () => {
    // A moment that is Dec 20 locally but still Dec 19 in UTC (e.g. Sydney's morning).
    const sydney = { getFullYear: () => 2026, getMonth: () => 11, getDate: () => 20, getUTCFullYear: () => 2026, getUTCMonth: () => 11, getUTCDate: () => 19 } as unknown as Date;
    expect(seasonalHeadwear(sydney)).toBe("christmas");
    const behind = { getFullYear: () => 2026, getMonth: () => 11, getDate: () => 19, getUTCFullYear: () => 2026, getUTCMonth: () => 11, getUTCDate: () => 20 } as unknown as Date;
    expect(seasonalHeadwear(behind)).toBeNull();
    // The refresh lands at the next local midnight.
    expect(msToLocalMidnight(new Date(2026, 11, 19, 23, 59, 0))).toBe(60_000);
  });

  it("the Director only, over the chosen style; Operators keep their companion; 不显示 wins", () => {
    expect(headwearFor("crown", DIRECTOR, 32, { seasonal: "christmas" })).toBe("christmas");
    expect(headwearFor("crown", OPERATOR, 32, { seasonal: "christmas" })).toBe("operator-tiara");
    expect(headwearFor("none", DIRECTOR, 32, { seasonal: "lunar-new-year" })).toBeNull();
    expect(headwearFor("crown", DIRECTOR, 32, { seasonal: null })).toBe("crown");
  });
});

describe("settings migration", () => {
  it("副主管也戴 and 节日头饰 default on; a stored off stays off; anything else reads on; the style survives", async () => {
    expect(getUiPrefs().operatorHeadwear).toBe(true);
    expect(getUiPrefs().seasonalHeadwear).toBe(true);
    const read = async (stored: Record<string, unknown>) => {
      localStorage.setItem("cutex-desktop.ui", JSON.stringify(stored));
      vi.resetModules();
      const prefs = await import("../src/renderer/src/lib/prefs");
      return prefs.getUiPrefs();
    };
    try {
      const off = await read({ directorHeadwear: "wizard", operatorHeadwear: false, seasonalHeadwear: false });
      expect([off.directorHeadwear, off.operatorHeadwear, off.seasonalHeadwear]).toEqual(["wizard", false, false]);
      const odd = await read({ directorHeadwear: "crown", operatorHeadwear: "no", seasonalHeadwear: 0 });
      expect([odd.directorHeadwear, odd.operatorHeadwear, odd.seasonalHeadwear]).toEqual(["crown", true, true]);
      const old = await read({ directorHeadwear: "mianguan" });
      expect([old.directorHeadwear, old.operatorHeadwear, old.seasonalHeadwear]).toEqual(["mianguan", true, true]);
    } finally {
      localStorage.removeItem("cutex-desktop.ui");
      vi.resetModules();
    }
  });
});

describe("Avatar wears it", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    minorDot = false;
    look.isDirector = true;
    look.isOperator = false;
    act(() => setUiPref("seasonalHeadwear", false));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    act(() => setUiPref("directorHeadwear", "maid"));
    act(() => setUiPref("operatorHeadwear", true));
    act(() => setUiPref("seasonalHeadwear", true));
    vi.useRealTimers();
  });
  const draw = (props: Record<string, unknown>) => act(() => root.render(h(Avatar, { name: "Eva", seed: "s1", size: 32, ...props } as never)));
  const hat = () => host.querySelector<HTMLImageElement>("img[data-headwear]");

  it("a Director's 32 px avatar: the maid headwear over the face, sticking out above it", () => {
    draw({});
    const img = hat()!;
    expect(img).not.toBeNull();
    expect(img.dataset.headwear).toBe("maid");
    expect(img.getAttribute("srcset")).toContain("128w");
    expect(parseFloat(img.style.width)).toBeCloseTo(35.84);
    expect(parseFloat(img.style.height)).toBeCloseTo(22.4);
    expect(parseFloat(img.style.top)).toBeCloseTo(-4.48);
    expect(parseFloat(img.style.left)).toBeCloseTo(-1.92);
    // Over the face (after it), inside the same box.
    expect(img.previousElementSibling?.getAttribute("data-avatar")).toBeTruthy();
  });

  it("with a status layer the ring and badge still draw over it", () => {
    draw({ status: { running: true, badge: { tone: "attention", text: "2" } } });
    const img = hat()!;
    const status = host.querySelector("[data-avatar-status]")!;
    expect(status.contains(img)).toBe(true);
    expect(img.compareDocumentPosition(status.querySelector("[data-avatar-badge]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("not a Director: nothing", () => {
    look.isDirector = false;
    draw({});
    expect(hat()).toBeNull();
  });

  it("Settings → 主管头饰 = 王冠 / 冕冠: that picture in its box", () => {
    for (const style of ["crown", "mianguan"] as const) {
      act(() => setUiPref("directorHeadwear", style));
      draw({ size: 40 });
      const img = hat()!;
      expect(img.dataset.headwear).toBe(style);
      const box = headwearBox(style, 40);
      expect(parseFloat(img.style.width)).toBeCloseTo(box.width);
      expect(parseFloat(img.style.top)).toBeCloseTo(box.top);
    }
  });

  it("an Operator wears the companion (副主管也戴 on), nothing with it off", () => {
    look.isDirector = false;
    look.isOperator = true;
    draw({ size: 40 });
    expect(hat()!.dataset.headwear).toBe("operator-maid");
    act(() => setUiPref("operatorHeadwear", false));
    draw({ size: 40 });
    expect(hat()).toBeNull();
  });

  it("节日头饰 on Dec 26: the Director wears the Christmas hat, then the style again from Dec 27 (local midnight)", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 11, 26, 22));
    act(() => setUiPref("directorHeadwear", "wizard"));
    act(() => setUiPref("seasonalHeadwear", true));
    draw({ size: 40 });
    expect(hat()!.dataset.headwear).toBe("christmas");
    await act(async () => { vi.advanceTimersByTime(60 * 60_000); });
    expect(hat()!.dataset.headwear).toBe("christmas");
    // Past midnight: the shared timer fires and the style returns.
    await act(async () => { vi.advanceTimersByTime(60 * 60_000 + 2_000); });
    expect(new Date().getDate()).toBe(27);
    expect(hat()!.dataset.headwear).toBe("wizard");
  });

  it("Settings → 主管头饰 = 不显示: nothing", () => {
    act(() => setUiPref("directorHeadwear", "none"));
    draw({});
    expect(hat()).toBeNull();
  });

  it("small avatars (< 28 px), minor dots and cut-out portraits: nothing", () => {
    draw({ size: 24 });
    expect(hat()).toBeNull();
    draw({ size: 28 });
    expect(hat()).not.toBeNull();
    minorDot = true;
    draw({ size: 40 });
    expect(hat()).toBeNull();
    minorDot = false;
    draw({ size: 96, cutout: true });
    expect(hat()).toBeNull();
  });
});
