// 右栏与对话 = 让位 is gone (owner 2026-10-21): the reading column centres in its own pane, so a stored
// "yield" comes back as 并排 (push); 悬浮 stays.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("sideMode migration (让位 → 并排)", () => {
  describe.each([
    { stored: "yield", loaded: "push" },
    { stored: "float", loaded: "float" },
  ])("on reload with a stored $stored preference", ({ stored, loaded }) => {
    let prefs: typeof import("../src/renderer/src/lib/prefs");
    beforeAll(async () => {
      vi.resetModules();
      const storage = new Map([["cutex-desktop.ui", JSON.stringify({ sideMode: stored })]]);
      vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
      // The first prefs import transforms the renderer graph under full-suite load.
      prefs = await import("../src/renderer/src/lib/prefs");
    }, 60_000);
    afterAll(() => vi.unstubAllGlobals());

    it("loads the stored mode and preserves the migration rules", () => {
      expect(prefs.getUiPrefs().sideMode).toBe(loaded);
      expect(prefs.migrateSideMode("float")).toBe("float");
      expect(prefs.migrateSideMode("push")).toBe("push");
      expect(prefs.migrateSideMode("yield")).toBe("push");
      expect(prefs.migrateSideMode(undefined)).toBe("push");
      expect(prefs.migrateSideMode(42)).toBe("push");
    });
  });

  it("Settings → 右侧栏与留白 offers 并排 / 悬浮 only", () => {
    const src = readFileSync(new URL("../src/renderer/src/components/settings/SidesSettings.tsx", import.meta.url), "utf8");
    expect(src).toContain('value={ui.sideMode}');
    expect(src).toContain('(["push", "float"] as const)');
    expect(src).not.toContain('"yield"');
  });
});
