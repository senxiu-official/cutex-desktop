// @vitest-environment jsdom
// The one onboarding flow (owner 2026-10-24; lib/onboardingFlow, components/OnboardingFlow): one decision group per
// setup card; the full flow runs once for everyone at 0.2.0 (upgraders from 0.1.x included) with their current
// choices preselected, then only for new users; Settings → 新功能 replays only the 0.2 part.
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
vi.mock("../src/renderer/src/lib/profileSnapshot", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cachedProfileList: () => ({ profiles: [{ name: "work" }] }),
  loadProfileList: async () => ({ profiles: [{ name: "work" }] }),
}));
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { flowSections, flowSteps, NEW_IN_02 } = await import("../src/renderer/src/lib/onboardingFlow");
const { automaticView, closeOnboarding, ONBOARDING_REVISION, openOnboarding, resetOnboardingForTest } = await import("../src/renderer/src/lib/onboarding");
const { OnboardingHost } = await import("../src/renderer/src/components/OnboardingDialog");
const { setUiPref } = await import("../src/renderer/src/lib/prefs");
const { applyTheme } = await import("../src/renderer/src/lib/theme");

describe("lib/onboardingFlow", () => {
  it("introduces concepts before their one-decision cards, at most fifteen steps", () => {
    const ids = flowSteps("full", { portraitThemes: true, noProfile: true }).map((s) => s.id);
    expect(ids).toEqual(["language", "intro", "theme", "zoom", "perf", "terms", "project", "window", "sidebar", "groups", "layout", "pages", "look", "portraitThemes", "profile"]);
    expect(flowSteps("whatsNew").map((s) => s.id)).toEqual(["groups", "layout", "pages", "look", "sidebar", "more"]);
    expect([...NEW_IN_02]).toEqual(["groups", "pages", "look"]);
    expect(flowSections(flowSteps("full"))[0]?.section).toBe("basics");
  });
  it("omits configured choices but preserves their concept", () => {
    expect(flowSteps("full", {portraitThemes: true, configured: ["theme", "sidebar", "layout", "portraits", "portraitThemes"]}).map((s) => s.id)).toEqual(["language", "intro", "zoom", "perf", "terms", "project", "window", "groups", "pages", "look"]);
  });
});

describe("once for everyone at 0.2.0, then only for new users", () => {
  const listed = ["0.2.0", "0.1.5"];
  it("a 0.1.x user (an earlier introduction finished) gets the whole flow once; closing it also counts 0.2.0 as seen", () => {
    expect(ONBOARDING_REVISION).toBe(3);
    for (const doneRevision of [1, 2]) {
      const upgrader = { doneRevision, whatsNew: true, lastWhatsNew: "0.1.5", testEveryBuild: false, lastTestBuild: null };
      expect(automaticView(upgrader, "0.2.0", listed)).toEqual({ kind: "intro" });
    }
    openOnboarding({ kind: "intro" });
    closeOnboarding("0.2.0");
    const after = { doneRevision: ONBOARDING_REVISION, whatsNew: true, lastWhatsNew: "0.2.0", testEveryBuild: false, lastTestBuild: null };
    expect(automaticView(after, "0.2.0", listed)).toBeNull();
    expect(automaticView({ ...after, doneRevision: 0, lastWhatsNew: null }, "0.2.0", listed)).toEqual({ kind: "intro" }); // a new user
  });
});

describe("the first automatic onboarding on a device asks first", () => {
  it("「要看引导和提示吗？」: 看 opens the flow; 全部跳过 closes it as done; a replay never asks", async () => {
    const guides = await import("../src/renderer/src/lib/guides");
    const { getOnboarding } = await import("../src/renderer/src/lib/onboarding");
    localStorage.removeItem(guides.GUIDES_KEY);
    guides.reloadGuideState();
    const div = document.createElement("div");
    document.body.append(div);
    const root = createRoot(div);
    act(() => root.render(h(OnboardingHost)));
    const click = (sel: string) => act(() => div.querySelector<HTMLElement>(`${sel} button`)!.click());
    act(() => openOnboarding({ kind: "intro", auto: true }));
    expect(div.querySelector("[data-guides-ask]")).not.toBeNull();
    expect(div.querySelector("[data-onboarding]")).toBeNull();
    click("[data-guides-answer=see]");
    expect(div.querySelector("[data-onboarding]")).not.toBeNull();
    act(() => closeOnboarding(null));
    localStorage.removeItem(guides.GUIDES_KEY);
    guides.reloadGuideState();
    localStorage.removeItem("cutex-desktop.onboarding");
    resetOnboardingForTest();
    act(() => openOnboarding({ kind: "intro" }));
    expect(div.querySelector("[data-guides-ask]")).toBeNull();
    act(() => closeOnboarding(null));
    act(() => openOnboarding({ kind: "intro", auto: true }));
    click("[data-guides-answer=skip]");
    expect(div.querySelector("[data-onboarding], [data-guides-ask]")).toBeNull();
    expect(getOnboarding().doneRevision).toBe(ONBOARDING_REVISION);
    expect(guides.guideSeen("onboarding")).toBe(true);
    act(() => root.unmount());
  });
});

