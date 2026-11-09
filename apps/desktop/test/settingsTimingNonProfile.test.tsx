// @vitest-environment jsdom
// Page summaries and row timing of non-Profile settings: 通知 → owner_notify and 对话 → 侧边对话 / 记为批注.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OwnerNotifySettings } from "@cutex-desktop/protocol";

const features = vi.hoisted(() => ({ value: new Set<string>() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (value: string) => value }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/lib/targetHost", async original => ({
  ...(await original<object>()),
  useTargetHostId: () => "local", useTargetApi: () => ({ patchOwnerNotify: vi.fn() }), useTargetFeatures: () => features.value, useTargetSidebar: () => null,
}));
vi.mock("../src/renderer/src/lib/notificationLevelsStore", () => ({ useNotificationLevels: () => ({ view: null }) }));
vi.mock("../src/renderer/src/modules/react", () => ({ useModulePref: (_id: string, _key: string, fallback: unknown) => [fallback, () => {}] }));
vi.mock("../src/renderer/src/store", () => {
  const state = { hosts: { active: "local", hosts: [{ id: "local", label: "Local" }] }, daemon: { kind: "disconnected" } };
  return { useApp: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) };
});
import { SettingsPage } from "../src/renderer/src/components/settings/Form";
import { OwnerNotifySection } from "../src/renderer/src/components/settings/OwnerNotifySettings";
import { SideChatSettings, SideSummarySettings } from "../src/renderer/src/modules/side-chat/SideSettings";
import { NOTIFICATION_LEVELS_FEATURE, NOTIFICATION_PRESETS_NO_LEGACY_FEATURE } from "../src/shared/notificationLevels";
import type { GlobalSettings } from "../src/shared/ipc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const chips = (element: Element) => [...element.querySelectorAll("button[data-settings-agents]")].map((button) => button.getAttribute("aria-label"));
const header = () => [...host.querySelectorAll('button[data-timing-presentation="header"]')].map((button) => button.getAttribute("aria-label"));
const row = (label: string) => [...host.querySelectorAll("[data-setting-row]")].find((element) => element.textContent?.startsWith(label))!;
const ownerNotify = (): OwnerNotifySettings => ({
  delivery: { info: ["desktop"], attention: ["desktop", "phone"], urgent: ["desktop", "phone", "bigAlert"] },
  deliveryDefault: { info: ["desktop"], attention: ["desktop", "phone"], urgent: ["desktop", "phone", "bigAlert"] },
  bigAlertSound: true, toolAudience: "ownerFacing", rateLimit: { perHour: 12, urgentPerHour: 3 }, agentOverrides: {}, phonePaired: false,
});
const render = (node: ReturnType<typeof h>) => act(() => root.render(h(SettingsPage, { children: node })));
const noCardLabels = () => expect(host.querySelector('section button[data-timing-presentation="header"]')).toBeNull();

it("owner_notify: call-time limits now, audience off now / on next, the page says mixed", () => {
  features.value = new Set([NOTIFICATION_LEVELS_FEATURE, NOTIFICATION_PRESETS_NO_LEGACY_FEATURE]);
  render(h(OwnerNotifySection, { settings: { ownerNotify: ownerNotify() } as unknown as GlobalSettings, onSettings: () => {} }));
  expect(chips(row("owner-notify.audience"))).toEqual(["settings.scope.agents.offNowOnNext"]);
  expect(chips(row("owner-notify.perHour"))).toEqual(["settings.scope.agents.now"]);
  expect(chips(row("owner-notify.urgentPerHour"))).toEqual(["settings.scope.agents.now"]);
  expect(header()).toEqual(["settings.scope.agents.mixed"]);
  noCardLabels();
  expect(host.querySelector("table")).toBeNull();
});

it("owner_notify on an older host: the delivery matrix and sound are display-only, one icon for the matrix", () => {
  features.value = new Set();
  render(h(OwnerNotifySection, { settings: { ownerNotify: ownerNotify() } as unknown as GlobalSettings, onSettings: () => {} }));
  const matrix = host.querySelector("table")!.parentElement!;
  expect(chips(matrix)).toEqual([]);
  expect(chips(host.querySelector("table")!)).toEqual([]);
  expect(chips(row("owner-notify.sound"))).toEqual([]);
  expect(chips(row("owner-notify.audience"))).toEqual(["settings.scope.agents.offNowOnNext"]);
  expect(chips(row("owner-notify.perHour"))).toEqual(["settings.scope.agents.now"]);
  expect(header()).toEqual(["settings.scope.agents.mixed"]);
  noCardLabels();
});

it("side chat: uniform next-start timing appears once at page level", () => {
  render(h(SideChatSettings));
  expect(header()).toEqual(["settings.scope.agents.next"]);
  expect(chips(row("side-chat.scopeSetting"))).toEqual([]);
  noCardLabels();
});

it("notes: owner-private metadata (none), the prompt reaches the side-chat model at the next note (now)", () => {
  render(h(SideSummarySettings));
  expect(chips(row("side-chat.anchorSetting"))).toEqual([]);
  expect(chips(row("side-chat.summaryPrompt"))).toEqual(["settings.scope.agents.now"]);
  expect(header()).toEqual(["settings.scope.agents.mixed"]);
  noCardLabels();
});
