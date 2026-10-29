// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: { openExternal: vi.fn() } }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key.endsWith(".text") ? `${key} first line\nFull guide second line` : key }) }));
vi.mock("../src/renderer/src/lib/update", () => ({ useUpdateStatus: () => ({ current: { version: "0.2.0" } }) }));
vi.mock("../src/renderer/src/lib/onboarding", () => ({ openOnboarding: vi.fn(), finishOnboarding: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ openSettings: vi.fn() }) } }));
vi.mock("../src/renderer/src/components/GuidesAsk", () => ({ GuidesAskButtons: () => null }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick(): void }) => h("button", { onClick }, children),
  SettingRow: ({ label, hint, children }: { label: React.ReactNode; hint: React.ReactNode; children: React.ReactNode }) => h("div", null, label, hint, children),
  Section: ({ title, actions, children }: { title: React.ReactNode; actions: React.ReactNode; children: React.ReactNode }) => h("section", null, title, actions, children),
  SettingsGroup: ({ children }: { children: React.ReactNode }) => h("div", null, children),
  LinkRow: () => null,
}));
import { InlineGuide } from "../src/renderer/src/components/InlineGuide";
import { HelpPage } from "../src/renderer/src/modules/onboarding/HelpPage";
import { answerGuides, guideSeen, markGuideSeen, reloadGuideState, setGuidesHostPending, setGuidesHostWriter } from "../src/renderer/src/lib/guides";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  localStorage.clear(); reloadGuideState(); setGuidesHostPending(false); setGuidesHostWriter(null);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); setGuidesHostPending(false); setGuidesHostWriter(null); });

it("replays the full Profile guide in Help after a matching Profile has already completed it", () => {
  answerGuides(); markGuideSeen("inline.profile.chatgpt");
  act(() => root.render(h(InlineGuide, { id: "inline.profile.chatgpt", done: true })));
  expect(host.querySelector("[data-inline-guide]")).toBeNull();
  act(() => root.render(h(HelpPage)));
  const row = host.querySelector('[data-help-guide="inline.profile.chatgpt"]')!;
  act(() => row.querySelector<HTMLButtonElement>("button")!.click());
  const guide = row.querySelector("[data-inline-guide]")!;
  expect(guide.textContent).toContain("Full guide second line");
  expect(guide.querySelector("[data-guides-skip]")).toBeNull();
  act(() => guide.querySelector<HTMLButtonElement>('button[aria-label="onboarding.tips.dismiss"]')!.click());
  expect(row.querySelector("[data-inline-guide]")).toBeNull();
  expect(guideSeen("inline.profile.chatgpt")).toBe(true);
});

it("explicit inline replay bypasses the initial question and host wait without changing the saved seen state", () => {
  markGuideSeen("inline.profile.apiKey"); setGuidesHostPending(true);
  act(() => root.render(h(InlineGuide, { id: "inline.profile.apiKey", done: true, replay: true })));
  expect(host.textContent).toContain("onboarding.guide.profile.apiKey.text");
  expect(host.querySelector("[data-guides-ask]")).toBeNull();
  expect(guideSeen("inline.profile.apiKey")).toBe(true);
});

it("acknowledges a tip replay while its anchor is absent and updates feedback when it is shown", () => {
  answerGuides(); markGuideSeen("tip.tray");
  act(() => root.render(h(HelpPage)));
  const row = host.querySelector('[data-help-guide="tip.tray"]')!;
  act(() => row.querySelector<HTMLButtonElement>("button")!.click());
  expect(row.querySelector('[role="status"]')!.textContent).toBe("onboarding.guide.help.tipPending");
  expect(guideSeen("tip.tray")).toBe(false);
  act(() => markGuideSeen("tip.tray"));
  expect(row.querySelector('[role="status"]')!.textContent).toBe("onboarding.guide.help.tipShown");
});

it("explains local seen state and routes skip/reset through the shared choice writer", () => {
  const write = vi.fn(); setGuidesHostWriter(write);
  act(() => root.render(h(HelpPage)));
  expect(host.querySelector("[data-help-guide-scope]")!.textContent).toBe("onboarding.guide.help.scope");
  act(() => host.querySelector<HTMLButtonElement>("[data-help-skip] button")!.click());
  expect(write).toHaveBeenLastCalledWith("0.2.0");
  act(() => host.querySelector<HTMLButtonElement>("[data-help-reset] button")!.click());
  expect(write).toHaveBeenLastCalledWith(null);
});

it("lists the four panel guides apart from the tips; 打开 opens one, 已看过 once finished", async () => {
  const panels = await import("../src/renderer/src/lib/panelGuides");
  markGuideSeen(panels.panelSeenId("tray"));
  act(() => root.render(h(HelpPage)));
  const tray = host.querySelector('[data-help-guide="panel.tray"]')!;
  expect(tray.getAttribute("data-seen")).toBe("true");
  expect(tray.textContent).toContain("onboarding.panel.help.seen");
  expect(host.querySelector('[data-help-guide="panel.shelf"]')!.getAttribute("data-seen")).toBe("false");
  await act(async () => {
    host.querySelector<HTMLButtonElement>('[data-help-guide="panel.shelf"] button')!.click();
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(panels.panelGuideNow()?.request.panel).toBe("shelf");
  act(() => panels.closePanelGuide());
});
