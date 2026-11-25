// @vitest-environment jsdom
// Storage → 手动清理 → Native 临时文件 (cutex storage/stock-tmp-reclaim): offered only where the host's inventory lists the
// stock-tmp store; each candidate shows its agent and launch generation; held / replaced / unknown-ownership rows are
// listed but cannot be selected, with the reason; execution is high risk (typed 删除, the cleanup picker's dialog).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store double is too thin for the avatar stack (agent looks, Profile pictures): icons are stubbed.
vi.mock("../src/renderer/src/components/EntityIcon", () => import("./helpers/entityIconStub"));

const fx = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../src/renderer/src/modules/storage/cleanupHooks", () => ({ useCleanup: () => fx.data }));
vi.mock("../src/renderer/src/store", () => {
  const state = { hosts: { hosts: [{ id: "test", label: "Test host" }] } };
  const sidebar = { active: [{ cutexSessionId: "kai", displayName: "Kai" }], retired: [{ cutexSessionId: "sora", displayName: "Sora（已归档）" }] };
  return { useApp: (select: (s: unknown) => unknown) => select(state), sidebarOf: (_s: unknown, hostId: string) => (hostId === "test" ? sidebar : null) };
});
vi.mock("../src/renderer/src/i18n", async () => {
  const { zhCN } = await import("../src/renderer/src/modules/storage/i18n");
  return { useI18n: () => ({ locale: "zh-CN", t: (key: keyof typeof zhCN, vars: Record<string, unknown> = {}) => String(zhCN[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? "")) }) };
});
vi.mock("../src/renderer/src/lib/time", () => ({ useNow: () => Date.now() }));
vi.mock("../src/renderer/src/lib/openOverlays", () => ({ useTrackOverlay: () => {} }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  EmptyState: ({ children }: { children: React.ReactNode }) => h("p", null, children),
  SettingRow: ({ label, hint, children }: { label?: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode }) => h("div", null, label, h("span", { "data-hint": "" }, hint), children),
  Select: ({ value, options, onChange, label }: { value: string; options: { value: string; label: string }[]; onChange(v: string): void; label?: string }) =>
    h("select", { "aria-label": label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }, options.map((o) => h("option", { key: o.value, value: o.value }, o.label))),
  SettingsGroup: ({ children }: { children: React.ReactNode }) => children,
  Button: (props: object) => h("button", props),
  ErrorNote: ({ children }: { children: React.ReactNode }) => h("p", { role: "alert" }, children),
  Section: ({ title, hint, actions, children }: { title?: string; hint?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) => h("section", null, h("h2", null, title), hint, actions, children),
}));
const { CleanupSection } = await import("../src/renderer/src/modules/storage/CleanupSection");
const { stockTempOwner } = await import("../src/renderer/src/modules/storage/cleanupReason");
const { mockStockTmpPreview, mockStorageView } = await import("../src/renderer/src/modules/storage/mock");
const { zhCN } = await import("../src/renderer/src/modules/storage/i18n");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };

let unmount = () => {};
beforeEach(() => {
  fx.data = { hostId: "test", supported: true, connected: true, allowed: true, preview: null, selected: [], run: null, history: [], error: null, historyError: null, pending: null, loading: false, executing: false, historyLoading: false,
    controller: { clearPreview: vi.fn(), preview: vi.fn(), select: vi.fn(), execute: vi.fn(), retry: vi.fn(), loadHistory: vi.fn(), loadRun: vi.fn() } };
});
afterEach(() => { unmount(); document.body.innerHTML = ""; });
function mount(stockTmp: boolean) {
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node);
  act(() => root.render(h(CleanupSection, { stockTmp })));
  unmount = () => act(() => root.unmount());
  return node;
}
const options = (node: HTMLElement) => [...node.querySelectorAll<HTMLOptionElement>("select option")].map((o) => o.value);
const controller = () => fx.data.controller as Record<string, ReturnType<typeof vi.fn>>;

