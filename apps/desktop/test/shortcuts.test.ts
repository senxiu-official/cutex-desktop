import { describe, expect, it } from "vitest";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { composerKeyAction } from "../src/renderer/src/lib/sendKeys";
import { displayKey, SHORTCUT_GROUPS, shortcutsFor } from "../src/renderer/src/lib/shortcuts";

const busy = { busy: true, hasContent: true, pendingSteers: 0, collapsedSelection: true };

describe("shortcut reference", () => {
  it("has a translation for every entry", () => {
    for (const g of SHORTCUT_GROUPS) {
      expect(zhCN[g.title]).toBeTruthy();
      expect(en[g.title]).toBeTruthy();
      for (const s of g.items) expect([zhCN[s.desc], en[s.desc]].every(Boolean)).toBe(true);
    }
  });

  it("matches the composer key handler per preset", () => {
    const keysOf = (preset: "queueFirst" | "cli") => shortcutsFor(preset).flatMap((g) => g.items.map((s) => `${s.keys.join(",")}:${s.desc}`));
    // Tab queues only in the CLI preset.
    expect(composerKeyAction("cli", { key: "Tab", ctrl: false, shift: false }, busy)).toBe("queue");
    expect(composerKeyAction("queueFirst", { key: "Tab", ctrl: false, shift: false }, busy)).toBeNull();
    expect(keysOf("cli")).toContain("Tab:shortcuts.tab.cli");
    expect(keysOf("queueFirst")).not.toContain("Tab:shortcuts.tab.cli");
    // Enter: queue (queueFirst) vs steer (cli); Ctrl+Enter steers in both; Ctrl+Shift+Enter interrupts.
    expect(composerKeyAction("queueFirst", { key: "Enter", ctrl: false, shift: false }, busy)).toBe("send");
    expect(composerKeyAction("cli", { key: "Enter", ctrl: false, shift: false }, busy)).toBe("steer");
    expect(composerKeyAction("queueFirst", { key: "Enter", ctrl: true, shift: false }, busy)).toBe("steer");
    expect(composerKeyAction("cli", { key: "Enter", ctrl: true, shift: true }, busy)).toBe("interruptSend");
    expect(composerKeyAction("cli", { key: "Escape", ctrl: false, shift: false }, { ...busy, pendingSteers: 2 })).toBe("interruptSendSteers");
  });

  it("shows ⌘ / ⇧ / ⌥ on macOS", () => {
    expect(displayKey("Ctrl+Shift+Enter", true)).toBe("⌘⇧Enter");
    expect(displayKey("Ctrl+Shift+Enter", false)).toBe("Ctrl+Shift+Enter");
  });
});
