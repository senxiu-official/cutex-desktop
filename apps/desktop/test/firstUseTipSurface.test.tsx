// @vitest-environment jsdom
// Tips, inline panels and 帮助 read the one registry (lib/guides): a tip shows once beside its anchor and never over a
// dialog or the onboarding; the first guide on a device asks 「要看引导和提示吗？」 in place; every guide offers
// 「跳过所有引导」; 帮助 lists live guides with 「再看一次」 and 「重置所有提示」.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  view: null as object | null,
  overlay: false,
  host: "a",
  openSettings: vi.fn(),
  external: vi.fn(),
  features: [] as string[],
  prefs: { schema: 1, skippedThrough: null as string | null, updatedAt: null as string | null },
  put: vi.fn(async (skippedThrough: string | null) => ({ schema: 1, skippedThrough, updatedAt: "now" })),
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("../src/renderer/src/bridge", () => ({ api: { openExternal: fx.external, guidesPreferences: async () => fx.prefs, putGuidesPreferences: fx.put }, apiFor: () => ({guidesPreferences: async () => fx.prefs, putGuidesPreferences: fx.put}) }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: unknown) => unknown) => select({ hosts: { active: fx.host } }), { getState: () => ({ openSettings: fx.openSettings, hosts: {active: fx.host} }) }),
  featuresOf: () => new Set(fx.features),
}));
vi.mock("../src/renderer/src/lib/onboarding", () => ({ useOnboardingView: () => fx.view, openOnboarding: vi.fn(), finishOnboarding: vi.fn() }));
vi.mock("../src/renderer/src/lib/openOverlays", () => ({ anyOverlayOpen: () => fx.overlay, useTrackOverlay: () => {} }));
vi.mock("../src/renderer/src/lib/update", () => ({ useUpdateStatus: () => ({ current: { version: "0.2.0" } }) }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  Button: ({ children, onClick }: { children: unknown; onClick(): void }) => h("button", { onClick }, children as never),
  Section: ({ title, children, actions }: { title?: string; children: unknown; actions?: unknown }) => h("section", { "data-section": title }, actions as never, children as never),
  SettingRow: ({ label, hint, children }: { label: unknown; hint?: unknown; children?: unknown }) => h("div", null, h("span", { "data-label": "" }, label as never), h("span", { "data-hint": "" }, hint as never), children as never),
  SettingsGroup: ({ children }: { children: unknown }) => h("div", null, children as never),
  LinkRow: ({ label, onClick }: { label: unknown; onClick(): void }) => h("button", { "data-link-row": "", onClick }, label as never),
}));

