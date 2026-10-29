// @vitest-environment jsdom
// The 0.2.0 tour and the first-contact choices (owner 2026-10-23; lib/tour, lib/firstChoices, components/OnboardingFlow):
// 0.2.0's 新功能 is the onboarding flow's 0.2 part (owner 2026-10-24: one flow); 拟人头像 starts on 用 with every theme
// (owner 2026-10-24), written when the user moves past it; Skip / Esc before that keep today's look; 「帮我决定」 on a
// choice sets the recommendation and says so.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "zh-CN", setLocale: () => {} }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => {
  const state = { daemon: { kind: "connecting" }, openSettings: () => {}, notify: () => {}, hosts: { active: "local", hosts: [] }, features: new Set<string>(), byHost: {} };
  return {
    ...(await importOriginal<object>()),
    useApp: Object.assign((select: (s: unknown) => unknown) => select(state), { getState: () => state, setState: () => {}, subscribe: () => () => {} }),
  };
});
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { OnboardingHost } = await import("../src/renderer/src/components/OnboardingDialog");
const { closeOnboarding, getOnboarding, openOnboarding } = await import("../src/renderer/src/lib/onboarding");
const { decidePortraitThemes, hasTour, initialPortraitAnswer, portraitAnswered, portraitThemesFor } = await import("../src/renderer/src/lib/tour");
const { availableChoices, decideAllChoices, FIRST_CHOICES } = await import("../src/renderer/src/lib/firstChoices");
const { getUiPrefs, setUiPref } = await import("../src/renderer/src/lib/prefs");
const { getAppearance, setAppearance } = await import("../src/renderer/src/lib/appearance");
const { setTrayPrefs, useTrayPrefs } = await import("../src/renderer/src/lib/trayPrefs");

describe("lib/tour", () => {
  it("0.2.0 (and its pre-releases) has the tour; later versions keep the text list", () => {
    expect(hasTour("0.2.0")).toBe(true);
    expect(hasTour("0.2.0-rc.1")).toBe(true);
    expect(hasTour("0.2.1")).toBe(false);
    expect(hasTour(null)).toBe(false);
  });

  it("the 拟人头像 answer: 用 with every theme to start; 用 needs a theme; its 「帮我决定」 = every theme", () => {
    const fresh = initialPortraitAnswer([], ["p/a", "p/b"]);
    expect(fresh).toEqual({ use: true, themes: ["p/a", "p/b"] });
    expect(portraitAnswered(fresh)).toBe(true);
    expect(portraitAnswered({ use: null, themes: [] })).toBe(false);
    expect(portraitAnswered({ use: false, themes: [] })).toBe(true);
    expect(portraitAnswered({ use: true, themes: [] })).toBe(false);
    expect(portraitAnswered({ use: true, themes: ["p/a"] })).toBe(true);
    // Themes already on (from Settings) count as answered.
    expect(initialPortraitAnswer(["p/a"])).toEqual({ use: true, themes: ["p/a"] });
    expect(portraitThemesFor({ use: false, themes: ["p/a"] })).toEqual([]);
    expect(decidePortraitThemes({ use: true, themes: [] }, ["p/a", "p/b"])).toEqual({ use: true, themes: ["p/a", "p/b"] });
    // Not decided for someone who has not said 用.
    expect(decidePortraitThemes({ use: null, themes: [] }, ["p/a"])).toEqual({ use: null, themes: [] });
  });
});

describe("lib/firstChoices", () => {
  it("「都帮我决定」 sets every recommendation (avatar background none, sidebar 花名册, drop preview outline, 2 columns) and never the 拟人头像", () => {
    setUiPref("avatarTint", "provider");
    setUiPref("sidebarLayout", "now-all");
    setAppearance({ dropPreview: "fill" });
    setTrayPrefs({ allowThreeColumns: true });
    setUiPref("portraitPacks", []);
    const done = decideAllChoices();
    expect(done.map((d) => [d.choice.id, d.option.value])).toEqual([
      ["avatarTint", "none"],
      ["sidebarLayout", "roster"],
      ["dropPreview", "outline"],
      ["threeColumns", "two"],
    ]);
    expect(getUiPrefs().avatarTint).toBe("none");
    expect(getUiPrefs().sidebarLayout).toBe("roster");
    expect(getAppearance().dropPreview).toBe("outline");
    expect(useTrayPrefs.getState().allowThreeColumns).toBe(false);
    expect(getUiPrefs().portraitPacks).toEqual([]);
    expect(availableChoices(["dropPreview"]).map((c) => c.id)).toEqual(["dropPreview"]);
    for (const c of FIRST_CHOICES) expect(c.options.some((o) => o.value === c.recommended)).toBe(true);
  });
});

describe("portrait upgrade preservation", () => {
  it("keeps explicit minimal style and existing theme subsets", () => {
    expect(initialPortraitAnswer([], ["p/a", "p/b"], true)).toEqual({use: false, themes: []});
    expect(initialPortraitAnswer(["p/b"], ["p/a", "p/b"], true)).toEqual({use: true, themes: ["p/b"]});
  });
});