describe("stock-tmp cleanup", () => {
  it("the launch owner comes from cutex's reason; legacy reasons have none", () => {
    expect(stockTempOwner("kai · generation 3 · stopped; publication lease released")).toEqual({ sessionId: "kai", generation: 3 });
    expect(stockTempOwner("cutex.abc-1 · generation 12 · no complete stop or holder evidence")).toEqual({ sessionId: "cutex.abc-1", generation: 12 });
    expect(stockTempOwner("Ownership unknown; older Native or tool temporary data")).toBeNull();
    expect(stockTempOwner(null)).toBeNull();
  });

  it("offered only on a host whose inventory lists the stock-tmp store; previews with the stock-tmp action", () => {
    expect(options(mount(false))).not.toContain("stock-tmp");
    unmount();
    const node = mount(true);
    expect(options(node)).toContain("stock-tmp");
    const select = node.querySelector("select")!;
    act(() => { select.value = "stock-tmp"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(node.textContent).toContain(zhCN["storage.cleanup.stockTmpHint"]);
    act(() => [...node.querySelectorAll("button")].find((b) => b.textContent === zhCN["storage.cleanup.preview"])!.click());
    expect(controller().preview).toHaveBeenCalledWith({ action: "stock-tmp" });
    // StoragePage passes the inventory's answer; the mock host lists the store (with size and file count).
    const page = readFileSync(join(__dirname, "../src/renderer/src/modules/storage/StoragePage.tsx"), "utf8");
    expect(page).toContain("stockTmp={!!view?.stores.some((store) => store.id === STOCK_TMP_STORE)}");
    const store = mockStorageView().stores.find((s) => s.id === "stock-tmp")!;
    expect(store).toMatchObject({ path: "runtime/stock-tmp", group: "logs", files: 48210 });
    expect(zhCN["storage.store.stock-tmp"]).toBe("Native 临时文件");
  });

  it("each candidate: agent and launch generation; only stopped launches can be selected, the rest say why", () => {
    const preview = mockStockTmpPreview();
    fx.data.preview = preview;
    const node = mount(true);
    const rows = [...node.querySelectorAll<HTMLElement>("[data-cleanup-item]")];
    expect(rows.map((r) => r.dataset.cleanupItem)).toEqual(["stock_temp_stopped", "stock_temp_stopped", "stock_temp_held", "stock_temp_unknown", "stock_temp_unknown"]);
    expect(rows[0]!.querySelector("[data-stock-tmp-owner]")!.textContent).toBe("Kai · 第 3 次启动");
    expect(rows[1]!.querySelector("[data-stock-tmp-owner]")!.textContent).toBe("Sora（已归档） · 第 7 次启动");
    // Not listed on this host: its id.
    expect(rows[2]!.querySelector("[data-stock-tmp-owner]")!.textContent).toBe("eva · 第 12 次启动");
    expect(rows[3]!.querySelector("[data-stock-tmp-owner]")).toBeNull();
    const boxes = [...node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((b) => b.disabled)).toEqual([false, false, true, true, true]);
    expect(rows[2]!.textContent).toContain(zhCN["storage.cleanup.reason.stock_temp_held"]);
    expect(rows[3]!.textContent).toContain(zhCN["storage.cleanup.reason.stock_temp_unknown"]);
    expect(rows[4]!.textContent).toContain(zhCN["storage.cleanup.reason.stock_temp_unknown"]);
    // cutex's own words stay on hover.
    expect(rows[4]!.querySelector("[title]")!.getAttribute("title")).toBe("Ownership unknown; older Native or tool temporary data");
  });

  it("execution is high risk: the typed 删除 dialog, which also says what is deleted", () => {
    const preview = mockStockTmpPreview();
    fx.data.preview = preview; fx.data.selected = [preview.items[0]!.id, preview.items[1]!.id];
    mount(true);
    act(() => [...document.querySelectorAll("button")].find((b) => b.textContent === zhCN["storage.cleanup.confirm"])!.click());
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain(zhCN["storage.cleanup.stock-tmp"]);
    expect(dialog.textContent).toContain(zhCN["storage.cleanup.stockTmpHint"]);
    const submit = dialog.querySelector<HTMLButtonElement>("button:last-child")!;
    expect(submit.disabled).toBe(true);
    expect(controller().execute).not.toHaveBeenCalled();
  });
});
