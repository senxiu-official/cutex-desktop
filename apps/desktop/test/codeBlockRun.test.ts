// ▶ 运行 on reply code blocks (docs/desktop-modules.md §22): tag × host OS, one-line vs multi-line
// confirm, what reaches the PTY, and the outlet's match filter.
import { describe, expect, it } from "vitest";
import { codeLines, POSIX_SHELL_TAGS, runClick, runnableOn, terminalInputOf, WINDOWS_SHELL_TAGS } from "../src/renderer/src/modules/terminal/codeRun";
import { fenceLanguage, matchCodeBlockActions, trimCode, type CodeBlockActionEntry } from "../src/renderer/src/lib/codeBlockScope";

describe("runnableOn: the block's tag must be the host's shell", () => {
  it("Windows hosts: PowerShell / cmd tags only", () => {
    for (const tag of ["powershell", "pwsh", "ps1", "cmd", "PowerShell", "PWSH"]) expect(runnableOn(tag, "windows"), tag).toBe(true);
    for (const tag of ["bash", "sh", "shell", "zsh"]) expect(runnableOn(tag, "windows"), tag).toBe(false);
  });
  it("Linux / macOS hosts: POSIX shell tags only", () => {
    for (const platform of ["linux", "macos"] as const) {
      for (const tag of ["bash", "sh", "shell", "zsh", "Bash"]) expect(runnableOn(tag, platform), `${platform} ${tag}`).toBe(true);
      for (const tag of ["powershell", "pwsh", "ps1", "cmd"]) expect(runnableOn(tag, platform), `${platform} ${tag}`).toBe(false);
    }
  });
  it("unknown OS, other languages and untagged blocks: never", () => {
    for (const tag of [...WINDOWS_SHELL_TAGS, ...POSIX_SHELL_TAGS]) expect(runnableOn(tag, null)).toBe(false);
    for (const platform of ["windows", "linux", "macos"] as const) for (const tag of ["", "python", "ts", "console", "fish", "text"]) expect(runnableOn(tag, platform)).toBe(false);
  });
});

describe("one-line vs multi-line confirm", () => {
  it("counts lines without trailing newlines", () => {
    expect(codeLines("")).toBe(0);
    expect(codeLines("\n")).toBe(0);
    expect(codeLines("git status")).toBe(1);
    expect(codeLines("git status\n\n")).toBe(1);
    expect(codeLines("a\nb")).toBe(2);
    expect(codeLines("a\r\nb\r\nc\r\n")).toBe(3);
    expect(codeLines("a\n\nb")).toBe(3);
  });
  it("one line runs on the first click; several lines arm first and run on the armed click", () => {
    expect(runClick(1, false)).toBe("run");
    expect(runClick(1, true)).toBe("run");
    expect(runClick(2, false)).toBe("arm");
    expect(runClick(2, true)).toBe("run");
    expect(runClick(12, false)).toBe("arm");
  });
});

describe("terminal input", () => {
  it("types the block like an xterm paste, then Enter", () => {
    expect(terminalInputOf("git status")).toBe("git status\r");
    expect(terminalInputOf("git status\n")).toBe("git status\r");
    expect(terminalInputOf("a\nb\r\nc\n\n")).toBe("a\rb\rc\r");
  });
});

describe("outlet helpers", () => {
  const entry = (id: string, match: (b: { language: string }) => boolean, order?: number) => ({ item: { id, order, match, Action: () => null }, moduleId: id.split(".")[0]!, mode: "show", missing: [], waiting: false }) as unknown as CodeBlockActionEntry;
  it("keeps the entries whose match accepts the block, by order; a throwing match is a no (logged)", () => {
    const logged: string[] = [];
    const entries = [entry("b.late", () => true, 300), entry("a.bash", (b) => b.language === "bash", 100), entry("c.boom", () => { throw new Error("x"); })];
    const block = { language: "bash", hostId: "local", platform: "linux" as const };
    expect(matchCodeBlockActions(entries, block, (id) => logged.push(id)).map((e) => e.item.id)).toEqual(["a.bash", "b.late"]);
    expect(logged).toEqual(["c.boom"]);
    expect(matchCodeBlockActions(entries, { ...block, language: "python" }, () => {}).map((e) => e.item.id)).toEqual(["b.late"]);
  });
  it("reads the fence tag and trims the trailing newlines", () => {
    expect(fenceLanguage("language-Bash")).toBe("Bash");
    expect(fenceLanguage("foo language-pwsh bar")).toBe("pwsh");
    expect(fenceLanguage(undefined)).toBe("");
    expect(trimCode("ls\n\n")).toBe("ls");
  });
});