describe("the full flow keeps what is chosen today", () => {
  it("the theme, animation and wording cards open on the current choice, so 下一步 keeps it", () => {
    applyTheme("dark");
    setUiPref("perfMode", "smooth");
    const div = document.createElement("div");
    document.body.append(div);
    const root = createRoot(div);
    act(() => root.render(h(OnboardingHost)));
    localStorage.removeItem("cutex-desktop.onboarding");
    resetOnboardingForTest();
    act(() => openOnboarding({ kind: "intro" }));
    const step = () => div.querySelector("[data-onboarding]")?.getAttribute("data-onboarding-step");
    const next = () => act(() => [...div.querySelectorAll("button")].find((b) => b.textContent === "onboarding.next")!.click());
    expect(div.querySelector("[data-onboarding]")!.getAttribute("data-onboarding-mode")).toBe("full");
    expect([...div.querySelectorAll("[data-onboarding-section]")].map((e) => e.getAttribute("data-onboarding-section"))).toEqual(["basics"]);
    while (step() !== "theme") next();
    expect(step()).toBe("theme");
    expect(div.querySelector("[data-onboarding-theme=dark]")!.getAttribute("aria-checked")).toBe("true");
    while (step() !== "perf") next();
    expect(div.querySelector("[data-onboarding-perf=smooth]")!.getAttribute("aria-checked")).toBe("true");
    act(() => div.querySelector<HTMLElement>("[data-onboarding-perf=save]")!.click());
    expect(div.querySelector("[data-onboarding-perf=save]")!.getAttribute("aria-checked")).toBe("true");
    act(() => closeOnboarding(null));
    act(() => root.unmount());
    applyTheme("system");
    setUiPref("perfMode", "save");
  });
});

