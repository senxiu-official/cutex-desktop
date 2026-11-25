// 「多行时 Enter 换行（Ctrl+Enter 发送）」 (owner 2026-11-24, 方案 B of .claude/reports/composer-enter-study-20261124.md):
// off by default; on, a draft that already has a line break takes plain Enter as a new line, every other key keeps
// its meaning; a one-line draft is unchanged.
import { describe, expect, it } from "vitest";
import { composerKeyAction, isMultilineDraft, multilineHint, type ComposerKeyEvent, type SendKeyPreset } from "../src/renderer/src/lib/sendKeys";
import { composerCandidateKey } from "../src/renderer/src/lib/composerMentions";
import { displayKey, shortcutsFor } from "../src/renderer/src/lib/shortcuts";

const KEYS: Record<string, ComposerKeyEvent> = {
  "Enter": { key: "Enter", ctrl: false, shift: false },
  "Shift+Enter": { key: "Enter", ctrl: false, shift: true },
  "Ctrl+Enter": { key: "Enter", ctrl: true, shift: false },
  "Ctrl+Shift+Enter": { key: "Enter", ctrl: true, shift: true },
  "Alt+Enter": { key: "Enter", ctrl: false, shift: false, alt: true },
  "Tab": { key: "Tab", ctrl: false, shift: false },
  "Esc": { key: "Escape", ctrl: false, shift: false },
};
// What each key does today (setting off, or a one-line draft), per preset and busy.
const TODAY: Record<SendKeyPreset, Record<"idle" | "busy", Record<string, string | null>>> = {
  queueFirst: {
    idle: { "Enter": "send", "Shift+Enter": null, "Ctrl+Enter": "steer", "Ctrl+Shift+Enter": "interruptSend", "Alt+Enter": null, "Tab": null, "Esc": null },
    busy: { "Enter": "send", "Shift+Enter": null, "Ctrl+Enter": "steer", "Ctrl+Shift+Enter": "interruptSend", "Alt+Enter": null, "Tab": null, "Esc": "interrupt" },
  },
  cli: {
    idle: { "Enter": "steer", "Shift+Enter": null, "Ctrl+Enter": "steer", "Ctrl+Shift+Enter": "interruptSend", "Alt+Enter": null, "Tab": null, "Esc": null },
    busy: { "Enter": "steer", "Shift+Enter": null, "Ctrl+Enter": "steer", "Ctrl+Shift+Enter": "interruptSend", "Alt+Enter": null, "Tab": "queue", "Esc": "interrupt" },
  },
};
const ctx = (busy: boolean, multilineNewline: boolean) => ({ busy, hasContent: true, pendingSteers: 0, collapsedSelection: true, multilineNewline });

describe("the key rule: setting on/off × one-line/multi-line × idle/busy × every modifier", () => {
  for (const preset of ["queueFirst", "cli"] as const) for (const busy of [false, true]) for (const [name, event] of Object.entries(KEYS)) {
    const today = TODAY[preset][busy ? "busy" : "idle"][name];
    it(`${preset} · ${busy ? "busy" : "idle"} · ${name}`, () => {
      // Off, or on with a one-line draft (the composers pass multilineNewline = setting && multi-line): unchanged.
      expect(composerKeyAction(preset, event, ctx(busy, false))).toBe(today);
      // On with a multi-line draft: only plain Enter changes — to a new line (no action, the textarea inserts it).
      expect(composerKeyAction(preset, event, ctx(busy, true))).toBe(name === "Enter" ? null : today);
    });
  }
  it("a held key (auto-repeat) follows the same rule on every repeat: Enter keeps adding lines, never sends", () => {
    const repeat = { ...KEYS.Enter!, repeat: true } as ComposerKeyEvent;
    for (let i = 0; i < 5; i++) expect(composerKeyAction("queueFirst", repeat, ctx(false, true))).toBeNull();
    expect(composerKeyAction("queueFirst", { ...KEYS["Ctrl+Enter"]!, repeat: true } as ComposerKeyEvent, ctx(false, true))).toBe("steer");
  });
  it("an IME composition's Enter is stopped before the rule (confirms the candidate; never a send or a new line)", () => {
    for (const shift of [false, true]) expect(composerCandidateKey({ key: "Enter", shift, isComposing: true }, 0, 0)).toBe("composing");
  });
});

describe("multi-line draft", () => {
  it("a line break anywhere, \\n or \\r\\n, counts; a long one-line draft does not", () => {
    expect(isMultilineDraft("one line")).toBe(false);
    expect(isMultilineDraft("x".repeat(5000))).toBe(false);
    expect(isMultilineDraft("a\nb")).toBe(true);
    expect(isMultilineDraft("a\r\nb")).toBe(true);
    expect(isMultilineDraft("a\n")).toBe(true);
  });
});

describe("the composer hint", () => {
  it("idle: send; busy: steer + how to queue per preset; a delegation turn without steer keys: queue", () => {
    expect(multilineHint("queueFirst", false)).toBe("idle");
    expect(multilineHint("cli", false)).toBe("idle");
    expect(multilineHint("queueFirst", true)).toBe("busyQueueFirst");
    expect(multilineHint("cli", true)).toBe("busyCli");
    expect(multilineHint("queueFirst", true, true)).toBe("busyQueueOnly");
    expect(multilineHint("cli", true, true)).toBe("busyQueueOnly");
  });
  it("names Cmd on macOS", () => {
    expect(displayKey("Ctrl+Enter", true)).toBe("⌘Enter");
    expect(displayKey("Ctrl+Enter", false)).toBe("Ctrl+Enter");
  });
});

describe("keyboard shortcuts page", () => {
  it("lists 「多行草稿里换行」 only while the setting is on", () => {
    const has = (multiline: boolean) => shortcutsFor("queueFirst", multiline).flatMap((g) => g.items).some((s) => s.desc === "shortcuts.enter.multiline");
    expect(has(false)).toBe(false);
    expect(has(true)).toBe(true);
    expect(shortcutsFor("cli", true).flatMap((g) => g.items).some((s) => s.desc === "shortcuts.enter.multiline")).toBe(true);
  });
});
