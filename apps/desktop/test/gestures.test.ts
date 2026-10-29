// 点击与手势 (Settings → 键盘快捷键; lib/gestures, i18n/gestureCatalog, components/settings/GestureGuide). Owner 2026-10-24:
// one block per kind of target, one line per gesture that does something — no 「—」 / 「同…」 cells, no 「=」 as a verb,
// always 左键点击 / 右键点击 / 中键点击 (never a bare 点 / 右键), key combinations spaced. Behaviours checked against the
// handlers (see lib/gestures).
import { describe, expect, it } from "vitest";
import { GESTURE_TARGETS, GESTURES, gestureKeys, gestureParts } from "../src/renderer/src/lib/gestures";
import { defaultBindings } from "../src/renderer/src/lib/keybindings";
import { gestureZhCN } from "../src/renderer/src/i18n/gestureCatalog";
import { gestureEn } from "../src/renderer/src/i18n/gestureCatalog.en";
import { gestureZhHant } from "../src/renderer/src/i18n/gestureCatalog.locales";

const zh = gestureZhCN as Record<string, string>;
const rowOf = (target: string, input: string, mods: string[] = []) =>
  GESTURES.find((b) => b.id === target)!.rows.find((r) => r.gestures.some((g) => g.input === input && (g.mods ?? []).join() === mods.join()));

describe("gesture guide", () => {
  it("every key the guide uses has text in zh-CN, en and zh-Hant-CN, and the catalogs hold nothing else", () => {
    const keys = gestureKeys();
    for (const cat of [gestureZhCN, gestureEn, gestureZhHant] as Record<string, string>[]) {
      for (const k of keys) expect(cat[k], k).toBeTruthy();
      expect(Object.keys(cat).sort()).toEqual([...keys].sort());
    }
  });

  it("one block per kind of target, in order; no empty or placeholder lines", () => {
    expect(GESTURES.map((b) => b.id)).toEqual([...GESTURE_TARGETS]);
    expect([...GESTURE_TARGETS]).toEqual(["agent", "group", "page", "launcher", "tab", "strip", "desktop"]);
    for (const b of GESTURES) {
      expect(b.rows.length, b.id).toBeGreaterThan(0);
      for (const row of b.rows) {
        expect(row.gestures.length).toBeGreaterThan(0);
        expect(zh[row.result]).not.toMatch(/^[—-]$|^同/);
      }
    }
  });

  it("owner's wording: 左键点击 / 右键点击 / 中键点击, no bare 点 or 右键, no 「=」, no 「同…」", () => {
    for (const [k, v] of Object.entries(zh)) {
      expect(v, k).not.toContain("=");
      expect(v, k).not.toMatch(/(^|[^击])同 ?Ctrl/);
      expect(v, k).not.toMatch(/[左右中]键(?!点击)/);
      expect(v, k).not.toMatch(/(?<!点)点(?!击)/);
    }
    expect(zh["gestures.input.left"]).toBe("左键点击");
    expect(zh["gestures.input.right"]).toBe("右键点击");
    expect(zh["gestures.input.middle"]).toBe("中键点击");
  });

  it("identical gestures share a line: Ctrl/⌘ + 左键点击 or 中键点击 opens beside ({{agent}}s, groups, pages) or a kept background tab (launchers)", () => {
    for (const target of ["agent", "group", "page"]) {
      const row = rowOf(target, "middle")!;
      expect(row.kind, target).toBe("beside");
      expect(row.gestures.map((g) => gestureParts(g).map((p) => p.value).join("+"))).toEqual(["mod+left", "middle"]);
    }
    expect(rowOf("launcher", "middle")!.kind).toBe("background");
    expect(rowOf("launcher", "left", ["mod", "shift"])!.result).toBe("gestures.launcher.shown");
  });

  it("matches the handlers: a tab's middle click closes (unsaved work first), the ‹ / › long-press is {{shelf}} only, the desktop toggles with its paneDesktop key (default Mod+Shift+D)", () => {
    expect(rowOf("tab", "middle")!.kind).toBe("close");
    expect(zh["gestures.tab.close"]).toContain("未保存");
    expect(zh[rowOf("strip", "longPress")!.result]).toBe("只看{{shelf}}");
    expect(zh["gestures.strip.menu"]).toContain("只看会话");
    const desktop = GESTURES.find((b) => b.id === "desktop")!.rows[0]!;
    expect(desktop.gestures.map((g) => g.command ?? gestureParts(g).map((p) => p.value).join("+"))).toEqual(["left", "paneDesktop"]);
    expect(defaultBindings("paneDesktop")).toEqual(["Mod+Shift+KeyD"]);
    // The tray's groups have no pin of their own any more (one divider pushpin): unpinning is in the menu.
    expect(zh["gestures.group.menu"]).toContain("取消固定");
    expect(Object.values(zh).join()).not.toContain("钉子");
  });
});
