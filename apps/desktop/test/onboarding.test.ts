// @vitest-environment jsdom
// Onboarding (owner 2026-10-19): wording presets (lib/termPresets) and when the introduction / a version's
// 新功能 open by themselves (lib/onboarding automaticView); the dialog's step order and the hidden Maid chip.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ profiles: [] as unknown[] }));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "zh-CN", setLocale: () => {} }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => {
  const state = { daemon: { kind: "connecting" }, openSettings: () => {}, notify: () => {}, hosts: { active: "local" }, features: new Set<string>(), byHost: {} };
  return {
    ...(await importOriginal<object>()),
    useApp: Object.assign((select: (s: unknown) => unknown) => select(state), { getState: () => state, setState: () => {}, subscribe: () => () => {} }),
  };
});
vi.mock("../src/renderer/src/lib/profileSnapshot", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cachedProfileList: () => ({ profiles: fx.profiles }),
  loadProfileList: async () => ({ profiles: fx.profiles }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { applyTermPreset, currentTermPreset, termPresets } = await import("../src/renderer/src/lib/termPresets");
const { getTermOverrides, resolveTerms } = await import("../src/renderer/src/lib/terms");
const { automaticView, closeOnboarding, getOnboarding, ONBOARDING_REVISION, openOnboarding, setTestEveryBuild, setWhatsNewEnabled, testView, useOnboardingView } = await import("../src/renderer/src/lib/onboarding");
const { OnboardingHost } = await import("../src/renderer/src/components/OnboardingDialog");

describe("wording presets", () => {
  it("Chinese offers 智能体 / 代理 / agent and the Maid easter egg last; other languages default + Maid", () => {
    expect(termPresets("zh-CN").map((p) => p.id)).toEqual(["default", "daili", "english", "maid"]);
    expect(termPresets("zh-CN").at(-1)!.easterEgg).toBe(true);
    expect(termPresets("en").map((p) => p.id)).toEqual(["default", "maid"]);
  });

  it("a preset replaces the language's wording, is recognised, and default clears it", () => {
    expect(currentTermPreset("zh-CN")).toBe("default");
    applyTermPreset("zh-CN", "daili");
    expect(currentTermPreset("zh-CN")).toBe("daili");
    let terms = resolveTerms(getTermOverrides(), "zh-CN");
    expect([terms.agent.one, terms.subagent.one, terms.director.one, terms.owner.one]).toEqual(["代理", "子代理", "主管", "主人"]);
    applyTermPreset("zh-CN", "maid");
    terms = resolveTerms(getTermOverrides(), "zh-CN");
    expect([terms.agent.one, terms.director.one, terms.owner.one]).toEqual(["Maid", "Chief Maid", "Master"]);
    expect(currentTermPreset("zh-CN")).toBe("maid");
    // Other languages are untouched.
    expect(currentTermPreset("en")).toBe("default");
    applyTermPreset("en", "maid");
    expect(resolveTerms(getTermOverrides(), "en").agent).toEqual({ one: "Maid", many: "Maids" });
    applyTermPreset("zh-CN", "default");
    applyTermPreset("en", "default");
    expect(getTermOverrides()["zh-CN"] ?? {}).toEqual({});
    expect(currentTermPreset("zh-CN")).toBe("default");
  });

  it("a hand-made wording is no preset", () => {
    applyTermPreset("zh-CN", "daili");
    const custom = { "zh-CN": { agent: { one: "助手", many: "助手" } } };
    expect(currentTermPreset("zh-CN", custom)).toBeNull();
    applyTermPreset("zh-CN", "default");
  });
});

describe("when the dialog opens by itself", () => {
  const listed = ["0.1.5", "0.1.4"];
  const fresh = { doneRevision: 0, whatsNew: true, lastWhatsNew: null, testEveryBuild: false, lastTestBuild: null };
  const done = { doneRevision: ONBOARDING_REVISION, whatsNew: true, lastWhatsNew: "0.1.4", testEveryBuild: false, lastTestBuild: null };

  it("the introduction until it was finished once (version or not)", () => {
    expect(automaticView(fresh, null, listed)).toEqual({ kind: "intro" });
    expect(automaticView(fresh, "0.1.5", listed)).toEqual({ kind: "intro" });
  });

  it("then a listed, newer version's 新功能 once, only while the switch is on", () => {
    expect(automaticView(done, "0.1.5", listed)).toEqual({ kind: "whatsNew", version: "0.1.5" });
    expect(automaticView({ ...done, lastWhatsNew: "0.1.5" }, "0.1.5", listed)).toBeNull();
    expect(automaticView({ ...done, whatsNew: false }, "0.1.5", listed)).toBeNull();
    expect(automaticView(done, "0.1.6", listed)).toBeNull(); // not in the bundled changelog
    expect(automaticView({ ...done, lastWhatsNew: "0.1.5" }, "0.1.4", listed)).toBeNull(); // a downgrade
    expect(automaticView(done, null, listed)).toBeNull(); // unknown version (dev build)
  });

  it("finishing the introduction also counts this version's 新功能 as seen; the switch persists", () => {
    openOnboarding({ kind: "intro" });
    closeOnboarding("0.1.5");
    expect(getOnboarding()).toMatchObject({ doneRevision: ONBOARDING_REVISION, lastWhatsNew: "0.1.5" });
    expect(automaticView(getOnboarding(), "0.1.5", listed)).toBeNull();
    setWhatsNewEnabled(false);
    expect(JSON.parse(localStorage.getItem("cutex-desktop.onboarding")!)).toMatchObject({ whatsNew: false });
  });
});

describe("the testing switch (development builds)", () => {
  const listed = ["0.1.5", "0.1.4"];
  it("off: nothing; on: once per new build the whole introduction, then the newest 新功能", () => {
    const base = { doneRevision: ONBOARDING_REVISION, whatsNew: true, lastWhatsNew: "0.1.5", testEveryBuild: false, lastTestBuild: null };
    expect(testView(base, "0.1.5@abc", listed)).toBeNull();
    const on = { ...base, testEveryBuild: true };
    expect(testView(on, "0.1.5@abc", listed)).toEqual({ kind: "intro", test: { build: "0.1.5@abc", whatsNew: "0.1.5" } });
    expect(testView({ ...on, lastTestBuild: "0.1.5@abc" }, "0.1.5@abc", listed)).toBeNull();
    expect(testView({ ...on, lastTestBuild: "0.1.5@abc" }, "0.1.5@def", listed)).not.toBeNull(); // a new commit counts
    expect(testView(on, null, listed)).toBeNull();
  });

  it("closing the introduction records the build and opens the 新功能 next", () => {
    setTestEveryBuild(true);
    const view = testView(getOnboarding(), "0.1.5@abc", listed)!;
    openOnboarding(view);
    closeOnboarding("0.1.5");
    expect(getOnboarding()).toMatchObject({ testEveryBuild: true, lastTestBuild: "0.1.5@abc" });
    let seen: unknown = null;
    const probe = () => { seen = useOnboardingView(); return null; };
    const div = document.createElement("div");
    const root = createRoot(div);
    act(() => root.render(h(probe)));
    expect(seen).toEqual({ kind: "whatsNew", version: "0.1.5" });
    act(() => root.unmount());
    closeOnboarding(null);
    setTestEveryBuild(false);
    expect(getOnboarding()).toMatchObject({ testEveryBuild: false, lastTestBuild: null });
  });
});

describe("the introduction dialog", () => {
  function openIntro() {
    const div = document.createElement("div");
    document.body.append(div);
    const root = createRoot(div);
    act(() => root.render(h(OnboardingHost)));
    act(() => openOnboarding({ kind: "intro" }));
    const step = () => div.querySelector("[data-onboarding-step]")?.getAttribute("data-onboarding-step");
    const button = (label: string) => [...div.querySelectorAll("button")].find((b) => b.textContent === label);
    const toTerms = () => {
      while (step() !== "terms") act(() => button("onboarding.next")!.click());
    };
    return { div, step, button, toTerms, unmount: () => act(() => root.unmount()) };
  }

  it("language and appearance come first, then the session, project and wording steps, and the Profile step (none yet) last", () => {
    const { step, button, unmount } = openIntro();
    const seen = [step()];
    while (button("onboarding.next")) {
      act(() => button("onboarding.next")!.click());
      seen.push(step());
    }
    expect(seen).toEqual(["language", "appearance", "intro", "project", "terms", "profile"]);
    expect(button("onboarding.finish")).toBeTruthy();
    unmount();
  });

  it("without a missing Profile the Profile step is left out", () => {
    fx.profiles = [{ name: "work" }];
    const { step, button, unmount } = openIntro();
    const seen = [step()];
    while (button("onboarding.next")) {
      act(() => button("onboarding.next")!.click());
      seen.push(step());
    }
    expect(seen).toEqual(["language", "appearance", "intro", "project", "terms"]);
    fx.profiles = [];
    unmount();
  });

  it("the plain choices are 智能体 / 代理 / agent; the small ribbon reveals Maid, which then stays across steps", async () => {
    const { div, toTerms, button, unmount } = openIntro();
    toTerms();
    const maid = () => [...div.querySelectorAll("[role=radio]")].find((b) => b.textContent?.includes("onboarding.preset.maid"));
    expect([...div.querySelectorAll("[role=radio]")].map((b) => b.textContent)).toEqual(["onboarding.preset.default", "onboarding.preset.daili", "onboarding.preset.english"]);
    const ribbon = div.querySelector<HTMLElement>("[data-onboarding-ribbon]")!;
    expect(ribbon.getAttribute("title")).toBeNull(); // no hint
    act(() => ribbon.click());
    expect(maid()?.textContent).toBe("🎀 onboarding.preset.maid");
    expect(div.querySelector("[data-onboarding-ribbon]")).toBeNull();
    await act(async () => new Promise<void>((r) => requestAnimationFrame(() => r())));
    expect(maid()!.className).toContain("opacity-100");
    act(() => button("onboarding.back")!.click());
    act(() => button("onboarding.next")!.click());
    expect(maid()).toBeTruthy();
    unmount();
    closeOnboarding(null);
  });

  it("a wording that already is Maid shows it selected, and picking another keeps the way back", () => {
    applyTermPreset("zh-CN", "maid");
    const dialog = openIntro();
    dialog.toTerms();
    const maid = () => [...dialog.div.querySelectorAll("[role=radio]")].find((b) => b.textContent?.includes("onboarding.preset.maid"));
    expect(maid()?.getAttribute("aria-checked")).toBe("true");
    act(() => (maid()!.parentElement!.querySelector("[role=radio]") as HTMLElement).click());
    expect(currentTermPreset("zh-CN")).toBe("default");
    expect(maid()).toBeTruthy();
    dialog.unmount();
    closeOnboarding(null);
  });
});