const guides = await import("../src/renderer/src/lib/guides");
const { FirstUseTips, TIP_POLL_MS } = await import("../src/renderer/src/components/FirstUseTips");
const { InlineGuide } = await import("../src/renderer/src/components/InlineGuide");
const { HelpPage } = await import("../src/renderer/src/modules/onboarding/HelpPage");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mount: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const tip = () => document.querySelector<HTMLElement>("[data-first-use-tip]");
const poll = () => act(() => vi.advanceTimersByTime(TIP_POLL_MS));
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text) ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  guides.reloadGuideState();
  fx.features = [];
  fx.prefs = { schema: 1, skippedThrough: null, updatedAt: null };
  fx.put.mockClear();
  fx.view = null;
  fx.overlay = false;
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("anchored tips", () => {
  it("asks first, then shows the tip once; never over a dialog or the onboarding", () => {
    const anchor = document.createElement("button");
    anchor.setAttribute("data-tray-item", "");
    document.body.append(anchor);
    fx.overlay = true;
    act(() => root.render(h(FirstUseTips)));
    poll();
    expect(tip()).toBeNull();
    fx.overlay = false;
    poll();
    expect(tip()?.getAttribute("data-first-use-tip")).toBe("tip.tray");
    expect(tip()!.querySelector("[data-guides-ask]")).not.toBeNull();
    expect(guides.guideSeen("tip.tray")).toBe(false); // only the question is on screen
    click(button("onboarding.guide.ask.see"));
    expect(tip()!.textContent).toContain("onboarding.guide.tray.text");
    expect(guides.getGuides().asked).toBe(true);
    expect(guides.guideSeen("tip.tray")).toBe(true);
    click(button("onboarding.guide.openSettings"));
    expect(fx.openSettings).toHaveBeenCalledWith("tray");
    expect(tip()).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    expect(tip()).toBeNull();
    fx.view = {};
    act(() => root.render(h(FirstUseTips)));
    act(() => guides.replayGuide("tip.tray"));
    expect(tip()).toBeNull();
  });

  it("「跳过所有引导」 in a tip marks every live guide seen", () => {
    guides.answerGuides();
    const card = document.createElement("div");
    card.innerHTML = '<div data-delegation-card=""></div>';
    document.body.append(card);
    act(() => root.render(h(FirstUseTips)));
    poll();
    expect(tip()?.getAttribute("data-first-use-tip")).toBe("tip.delegation");
    click(button("onboarding.guide.related"));
    expect(guides.guideSeen("tip.rideAlong")).toBe(false); // replay = forget; it shows when its anchor is there
    poll();
    expect(tip()).toBeNull();
    guides.markGuideSeen("tip.rideAlong");
    act(() => guides.replayGuide("tip.delegation"));
    expect(tip()?.getAttribute("data-first-use-tip")).toBe("tip.delegation");
    click(tip()!.querySelector("[data-guides-skip]"));
    expect(tip()).toBeNull();
    expect(guides.liveGuides("0.2.0").every((g) => g.kind === "panel" || guides.guideSeen(g.id))).toBe(true); // panel guides never prompt
  });

  it("a project tip skips the 独立 and 快速对话 groups; a Shelf tip needs 2+ tabs", () => {
    guides.answerGuides();
    document.body.insertAdjacentHTML("beforeend", '<section data-group-key="__chats__"><div>chats</div></section><div data-side-card="x"><div data-side-tab-row=""><span role="tab"></span></div></div>');
    act(() => root.render(h(FirstUseTips)));
    poll();
    expect(tip()).toBeNull();
    document.body.insertAdjacentHTML("beforeend", '<section data-group-key="h1:p1"><div>Project</div></section>');
    document.querySelector("[data-side-tab-row]")!.insertAdjacentHTML("beforeend", '<span role="tab"></span>');
    poll();
    expect(tip()?.getAttribute("data-first-use-tip")).toBe("tip.project");
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(tip()).toBeNull();
    poll();
    expect(tip()).toBeNull(); // a quiet gap between tips
    act(() => vi.advanceTimersByTime(6000));
    expect(tip()?.getAttribute("data-first-use-tip")).toBe("tip.shelf");
  });
});

describe("inline panels", () => {
  it("shows for its type until closed or a Profile of that type exists; asks first on a new device", () => {
    act(() => root.render(h(InlineGuide, { id: "inline.profile.claude" })));
    expect(mount.querySelector("[data-guides-ask=inline]")).not.toBeNull();
    click(button("onboarding.guide.ask.see"));
    expect(mount.querySelector("[data-inline-guide]")!.textContent).toContain("onboarding.guide.profile.claude.text");
    act(() => root.render(h(InlineGuide, { id: "inline.profile.claude", done: true })));
    expect(mount.querySelector("[data-inline-guide]")).toBeNull();
    expect(guides.guideSeen("inline.profile.claude")).toBe(true);
    act(() => root.render(h(InlineGuide, { id: "inline.profile.apiKey" })));
    click(mount.querySelector('[aria-label="onboarding.tips.dismiss"]'));
    expect(mount.querySelector("[data-inline-guide]")).toBeNull();
    act(() => guides.replayGuide("inline.profile.apiKey"));
    expect(mount.querySelector("[data-inline-guide=inline\\.profile\\.apiKey]")).not.toBeNull();
  });
});

