// @vitest-environment jsdom
// Rebindable keyboard shortcuts (lib/keybindings): every command fires with its default on both platforms, a
// rebinding fires the new combo and not the old, conflicts are refused, the handlers route through the
// registry (no hard-coded key left), and Settings → 键盘快捷键 records / refuses / restores.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "zh-CN" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  bindingConflicts,
  bindingLabel,
  bindingsOf,
  COMMANDS,
  commandOf,
  comboLabel,
  currentConflicts,
  defaultBindings,
  digitBindingLabel,
  isDefault,
  matchDigit,
  matchesCommand,
  parseCombo,
  parseOverrides,
  resetBindings,
  resetKeybindingsForTests,
  setBindings,
  setKeybindingPlatform,
  setRecordingKeys,
  terminalPassesKey,
  type CommandId,
  type KeyLike,
} from "../src/renderer/src/lib/keybindings";
import { paneKeyAction } from "../src/renderer/src/lib/paneKeys";
import { passThroughKey } from "../src/renderer/src/modules/terminal/terminalState";
import { isTrayKey } from "../src/renderer/src/lib/trayModel";
import { isQuickSwitchKey, paletteKey } from "../src/renderer/src/modules/quick-switch/model";
import { KeybindingsSection } from "../src/renderer/src/components/settings/KeybindingsSection";

type Platform = "mac" | "other";

/** The key press of a combo string on `platform` (digits family: digit `n`). */
function press(combo: string, platform: Platform, n = 3): KeyLike & { code: string } {
  const parts = combo.split("+");
  let key = parts.pop()!;
  if (key === "Digits") key = `Digit${n}`;
  const mods = new Set(parts);
  const mac = platform === "mac";
  const ctrl = mac ? mods.has("Ctrl") : mods.has("Mod") || mods.has("Ctrl");
  const meta = mac ? mods.has("Mod") || mods.has("Meta") : mods.has("Meta");
  const shown = /^Key[A-Z]$/.test(key) ? key.slice(3).toLowerCase() : /^Digit\d$/.test(key) ? key.slice(5) : key;
  return { key: shown, code: key, ctrlKey: ctrl, metaKey: meta, altKey: mods.has("Alt"), shiftKey: mods.has("Shift") };
}

const ids = COMMANDS.map((c) => c.id) as CommandId[];

beforeEach(() => {
  resetKeybindingsForTests();
  setKeybindingPlatform("other");
});
afterEach(() => {
  resetKeybindingsForTests();
  setKeybindingPlatform(null);
});

