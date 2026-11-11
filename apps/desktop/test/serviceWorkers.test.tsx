// @vitest-environment jsdom
// Background services (cutex services-workers-v1, `runtime: "worker"`): no port or page. The desktop shows 「后台应用」,
// offers no 打开 / copy / browser tab anywhere, puts start / 停止后台 / restart / logs first, defaults the idle preset
// to forever, and opening one from a link, pin or the header shows it on the 服务 page instead.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceView } from "../src/shared/ipc";

const openPage = vi.fn();
const menuOpened = vi.fn();
const sideOpen = vi.fn();
const openService = vi.fn(async () => ({ url: "http://h:1/", localUrl: "http://127.0.0.1:1/" }));
const serviceAction = vi.fn(async () => ({}));
let hostServices: ServiceView[] = [];
vi.mock("../src/renderer/src/bridge", () => ({
  api: { openService: (...a: unknown[]) => openService(...(a as [])), openExternal: vi.fn(), serviceAction: (...a: unknown[]) => serviceAction(...(a as [])) },
  apiFor: () => ({ openService: (...a: unknown[]) => openService(...(a as [])), serviceAction: (...a: unknown[]) => serviceAction(...(a as [])), serviceTile: async () => null }),
  bridge: { on: () => () => {} },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { side: { open: (...a: unknown[]) => sideOpen(...a) }, ui: { openPage: (...a: unknown[]) => openPage(...a) } } }));
vi.mock("../src/renderer/src/lib/contextMenu", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openMenuFrom: (_el: unknown, entries: unknown) => menuOpened(entries),
}));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideShowsHost: () => true }));
vi.mock("../src/renderer/src/lib/hostScope", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hostData: () => ({ services: hostServices, features: new Set(["service-idle-presets-v1"]), sidebar: null, daemon: { kind: "connected" } }),
}));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key), locale: "zh-CN" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { serviceMenu, openService: openServiceUi } = await import("../src/renderer/src/lib/services");
const { serviceHealthKey, isSupervised } = await import("../src/renderer/src/lib/serviceWorker");
const { serviceWhere } = await import("../src/renderer/src/lib/servicesPopover");
const { servicesToOpen } = await import("../src/renderer/src/lib/serviceLink");
const { openServiceRef } = await import("../src/renderer/src/modules/services/refTarget");
const { ServiceCards } = await import("../src/renderer/src/modules/services/ServiceCards");

const service = (slug: string, extra: Partial<ServiceView> = {}): ServiceView => ({
  slug, displayName: slug, host: "h", port: 24301, path: null, ownerCutexSessionId: "cutex.mika", projectId: null, runtime: "managed", lifetime: "persistent", purpose: "background",
  createdAt: "2026-11-10T00:00:00Z", lastSeenAt: null, health: "reachable", url: "http://h:24301/", localUrl: "http://127.0.0.1:24301/", process: null, ...extra,
} as ServiceView);
const worker = (slug: string, extra: Partial<ServiceView> = {}) => service(slug, { runtime: "worker", port: null, url: null, localUrl: null, portAllocated: false, ...extra });
type Entry = { label: string; info?: string; submenu?: Entry[]; onSelect(): void };
const rows = (s: ServiceView, logs = () => {}) => serviceMenu(s, (k) => k, () => {}, logs, "local").filter((e): e is Entry => !!e && typeof e === "object" && "label" in e) as Entry[];

beforeEach(() => { openPage.mockReset(); sideOpen.mockReset(); openService.mockClear(); serviceAction.mockClear(); hostServices = []; });

describe("worker menu", () => {
  it("a running worker: 停止后台 / restart / logs first; no 打开, 在系统浏览器打开 or copy rows", () => {
    const labels = rows(worker("photo-indexer")).map((e) => e.label);
    expect(labels.slice(0, 3)).toEqual(["services.worker.stop", "services.restart", "services.logs"]);
    for (const k of ["services.open", "services.openExternal", "services.copyUrl", "services.copyPort"]) expect(labels).not.toContain(k);
    expect(labels).toContain("services.delete");
  });
  it("停止后台 says it stays stopped and sends stop; a stopped or crash-looped worker offers 启动后台", async () => {
    const stop = rows(worker("photo-indexer"))[0]!;
    expect(stop.info).toBe("services.worker.stop.hint");
    stop.onSelect();
    await Promise.resolve();
    expect(serviceAction).toHaveBeenCalledWith("photo-indexer", "stop");
    expect(rows(worker("mail-sync", { health: "stopped", stopped: true }))[0]!.label).toBe("services.worker.start");
    expect(rows(worker("backup", { health: "crashLooped" }))[0]!.label).toBe("services.worker.start");
  });
  it("a persistent worker waiting to restart (unreachable, retried forever) can still be stopped or restarted", () => {
    // Found in the real e2e (cutex fbd01a98): only ephemeral services reach crashLooped; a crashing persistent worker
    // stays `unreachable` with backoff, and the menu offered only 启动后台.
    const labels = rows(worker("crashy", { health: "unreachable" })).map((e) => e.label);
    expect(labels.slice(0, 2)).toEqual(["services.worker.stop", "services.restart"]);
    expect(labels).not.toContain("services.worker.start");
    expect(rows(worker("crashy", { health: "unreachable", stopped: true }))[0]!.label).toBe("services.worker.start");
    expect(rows(service("web", { health: "unreachable" })).map((e) => e.label)).toContain("services.start");
  });
  it("the idle preset defaults to forever (✓) with the worker's own hint", () => {
    const idle = rows(worker("photo-indexer")).find((e) => e.label === "services.idleStop")!;
    expect(idle.submenu!.map((e) => e.label)).toEqual(["services.idleStop.1h", "services.idleStop.24h", "services.idleStop.7d", "✓ services.idleStop.forever"]);
    expect(idle.submenu![0]!.info).toBe("services.worker.idleStop.hint");
  });
  it("a managed web service keeps 打开 first and its plain 停止", () => {
    const labels = rows(service("web")).map((e) => e.label);
    expect(labels[0]).toBe("services.open");
    expect(labels).toContain("services.stop");
    expect(labels).not.toContain("services.worker.stop");
    expect(isSupervised(worker("w"))).toBe(true);
  });
});

