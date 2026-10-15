// cutex profile-search-tool: the per-profile `searchTool` switch (Profile → 模型), owner-set, default
// off, Codex API-key profiles only — mirrored by the preview mock like cutex's PATCH.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreloadBridge } from "../src/shared/ipc";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { enAU } from "../src/renderer/src/i18n/en-AU";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";

async function install(): Promise<PreloadBridge> {
  vi.resetModules();
  vi.useFakeTimers();
  const win: { cutex?: PreloadBridge } = {};
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("document", { title: "" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const { installMockBridge } = await import("../src/renderer/src/dev/mockBridge");
  installMockBridge();
  return win.cutex!;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("profile searchTool", () => {
  it("is off by default, offered on API-key profiles only, and round-trips through PATCH", async () => {
    const api = (await install()).api;
    const deepseek = await api.getProfile("omega");
    expect(deepseek.searchTool).toBe(false);
    expect(deepseek.detail.editable.searchTool).toBe(true);
    const on = await api.patchProfile("omega", { searchTool: true });
    expect(on.searchTool).toBe(true);
    expect(on.detail.config).not.toHaveProperty("searchTool");
    expect((await api.patchProfile("omega", { searchTool: false })).searchTool).toBe(false);
    const claude = await api.getProfile("claude");
    expect(claude.searchTool).toBe(false);
    expect(claude.detail.editable.searchTool).toBe(false);
    await expect(api.patchProfile("claude", { searchTool: true })).rejects.toThrow("Codex API-key profiles only");
  });

  it("has its strings in every locale (no tool id in the hint; the id is the label's tooltip)", () => {
    for (const catalog of [zhCN, en, enAU, zhHantCN]) {
      expect(catalog["agent-config.profile.searchTool"]).toBeTruthy();
      expect(catalog["agent-config.profile.searchToolHint"]).toBeTruthy();
      expect(catalog["agent-config.profile.searchToolHint"]).not.toContain("web_search");
    }
    expect(zhCN["agent-config.profile.searchToolHint"]).toContain("网页搜索");
    // New keys go right after app.name, so later features push these two down: only their adjacency is fixed.
    const keys = Object.keys(zhCN);
    expect(keys[keys.indexOf("agent-config.profile.searchTool") + 1]).toBe("agent-config.profile.searchToolHint");
  });
});
