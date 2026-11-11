// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageCleanupPreview } from "../src/shared/storageCleanup";
const fx = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../src/renderer/src/modules/storage/cleanupHooks", () => ({ useCleanup: () => fx.data }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (state: unknown) => unknown) => select({ hosts: { hosts: [{ id: "test", label: "Test host" }] } }) }));
vi.mock("../src/renderer/src/i18n", async () => { const { zhCN } = await import("../src/renderer/src/modules/storage/i18n"); return { useI18n: () => ({ locale: "zh-CN", t: (key: keyof typeof zhCN, vars: Record<string, unknown> = {}) => String(zhCN[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? "")) }) }; });
vi.mock("../src/renderer/src/lib/time", () => ({ useNow: () => Date.now() }));
vi.mock("../src/renderer/src/lib/openOverlays", () => ({ useTrackOverlay: () => {} }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({EmptyState: ({ children }: { children: React.ReactNode }) => h("p", null, children), SettingRow: ({ label, hint, children }: { label?: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode }) => h("div", null, label, hint, children), Select: ({ value, options, onChange, label, disabled }: { value: string; options: { value: string; label: string }[]; onChange(v: string): void; label?: string; disabled?: boolean }) => h("select", { "aria-label": label, value, disabled, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }, options.map((o) => h("option", { key: o.value, value: o.value }, o.label))), SettingsGroup: ({ children }: any) => children, SettingsEffectCard: ({ children }: any) => children,  Button: (props: object) => h("button", props), ErrorNote: ({ children }: { children: React.ReactNode }) => h("p", { role: "alert" }, children), Section: ({ title, hint, actions, children }: { title?: string; hint?: string; actions?: React.ReactNode; children: React.ReactNode }) => h("section", null, h("h2", null, title), hint && h("p", null, hint), actions, children) }));
const { CleanupSection } = await import("../src/renderer/src/modules/storage/CleanupSection");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
let unmount = () => {};
beforeEach(() => { fx.data = { hostId: "test", supported: true, connected: true, allowed: true, preview: null, selected: [], run: null, history: [], error: null, historyError: null, pending: null, loading: false, executing: false, historyLoading: false, controller: { clearPreview: vi.fn(), preview: vi.fn(), select: vi.fn(), execute: vi.fn(), retry: vi.fn(), loadHistory: vi.fn(), loadRun: vi.fn() } }; });
afterEach(() => { unmount(); document.body.innerHTML = ""; vi.useRealTimers(); });
function mount() { const node = document.createElement("div"); document.body.append(node); const root = createRoot(node); const render = () => act(() => root.render(h(CleanupSection))); render(); unmount = () => act(() => root.unmount()); return { node, render }; }
function plan(action: StorageCleanupPreview["action"]): StorageCleanupPreview { return { previewId: "preview", action, risk: ["old-logs", "vacuum"].includes(action) ? "medium" : "high", expiresAt: new Date(Date.now() + 600000).toISOString(), freeableBytes: 10, items: [{ id: "a", path: "backups/a", eligible: true, bytes: 10, files: 1, mtime: null, reason: "old", code: null }] }; }
const button = (text: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === text)!;
describe("storage cleanup confirmation surfaces", () => {
  it("shows each preview before execution and requires exact typed high-risk confirmation", () => {
    fx.data.preview = plan("retired-homes"); fx.data.selected = ["a"]; const { render } = mount();
    expect(document.body.textContent).toContain("backups/a"); expect(document.body.textContent).toContain("预计释放 10 B");
    act(() => button("确认清理").click()); expect(document.querySelector("dialog[open]")).not.toBeNull(); expect(document.body.textContent).toContain("仍能恢复");
    const execute = (fx.data.controller as { execute: ReturnType<typeof vi.fn> }).execute;
    const submit = () => document.querySelector<HTMLButtonElement>("dialog button:last-child")!;
    expect(submit().disabled).toBe(true); expect(execute).not.toHaveBeenCalled();
    const input = document.querySelector<HTMLInputElement>("dialog input")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "删除"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    // React's change handler is exercised through its controlled input event path.
    if (submit().disabled) act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(submit().disabled).toBe(false); act(() => submit().click()); expect(execute).toHaveBeenCalledWith("删除");
    act(() => button("确认清理").click()); fx.data.allowed = false; render(); expect(document.querySelector("dialog")).toBeNull();
  });
  it("medium vacuum uses two explicit clicks and does not ask to delete records", () => {
    vi.useFakeTimers(); fx.data.preview = plan("vacuum"); fx.data.selected = ["a"]; mount();
    const execute = (fx.data.controller as { execute: ReturnType<typeof vi.fn> }).execute;
    act(() => button("压缩 1 个数据库").click()); expect(execute).not.toHaveBeenCalled(); expect(document.querySelector(".armed-countdown")).not.toBeNull();
    act(() => button("再左键点击一次：压缩 1 个数据库").click()); expect(execute).toHaveBeenCalledOnce(); expect(document.querySelector("dialog")).toBeNull();
  });
  it("hides unsupported actions, respects owner admission, and reports changed data as skipped", () => {
    fx.data.supported = false; const { node, render } = mount(); expect(node.textContent).toBe("");
    fx.data.supported = true; fx.data.allowed = false; fx.data.run = { runId: "run", state: "completed", freedBytes: 0, items: [{ id: "a", path: "a", state: "deleted", outcome: "deleted", freedBytes: 0, reason: "changed", code: "changed", retainedPath: "runtime/storage/trash/a" }] }; render();
    expect(button("预览清理")).toBeUndefined(); expect(node.querySelector('[data-cleanup-outcome="skipped"]')).not.toBeNull(); expect(node.textContent).toContain("保留原数据"); expect(node.textContent).toContain("runtime/storage/trash/a");
  });
  it("shows durable worker pause reasons in both the selected result and history, then clears recovered errors", () => {
    const paused = { runId: "paused", state: "running", freedBytes: 0, items: [], error: "cleanup paused: busy root state" };
    fx.data.run = paused; fx.data.history = [paused]; const { node, render } = mount();
    expect(node.querySelector('[role="alert"]')?.textContent).toContain(paused.error);
    expect(node.textContent?.split(paused.error).length).toBe(3);
    const recovered = { ...paused, error: undefined, state: "completed" }; fx.data.run = recovered; fx.data.history = [recovered]; render();
    expect(node.querySelector('[role="alert"]')).toBeNull(); expect(node.textContent).not.toContain(paused.error);
  });

});
