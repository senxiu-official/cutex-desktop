// Acceptance O4: the desktop-plugins switch stays out of Settings → 模块 until there is an install entry.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { MODULES } = await import("../src/renderer/src/modules/registry");
const { listedInSettings, revealUnlistedModules, SHOW_UNLISTED_MODULES_KEY, UNLISTED_MODULES } = await import("../src/renderer/src/modules/settingsVisibility");

describe("Settings → 模块 visibility", () => {
  it("keeps the plugins module registered, default-off and unlisted", () => {
    const plugins = MODULES.find((module) => module.id === "plugins");
    expect(plugins?.defaultEnabled).toBe(false);
    expect([...UNLISTED_MODULES]).toEqual(["plugins"]);
    expect(listedInSettings("plugins", false, false)).toBe(false);
  });

  it("lists it once it is on (so it can be turned off) or when the device opted in", () => {
    expect(listedInSettings("plugins", true, false)).toBe(true);
    expect(listedInSettings("plugins", false, true)).toBe(true);
  });

  it("lists every other module, external plugin modules included", () => {
    for (const module of MODULES.filter((module) => module.id !== "plugins")) expect(listedInSettings(module.id, false, false)).toBe(true);
    expect(listedInSettings("external-desk-note", false, false)).toBe(true);
  });

  it("reads the opt-in flag defensively", () => {
    expect(revealUnlistedModules({ getItem: (key) => (key === SHOW_UNLISTED_MODULES_KEY ? "1" : null) })).toBe(true);
    expect(revealUnlistedModules({ getItem: () => "true" })).toBe(false);
    expect(revealUnlistedModules({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
  });
});
