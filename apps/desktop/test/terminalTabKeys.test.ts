// Built-in terminal (owner 2026-10-25: Tab seemed not to accept the shell's completion): Tab and Shift+Tab belong to
// the shell while a terminal has focus. xterm's own key handler sends them (\t / CSI Z) only when the custom key
// handler (XtermView: !passThroughKey) keeps them, and no command may take them for the window: they are composer
// keys, so Settings → 键盘快捷键 refuses them (a "composer" conflict offers no 改用 / take-over).
import { afterEach, describe, expect, it } from "vitest";
import { bindingConflicts, COMMANDS, resetBindings, setBindings, terminalPassesKey } from "../src/renderer/src/lib/keybindings";
import { passThroughKey } from "../src/renderer/src/modules/terminal/terminalState";

const key = (shiftKey: boolean, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) => ({ key: "Tab", code: "Tab", ctrlKey: false, metaKey: false, altKey: false, shiftKey, ...mods });

afterEach(() => resetBindings());

describe("terminal: Tab / Shift+Tab reach the shell", () => {
  it("the terminal keeps Tab and Shift+Tab (xterm sends them to the PTY)", () => {
    expect(passThroughKey(key(false))).toBe(false);
    expect(passThroughKey(key(true))).toBe(false);
    expect(terminalPassesKey(key(false))).toBe(false);
    expect(terminalPassesKey(key(true))).toBe(false);
  });

  it("no command a focused terminal lets through can be bound to Tab / Shift+Tab", () => {
    for (const cmd of COMMANDS.filter((c) => "terminal" in c && c.terminal)) {
      if ("digits" in cmd && cmd.digits) continue;
      for (const combo of ["Tab", "Shift+Tab"]) {
        const reasons = bindingConflicts(cmd.id, combo).map((r) => r.kind);
        expect(reasons, `${cmd.id} ← ${combo}`).toContain("composer");
        // Settings offers 改用 (take over) only when every conflict is another command's: never here.
        expect(reasons.every((r) => r === "command"), `${cmd.id} ← ${combo}`).toBe(false);
      }
    }
  });

  it("other bindings of the terminal-passing commands leave Tab alone", () => {
    setBindings("focusNext", ["F6", "Mod+Alt+KeyN"]);
    setBindings("focusPrev", ["Shift+F6"]);
    expect(terminalPassesKey(key(false))).toBe(false);
    expect(terminalPassesKey(key(true))).toBe(false);
    expect(terminalPassesKey({ key: "F6", code: "F6", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
  });
});
