// 右栏与对话 = 让位 is gone (owner 2026-10-21): the reading column centres in its own pane, so a stored
// "yield" comes back as 并排 (push); 悬浮 stays.
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("sideMode migration (让位 → 并排)", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  });

  it("a stored 让位 loads as 并排; 悬浮 and 并排 stay; unknown → 并排", async () => {
    storage.set("cutex-desktop.ui", JSON.stringify({ sideMode: "yield" }));
    const prefs = await import("../src/renderer/src/lib/prefs");
    expect(prefs.getUiPrefs().sideMode).toBe("push");
    expect(prefs.migrateSideMode("float")).toBe("float");
    expect(prefs.migrateSideMode("push")).toBe("push");
    expect(prefs.migrateSideMode("yield")).toBe("push");
    expect(prefs.migrateSideMode(undefined)).toBe("push");
    expect(prefs.migrateSideMode(42)).toBe("push");
  });

  it("悬浮 survives a reload", async () => {
    storage.set("cutex-desktop.ui", JSON.stringify({ sideMode: "float" }));
    const prefs = await import("../src/renderer/src/lib/prefs");
    expect(prefs.getUiPrefs().sideMode).toBe("float");
  });

  it("Settings → 右侧栏与留白 offers 并排 / 悬浮 only", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/renderer/src/components/settings/SidesSettings.tsx", import.meta.url), "utf8");
    expect(src).toContain('value={ui.sideMode}');
    expect(src).toContain('(["push", "float"] as const)');
    expect(src).not.toContain('"yield"');
  });
});
