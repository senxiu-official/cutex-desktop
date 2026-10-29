// @vitest-environment jsdom
// 在线的桌面 in a zh-CN UI: every remote-close text comes out simplified through the real lookup (the
// owner saw 「正在關閉」; the Traditional values exist only in the zh-Hant catalogs).
import { expect, it } from "vitest";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";

// Traditional-only forms of characters these texts use (关 闭 这 台 个 设 备 实 时 记 录 后 隐 启 动 计 权 远 应).
const TRADITIONAL = /[關閉這臺個設備實時記錄後隱啟啓動計權遠應]/;
const keys = (Object.keys(zhCN) as (keyof typeof zhCN)[]).filter((k) => k.startsWith("remoteClose."));

it("zh-CN remote-close texts are simplified and differ from the Traditional catalog where it converts", () => {
  expect(keys.length).toBeGreaterThan(20);
  for (const key of keys) {
    expect(TRADITIONAL.test(zhCN[key]), `${key}: ${zhCN[key]}`).toBe(false);
  }
  expect(zhHantCN["remoteClose.state.closing"]).toBe("正在關閉");
});

it("translate() in a zh-CN UI gives 正在关闭 / 正在倒计时, not the Traditional text", async () => {
  localStorage.setItem("cutex-desktop.locale", "zh-CN");
  const { translate, currentLocale, startLocaleReady } = await import("../src/renderer/src/i18n");
  await startLocaleReady;
  expect(currentLocale()).toBe("zh-CN");
  expect(translate("remoteClose.state.closing")).toBe("正在关闭");
  expect(translate("remoteClose.gate.busy")).toBe("正在关闭");
  expect(translate("remoteClose.state.closeRequested")).toBe("正在倒计时");
  expect(translate("remoteClose.closing")).toBe("正在关闭 cutex 桌面…");
});
