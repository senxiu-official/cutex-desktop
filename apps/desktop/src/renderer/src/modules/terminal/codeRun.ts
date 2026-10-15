// ▶ 运行 on a reply's shell code block (docs/desktop-modules.md §22; owner 2026-10-09): which blocks get
// the button and what a click does. Pure (no store / React); the button is RunCodeButton.tsx, the run
// itself runCode() in terminals.ts.
import type { HostPlatform } from "../../../../shared/hosts";

/** Fence tags a host's terminal runs: cutex PTYs on Windows are PowerShell, elsewhere a POSIX shell. */
export const WINDOWS_SHELL_TAGS: readonly string[] = ["powershell", "pwsh", "ps1", "cmd"];
export const POSIX_SHELL_TAGS: readonly string[] = ["bash", "sh", "shell", "zsh"];

/** A block tagged `language` gets ▶ 运行 on a host of `platform` (unknown OS → never). */
export function runnableOn(language: string, platform: HostPlatform | null): boolean {
  const tag = language.toLowerCase();
  if (platform === "windows") return WINDOWS_SHELL_TAGS.includes(tag);
  if (platform === "linux" || platform === "macos") return POSIX_SHELL_TAGS.includes(tag);
  return false;
}

/** Lines of a block (trailing newlines don't count; an empty block has 0). */
export function codeLines(code: string): number {
  const text = code.replace(/[\r\n]+$/, "");
  return text ? text.split(/\r?\n/).length : 0;
}

/**
 * A click on ▶ 运行: one line runs at once; several lines arm first (the app's two-step confirm,
 * lib/armedConfirm) and run on the second click while armed. Never auto-runs.
 */
export function runClick(lines: number, armed: boolean): "run" | "arm" {
  return lines <= 1 || armed ? "run" : "arm";
}

/** What goes to the PTY: the block typed in like an xterm paste (line breaks → CR), then Enter. */
export function terminalInputOf(code: string): string {
  return `${code.replace(/[\r\n]+$/, "").replace(/\r?\n/g, "\r")}\r`;
}
