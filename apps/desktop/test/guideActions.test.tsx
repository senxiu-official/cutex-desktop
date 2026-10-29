// @vitest-environment jsdom
// Every action button of the onboarding flow, the 新功能 cards, the guide tips and 帮助 (lib/guideActions, owner
// 2026-10-24): each id resolves to a real app command and running it has the real effect — the Settings Shelf
// on that page, the conversation's Shelf on screen (a first empty page when it has none). A precondition is run
// first (no conversation: the last one opens) or the button is disabled with the reason, never a silent no-op;
// the flow steps aside and 「回到引导」 brings it back at the same card.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "zh-CN" }),
  translate: (key: string) => key,
}));
const ctx = { hostId: "local", sessionId: "eva", workspaceKey: null, available: () => true };
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideView: () => ctx,
  sideViewNow: () => ctx,
  useSideRegistry: () => new Map(),
  sideRegistry: () => new Map(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SessionResource } from "@cutex-desktop/protocol";
import { MODULES } from "../src/renderer/src/modules/registry";
import { GUIDES } from "../src/renderer/src/lib/guides";
import { NEW_FEATURES } from "../src/renderer/src/modules/onboarding/features";
import { GUIDE_ACTIONS, guideActionBlocked, runGuideAction, settingsAction, type GuideAction } from "../src/renderer/src/lib/guideActions";
import { liveShelfState } from "../src/renderer/src/lib/convPaneControls";
import { collapseShelf, emptyLayout, shelvesOf } from "../src/renderer/src/lib/sideLayout";
import { updateLayout, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { useSettingsShelf, closeSettingsShelf } from "../src/renderer/src/lib/settingsShelf";
import { closeOnboarding, getOnboarding, openOnboarding, useOnboardingView } from "../src/renderer/src/lib/onboarding";
import { useApp } from "../src/renderer/src/store";
import { OnboardingHost } from "../src/renderer/src/components/OnboardingDialog";

const session = (id: string) => ({ cutexSessionId: id, displayName: id, formalAgentName: id, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "/w", lifecycle: "active" }) as unknown as SessionResource;
const settingsPages = new Set(MODULES.flatMap((m) => ((m.contributes as Record<string, { page: string }[] | undefined>)["settings.page"] ?? []).map((p) => p.page)));
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

/** Every action the UI can press (the flow / 新版本 / 帮助 ids, each tip's and 新功能 card's settings page). */
const ALL: [string, GuideAction][] = [
  ...Object.entries(GUIDE_ACTIONS),
  ...GUIDES.filter((g) => g.settings).map((g): [string, GuideAction] => [`${g.id} → settings`, settingsAction(g.settings!)]),
  ...NEW_FEATURES.filter((f) => f.page).map((f): [string, GuideAction] => [`feature ${f.id}`, settingsAction(f.page!)]),
];

beforeEach(() => {
  localStorage.clear();
  closeSettingsShelf();
  closeOnboarding(null);
  useApp.setState({ hosts: null, selectedId: "eva", selectedHost: "local", view: { kind: "conversation" }, sidebar: { active: [session("eva")], retired: [], hostRows: {}, projects: null } as never });
  useSide.setState({ scope: null, layout: emptyLayout(), mode: null });
});

describe("the registry", () => {
  it("every settings action names a page some module registers (Settings can show it)", () => {
    const settings = ALL.filter(([, a]) => a.kind === "settings");
    expect(settings.length).toBeGreaterThan(10);
    for (const [id, a] of settings) expect(settingsPages.has((a as { tab: string }).tab), `${id} → ${(a as { tab: string }).tab}`).toBe(true);
  });

  it("every settings action opens the Settings Shelf on its page (the command Settings' nav and ⌘K use)", async () => {
    for (const [id, a] of ALL.filter(([, x]) => x.kind === "settings")) {
      closeSettingsShelf();
      expect(await runGuideAction(a), id).toBe(true);
      const shelf = useSettingsShelf.getState();
      expect(shelf.open, id).toBe(true);
      expect(shelf.params.tab, id).toBe((a as { tab: string }).tab);
    }
    await runGuideAction(GUIDE_ACTIONS["profile.add"]);
    expect(useSettingsShelf.getState().params).toMatchObject({ tab: "profiles", create: "1" });
  });
});

describe("打开 Shelf (tour.pages)", () => {
  const shelf = () => liveShelfState(useSide.getState().layout, ctx);

  it("no page yet: a first, empty page with the launchers, on screen", async () => {
    expect(shelf()).toBe("empty");
    expect(await runGuideAction(GUIDE_ACTIONS["tour.pages"])).toBe(true);
    expect(shelf()).toBe("expanded");
    const { layout } = useSide.getState();
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]).toMatchObject({ cards: [], launcher: true });
  });

  it("folded to its rail (or the tool area closed): expanded again", async () => {
    await runGuideAction(GUIDE_ACTIONS["tour.pages"]);
    updateLayout((l) => ({ ...shelvesOf(l).reduce((acc, x) => collapseShelf(acc, x.id), l), pages: l.pages.map((p) => ({ ...p, kept: true })) }));
    expect(shelf()).toBe("folded");
    await runGuideAction(GUIDE_ACTIONS["tour.pages"]);
    expect(shelf()).toBe("expanded");
  });

  it("on another page (not a conversation): back to the conversation first", async () => {
    useApp.setState({ view: { kind: "page", page: "projects.page" as never, params: {} } });
    const select = vi.spyOn(useApp.getState(), "select").mockImplementation(async () => void useApp.setState({ view: { kind: "conversation" } }));
    await runGuideAction(GUIDE_ACTIONS["tour.pages"]);
    expect(select).toHaveBeenCalledWith("eva", "local");
    expect(useApp.getState().view.kind).toBe("conversation");
    expect(shelf()).toBe("expanded");
    select.mockRestore();
  });

  it("no agent at all: disabled with the reason, nothing runs", async () => {
    useApp.setState({ selectedId: null, selectedHost: null, sidebar: { active: [], retired: [], hostRows: {}, projects: null } as never });
    expect(guideActionBlocked(GUIDE_ACTIONS["tour.pages"])).toBe("onboarding.action.needsAgent");
    expect(await runGuideAction(GUIDE_ACTIONS["tour.pages"])).toBe(false);
    expect(useSide.getState().layout.pages).toHaveLength(0);
  });
});

