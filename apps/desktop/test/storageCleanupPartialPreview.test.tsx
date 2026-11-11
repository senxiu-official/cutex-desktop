// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StorageCleanupPreview } from "../src/shared/storageCleanup";
const fx = vi.hoisted(() => ({ data: {} as Record<string, unknown>, english: false }));
vi.mock("../src/renderer/src/modules/storage/cleanupHooks", () => ({ useCleanup: () => fx.data }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (state: unknown) => unknown) => select({ hosts: { hosts: [{ id: "test", label: "Test host" }] } }) }));
vi.mock("../src/renderer/src/i18n", async () => {
  const { zhCN } = await import("../src/renderer/src/modules/storage/i18n");
  const { en } = await import("../src/renderer/src/modules/storage/i18n.en");
  return { useI18n: () => ({ locale: fx.english ? "en" : "zh-CN", t: (key: keyof typeof zhCN, vars: Record<string, unknown> = {}) => String((fx.english ? en : zhCN)[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? "")) }) };
});
vi.mock("../src/renderer/src/lib/time", () => ({ useNow: () => Date.now() }));
vi.mock("../src/renderer/src/lib/openOverlays", () => ({ useTrackOverlay: () => {} }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  EmptyState: ({ children }: { children: ReactNode }) => h("p", null, children), SettingRow: ({ label, hint, children }: { label?: ReactNode; hint?: ReactNode; children?: ReactNode }) => h("div", null, label, hint, children), Select: ({ value, options, onChange, label, disabled }: { value: string; options: { value: string; label: string }[]; onChange(v: string): void; label?: string; disabled?: boolean }) => h("select", { "aria-label": label, value, disabled, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }, options.map((o) => h("option", { key: o.value, value: o.value }, o.label))), 
  SettingsGroup: ({ children }: { children: ReactNode }) => children,
  Button: (props: object) => h("button", props),
  ErrorNote: ({ children }: { children: ReactNode }) => h("p", { role: "alert" }, children),
  Section: ({ title, hint, actions, children }: { title?: string; hint?: string; actions?: ReactNode; children: ReactNode }) => h("section", null, h("h2", null, title), hint && h("p", null, hint), actions, children),
}));
import { CleanupSection } from "../src/renderer/src/modules/storage/CleanupSection";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement; let root: Root;
const plan = (extra: Partial<StorageCleanupPreview> = {}): StorageCleanupPreview => ({
  previewId: "partial", action: "old-logs", risk: "medium", expiresAt: new Date(Date.now() + 600000).toISOString(), freeableBytes: 100,
  items: [{ id: "inspected", path: "logs/old.log", eligible: true, bytes: 100, files: 1, mtime: null, reason: null, code: "eligible" }], ...extra,
});
const render = () => act(() => root.render(h(CleanupSection)));
beforeEach(() => {
  fx.english = false;
  fx.data = { hostId: "test", supported: true, connected: true, allowed: true, preview: null, selected: ["inspected"], run: null, history: [], error: null, historyError: null, pending: null, loading: false, executing: false, historyLoading: false, controller: { clearPreview: vi.fn(), preview: vi.fn(), select: vi.fn(), execute: vi.fn(), retry: vi.fn(), loadHistory: vi.fn(), loadRun: vi.fn() } };
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); });

it.each(["time_budget", "item_limit", "entry_limit"] as const)("labels %s results partial before the totals, without automatic writes or retries", (partialReason) => {
  fx.data.preview = plan({ complete: false, partialReason, inspectedItems: 1, elapsedMs: 2000 }); render();
  const notice = node.querySelector<HTMLElement>("[data-cleanup-partial]")!;
  expect(notice.getAttribute("role")).toBe("status");
  expect(notice.textContent).toContain("仅检查了部分项目"); expect(notice.textContent).toContain("不是全部结果");
  expect(notice.textContent).toContain("缩小清理范围"); expect(notice.textContent).toContain("其余项目");
  expect(notice.nextElementSibling?.textContent).toContain("选中 1 项，预计释放 100 B");
  expect(node.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(false);
  expect(node.textContent).toContain("logs/old.log");
  const controller = fx.data.controller as Record<string, ReturnType<typeof vi.fn>>;
  expect(controller.execute).not.toHaveBeenCalled(); expect(controller.retry).not.toHaveBeenCalled(); expect(controller.preview).not.toHaveBeenCalled();
  const checkbox = node.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  act(() => checkbox.click()); expect(controller.select).toHaveBeenCalledWith("inspected", false);
  const remove = [...node.querySelectorAll("button")].find((b) => b.textContent?.includes("删除 1 项"))!;
  act(() => remove.click()); expect(controller.execute).not.toHaveBeenCalled();
  act(() => remove.click()); expect(controller.execute).toHaveBeenCalledOnce();
});

it.each([undefined, true])("leaves complete=%s legacy/full previews unchanged", (complete) => {
  fx.data.preview = plan(complete === undefined ? {} : { complete }); render();
  expect(node.querySelector("[data-cleanup-partial]")).toBeNull();
  expect(node.textContent).toContain("选中 1 项，预计释放 100 B");
});

it("scopes a partial empty result to the items inspected and clears the notice on replacement", () => {
  fx.data.preview = plan({ complete: false, items: [], freeableBytes: 0 }); fx.data.selected = []; render();
  expect(node.textContent).toContain("本次已检查的项目中，没有符合条件的项目。");
  const remove = [...node.querySelectorAll("button")].find((b) => b.textContent?.includes("删除 0 项"))!;
  expect(remove.disabled).toBe(true);
  fx.data.preview = plan({ previewId: "complete", complete: true }); render();
  expect(node.querySelector("[data-cleanup-partial]")).toBeNull();
  expect(node.textContent).not.toContain("本次已检查的项目中");
});

it("does not describe partial vacuum estimates as all eligible databases", () => {
  fx.english = true; fx.data.preview = plan({ action: "vacuum", complete: false }); render();
  expect(node.textContent).toContain("counts and space estimates below are partial");
  expect(node.textContent).toContain("databases inspected in this preview: 100 B");
  expect(node.textContent).not.toContain("all eligible databases");
  fx.data.preview = plan({ action: "vacuum" }); render();
  expect(node.textContent).toContain("all eligible databases: 100 B");
});