describe("帮助", () => {
  it("lists every live guide with 再看一次, resets tips, skips all, links out", () => {
    act(() => root.render(h(HelpPage)));
    const listed = [...mount.querySelectorAll("[data-help-guide]")].map((e) => e.getAttribute("data-help-guide"));
    expect(listed.sort()).toEqual(guides.liveGuides("0.2.0").map((g) => g.id).sort());
    click(mount.querySelector("[data-help-skip] button"));
    expect(mount.querySelector("[data-help-guide='tip.tray']")!.getAttribute("data-seen")).toBe("true");
    click(mount.querySelector("[data-help-reset] button"));
    expect(mount.querySelector("[data-help-guide='tip.tray']")!.getAttribute("data-seen")).toBe("false");
    expect(mount.querySelector("[data-help-guide='onboarding']")!.getAttribute("data-seen")).toBe("true");
    const links = [...mount.querySelectorAll("[data-link-row]")];
    click(links.at(-1)!);
    expect(fx.external).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/github\.com\/.+\/issues$/));
  });
});

describe("cutex r258: who created an agent, and 全部跳过 shared by the owner's devices", () => {
  const rows = (html: string) => document.body.insertAdjacentHTML("beforeend", html);

  it("a Director's own agent gets the real tip on its row; it covers the tile tip", () => {
    guides.answerGuides();
    rows('<div data-row-selectable="" id="plain"><span data-avatar="dot"></span></div><div data-row-selectable="" data-created-by="director" id="dir"><span data-avatar="dot"></span></div>');
    act(() => root.render(h(FirstUseTips)));
    poll();
    expect(tip()?.getAttribute("data-first-use-tip")).toBe("tip.directorCreated");
    expect(guides.guideSeen("tip.minorAgent")).toBe(true);
  });

  it("without that record (older cutex, or an old session) the tile tip explains the tile; a known creator does not get it", () => {
    guides.answerGuides();
    rows('<div data-row-selectable="" data-created-by="owner"><span data-avatar="dot"></span></div>');
    act(() => root.render(h(FirstUseTips)));
    poll();
    expect(tip()).toBeNull();
    rows('<div data-row-selectable=""><span data-avatar="dot"></span></div>');
    poll();
    expect(tip()?.getAttribute("data-first-use-tip")).toBe("tip.minorAgent");
  });

  it("skipped through this version on another device: no question, every guide seen; 全部跳过 / 重置所有提示 write back", async () => {
    fx.features = ["guides.preferences"];
    fx.prefs = { schema: 1, skippedThrough: "0.2.0", updatedAt: "t" };
    rows('<button data-tray-item="">x</button>');
    await act(async () => root.render(h(FirstUseTips)));
    await act(async () => {});
    expect(guides.getGuides().asked).toBe(true);
    expect(guides.liveGuides("0.2.0").every((g) => g.kind === "panel" || guides.guideSeen(g.id))).toBe(true); // panel guides never prompt
    act(() => vi.advanceTimersByTime(10_000));
    expect(tip()).toBeNull();
    await act(async () => guides.resetGuides());
    expect(fx.put).toHaveBeenLastCalledWith(null);
    await act(async () => guides.skipAllGuides("0.2.0"));
    expect(fx.put).toHaveBeenLastCalledWith("0.2.0");
  });

  it("skipped through an older version: those guides count as seen, the question asks about the rest with 全部跳过 preselected", async () => {
    fx.features = ["guides.preferences"];
    fx.prefs = { schema: 1, skippedThrough: "0.1.0", updatedAt: "t" };
    rows('<button data-tray-item="">x</button>');
    await act(async () => root.render(h(FirstUseTips)));
    await act(async () => {});
    expect(guides.getGuides().asked).toBe(false);
    expect(guides.guideSeen("onboarding")).toBe(true);
    expect(guides.guideSeen("tip.tray")).toBe(false);
    act(() => vi.advanceTimersByTime(4000));
    expect(tip()?.querySelector("[data-guides-preselected]")?.getAttribute("data-guides-preselected")).toBe("skip");
  });

  it("the first question waits for the host a moment at start (an older host: it goes on without)", () => {
    rows('<button data-tray-item="">x</button>');
    act(() => root.render(h(FirstUseTips)));
    poll();
    expect(tip()).toBeNull();
    poll();
    expect(tip()?.querySelector("[data-guides-ask]")).not.toBeNull();
  });
});
