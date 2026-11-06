import { expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (value: string) => value }));
const { MODULES } = await import("../src/renderer/src/modules/registry");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");
it("every settings page supplies a translated title and purpose in Chinese and English", () => {
  const pages = MODULES.flatMap(module => module.contributes?.["settings.page"] ?? []);
  expect(pages.length).toBeGreaterThan(30);
  for (const page of pages) {
    expect(page.hintKey, page.page).toBeTruthy();
    for (const catalog of [zhCN, en]) {
      expect(catalog[page.titleKey], page.page).toBeTruthy();
      const purpose = page.hintKey && catalog[page.hintKey];
      expect(purpose, page.page).toBeTruthy();
      expect(purpose, page.page).not.toMatch(/ledger|r274|admission|账本/i);
    }
  }
});
