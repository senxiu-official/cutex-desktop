// @vitest-environment jsdom
// 百度网盘 Shelf page (modules/baidu-pan/PanPage): the app form, the device-code login (polls only while
// visible), browsing with the breadcrumb, a file's details → 下载到… (folder pick, path check), the
// downloads list (progress, speed, controls, agent rows, plain errors) and the feed following visibility.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanConnection, PanDownload, PanFile, PanResult } from "../src/shared/baiduPan";

const f = vi.hoisted(() => ({ pick: vi.fn(async () => "D:\\Picked"), openExternal: vi.fn(), reveal: vi.fn(), hosts: ["local"] as string[] }));
vi.mock("../src/renderer/src/bridge", () => ({ api: { openExternal: f.openExternal, revealPath: f.reveal }, apiFor: () => ({}), bridge: { on: () => () => {} }, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/remoteMode", () => ({ pickDirectory: f.pick }));
vi.mock("../src/renderer/src/lib/hostLists", () => ({ useListHosts: () => ({ data: f.hosts.map((hostId) => ({ hostId, features: new Set(["baidu-pan"]) })) }) }));

const S = await import("../src/renderer/src/modules/baidu-pan/store");
const { PanPage } = await import("../src/renderer/src/modules/baidu-pan/PanPage");
const { I18nProvider } = await import("../src/renderer/src/i18n");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ok = <T,>(value: T): PanResult<T> => ({ ok: true, value });
const conn = (patch: Partial<PanConnection> = {}): PanConnection => ({ configured: true, state: "connected", appId: "1", clientId: "k", account: { id: "9", name: "developer_pan", vipType: 2 }, expiresAt: null, ...patch });
const file = (path: string, isDir = false, size = 2048): PanFile => ({ id: path, path, name: path.split("/").pop()!, isDir, size, modifiedAt: 1_760_000_000 });
const dl = (id: string, patch: Partial<PanDownload> = {}): PanDownload => ({ id, requestId: "r" + id, remote: "/数据集/" + id + ".tar", targetDir: "D:\\Data", targetPath: "D:\\Data\\" + id + ".tar", state: "downloading", downloadedBytes: 512 * 1024 ** 2, totalBytes: 1024 ** 3, bytesPerSecond: 32 * 1024 ** 2, caller: { kind: "owner", id: null }, createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z", error: null, ...patch });

function makeDaemon() {
  return {
    panConnection: vi.fn(async () => ok(conn())),
    panConfigure: vi.fn(async () => ok(conn({ state: "needsAuth", account: null }))),
    panAuthStart: vi.fn(async () => ok({ id: "a1", state: "pending", verificationUrl: "https://openapi.baidu.com/device", userCode: "QK7M-4TZP", expiresAt: new Date(Date.now() + 300_000).toISOString(), intervalSeconds: 5 })),
    panAuthPoll: vi.fn(async () => ok({ id: "a1", state: "pending" })),
    panAuthCode: vi.fn(async () => ok(conn())),
    panFiles: vi.fn(async (dir: string) => ok({ files: dir === "/" ? [file("/研究资料", true), file("/读我.txt")] : [file(dir + "/论文.pdf", false, 6 * 1024 ** 2)], hasMore: false, nextStart: null })),
    panSearch: vi.fn(async () => ok({ files: [], hasMore: false })),
    panMeta: vi.fn(async (path: string) => ok({ file: file(path, false, 6 * 1024 ** 2) })),
    panDownloads: vi.fn(async () => ok({ downloads: [dl("ifm-val"), dl("bad", { state: "failed", bytesPerSecond: 0, caller: { kind: "agent", id: "eva" }, error: { code: "pan_storage_error", message: "disk full", retryable: true } })] })),
    panStartDownload: vi.fn(async () => ok({ download: dl("new", { state: "queued", createdAt: "2026-11-11T09:00:00Z" }) })),
    panDownloadAction: vi.fn(async (id: string) => ok({ download: dl(id, { state: "paused", bytesPerSecond: 0, updatedAt: "2026-11-11T10:00:00Z" }) })),
    watchPan: vi.fn(async () => "w1"),
    unwatchPan: vi.fn(async () => undefined),
  };
}
let d: ReturnType<typeof makeDaemon>;
let root: Root, el: HTMLDivElement;
let state: Record<string, unknown>;
const setState = vi.fn((s: Record<string, unknown>) => (state = s));

function render(visible = true) {
  act(() => root.render(h(I18nProvider, { initialLocale: "zh-CN" } as never, h(PanPage as never, { hostId: "local", sessionId: null, instance: { state }, setState, visible, active: true, mode: "normal", where: "card", revealed: 0, close() {}, open() {}, keepMounted: () => false, held: false, keep() {} }))));
}
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const q = (sel: string) => el.querySelector(sel) as HTMLElement | null;
const text = () => el.textContent ?? "";
const click = (node: Element | null) => act(() => (node as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
const buttonWith = (s: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(s) || b.getAttribute("aria-label") === s) ?? null;

beforeEach(() => {
  localStorage.setItem("cutex-desktop.locale", "zh-CN");
  S.resetPanStore();
  state = {};
  f.hosts = ["local"];
  d = makeDaemon();
  S.setPanDaemon(() => d as never);
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  el.remove();
  S.setPanDaemon(null);
  vi.useRealTimers();
});

describe("PanPage", () => {
  it("asks for the app when none is saved and sends what was typed", async () => {
    d.panConnection.mockResolvedValue(ok(conn({ configured: false, state: "disconnected", account: null })));
    render();
    await flush();
    expect(q("[data-pan-app-form]")).not.toBeNull();
    const inputs = [...el.querySelectorAll("input")];
    const type = (i: HTMLInputElement, v: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); });
    type(inputs[0]!, "41785023");
    type(inputs[1]!, "KqAppKey");
    type(inputs[2]!, "secret");
    expect(inputs[2]!.type).toBe("password");
    await act(async () => { q("[data-pan-app-form]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(d.panConfigure).toHaveBeenCalledWith({ appId: "41785023", clientId: "KqAppKey", clientSecret: "secret" });
    expect(q("[data-pan-login]")).not.toBeNull();
  });

  it("login: shows Baidu's link and the code; polls on the interval only while visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    d.panConnection.mockResolvedValue(ok(conn({ state: "needsAuth", account: null })));
    render();
    await flush();
    click(q("[data-pan-login-start]"));
    await flush();
    expect(q("[data-pan-user-code]")?.textContent).toBe("QK7M-4TZP");
    click(buttonWith("打开百度页面"));
    expect(f.openExternal).toHaveBeenCalledWith("https://openapi.baidu.com/device");
    await act(async () => { vi.advanceTimersByTime(5_100); });
    expect(d.panAuthPoll).toHaveBeenCalledTimes(1);
    render(false);
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(d.panAuthPoll).toHaveBeenCalledTimes(1);
  });

  it("browses with the breadcrumb, opens a file's details and downloads to a picked folder", async () => {
    render();
    await flush();
    expect(text()).toContain("developer_pan");
    expect(text()).toContain("超级会员");
    click(q("[data-pan-file=dir]"));
    await flush();
    expect(d.panFiles).toHaveBeenLastCalledWith("/研究资料", 0, 100);
    expect(q("[data-pan-crumbs]")?.textContent).toContain("全部文件");
    expect(q("[data-pan-crumbs]")?.textContent).toContain("研究资料");
    click(q("[data-pan-file=file]"));
    await flush();
    expect(q("[data-pan-details]")?.textContent).toContain("6.0 MiB");
    expect((q("[data-pan-start]") as HTMLButtonElement).disabled).toBe(true); // no folder yet
    click(buttonWith("选择…"));
    await flush();
    expect(f.pick).toHaveBeenCalledWith(null, "local");
    expect(state.targetDirs).toEqual({ local: "D:\\Picked" });
    click(q("[data-pan-start]"));
    await flush();
    expect(d.panStartDownload).toHaveBeenCalledWith(expect.objectContaining({ remote: "/研究资料/论文.pdf", targetDir: "D:\\Picked" }));
    expect(text()).toContain("已加入下载");
    click(buttonWith("返回列表"));
    click(buttonWith("全部文件"));
    await flush();
    expect(d.panFiles).toHaveBeenLastCalledWith("/", 0, 100);
  });

  it("lists downloads with progress, speed, time left, the agent who started one and plain errors; pause works", async () => {
    render();
    await flush();
    const rows = el.querySelectorAll("[data-pan-download]");
    expect(rows).toHaveLength(2);
    const first = rows[0]!.textContent!;
    expect(first).toContain("下载中 50%");
    expect(first).toContain("512 MiB / 1.0 GiB");
    expect(first).toContain("32.0 MiB/s");
    expect(first).toContain("剩余 16s");
    expect(rows[1]!.textContent).toContain("主机上的文件夹写不进去");
    expect(rows[1]!.textContent).toContain("由 eva 发起");
    expect(rows[1]!.querySelector("[aria-label=重试]")).not.toBeNull();
    click(rows[0]!.querySelector("[aria-label=暂停]"));
    await flush();
    expect(d.panDownloadAction).toHaveBeenCalledWith("ifm-val", "pause");
    expect(el.querySelector("[data-pan-download]")!.textContent).toContain("已暂停");
  });

  it("follows the feed only while on screen and stops it when hidden or closed", async () => {
    render();
    await flush();
    expect(d.watchPan).toHaveBeenCalledTimes(1);
    render(false);
    await flush();
    expect(d.unwatchPan).toHaveBeenCalledWith("w1");
    render(true);
    await flush();
    expect(d.watchPan).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
    await flush();
    expect(d.unwatchPan).toHaveBeenCalledTimes(2);
    root = createRoot(el);
  });

  it("offers a host choice when several hosts have Baidu Netdisk", async () => {
    f.hosts = ["local", "remote"];
    render();
    await flush();
    const select = el.querySelector("select") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["local", "remote"]);
    act(() => { select.value = "remote"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(state.hostId).toBe("remote");
  });

  it("the folded authorization-code entry submits once and clears the code", async () => {
    d.panConnection.mockResolvedValue(ok(conn({ state: "needsAuth", account: null })));
    render();
    await flush();
    const box = q("[data-pan-code-login]")!;
    expect(box.hasAttribute("open")).toBe(false);
    const [redirect, code] = [...box.querySelectorAll("input")] as HTMLInputElement[];
    expect(redirect!.value).toBe("oob");
    expect(code!.type).toBe("password");
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(code, "9f8e7d"); code!.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { box.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(d.panAuthCode).toHaveBeenCalledWith("9f8e7d", "oob");
    expect(el.querySelector("[data-pan-code-login]")).toBeNull(); // connected: the browser shows
    expect(text()).toContain("研究资料");
  });

  it("says plainly when the host's cutex has no Baidu Netdisk", async () => {
    d.panConnection.mockResolvedValue({ ok: false, code: "unsupported", message: "", retryable: false });
    render();
    await flush();
    expect(text()).toContain("这台主机的 cutex 还不支持百度网盘");
  });
});
