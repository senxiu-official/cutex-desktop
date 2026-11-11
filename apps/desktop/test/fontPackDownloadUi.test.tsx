// Settings → 外观 → 中文字体包 下载并安装: the button, the progress row from main's pushes (bar, bytes, 取消), plain-word
// errors, 继续下载 after an interruption (not after a refused archive), and the button gone once everything is installed.
// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FontPackDownload, FontPackState } from "../src/shared/fontCatalog";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: (globalThis as { cutex?: unknown }).cutex ?? {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "zh-CN" }),
}));

const g = globalThis as { cutex?: { fontPack: Record<string, unknown> }; IS_REACT_ACT_ENVIRONMENT?: boolean };
const fake = vi.hoisted(() => ({ installed: 0, download: undefined as FontPackDownload | undefined, push: null as ((s: FontPackState) => void) | null, downloads: 0, cancels: 0 }));
let section: typeof import("../src/renderer/src/components/settings/FontPackSettings");
let catalog: typeof import("../src/shared/fontCatalog");
const state = (): FontPackState => ({
  families: catalog.PACK_FONTS.map((e) => ({ id: e.id, installed: fake.installed ? e.faces.length : 0, total: e.faces.length, bytes: 1 })),
  ...(fake.download ? { download: fake.download } : {}),
});
beforeAll(async () => {
  g.IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { FontFace?: unknown }).FontFace = class {};
  Object.defineProperty(document, "fonts", { value: { add: () => {}, delete: () => {} }, configurable: true });
  catalog = await import("../src/shared/fontCatalog");
  g.cutex = {
    fontPack: {
      state: async () => state(),
      import: async () => ({ canceled: true, imported: [], refused: [], state: state() }),
      remove: async () => state(),
      openFolder: async () => {},
      download: async () => { fake.downloads++; return state(); },
      cancelDownload: async () => { fake.cancels++; },
      onState: (l: (s: FontPackState) => void) => { fake.push = l; return () => {}; },
    },
  };
  section = await import("../src/renderer/src/components/settings/FontPackSettings");
}, 30_000);

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});
async function mount(): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(h(section.FontPackSection)));
  return host;
}
const push = async (download: FontPackDownload | undefined, installed = 0) => {
  fake.download = download;
  fake.installed = installed;
  await act(async () => fake.push!(state()));
};
const buttons = (host: HTMLElement) => [...host.querySelectorAll("button")].map((b) => b.textContent ?? "").filter((t) => t.startsWith("appearance.fontPack"));

describe("中文字体包 下载并安装", () => {
  it("offers 下载并安装 first, with 导入字体包… as the fallback, and the pack size in the hint", async () => {
    const host = await mount();
    expect(buttons(host).slice(0, 3)).toEqual(["appearance.fontPack.download", "appearance.fontPack.import", "appearance.fontPack.openFolder"]);
    expect(host.textContent).toContain("appearance.fontPackHint(83.8 MiB)");
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "appearance.fontPack.download")!.click());
    expect(fake.downloads).toBe(1);
  });

  it("shows main's progress with a bar and 取消, then 核对 / 安装 without 取消", async () => {
    const host = await mount();
    await push({ phase: "downloading", received: 21_956_608, total: 87_826_432 });
    const bar = host.querySelector("[role=progressbar]")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(host.textContent).toContain("appearance.fontPack.progress.downloading(20.9 MiB,83.8 MiB)");
    const cancel = [...host.querySelectorAll("button")].find((b) => b.textContent === "appearance.fontPack.cancel")!;
    // While it runs, 下载 / 导入 wait.
    expect([...host.querySelectorAll("button")].find((b) => b.textContent === "appearance.fontPack.download")!.disabled).toBe(true);
    await act(async () => cancel.click());
    expect(fake.cancels).toBe(1);
    await push({ phase: "verifying", received: 87_826_432, total: 87_826_432 });
    expect(host.querySelector("[data-font-pack-download]")!.getAttribute("data-font-pack-download")).toBe("verifying");
    expect(buttons(host)).not.toContain("appearance.fontPack.cancel");
  });

  it("explains a failure in plain words; an interruption offers 继续下载, a refused archive a fresh download", async () => {
    const host = await mount();
    await push({ phase: "failed", received: 31_457_280, total: 87_826_432, error: "network" });
    expect(host.textContent).toContain("appearance.fontPack.error.network");
    expect(buttons(host)[0]).toBe("appearance.fontPack.resume");
    await push({ phase: "failed", received: 87_826_432, total: 87_826_432, error: "mismatch" });
    expect(host.textContent).toContain("appearance.fontPack.error.mismatch");
    expect(buttons(host)[0]).toBe("appearance.fontPack.download");
    await push({ phase: "failed", received: 0, total: 87_826_432, error: "proxyAuth" });
    expect(host.textContent).toContain("appearance.fontPack.error.proxyAuth");
  });

  it("drops the download button once every family is installed", async () => {
    const host = await mount();
    await push(undefined, 1);
    expect(buttons(host)).not.toContain("appearance.fontPack.download");
    expect([...host.querySelectorAll("[data-font-pack-status]")].every((e) => e.getAttribute("data-font-pack-status") === "imported")).toBe(true);
  });
});
