// The terminal card's pure state (modules/terminal/terminalState.ts; RFC right-panel-rfc-20261009 §6.1).
import { describe, expect, it } from "vitest";
import type { TerminalSummary } from "../src/shared/ipc";
import {
  initTerminal,
  missingTerminals,
  parseTerminalParams,
  passThroughKey,
  restoreTerminal,
  scopeOfKey,
  shellName,
  terminalIdOf,
  terminalKey,
  terminalNumber,
} from "../src/renderer/src/modules/terminal/terminalState";

const pty = (terminalId: string, createdAt: string, exited = false): TerminalSummary => ({
  terminalId,
  scope: "project",
  rootId: "p1",
  cwd: "D:/w",
  shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  pid: 1,
  cols: 80,
  rows: 24,
  createdAt,
  exited,
  exitCode: exited ? 0 : null,
});

const key = (over: Partial<KeyboardEvent>) => ({ key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

describe("terminal params / state", () => {
  it("a PTY by id; a placeholder for create / adopt (fresh key each time); anything else refused", () => {
    expect(parseTerminalParams({ terminalId: "t-1" })).toEqual({ terminalId: "t-1" });
    expect(parseTerminalParams({ terminalId: "bad id/../" })).toBeNull();
    const a = parseTerminalParams({ create: true });
    const b = parseTerminalParams({ create: true });
    expect(a).toMatchObject({ adopt: false });
    expect(terminalKey(a!)).not.toBe(terminalKey(b!));
    expect(parseTerminalParams({ adopt: true })).toMatchObject({ adopt: true });
    expect(parseTerminalParams({})).toBeNull();
    expect(parseTerminalParams(null)).toBeNull();
    expect(parseTerminalParams(["x"])).toBeNull();
    expect(terminalKey({ terminalId: "t-1" })).toBe("pty:t-1");
  });

  it("init keeps a PTY; restore drops placeholders (they never outlive a run)", () => {
    expect(initTerminal({ terminalId: "t-2" }, { terminalId: "t-2" })).toEqual({ terminalId: "t-2" });
    expect(restoreTerminal({ terminalId: "t-3" })).toEqual({ terminalId: "t-3" });
    expect(restoreTerminal({ pending: "x", adopt: true })).toBeNull();
    expect(restoreTerminal("t-3")).toBeNull();
    expect(terminalIdOf({ terminalId: "t-4" })).toBe("t-4");
    expect(terminalIdOf({ pending: "x", adopt: false })).toBeNull();
  });

  it("workspace binding key → scope", () => {
    expect(scopeOfKey("project:p1")).toEqual({ kind: "project", id: "p1" });
    expect(scopeOfKey("session:abc:def")).toEqual({ kind: "session", id: "abc:def" });
    expect(scopeOfKey("host:local")).toBeNull();
  });
});

describe("terminal numbering and adoption", () => {
  const list = [pty("b", "2026-10-10T01:00:02Z"), pty("a", "2026-10-10T01:00:01Z"), pty("c", "2026-10-10T01:00:03Z", true)];

  it("终端 n = order of creation in the workspace", () => {
    expect(terminalNumber(list, "a")).toBe(1);
    expect(terminalNumber(list, "b")).toBe(2);
    expect(terminalNumber(list, "c")).toBe(3);
    expect(terminalNumber(list, "zz")).toBeNull();
    expect(terminalNumber(undefined, "a")).toBeNull();
  });

  it("Ctrl+` takes in the live PTYs no tab shows, oldest first", () => {
    expect(missingTerminals(list, new Set()).map((t) => t.terminalId)).toEqual(["a", "b"]);
    expect(missingTerminals(list, new Set(["a"])).map((t) => t.terminalId)).toEqual(["b"]);
    expect(shellName(list[0]!.shell)).toBe("pwsh");
  });
});

describe("keys a focused terminal lets through (§3.11)", () => {
  it("the app's shortcuts reach the window", () => {
    expect(passThroughKey(key({ key: "`", code: "Backquote", ctrlKey: true }))).toBe(true);
    expect(passThroughKey(key({ key: "b", code: "KeyB", ctrlKey: true, altKey: true }))).toBe(true);
    expect(passThroughKey(key({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(passThroughKey(key({ key: "N", code: "KeyN", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(passThroughKey(key({ key: "M", code: "KeyM", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(passThroughKey(key({ key: "F11", code: "F11", shiftKey: true }))).toBe(true);
    expect(passThroughKey(key({ key: "F6", code: "F6" }))).toBe(true);
  });

  it("the shell keeps everything else (Esc, Ctrl+B, Ctrl+C, Alt+←, F11)", () => {
    expect(passThroughKey(key({ key: "Escape", code: "Escape" }))).toBe(false);
    expect(passThroughKey(key({ key: "b", code: "KeyB", ctrlKey: true }))).toBe(false);
    expect(passThroughKey(key({ key: "c", code: "KeyC", ctrlKey: true }))).toBe(false);
    expect(passThroughKey(key({ key: "ArrowLeft", code: "ArrowLeft", altKey: true }))).toBe(false);
    expect(passThroughKey(key({ key: "F11", code: "F11" }))).toBe(false);
  });
});
