// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_PORTRAIT_THEMES } from "../src/shared/portraitDefaults";
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
afterEach(() => localStorage.clear());
it("defaults a new install to the owner kit, preserving explicit off and legacy letter choices", async () => {
  localStorage.clear(); vi.resetModules();
  const fresh = await import("../src/renderer/src/lib/prefs");
  expect(fresh.getUiPrefs().portraitPacks).toEqual(DEFAULT_PORTRAIT_THEMES);
  for (const saved of [{ portraitPacks: [] }, { agentAvatarDefault: "letter" }]) {
    localStorage.clear(); localStorage.setItem("cutex-desktop.ui", JSON.stringify(saved)); vi.resetModules();
    const loaded = await import("../src/renderer/src/lib/prefs");
    expect(loaded.getUiPrefs().portraitPacks).toEqual([]);
  }
});
