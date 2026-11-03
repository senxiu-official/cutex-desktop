// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readHostServiceInfo } from "@cutex-desktop/cutex-client";
import type { HostServiceInfo } from "../src/shared/backendUpgrade";

const fx = vi.hoisted(() => ({ locale: "zh-CN", info: null as HostServiceInfo | null }));
vi.mock("../src/renderer/src/i18n", async () => {
  const { zhCN } = await import("../src/renderer/src/modules/runtimes/i18n");
  const { en } = await import("../src/renderer/src/modules/runtimes/i18n.en");
  return { useI18n: () => ({ locale: fx.locale, t: (key: string) => {
    const catalog: Record<string, string> = fx.locale === "en" ? en : zhCN;
    return catalog[key] ?? key;
  } }) };
});
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => "host-a", useTargetApi: () => ({}) }));
vi.mock("../src/renderer/src/lib/settingsNav", () => ({ settingsAnchorId: (key: string) => key, cutexBuildText: () => "r268" }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ confirmDialog: vi.fn() }));
vi.mock("../src/renderer/src/modules/backend-upgrade/hooks", () => ({ useHostServiceInfo: () => fx.info, useUpgradeAction: () => ({ busy: false, error: null }) }));
vi.mock("../src/renderer/src/modules/backend-upgrade/store", () => ({
  useHostUpgrade: () => ({ connected: true, supported: true, installedNotes: false, runs: [], status: {
    managed: false, build: {}, installed: { release: "r268" }, installedReleases: [],
  } }), loadUpgradeRuns: vi.fn(), loadUpgradeStatus: vi.fn(), putUpgradeStatus: vi.fn(),
}));
vi.mock("../src/renderer/src/modules/backend-upgrade/RunView", () => ({ CommandLine: () => null, HistorySection: () => null, RunNote: () => null, RunSection: () => null, When: () => null }));
vi.mock("../src/renderer/src/components/settings/Form", () => {
  const body = ({ children }: any) => h("div", null, children);
  return {
    Section: body, SettingRow: ({ label, children }: any) => h("div", { "data-row": label }, children),
    Button: body, EmptyState: body, ErrorNote: body, Loading: body, Notice: body,
    NumberField: body, Segmented: body, Select: body, TextInput: body, Toggle: body,
  };
});
import { BackendUpgradePage } from "../src/renderer/src/modules/backend-upgrade/BackendUpgradePage";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root;
beforeEach(() => { node = document.createElement("div"); document.body.append(node); root = createRoot(node); fx.locale = "zh-CN"; });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
async function summary(native: Record<string, unknown>, claude: string | null = "claude-r32"): Promise<string> {
  fx.info = readHostServiceInfo({ runtimes: { native, claude: { selected: claude } } });
  await act(async () => root.render(h(BackendUpgradePage)));
  return node.querySelector('[data-row="backend-upgrade.status.runtimes"]')!.textContent!;
}
it.each(["zh-CN", "en"])("shows the actual unregistered native SHA without substituting latest (%s)", async (locale) => {
  fx.locale = locale;
  expect(await summary({ selected: null, selectedSha256Prefix: "dddddddddddd", latest: "0.160.0-r58", inUse: [] }))
    .toBe(`${locale === "en" ? "Unknown version" : "未知版本"} · dddddddddddd · claude-r32`);
});
it("keeps registered selections unchanged even when their actual SHA is present", async () => {
  expect(await summary({ selected: "0.160.0-r58", selectedSha256Prefix: "dddddddddddd", latest: "0.160.0-r59" }))
    .toBe("0.160.0-r58 · claude-r32");
});
it("tolerates older peers without SHA metadata", async () => {
  expect(await summary({ selected: "r58", latest: "r59" })).toBe("r58 · claude-r32");
});
it.each([{}, { selected: null, selectedSha256Prefix: null, latest: "r58" }])("distinguishes no deployment from an unknown selected build (%j)", async (native) => {
  expect(await summary(native)).toBe("未安装或未设置默认版本 · claude-r32");
});
it("tolerates a host without runtime metadata", async () => {
  fx.info = readHostServiceInfo({});
  await act(async () => root.render(h(BackendUpgradePage)));
  expect(node.querySelector('[data-row="backend-upgrade.status.runtimes"]')).toBeNull();
});
