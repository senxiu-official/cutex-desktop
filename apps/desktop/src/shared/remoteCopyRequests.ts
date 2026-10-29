import type { HostBinding } from "./hosts";
import type { CopySource, TransferMeta } from "./remoteCopies";
import { canOpenFileName } from "./localFiles";

const SCRIPT_SUFFIXES = new Set(["py", "pyw", "pyc", "pyo", "pyz", "rb", "rbw", "pl", "pm", "php", "lua", "r", "rscript", "ahk", "au3", "bash", "zsh", "fish", "ksh", "csh", "tcl", "scpt", "applescript", "vba", "mjs", "cjs"]);
/** Downloads must not launch scripts through a system file association. */
export function canOpenCopy(name: string): boolean {
  const suffix = name.split(/[\\/]/).pop()!.replace(/[ .]+$/, "").split(".").pop()!.toLowerCase();
  return canOpenFileName(name) && !SCRIPT_SUFFIXES.has(suffix);
}

export type CopyRequest =
  | { kind: "list" }
  | { kind: "inspect"; source: CopySource; binding: HostBinding }
  | { kind: "start"; source: CopySource; binding: HostBinding; expected: Pick<TransferMeta, "revision" | "size">; replaceId?: string }
  | { kind: "cancel" | "remove" | "open" | "reveal"; id: string }
  | { kind: "keep"; id: string; value: boolean }
  | { kind: "settings"; retentionDays: number | null };
export interface PreparedCopy { source: CopySource; meta: TransferMeta }
