// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
const fx = vi.hoisted(() => ({ locale: "zh-CN", request: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (v: string) => v }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => (fx.locale === "en" ? en : zhCN)[key as keyof typeof en] ?? key, locale: fx.locale }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetApi: () => ({ codexRequest: fx.request }), useTargetFeatures: () => new Set(["codex-plugins"]) }));
vi.mock("../src/renderer/src/components/settings/FollowShared", () => ({ FollowSharedSection: () => null }));
vi.mock("../src/renderer/src/components/settings/Form", async original => {
  const actual = await original<Record<string, unknown>>();
  return { ...actual,
    Section: ({ children }: { children: React.ReactNode }) => h("section", null, children),
    SettingsGroup: ({ children }: { children: React.ReactNode }) => h("div", null, children),
    SettingRow: ({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }) => h("div", { "data-row": label }, h("span", null, label), h("p", null, hint), children),
  };
});
const { PluginsPage } = await import("../src/renderer/src/components/settings/PluginsSettings");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const names = ["browser", "codex-app-tools", "computer-use", "unified-computer-use", "visualize", "portable"];
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
let payload: { marketplaces: { name: string; path: null; interface: null; plugins: { name: string; enabled: boolean }[] }[] };
beforeEach(() => {
  fx.locale = "zh-CN"; fx.request.mockReset();
  payload = { marketplaces: [{ name: "openai-bundled", path: null, interface: null, plugins: names.map(name => ({ name, id: name + "@openai-bundled", enabled: true, installed: true, availability: "AVAILABLE", disabledReason: null, installPolicy: "AVAILABLE", source: { type: "local", path: "/plugins/" + name }, interface: null, keywords: [] })) }] };
  fx.request.mockImplementation(async (method: string) => method === "plugin/list" ? payload : { config: {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
it.each(["zh-CN", "en"])("shows unavailable toggles off in %s while preserving native config", async locale => {
  fx.locale = locale;
  await act(async () => root.render(h(PluginsPage)));
  for (const name of names.slice(0, 5)) {
    const row = host.querySelector(`[data-row="${name}"]`)!;
    const toggle = row.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(row.textContent).toContain(locale === "en" ? "Requires the official OpenAI app; not available in cutex" : "需要 OpenAI 官方应用，cutex 下不可用");
    act(() => toggle.click());
  }
  expect(fx.request.mock.calls.some(([method]) => method === "config/value/write")).toBe(false);
  expect(payload.marketplaces[0]!.plugins.every(plugin => plugin.enabled)).toBe(true);
  const portable = host.querySelector<HTMLButtonElement>('[data-row="portable"] [role="switch"]')!;
  expect(portable.disabled).toBe(false);
  expect(portable.getAttribute("aria-checked")).toBe("true");
  await act(async () => portable.click());
  expect(fx.request).toHaveBeenCalledWith("config/value/write", { keyPath: 'plugins."portable@openai-bundled"', value: { enabled: false }, mergeStrategy: "upsert" });
});
