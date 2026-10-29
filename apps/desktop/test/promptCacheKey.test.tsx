// @vitest-environment jsdom
// design 034 prompt-cache-key: 新建默认 → 提示缓存 — the switch is opt-in (default off), round-trips
// through PATCH like cutex, hides without the capability or the settings field, and every locale
// carries its strings (zh-CN, en, en-AU via modulesEn, zh-Hant-CN s2t).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreloadBridge } from "../src/shared/ipc";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { enAU } from "../src/renderer/src/i18n/en-AU";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";

const fx = vi.hoisted(() => ({ api: null as unknown as PreloadBridge["api"], features: new Set<string>() }));

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTargetApi: () => fx.api,
  useTargetFeatures: () => fx.features,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Loaded while the file is collected, not inside a test's 5 s: the first load of the settings page and of the mock
// bridge (with every module's mock) took up to 4 s alone and timed out under the full suite's load. The section is
// rendered from this one instance (its api comes from fx); install() still gets a fresh mock bridge per call, now
// from the transform cache.
const { PromptCacheKeySection } = await import("../src/renderer/src/components/settings/GlobalSettings");
await import("../src/renderer/src/dev/mockBridge");

async function install(search: string): Promise<PreloadBridge["api"]> {
  vi.resetModules();
  vi.stubGlobal("location", { search });
  const { installMockBridge } = await import("../src/renderer/src/dev/mockBridge");
  installMockBridge();
  return (window as unknown as { cutex?: PreloadBridge }).cutex!.api;
}

async function section(search = "", tweak?: (api: PreloadBridge["api"]) => void) {
  fx.api = await install(search);
  tweak?.(fx.api);
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  await act(async () => root.render(h(PromptCacheKeySection)));
  const unmount = async () => {
    await act(async () => root.unmount());
    div.remove();
  };
  return { div, unmount };
}

const switchOf = (div: HTMLElement) => div.querySelector<HTMLElement>('[role="switch"]');

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("prompt cache settings", () => {
  it("mock: default off, PATCH round-trips, feature advertised (not under ?legacy)", async () => {
    const api = await install("");
    const settings = await api.getSettings();
    expect(settings.promptCacheKey).toEqual({ enabled: false });
    expect(settings.promptCacheKeyDefault).toEqual({ enabled: false });
    expect((await api.capabilities())!.featureList).toContain("prompt-cache-key");
    expect((await api.patchSettings({ promptCacheKey: { enabled: true } })).promptCacheKey).toEqual({ enabled: true });
    expect((await api.getSettings()).promptCacheKey).toEqual({ enabled: true });
    const legacy = await install("?legacy");
    expect((await legacy.getSettings()).promptCacheKey).toBeUndefined();
    expect((await legacy.capabilities())!.featureList).not.toContain("prompt-cache-key");
  });

  it("renders off by default and toggles through PATCH", async () => {
    fx.features = new Set(["prompt-cache-key"]);
    const m = await section();
    expect(m.div.querySelector("#settings-promptCache")?.textContent).toContain("agent-config.promptCache.title");
    const toggle = switchOf(m.div)!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(switchOf(m.div)!.getAttribute("aria-checked")).toBe("true");
    expect((await fx.api.getSettings()).promptCacheKey).toEqual({ enabled: true });
    await act(async () => switchOf(m.div)!.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(switchOf(m.div)!.getAttribute("aria-checked")).toBe("false");
    await m.unmount();
  });

  it("hides without the capability, and when the settings lack the field", async () => {
    fx.features = new Set(["prompt-cache-key"]);
    const legacy = await section("?legacy");
    expect(switchOf(legacy.div)).toBeNull();
    await legacy.unmount();
    fx.features = new Set();
    const current = await section();
    expect(switchOf(current.div)).toBeNull();
    await current.unmount();
  });

  it("carries the strings in every locale, the hint naming the trade-offs", () => {
    const keys = ["agent-config.promptCache.title", "agent-config.promptCache.hint", "agent-config.promptCache.share", "agent-config.promptCache.shareHint"] as const;
    for (const catalog of [zhCN, en, enAU, zhHantCN]) for (const key of keys) expect(catalog[key], key).toBeTruthy();
    expect(zhCN["agent-config.promptCache.share"]).toBe("新{{agent}}共用提示缓存");
    expect(zhCN["agent-config.promptCache.shareHint"]).toContain("冷缓存");
    expect(zhHantCN["agent-config.promptCache.share"]).toContain("提示緩存");
    expect(zhHantCN["agent-config.promptCache.shareHint"]).toContain("冷緩存");
    expect(en["agent-config.promptCache.shareHint"]).toContain("one cache");
  });

  it("one status line under the switch (pending / active / unsupported / probe_failed); off or missing: nothing", async () => {
    fx.features = new Set(["prompt-cache-key"]);
    const m = await section();
    expect(m.div.querySelector("[data-prompt-cache-status]")).toBeNull(); // off
    const withStatus = (status?: string) => (api: PreloadBridge["api"]) => {
      const base = api.getSettings;
      api.getSettings = async () => ({ ...(await base()), promptCacheKey: { enabled: true }, ...(status ? { promptCacheKeyStatus: status } : {}) }) as never;
    };
    for (const [status, key] of [["pending", "pending"], ["active", "active"], ["unsupported", "unsupported"], ["probe_failed", "probeFailed"]] as const) {
      const x = await section("", withStatus(status));
      expect(x.div.querySelector("[data-prompt-cache-status]")!.textContent).toBe("agent-config.promptCache.status." + key);
      await x.unmount();
    }
    const none = await section("", withStatus()); // an older cutex: no status
    expect(none.div.querySelector("[data-prompt-cache-status]")).toBeNull();
    await none.unmount();
    await m.unmount();
  });

  it("the switch sends exactly { promptCacheKey: { enabled } }; a 400 unsupported field says 需要新版 cutex and leaves the switch", async () => {
    fx.features = new Set(["prompt-cache-key"]);
    const m = await section();
    const sent: unknown[] = [];
    const real = fx.api.patchSettings;
    fx.api.patchSettings = async (p) => {
      sent.push(p);
      throw new Error("400 invalid_request: unsupported field: promptCacheKey");
    };
    await act(async () => switchOf(m.div)!.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(sent).toEqual([{ promptCacheKey: { enabled: true } }]);
    expect(switchOf(m.div)!.getAttribute("aria-checked")).toBe("false");
    expect(m.div.textContent).toContain("agent-config.promptCache.needNew");
    fx.api.patchSettings = real;
    await act(async () => switchOf(m.div)!.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(switchOf(m.div)!.getAttribute("aria-checked")).toBe("true");
    expect(m.div.textContent).not.toContain("agent-config.promptCache.needNew");
    await m.unmount();
  });

  it("the status strings are in every locale", () => {
    const keys = ["pending", "active", "unsupported", "probeFailed"].map((k) => "agent-config.promptCache.status." + k).concat("agent-config.promptCache.needNew") as (keyof typeof zhCN)[];
    for (const catalog of [zhCN, en, enAU, zhHantCN]) for (const key of keys) expect(catalog[key], key).toBeTruthy();
    expect(zhCN["agent-config.promptCache.status.pending"]).toBe("下次启动{{agent}}时生效");
    expect(zhCN["agent-config.promptCache.status.probeFailed"]).toBe("检测失败，已按原方式启动");
  });
});