describe("the cards of round 2 (owner 2026-10-24)", () => {
  it("theme and colours on one card; 节省资源 / 流畅优先 each with its small slanted joke", () => {
    const div = document.createElement("div");
    document.body.append(div);
    const root = createRoot(div);
    act(() => root.render(h(OnboardingHost)));
    localStorage.removeItem("cutex-desktop.onboarding");
    resetOnboardingForTest();
    act(() => openOnboarding({ kind: "intro" }));
    const next = () => act(() => [...div.querySelectorAll("button")].find((b) => b.textContent === "onboarding.next")!.click());
    for (let i = 0; i < 4 && !div.querySelector("[data-onboarding-theme=light]"); i++) next();
    expect(div.querySelector("[data-onboarding-theme=light]")).not.toBeNull();
    expect(div.querySelectorAll("[data-onboarding-palettes] [data-onboarding-palette]").length).toBeGreaterThan(2);
    next();
    next();
    expect(div.querySelector("[data-onboarding]")!.getAttribute("data-onboarding-step")).toBe("perf");
    expect([...div.querySelectorAll("[data-onboarding-quip]")].map((e) => e.textContent)).toEqual(["onboarding.perf.quip.save", "onboarding.perf.quip.smooth"]);
    // Owner 2026-10-24: the jokes at the very bottom of the card, under the options and their descriptions, not in them.
    expect(div.querySelector("[role=radio] [data-onboarding-quip]")).toBeNull();
    const group = div.querySelector("[data-onboarding-perf]")!.closest("[role=radiogroup]")!;
    expect(group.compareDocumentPosition(div.querySelector("[data-onboarding-quips]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => closeOnboarding(null));
    act(() => root.unmount());
  });

  it("头像底色 is previewed in the style chosen before: the chosen themes' faces (tinted with 按模型), else emoji / letters", async () => {
    const { LookArt } = await import("../src/renderer/src/components/TourArt");
    const { ONBOARDING_FACES } = await import("../src/renderer/src/lib/onboardingFaces");
    const div = document.createElement("div");
    document.body.append(div);
    const root = createRoot(div);
    const faces = () => [...div.querySelectorAll("[data-look-face]")].map((e) => e.getAttribute("data-look-face"));
    const keys = [...ONBOARDING_FACES.keys()].slice(0, 2);
    setUiPref("portraitPacks", keys);
    setUiPref("avatarTint", "provider");
    act(() => root.render(h(LookArt)));
    expect(faces()).toEqual(["picture", "picture", "picture", "picture"]);
    expect(div.querySelector("[data-look-face] img")!.getAttribute("src")).toBe(ONBOARDING_FACES.get(keys[0]!));
    expect(div.querySelector("[data-look-face]")!.getAttribute("data-look-tint")).toBe("claude");
    act(() => setUiPref("avatarTint", "none"));
    expect(div.querySelector("[data-look-tint]")).toBeNull();
    act(() => setUiPref("portraitPacks", []));
    act(() => setUiPref("agentAvatarDefault", "emoji"));
    expect(faces()).toEqual(["emoji", "emoji", "emoji", "emoji"]);
    act(() => setUiPref("agentAvatarDefault", "letter"));
    expect(faces()).toEqual(["letter", "letter", "letter", "letter"]);
    act(() => root.unmount());
  });
});


describe("review regressions", () => {
  function mount() {
    const div = document.createElement("div"); document.body.append(div);
    const root = createRoot(div);
    act(() => root.render(h(OnboardingHost)));
    act(() => openOnboarding({kind: "intro"}));
    const step = () => div.querySelector("[data-onboarding-step]")?.getAttribute("data-onboarding-step");
    const next = () => act(() => [...div.querySelectorAll("button")].find((b) => b.textContent === "onboarding.next" || b.textContent === "onboarding.finish")!.click());
    return {div, step, next, stop: () => { act(() => closeOnboarding(null)); act(() => root.unmount()); div.remove(); }};
  }
  it("upgrade skips saved cards and never enables minimal avatars, including after continuing to the end", async () => {
    const {getUiPrefs} = await import("../src/renderer/src/lib/prefs");
    const {setTrayPrefs} = await import("../src/renderer/src/lib/trayPrefs");
    const {setAppearance} = await import("../src/renderer/src/lib/appearance");
    setUiPref("portraitPacks", []); setUiPref("sidebarLayout", "now-all"); setUiPref("perfMode", "smooth");
    setTrayPrefs({allowThreeColumns: true}); setAppearance({zoom: 125}); applyTheme("dark");
    localStorage.setItem("cutex-desktop.onboarding", JSON.stringify({doneRevision: 2})); resetOnboardingForTest();
    const m = mount(); const seen: (string | null | undefined)[] = [];
    for (let i = 0; i < 20 && m.step(); i++) { seen.push(m.step()); m.next(); }
    expect(seen).toEqual(["intro", "project", "window", "groups", "pages", "look"]);
    expect(getUiPrefs().portraitPacks).toEqual([]); expect(getUiPrefs().sidebarLayout).toBe("now-all"); expect(getUiPrefs().perfMode).toBe("smooth");
    m.stop();
  });
  it("radio arrows select locally, Tab remains in the modal and closing restores its opener", () => {
    localStorage.removeItem("cutex-desktop.onboarding"); resetOnboardingForTest();
    const opener = document.createElement("button"); document.body.append(opener); opener.focus();
    const m = mount();
    while (m.step() !== "theme") m.next();
    const light = m.div.querySelector<HTMLButtonElement>("[data-onboarding-theme=light]")!;
    act(() => { light.focus(); light.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true})); });
    expect(m.step()).toBe("theme"); expect(m.div.querySelector("[data-onboarding-theme=dark]")?.getAttribute("aria-checked")).toBe("true");
    const buttons = [...m.div.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")].filter((b) => b.tabIndex >= 0);
    act(() => { buttons.at(-1)!.focus(); buttons.at(-1)!.dispatchEvent(new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true})); });
    expect(document.activeElement).toBe(buttons[0]);
    act(() => m.div.querySelector<HTMLElement>("[data-onboarding-keep]")!.click());
    expect(document.activeElement).toBe(opener); m.stop(); opener.remove();
  });
  it("fresh users have all portrait themes preselected and Select all repairs an empty selection", async () => {
    const {getUiPrefs} = await import("../src/renderer/src/lib/prefs");
    localStorage.removeItem("cutex-desktop.onboarding"); resetOnboardingForTest(); setUiPref("portraitPacks", []);
    const m = mount();
    for (let i = 0; i < 20 && m.step() !== "look"; i++) m.next();
    expect(m.div.querySelector("[data-portrait-use=yes]")?.getAttribute("aria-checked")).toBe("true");
    expect(m.div.querySelector("[data-choice-decide]")).toBeNull(); expect(m.div.querySelector("[data-tour-decide-all]")).toBeNull();
    m.next(); expect(m.step()).toBe("portraitThemes");
    const themes = [...m.div.querySelectorAll<HTMLElement>("[data-portrait-theme]")]; expect(themes.length).toBeGreaterThan(0);
    expect(themes.every((t) => t.getAttribute("aria-checked") === "true")).toBe(true);
    themes.forEach((t) => act(() => t.click()));
    expect(getUiPrefs().portraitPacks).toHaveLength(0);
    act(() => m.div.querySelector<HTMLElement>("[data-portrait-decide]")!.click());
    expect(getUiPrefs().portraitPacks).toHaveLength(themes.length); m.stop();
  });
});

describe("the wording step's preview line", () => {
  it("comes from the catalog (onboarding.terms.example) and each preset fills it", async () => {
    const { TermsStep } = await import("../src/renderer/src/components/OnboardingSteps");
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    act(() => root.render(h(TermsStep, { egg: { revealed: false, reveal: () => {} } })));
    const line = div.querySelector("[data-onboarding-preview]")!.textContent!;
    expect(line).toContain("2 个");
    expect(line).not.toContain("{{");
    act(() => root.unmount());
    div.remove();
  });
});
