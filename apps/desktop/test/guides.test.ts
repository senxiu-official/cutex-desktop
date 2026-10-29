// @vitest-environment jsdom
// The guide registry and its per-device seen state (lib/guides, owner 2026-10-24): one list for the onboarding, tips and
// inline panels; asked once per device; skip-all marks every live guide seen, a guide added later still shows;
// 重置所有提示 brings tips back; 再看一次 forgets one.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../src/renderer/src/modules/onboarding/i18n";
import { en } from "../src/renderer/src/modules/onboarding/i18n.en";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";

const opened: unknown[] = [];
const finished: (string | null)[] = [];
vi.mock("../src/renderer/src/lib/onboarding", () => ({
  openOnboarding: (v: unknown) => opened.push(v),
  finishOnboarding: (v: string | null) => finished.push(v),
}));

const load = () => import("../src/renderer/src/lib/guides");

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  opened.length = 0;
  finished.length = 0;
});

describe("the registry", () => {
  it("ids are unique; every guide has its text in zh-CN, English and zh-Hant; tips name an anchor", async () => {
    const { GUIDES } = await load();
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
    for (const g of GUIDES) {
      for (const key of [g.title, g.text]) {
        expect(zhCN).toHaveProperty([key]);
        expect(en).toHaveProperty([key]);
        expect(zhHantCN).toHaveProperty([key]);
      }
      if (g.kind === "tip") expect(g.anchor, g.id).toBeTruthy();
      if (g.kind === "onboarding") expect(g.replay, g.id).toBeTypeOf("function");
      if (g.related) expect(GUIDES.some((x) => x.id === g.related), g.id).toBe(true);
    }
  });

  it("the delegation and ride-along tips link to each other", async () => {
    const { guideById } = await load();
    expect(guideById("tip.delegation")?.related).toBe("tip.rideAlong");
    expect(guideById("tip.rideAlong")?.related).toBe("tip.delegation");
  });

  it("live from `since`, never after `retireAfter` (unknown version: all not retired)", async () => {
    const { liveGuides } = await load();
    const all = [
      { id: "old", kind: "tip" as const, since: "0.1.0", retireAfter: "0.1.9", title: "onboarding.guide.tray.title" as const, text: "onboarding.guide.tray.text" as const },
      { id: "now", kind: "tip" as const, since: "0.2.0", title: "onboarding.guide.tray.title" as const, text: "onboarding.guide.tray.text" as const },
      { id: "next", kind: "tip" as const, since: "0.3.0", title: "onboarding.guide.tray.title" as const, text: "onboarding.guide.tray.text" as const },
    ];
    expect(liveGuides("0.1.5", all).map((g) => g.id)).toEqual(["old"]);
    expect(liveGuides("0.2.0", all).map((g) => g.id)).toEqual(["now"]);
    expect(liveGuides("0.3.1", all).map((g) => g.id)).toEqual(["now", "next"]);
    expect(liveGuides(null, all).map((g) => g.id)).toEqual(["old", "now", "next"]);
  });
});

describe("seen state", () => {
  it("starts unasked; the draft's tray / shelf tips count as seen", async () => {
    localStorage.setItem("cutex-desktop.first-use-tips", JSON.stringify(["tray", "home", {}]));
    const g = await load();
    expect(g.getGuides()).toEqual({ schema: 1, seen: ["tip.tray"], asked: false });
  });

  it("看 is remembered; seen ids survive a restart; corrupt storage starts fresh", async () => {
    let g = await load();
    g.answerGuides();
    g.markGuideSeen("tip.tray");
    vi.resetModules();
    g = await load();
    expect(g.getGuides()).toEqual({ schema: 1, seen: ["tip.tray"], asked: true });
    localStorage.setItem(g.GUIDES_KEY, "{");
    vi.resetModules();
    expect((await load()).getGuides()).toEqual({ schema: 1, seen: [], asked: false });
  });

  it("全部跳过 marks every live guide seen and finishes the onboarding; a guide of a later version still shows", async () => {
    const g = await load();
    g.skipAllGuides("0.1.9");
    expect(g.getGuides().asked).toBe(true);
    expect(g.getGuides().seen).toEqual(["onboarding"]); // the 0.2.0 guides were not live yet
    expect(finished).toEqual(["0.1.9"]);
    g.skipAllGuides("0.2.0");
    // Panel guides never prompt, so 全部跳过 has nothing to skip there (design panel-guides-design.md).
    expect(g.getGuides().seen.sort()).toEqual(g.liveGuides("0.2.0").filter((x) => x.kind !== "panel").map((x) => x.id).sort());
    expect(g.getGuides().seen.some((id) => id.startsWith("panel."))).toBe(false);
  });

  it("重置所有提示 brings back tips and panels, not the onboarding", async () => {
    const g = await load();
    g.skipAllGuides("0.2.0");
    g.resetGuides();
    expect(g.getGuides()).toEqual({ schema: 1, seen: ["onboarding", "onboarding.v02"], asked: true });
  });

  it("再看一次: an onboarding guide replays; a tip is forgotten and its host told", async () => {
    const g = await load();
    g.replayGuide("onboarding.v02");
    expect(opened).toEqual([{ kind: "whatsNew", version: "0.2.0" }]);
    g.markGuideSeen("tip.tray");
    const told: string[] = [];
    const off = g.onGuideReplay((id) => told.push(id));
    g.replayGuide("tip.tray");
    off();
    expect(told).toEqual(["tip.tray"]);
    expect(g.guideSeen("tip.tray")).toBe(false);
  });
});

describe("the owner's choice on the host (cutex guides.preferences)", () => {
  it("the guides version is the newest `since` among live guides", async () => {
    const g = await load();
    expect(g.guidesVersion("0.2.0")).toBe("0.2.0");
    expect(g.guidesVersion("0.1.9")).toBe("0.1.0");
  });

  it("taken only by a device that has not answered yet; covering everything finishes the onboarding", async () => {
    let g = await load();
    expect(g.applyHostSkip("0.2.0", "0.2.0")).toBe(true);
    expect(g.getGuides().asked).toBe(true);
    expect(finished).toEqual(["0.2.0"]);
    vi.resetModules();
    localStorage.clear();
    g = await load();
    g.answerGuides();
    expect(g.applyHostSkip("0.2.0", "0.2.0")).toBe(false);
    expect(g.getGuides().seen).toEqual([]);
    expect(g.applyHostSkip("not a version", "0.2.0")).toBe(false);
  });

  it("全部跳过 writes the guides version; 重置所有提示 writes null", async () => {
    const g = await load();
    const writes: (string | null)[] = [];
    g.setGuidesHostWriter((v) => writes.push(v));
    g.skipAllGuides("0.2.0");
    g.resetGuides();
    g.setGuidesHostWriter(null);
    g.skipAllGuides("0.2.0");
    expect(writes).toEqual(["0.2.0", null]);
  });

  it("a Director-created agent's tip covers the tile tip", async () => {
    const g = await load();
    g.markGuideSeen("tip.directorCreated");
    expect(g.guideSeen("tip.minorAgent")).toBe(true);
  });
});
