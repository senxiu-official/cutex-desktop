// 终端 card state (pure; RFC right-panel-rfc-20261009 §6.1): an instance is one cutex PTY
// ({ terminalId }), or a short-lived placeholder that creates one / takes in the workspace's live PTYs
// and then hands over to them (Ctrl+`, the title-bar button, ＋). The PTYs live in the daemon.
import { terminalPassesKey } from "../../lib/keybindings";
import type { TerminalSummary, WorkspaceScope } from "../../../../shared/ipc";
import type { Json } from "../types";

export const TERMINAL = "terminal.pty";

export type TerminalState = { terminalId: string } | { pending: string; adopt: boolean };
export type TerminalParams = TerminalState;

const ID = /^[A-Za-z0-9._:-]{1,128}$/;

let seq = 0;
/** A fresh placeholder id (unique per open: a placeholder is never reused). */
export function pendingId(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}`;
}

function record(raw: Json): Record<string, Json> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, Json>) : null;
}

/**
 * Open params: `{ terminalId }` = that PTY; `{ create: true }` = a new PTY; `{ adopt: true }` = the
 * workspace's live PTYs (a new one when there are none). null = refused.
 */
export function parseTerminalParams(raw: Json): TerminalParams | null {
  const r = record(raw);
  if (!r) return null;
  if (typeof r.terminalId === "string") return ID.test(r.terminalId) ? { terminalId: r.terminalId } : null;
  if (r.create === true) return { pending: pendingId(), adopt: false };
  if (r.adopt === true) return { pending: pendingId(), adopt: true };
  return null;
}

export function terminalKey(p: TerminalParams): string {
  return "terminalId" in p ? `pty:${p.terminalId}` : `new:${p.pending}`;
}

export function initTerminal(params: TerminalParams, previous: TerminalState | null): TerminalState {
  return "terminalId" in params ? { terminalId: params.terminalId } : (previous ?? params);
}

/** After a restart only PTY instances come back (a placeholder never outlives its run). */
export function restoreTerminal(raw: Json): TerminalState | null {
  const r = record(raw);
  return r && typeof r.terminalId === "string" && ID.test(r.terminalId) ? { terminalId: r.terminalId } : null;
}

export function terminalIdOf(state: Json): string | null {
  const r = record(state);
  return r && typeof r.terminalId === "string" ? r.terminalId : null;
}

/** The workspace binding key (lib/workspace.ts scopeKey: "project:<id>" / "session:<id>") → the scope. */
export function scopeOfKey(key: string): WorkspaceScope | null {
  const m = /^(project|session):(.+)$/.exec(key);
  return m ? { kind: m[1] as WorkspaceScope["kind"], id: m[2]! } : null;
}

/** 终端 n: the PTY's place among the workspace's PTYs by creation time (1-based); null = unknown. */
export function terminalNumber(list: readonly TerminalSummary[] | undefined, terminalId: string): number | null {
  if (!list) return null;
  const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.terminalId < b.terminalId ? -1 : 1));
  const k = sorted.findIndex((t) => t.terminalId === terminalId);
  return k < 0 ? null : k + 1;
}

/** The shell's short name for the tooltip ("pwsh", "bash"). */
export function shellName(shell: string): string {
  return shell.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ?? shell;
}

/** Live PTYs of a list that no open instance shows yet, oldest first (Ctrl+` takes them in). */
export function missingTerminals(list: readonly TerminalSummary[], open: ReadonlySet<string>): TerminalSummary[] {
  return list.filter((t) => !t.exited && !open.has(t.terminalId)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/**
 * Keys a focused terminal lets through to the window (§3.11): the app's own shortcuts — the keys of the
 * commands lib/keybindings marks `terminal` (Ctrl+`, Ctrl+Alt+B, the page keys, Ctrl+Shift+N / M / D / F,
 * Ctrl+Alt+arrows, Shift+F11, F6 by default; F11 alone and Ctrl+W / Ctrl+T stay the shell's). Everything
 * else (Esc, Ctrl+B, Alt+←, Ctrl+C …) belongs to the shell.
 */
export function passThroughKey(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  return terminalPassesKey(e);
}

/**
 * Whether `data` from xterm's onData is xterm answering a terminal query rather than a keystroke:
 * cursor position / status reports (`CSI … R`, `CSI … n`), device attributes (`CSI ? … c`, `CSI > … c`),
 * mode reports (`CSI ? … $ y`), window reports (`CSI … t`), OSC colour answers (`OSC … rgb:…`) and DCS
 * replies. Keys (arrows, function keys, pasted text) never match.
 */
export function isTerminalReply(data: string): boolean {
  // eslint-disable-next-line no-control-regex -- terminal control sequences
  return /^(?:\x1b\[[\d;]*[Rnt]|\x1b\[[?>][\d;]*c|\x1b\[\??[\d;]*\$y|\x1b\][^\x07\x1b]*rgb:[^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[\s\S]*\x1b\\)+$/.test(data);
}

/** xterm's answer to a cursor position request (`CSI 6 n` → `CSI row ; col R`). */
export function isCursorReport(data: string): boolean {
  // eslint-disable-next-line no-control-regex -- terminal control sequences
  return /^\x1b\[\d+;\d+R$/.test(data);
}

/**
 * Whether a replayed scrollback ends with a cursor position request nobody answered yet: after its last
 * `CSI 6 n` only control sequences or blanks follow. Windows ConPTY (portable-pty starts it with
 * PSEUDOCONSOLE_INHERIT_CURSOR) asks once when the PTY starts and holds the shell until the answer comes; a
 * new terminal's first replay carries that request, and dropping xterm's answer as a stale reply kept
 * PowerShell waiting (#34). An old request is followed by the shell's output (a prompt at least).
 */
export function pendingCursorRequest(bytes: Uint8Array): boolean {
  // Only the last 4 KiB: more bytes after it and the shell has long been running.
  let at = -1;
  for (let i = bytes.length - 4; i >= Math.max(0, bytes.length - 4096); i--) {
    if (bytes[i] === 0x1b && bytes[i + 1] === 0x5b && bytes[i + 2] === 0x36 && bytes[i + 3] === 0x6e) {
      at = i;
      break;
    }
  }
  if (at < 0) return false;
  const tail = String.fromCharCode(...bytes.subarray(at + 4))
    // eslint-disable-next-line no-control-regex -- terminal control sequences
    .replace(/\x1b\[[?>=!]?[\d;]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78c]/g, "");
  return /^[\s\0]*$/.test(tail);
}
