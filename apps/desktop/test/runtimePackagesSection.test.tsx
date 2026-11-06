// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { createClaudeRuntimeBatch } from "../src/renderer/src/lib/claudeRuntimeBatch";
import type { RuntimePackageRun, RuntimePackagesView } from "../src/shared/ipc";

const fx = vi.hoisted(() => ({ locale: "zh-CN", host: {} as any, claude: [] as any[], confirm: vi.fn(), undo: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => {
  const translate = (key: string, vars: Record<string, unknown> = {}) => {
    const catalog = fx.locale === "en" ? en : zhCN;
    return ((catalog as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
  };
  return { translate, useI18n: () => ({ t: translate, locale: fx.locale }) };
});
vi.mock("../src/renderer/src/lib/runtimePackagesView", () => ({ useHostRuntimePackages: () => fx.host, useActiveHostLabel: () => "HOST-A", useOutdatedClaudeRuntimeAgents: () => fx.claude }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => "host-a" }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ confirmDialog: fx.confirm }));
vi.mock("../src/renderer/src/lib/runtimePackageStore", () => ({ revertRuntimePackageRun: fx.undo, startRuntimePackageUpgrade: vi.fn() }));
vi.mock("../src/renderer/src/lib/time", () => ({ useClock: () => 0, formatAbsolute: () => "today", formatWhen: () => "today" }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  Section: ({ children }: any) => h("section", null, children),
  Button: ({ children, primary: _primary, ...props }: any) => h("button", props, children),
  SettingsGroup: ({ children }: any) => h("div", null, children),
  ErrorNote: ({ children }: any) => h("p", null, children), Loading: () => null,
}));
import { RuntimePackagesSection } from "../src/renderer/src/components/settings/RuntimePackagesSection";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root;
beforeEach(() => {
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  fx.locale = "zh-CN"; fx.claude = []; fx.confirm.mockReset().mockResolvedValue(true); fx.undo.mockReset();
  fx.host = { starting: false, view: { selected: { nativeVersion: "0.160.0-r58", readable: true }, agents: [], activeRun: null, lastRun: null } as unknown as RuntimePackagesView };
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });

it.each(["zh-CN", "en"])("shows a selected version when all agents are current, and omits an unavailable target (%s)", async locale => {
  fx.locale = locale;
  await act(async () => root.render(h(RuntimePackagesSection)));
  expect(node.textContent).toContain("0.160.0-r58");
  expect(node.textContent).toContain(locale === "en" ? "non-archived" : "未归档");
  fx.host.view.selected = null;
  await act(async () => root.render(h(RuntimePackagesSection)));
  expect(node.textContent).not.toContain(locale === "en" ? "unknown version" : "版本未知");
  expect(node.textContent).not.toContain("0.160.0-r58");
});

it.each(["native", "claude", "mixed"])("labels the actual outdated targets for %s", async kind => {
  if (kind !== "claude") fx.host.view.agents = [{ cutexSessionId: "codex", busy: false }];
  if (kind !== "native") fx.claude = [{ cutexSessionId: "claude", busy: false, target: "claude-r34" }];
  await act(async () => root.render(h(RuntimePackagesSection)));
  expect(node.textContent).toContain("未归档");
  expect(node.textContent?.includes("0.160.0-r58")).toBe(kind !== "claude");
  expect(node.textContent?.includes("claude-r34")).toBe(kind !== "native");
});

it.each(["zh-CN", "en"])("shows family subtotals and confirms only the native undo count and run (%s)", async locale => {
  fx.locale = locale;
  const native = { runId: "native-run", kind: "upgrade", state: "completed", startedAt: "2026-11-05T00:00:00Z", finishedAt: "2026-11-05T00:01:00Z", counts: { total: 113, pending: 0, moved: 112, skipped: 0, failed: 1 }, items: [], revertedBy: [] } as unknown as RuntimePackageRun;
  const claude = createClaudeRuntimeBatch([], native.runId);
  claude.run = { ...claude.run, state: "completed", counts: { total: 47, pending: 0, moved: 47, skipped: 0, failed: 0 } };
  native.items = Array.from({ length: 113 }, (_, i) => ({ cutexSessionId: `native-${i}`, name: `Codex ${i}`, state: i < 112 ? "moved" : "failed", code: i < 112 ? null : "reviewRefused", reason: null }) as RuntimePackageRun["items"][number]);
  claude.run.items = Array.from({ length: 47 }, (_, i) => ({ cutexSessionId: `claude-${i}`, name: `Claude ${i}`, state: "moved" }) as RuntimePackageRun["items"][number]);
  fx.host.view.lastRun = native;
  fx.host.view.revertable = { runId: native.runId, agentIds: Array.from({ length: 112 }, (_, i) => `a${i}`) };
  fx.host.claudeBatch = claude;
  await act(async () => root.render(h(RuntimePackagesSection)));
  expect(node.textContent).toContain("Codex 112/113 · Claude 47/47");
  expect(node.textContent).toContain("159");
  expect(node.textContent).toContain(locale === "en" ? "Undo restores only" : "撤销只会");
  const undo = [...node.querySelectorAll("button")].find(b => b.textContent === (locale === "en" ? "Revert this upgrade" : "撤销这次升级"))!;
  await act(async () => undo.click());
  expect(fx.confirm.mock.calls[0]?.[0]).toContain("112");
  expect(fx.confirm.mock.calls[0]?.[0]).not.toContain("159");
  expect(fx.undo).toHaveBeenCalledWith("native-run", "host-a");
});