describe("the flow steps aside and comes back", () => {
  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const q = (sel: string) => document.querySelector<HTMLElement>(sel);
  let view: ReturnType<typeof useOnboardingView> = null;
  function Probe() {
    view = useOnboardingView();
    return null;
  }

  it("试一试：打开Shelf closes the flow, opens the Shelf, and 「回到引导」 reopens the same card", async () => {
    act(() => root.render(h("div", null, h(OnboardingHost), h(Probe))));
    act(() => openOnboarding({ kind: "whatsNew", version: "0.2.0" }));
    for (let i = 0; i < 12 && !q("[data-tour-try=pages]"); i++) act(() => q("[data-onboarding]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    const button = q("[data-tour-try=pages] button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    act(() => button.click());
    await tick();
    expect(view).toBeNull();
    expect(q("[data-onboarding]")).toBeNull();
    expect(liveShelfState(useSide.getState().layout, ctx)).toBe("expanded");
    expect(getOnboarding().lastWhatsNew).toBe("0.2.0");
    expect(q("[data-onboarding-aside]")?.dataset.onboardingAside).toBe("pages");
    act(() => q("[data-onboarding-resume]")!.click());
    expect(q("[data-onboarding]")?.dataset.onboardingStep).toBe("pages");
    expect(q("[data-onboarding-aside]")).toBeNull();
  });

  it("without any agent the button is disabled and says why", () => {
    useApp.setState({ selectedId: null, selectedHost: null, sidebar: { active: [], retired: [], hostRows: {}, projects: null } as never });
    act(() => root.render(h(OnboardingHost)));
    act(() => openOnboarding({ kind: "whatsNew", version: "0.2.0" }));
    for (let i = 0; i < 12 && !q("[data-tour-try=pages]"); i++) act(() => q("[data-onboarding]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect((q("[data-tour-try=pages] button") as HTMLButtonElement).disabled).toBe(true);
    expect(q("[data-tour-try=pages] [data-guide-action-blocked]")?.textContent).toBe("onboarding.action.needsAgent");
  });
});

describe("one place to replay guides (Director 2026-10-24)", () => {
  it("Settings → 关于 keeps the summary switch and links to 帮助; it has no replay buttons of its own", async () => {
    const { OnboardingSection } = await import("../src/renderer/src/modules/onboarding/OnboardingSection");
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    act(() => root.render(h(OnboardingSection)));
    const labels = [...div.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toContain("onboarding.helpLink.open");
    expect(labels).not.toContain("onboarding.replayIntro");
    expect(labels.some((l) => l?.startsWith("onboarding.tour.replay"))).toBe(false);
    act(() => [...div.querySelectorAll("button")].find((b) => b.textContent === "onboarding.helpLink.open")!.click());
    expect(useSettingsShelf.getState().params.tab).toBe("help");
    act(() => root.unmount());
    div.remove();
  });

  it("the 拟人头像 option carries the quiet line on how the faces were made", async () => {
    const { PortraitChoice } = await import("../src/renderer/src/components/FirstChoices");
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    act(() => root.render(h(PortraitChoice, { answer: { use: null, themes: [] }, onAnswer: () => {}, all: [] })));
    expect(div.querySelector("[data-portrait-ai-note]")?.textContent).toBe("onboarding.tour.portraits.aiNote");
    act(() => root.unmount());
    div.remove();
  });
});