describe("words and lists", () => {
  it("the owner's name (2026-11-10): workers are 「后台应用」 / Background app; the purpose section keeps 「后台」", async () => {
    const { zhCN } = await import("../src/renderer/src/modules/services/i18n");
    const { en } = await import("../src/renderer/src/modules/services/i18n.en");
    expect([zhCN["services.worker.badge"], zhCN["services.worker.stop"], zhCN["services.worker.start"]]).toEqual(["后台应用", "停止后台应用", "启动后台应用"]);
    expect(en["services.worker.badge"]).toBe("Background app");
    expect(zhCN["services.purpose.background"]).toBe("后台");
  });
  it("「后台应用」 where a port would be; a worker's unreachable reads 等待重启", () => {
    expect(serviceWhere(worker("w"), "静态", "后台应用")).toBe("后台应用");
    expect(serviceWhere(service("web"), "静态", "后台应用")).toBe(":24301");
    expect(serviceHealthKey(worker("w", { health: "unreachable" }))).toBe("services.worker.health.restarting");
    expect(serviceHealthKey(service("web", { health: "unreachable" }))).toBe("services.health.unreachable");
    expect(serviceHealthKey(worker("w", { health: "crashLooped" }))).toBe("services.health.crashLooped");
  });
  it("「和它的智能体一起打开」 never opens a worker in the Shelf", () => {
    const list = [service("web"), worker("photo-indexer")];
    expect(servicesToOpen(list, { "local\nweb": true, "local\nphoto-indexer": true } as never, null, "local", "cutex.mika")).toEqual(["web"]);
  });
});

describe("opening a worker", () => {
  it("from a menu-less caller, a link or a pin: the 服务 page searched to it, never a browser tab or the daemon's open", async () => {
    hostServices = [worker("photo-indexer")];
    await openServiceUi({ slug: "photo-indexer" }, "local");
    expect(openPage).toHaveBeenLastCalledWith("services.page", { q: "photo-indexer" });
    const r = await openServiceRef({ hostId: "local", kind: "service", key: "photo-indexer", title: "x", params: {} }, "auto");
    expect(r).toEqual({ status: "opened", where: "page" });
    expect(sideOpen).not.toHaveBeenCalled();
    expect(openService).not.toHaveBeenCalled();
  });
  it("a web service still opens its tab", async () => {
    hostServices = [service("web")];
    sideOpen.mockReturnValue({ status: "opened" });
    await openServiceUi(service("web"), "local");
    expect(sideOpen).toHaveBeenCalledTimes(1);
    expect(openPage).not.toHaveBeenCalled();
  });
});

describe("worker card", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });
  const draw = (items: ServiceView[], logsOf: (key: string) => boolean) => act(() => root.render(h(ServiceCards, {
    rows: items.map((item) => ({ hostId: "local", key: `local:${item.slug}`, item })),
    ownerName: () => "Mika", hostName: () => "HOST-A", stale: () => false, tileEnabled: () => false, organizable: () => true,
    menu: (row) => rows(row.item), logs: (row) => logsOf(row.key) ? h("pre", { "data-logs": row.item.slug }, "log") : null,
    refresh: async () => {}, error: () => {},
  })));
  it("shows 「后台应用」; a click opens its menu (not a page); open logs show under the group", () => {
    draw([worker("photo-indexer"), service("web")], (key) => key === "local:photo-indexer");
    const card = host.querySelector<HTMLElement>("[data-service-card='local:photo-indexer']")!;
    expect(card.dataset.serviceWorker).toBe("true");
    expect(card.querySelector("[data-worker-badge]")?.textContent).toBe("services.worker.badge");
    expect(host.querySelector("[data-service-card='local:web'] [data-worker-badge]")).toBeNull();
    act(() => card.click());
    expect(sideOpen).not.toHaveBeenCalled();
    expect(openService).not.toHaveBeenCalled();
    expect((menuOpened.mock.calls.at(-1)![0] as Entry[]).filter((e) => e && typeof e === "object").map((e) => e.label)).toContain("services.worker.stop");
    expect(host.querySelector("[data-service-card-logs='local:photo-indexer'] [data-logs]")).not.toBeNull();
  });
});