describe("the command registry", () => {
  it.each(["other", "mac"] as Platform[])("every command fires with each of its defaults (%s) and no other command takes the same press", (platform) => {
    setKeybindingPlatform(platform);
    for (const id of ids) {
      const def = COMMANDS.find((c) => c.id === id)!;
      for (const combo of defaultBindings(id)) {
        const e = press(combo, platform);
        if ("digits" in def && def.digits) expect(matchDigit(id, e), `${id} ${combo}`).toBe(3);
        else expect(matchesCommand(id, e), `${id} ${combo}`).toBe(true);
        // The settings search and the conversation search share Ctrl+F on purpose (they never meet).
        const others = ids.filter((o) => o !== id && (matchesCommand(o, e) || matchDigit(o, e) !== null));
        expect(others.filter((o) => !(["settingsSearch", "threadSearch"].includes(o) && ["settingsSearch", "threadSearch"].includes(id))), `${id} ${combo}`).toEqual([]);
      }
    }
  });

  it.each(["other", "mac"] as Platform[])("the defaults are conflict-free and allowed (%s)", (platform) => {
    setKeybindingPlatform(platform);
    expect(currentConflicts()).toEqual([]);
    for (const id of ids)
      for (const combo of defaultBindings(id)) {
        const own = bindingConflicts(id, combo).filter((r) => r.kind !== "command");
        expect(own, `${id} ${combo}`).toEqual([]);
      }
  });

  it("uses the platform's command key: Ctrl elsewhere, ⌘ on macOS (not the other one)", () => {
    expect(matchesCommand("sidebar", { key: "b", code: "KeyB", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(matchesCommand("sidebar", { key: "b", code: "KeyB", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe(false);
    expect(comboLabel("Mod+Shift+KeyN")).toBe("Ctrl+Shift+N");
    expect(bindingLabel("quickSwitch")).toBe("Ctrl+K");
    setKeybindingPlatform("mac");
    expect(matchesCommand("sidebar", { key: "b", code: "KeyB", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe(true);
    expect(matchesCommand("sidebar", { key: "b", code: "KeyB", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(false);
    expect(comboLabel("Mod+Shift+KeyN")).toBe("⇧⌘N");
    expect(bindingLabel("quickSwitch")).toBe("⌘K");
    // ⌘` cycles a Mac app's windows: the terminal keeps ⌃`.
    expect(bindingsOf("terminal")).toEqual(["Ctrl+Backquote"]);
    expect(bindingLabel("terminal")).toBe("⌃`");
  });

  it("reads the physical key, with the typed key as a fallback (layouts, synthetic events)", () => {
    expect(matchesCommand("quickSwitch", { key: "л", code: "KeyK", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(matchesCommand("quickSwitch", { key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(matchDigit("sidePage", { key: "#", code: "Digit3", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(3);
    expect(matchesCommand("zoomIn", { key: "+", code: "BracketRight", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
  });

  it("bare printable keys and Alt+← never fire inside a text field; nothing fires while recording or composing", () => {
    const input = document.createElement("input");
    const slash = { key: "/", code: "Slash", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: input };
    expect(matchesCommand("settingsSearch", { ...slash, target: document.body })).toBe(true);
    expect(matchesCommand("settingsSearch", slash)).toBe(false);
    expect(matchesCommand("settingsSearch", { ...slash, key: "f", code: "KeyF", ctrlKey: true })).toBe(true);
    expect(matchesCommand("jumpBack", { key: "ArrowLeft", code: "ArrowLeft", ctrlKey: false, metaKey: false, altKey: true, shiftKey: false, target: input })).toBe(false);
    setRecordingKeys(true);
    expect(matchesCommand("sidebar", press("Mod+KeyB", "other"))).toBe(false);
    setRecordingKeys(false);
    expect(matchesCommand("sidebar", { ...press("Mod+KeyB", "other"), isComposing: true } as KeyLike)).toBe(false);
    expect(matchesCommand("sidebar", { ...press("Mod+KeyB", "other"), keyCode: 229 })).toBe(false);
    expect(matchDigit("sidePage", { ...press("Mod+Shift+Digit3", "other"), which: 229 })).toBeNull();
  });
});

describe("rebinding", () => {
  it("a new combo fires, the old one does not; 恢复默认 brings the default back", () => {
    setBindings("sidebar", ["Mod+Alt+KeyS"]);
    expect(isDefault("sidebar")).toBe(false);
    expect(matchesCommand("sidebar", press("Mod+Alt+KeyS", "other"))).toBe(true);
    expect(matchesCommand("sidebar", press("Mod+KeyB", "other"))).toBe(false);
    expect(bindingLabel("sidebar")).toBe("Ctrl+Alt+S");
    resetBindings("sidebar");
    expect(isDefault("sidebar")).toBe(true);
    expect(matchesCommand("sidebar", press("Mod+KeyB", "other"))).toBe(true);
  });

  it("a digits command moves as a family; none = no key at all", () => {
    setBindings("shelfPage", ["Mod+Alt+Digits"]);
    expect(matchDigit("shelfPage", press("Mod+Alt+Digits", "other", 7))).toBe(7);
    expect(matchDigit("shelfPage", press("Alt+Digits", "other", 7))).toBeNull();
    expect(digitBindingLabel("shelfPage", 2)).toBe("Ctrl+Alt+2");
    setBindings("tray", []);
    expect(bindingLabel("tray")).toBe("");
    expect(matchesCommand("tray", press("Mod+KeyJ", "other"))).toBe(false);
  });

  it("the handlers' routers follow the rebinding (panes, terminal pass-through, tray, quick switch)", () => {
    expect(paneKeyAction(press("Mod+KeyW", "other"))).toBe("closeTab");
    expect(paneKeyAction(press("F11", "other"))).toBe("fullscreen");
    expect(paneKeyAction(press("Shift+F11", "other"))).toBe("fullscreen");
    expect(paneKeyAction(press("Mod+Alt+ArrowUp", "other"))).toBe("focusUp");
    setBindings("paneCloseTab", ["Mod+Shift+KeyQ"]);
    expect(paneKeyAction(press("Mod+KeyW", "other"))).toBeNull();
    expect(paneKeyAction(press("Mod+Shift+KeyQ", "other"))).toBe("closeTab");

    // A focused terminal: the app's keys come through, F11 alone / Ctrl+W / Ctrl+B / Ctrl+C stay the shell's.
    expect(passThroughKey(press("Mod+Backquote", "other"))).toBe(true);
    expect(passThroughKey(press("Mod+Shift+KeyF", "other"))).toBe(true);
    expect(passThroughKey(press("F6", "other"))).toBe(true);
    expect(passThroughKey(press("F11", "other"))).toBe(false);
    expect(passThroughKey(press("Mod+KeyW", "other"))).toBe(false);
    expect(passThroughKey(press("Mod+KeyB", "other"))).toBe(false);
    expect(passThroughKey(press("Mod+KeyC", "other"))).toBe(false);
    setBindings("terminal", ["Mod+Alt+KeyT"]);
    expect(passThroughKey(press("Mod+Backquote", "other"))).toBe(false);
    expect(passThroughKey(press("Mod+Alt+KeyT", "other"))).toBe(true);
    expect(terminalPassesKey(press("Mod+Alt+KeyT", "other"))).toBe(true);

    expect(isTrayKey(press("Mod+KeyJ", "other"))).toBe(true);
    setBindings("tray", ["Mod+Shift+KeyJ"]);
    expect(isTrayKey(press("Mod+KeyJ", "other"))).toBe(false);
    expect(isTrayKey(press("Mod+Shift+KeyJ", "other"))).toBe(true);

    setBindings("quickSwitch", ["Mod+KeyP"]);
    expect(isQuickSwitchKey(press("Mod+KeyP", "other"))).toBe(true);
    expect(paletteKey(press("Mod+KeyP", "other"), false)).toEqual({ type: "close" });
    expect(isQuickSwitchKey(press("Mod+KeyK", "other"))).toBe(false);
  });

  it("stored overrides: unknown commands, junk and digit-shape mismatches are dropped; [] stays none", () => {
    expect(parseOverrides({ v: 1, bindings: { sidebar: ["Ctrl+KeyE", "nonsense", 3], nope: ["Mod+KeyA"], shelfPage: ["Alt+KeyA", "Alt+Digits"], tray: [] } })).toEqual({ sidebar: ["Mod+KeyE"], shelfPage: ["Alt+Digits"], tray: [] });
    expect(parseOverrides({ v: 2, bindings: { sidebar: ["Mod+KeyE"] } })).toEqual({});
    expect(parseOverrides(null)).toEqual({});
    // Setting the defaults again is no override.
    setBindings("sidebar", ["Ctrl+KeyB"]);
    expect(isDefault("sidebar")).toBe(true);
  });
});

describe("conflicts", () => {
  it("refuses another command's key, system keys, the composer's, the terminal's, typing keys and digit-shape mismatches", () => {
    expect(bindingConflicts("sidebar", "Mod+KeyK")).toEqual([{ kind: "command", id: "quickSwitch" }]);
    expect(bindingConflicts("sidebar", "Mod+Shift+Digit2")).toEqual([{ kind: "command", id: "sidePage" }]);
    expect(bindingConflicts("sidebar", "Alt+F4").map((r) => r.kind)).toContain("reserved");
    expect(bindingConflicts("sidebar", "Meta+KeyE").map((r) => r.kind)).toContain("reserved");
    expect(bindingConflicts("sidebar", "Mod+KeyC").map((r) => r.kind)).toContain("composer");
    expect(bindingConflicts("sidebar", "Mod+Enter").map((r) => r.kind)).toContain("composer");
    expect(bindingConflicts("sideToggle", "Mod+KeyE").map((r) => r.kind)).toContain("terminal");
    expect(bindingConflicts("sidebar", "Mod+KeyE")).toEqual([]); // not a key a terminal lets through
    expect(bindingConflicts("sidebar", "KeyE").map((r) => r.kind)).toContain("typing");
    expect(bindingConflicts("sidebar", "Shift+KeyE").map((r) => r.kind)).toContain("typing");
    expect(bindingConflicts("sidebar", "Alt+Digits").map((r) => r.kind)).toContain("digits");
    expect(bindingConflicts("shelfPage", "Alt+KeyE").map((r) => r.kind)).toContain("digits");
    // The settings search and the conversation search never meet.
    expect(bindingConflicts("threadSearch", "Mod+KeyF")).toEqual([]);
    setKeybindingPlatform("mac");
    expect(bindingConflicts("sidebar", "Mod+KeyQ").map((r) => r.kind)).toContain("reserved");
    expect(bindingConflicts("sidebar", "Mod+Backquote").map((r) => r.kind)).toContain("reserved");
  });

  it("a stale clash (both keys stored) is reported", () => {
    setBindings("sidebar", ["Mod+KeyJ"]);
    expect(currentConflicts()).toEqual([{ a: "sidebar", b: "tray", combo: "Mod+KeyJ" }]);
  });
});

describe("Settings → 键盘快捷键", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(h(KeybindingsSection)));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const q = (sel: string) => host.querySelector<HTMLElement>(sel);
  const key = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));

  it("lists every command with its keys", () => {
    for (const id of ids) expect(q(`[data-keybinding='${id}']`), id).not.toBeNull();
    expect(q("[data-keybinding='quickSwitch'] [data-keybinding-key]")?.textContent).toBe("Ctrl+K");
  });

  it("click → record → saved; the old key no longer fires; 恢复默认 per command", () => {
    act(() => q("[data-keybinding='sidebar'] [data-keybinding-key]")!.click());
    expect(q("[data-keybinding='sidebar'] [data-keybinding-recording]")).not.toBeNull();
    // The app's commands are quiet while recording.
    expect(matchesCommand("quickSwitch", press("Mod+KeyK", "other"))).toBe(false);
    key({ key: "Control", code: "ControlLeft", ctrlKey: true }); // a modifier alone: still waiting
    expect(q("[data-keybinding='sidebar'] [data-keybinding-recording]")).not.toBeNull();
    key({ key: "e", code: "KeyE", ctrlKey: true, altKey: true });
    expect(bindingsOf("sidebar")).toEqual(["Mod+Alt+KeyE"]);
    expect(q("[data-keybinding='sidebar'] [data-keybinding-key]")?.textContent).toBe("Ctrl+Alt+E");
    expect(matchesCommand("quickSwitch", press("Mod+KeyK", "other"))).toBe(true);
    expect(q("[data-keybinding='sidebar'] [data-modified]")).not.toBeNull();
    act(() => q("[data-keybinding='sidebar'] [data-modified] button[title='shortcuts.custom.reset']")!.click());
    expect(bindingsOf("sidebar")).toEqual(["Mod+KeyB"]);
  });

  it("Esc cancels the recording and keeps the key", () => {
    act(() => q("[data-keybinding='tray'] [data-keybinding-key]")!.click());
    key({ key: "Escape", code: "Escape", keyCode: 229 });
    expect(q("[data-keybinding-recording]")).not.toBeNull();
    key({ key: "Escape", code: "Escape" });
    expect(q("[data-keybinding-recording]")).toBeNull();
    expect(bindingsOf("tray")).toEqual(["Mod+KeyJ"]);
  });

  it("a conflict is shown and not saved until resolved: refuse, or take the key over", () => {
    act(() => q("[data-keybinding='sidebar'] [data-keybinding-key]")!.click());
    key({ key: "c", code: "KeyC", ctrlKey: true });
    expect(q("[data-keybinding='sidebar'] [data-keybinding-conflict]")?.textContent).toContain("shortcuts.conflict.composer");
    expect(bindingsOf("sidebar")).toEqual(["Mod+KeyB"]);
    // A system / composer clash offers no way to save it.
    expect([...host.querySelectorAll("[data-keybinding-conflict] button")].map((b) => b.textContent)).toEqual(["shortcuts.custom.retry", "shortcuts.custom.cancel"]);
    act(() => (host.querySelectorAll<HTMLElement>("[data-keybinding-conflict] button")[1] as HTMLElement).click());
    expect(q("[data-keybinding-conflict]")).toBeNull();

    act(() => q("[data-keybinding='sidebar'] [data-keybinding-key]")!.click());
    key({ key: "j", code: "KeyJ", ctrlKey: true });
    expect(q("[data-keybinding-conflict]")?.textContent).toContain("shortcuts.conflict.command");
    expect(bindingsOf("sidebar")).toEqual(["Mod+KeyB"]);
    act(() => (host.querySelector("[data-keybinding-conflict] button") as HTMLElement).click());
    expect(bindingsOf("sidebar")).toEqual(["Mod+KeyJ"]);
    expect(bindingsOf("tray")).toEqual([]);
    expect(currentConflicts()).toEqual([]);
  });

  it("+ adds a second key, × removes one, 全部恢复默认 resets everything", () => {
    act(() => q("[data-keybinding='capsule'] [data-keybinding-add]")!.click());
    key({ key: "y", code: "KeyY", ctrlKey: true, shiftKey: true });
    expect(bindingsOf("capsule")).toEqual(["Mod+Period", "Mod+Shift+KeyY"]);
    act(() => (q("[data-keybinding='capsule'] button[aria-label^='shortcuts.custom.remove']") as HTMLElement).click());
    expect(bindingsOf("capsule")).toEqual(["Mod+Shift+KeyY"]);
    act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "shortcuts.custom.resetAll")!.click());
    expect(bindingsOf("capsule")).toEqual(["Mod+Period"]);
    expect(ids.every(isDefault)).toBe(true);
  });

  it("a digits command records modifiers + any digit as the 1…9 family", () => {
    act(() => q("[data-keybinding='shelfPage'] [data-keybinding-key]")!.click());
    key({ key: "5", code: "Digit5", ctrlKey: true, altKey: true });
    expect(bindingsOf("shelfPage")).toEqual(["Mod+Alt+Digits"]);
    expect(q("[data-keybinding='shelfPage'] [data-keybinding-key]")?.textContent).toBe("Ctrl+Alt+1 … 9");
  });
});

describe("no hard-coded handler for a registry command", () => {
  const SRC = join(__dirname, "../src/renderer/src");
  // Local keys of one widget (not window / pane commands), each with its reason.
  const ALLOW: Record<string, string> = {
    "lib/keybindings.ts": "the registry itself",
    "components/settings/KeybindingsSection.tsx": "records digits as the 1…9 family",
    "modules/home/DeskSurface.tsx": "Ctrl+Z undo while arranging the desk",
    "components/AgentMentionInput.tsx": "Ctrl+Z / Ctrl+Y undo and redo inside the focused rich draft",
    "modules/quick-switch/model.ts": "Ctrl+N / Ctrl+P move in the open palette",
    "modules/workspace/explorer/Explorer.tsx": "the file tree's own filter / copy keys while it has focus",
  };
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.(ts|tsx)$/.test(f) ? [join(dir, f)] : []));
  // A modifier / key test of one of the registry's keys.
  const HARD = /code === "(Key[A-Z]|Backquote|Comma|Period|Slash|Equal|Minus)"|key(\.toLowerCase\(\))? [!=]== "([a-z]|,|\.|`|=|\+|-|_|0|F11|F6)"|Digit\[1-9\]|\(e\.key === "\/"|e\.key !== "ArrowLeft" \|\| e\.defaultPrevented/;

  it("only the registry decides what a window / pane key does", () => {
    const hits: string[] = [];
    for (const f of files(SRC)) {
      const rel = relative(SRC, f).replace(/\\/g, "/");
      if (rel.startsWith("dev/") || rel.startsWith("i18n/") || ALLOW[rel]) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (HARD.test(line) && !/^\s*(\/\/|\*)/.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it("the old per-file key tests are gone", () => {
    const text = (rel: string) => readFileSync(join(SRC, rel), "utf8");
    expect(text("components/TitleBar.tsx")).not.toMatch(/ctrlKey|metaKey/);
    expect(text("components/HostSwitcher.tsx")).not.toMatch(/e\.code === "KeyH"/);
    expect(text("lib/useSideShortcuts.ts")).not.toMatch(/ctrlKey|metaKey|e\.code/);
    expect(text("lib/paneKeys.ts")).not.toMatch(/ctrlKey|metaKey|e\.code/);
    expect(text("modules/terminal/terminalState.ts")).not.toMatch(/"Backquote"|"KeyB"|"F11"|"F6"/);
    expect(text("lib/workspaceEffects.ts")).not.toMatch(/e\.key !== "ArrowLeft"/);
    expect(text("components/gutter/ReturnChip.tsx")).not.toMatch(/e\.key !== "ArrowLeft"/);
    expect(text("lib/appearance.ts")).not.toMatch(/e\.key === "="/);
  });

  it("every command lists through commandOf in its declared order", () => {
    expect(commandOf(press("Mod+KeyB", "other"), ["tray", "sidebar"])).toBe("sidebar");
    expect(parseCombo("Mod+Nope")).toBeNull();
  });
});
