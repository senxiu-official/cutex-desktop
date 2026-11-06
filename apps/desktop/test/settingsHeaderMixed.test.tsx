// @vitest-environment jsdom
// Settings page header on a host page whose rows live in several places and take effect at different times
// (owner screenshot 2026-10-26: 「[混合设置][● remote ⌄] [混合设置]」). The scope chip says 混合设置 once; the timing
// chip says its own thing (生效时机不同), and a multi-place scope keeps the host picker.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (value: string) => value }));
vi.mock("../src/renderer/src/i18n", async () => {
  const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
  const t = (key: string) => (zhCN as Record<string, string>)[key]?.replace(/\{\{agent\}\}/g, "智能体") ?? key;
  return { useI18n: () => ({ t, locale: "zh-CN" }) };
});
vi.mock("../src/renderer/src/lib/targetHost", async original => ({ ...(await original<object>()), useTargetHostId: () => "remote" }));
vi.mock("../src/renderer/src/store", () => {
  const state = { hosts: { active: "remote", hosts: [{ id: "remote", label: "remote" }] }, daemon: { kind: "disconnected" } };
  return { useApp: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) };
});
import { Section, SettingsPage, SettingRow } from "../src/renderer/src/components/settings/Form";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";
import { zhHantTW } from "../src/renderer/src/i18n/zh-Hant-TW";
import { zhHantHK } from "../src/renderer/src/i18n/zh-Hant-HK";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const picker = h("button", { type: "button", "data-test-picker": "" }, "● remote");
const header = () => host.querySelector("[data-settings-scope]")!;
const count = (text: string) => header().textContent!.split(text).length - 1;

it("a host page with mixed places and mixed timing says 混合设置 once, next to the picker", () => {
  act(() => root.render(h(SettingsPage, { host: picker, children: h(Section, { title: "Card", children: [
    h(SettingRow, { key: "a", label: "A", agents: "now", source: "host" }),
    h(SettingRow, { key: "b", label: "B", agents: "next", source: "codex" }),
  ] }) })));
  expect(header().getAttribute("data-settings-scope")).toBe("mixed");
  expect(count(zhCN["settings.scope.mixedTag"])).toBe(1);
  expect(header().querySelector('[data-settings-agents="mixed"]')?.textContent).toBe("生效时机不同");
  expect(header().querySelectorAll("[data-test-picker]")).toHaveLength(1);
});

it("a multi-place scope keeps the host picker and never falls back to 混合设置", () => {
  act(() => root.render(h(SettingsPage, { host: picker, children: h(SettingRow, { label: "A", agents: "now", source: ["host", "codex"] }) })));
  expect(header().getAttribute("data-settings-scope")).toBe("codex:remote|host:remote");
  expect(header().querySelectorAll("[data-test-picker]")).toHaveLength(1);
  expect(count(zhCN["settings.scope.mixedTag"])).toBe(0);
});

it("a local + host page: local first, then the host place as the picker's left half", () => {
  act(() => root.render(h(SettingsPage, { host: picker, children: h(SettingRow, { label: "A", agents: "none", source: ["local", "host"] }) })));
  const marker = header().querySelector("[data-effect-scope-marker]")!;
  const texts = [...marker.querySelectorAll("button")].map(button => button.textContent);
  expect(texts).toEqual([zhCN["settings.scope.local.label"], `${zhCN["settings.scope.host.short"]} ·`, "● remote"]);
});

it("the mixed-timing chip never reads like the mixed-scope chip in any catalog", () => {
  for (const catalog of [zhCN, en, zhHantCN, zhHantTW, zhHantHK] as Partial<Record<string, string>>[]) {
    const short = catalog["settings.scope.agents.mixed.short"];
    if (short === undefined) continue;
    expect(short).not.toBe(catalog["settings.scope.mixedTag"]);
    expect(short).not.toMatch(/混合|mixed/i);
  }
});

it("the shared header keeps the title, purpose and scope before the related-page action", () => {
  act(() => root.render(h(SettingsPage, { page: "runtime", title: "Runtime", hint: "Manage installed runtimes.", host: picker,
    link: h("button", { type: "button" }, "Updates"), children: h(SettingRow, { label: "A", agents: "now", source: "host" }) })));
  const pageHeader = host.querySelector("[data-settings-header]")!;
  expect(pageHeader.querySelector("h1")?.textContent).toBe("Runtime");
  expect(pageHeader.querySelector("p")?.textContent).toBe("Manage installed runtimes.");
  const actions = pageHeader.querySelector("[data-settings-header-actions]")!;
  expect(header().parentElement).toBe(actions.parentElement);
  expect(header().nextElementSibling).toBe(actions);
  expect(actions.textContent).toBe("Updates");
});
