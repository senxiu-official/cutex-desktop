// 终端 card state (pure; RFC right-panel-rfc-20261009 §6.1): an instance is one cutex PTY
// ({ terminalId }), or a short-lived placeholder that creates one / takes in the workspace's live PTYs
// and then hands over to them (Ctrl+`, the title-bar button, ＋). The PTYs live in the daemon.
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
 * Keys a focused terminal lets through to the window (§3.11): the app's own shortcuts. Everything
 * else (Esc, Ctrl+B, Alt+←, Ctrl+C …) belongs to the shell.
 */
export function passThroughKey(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && !e.shiftKey && (e.key === "`" || e.code === "Backquote")) return true;
  if (mod && e.altKey && !e.shiftKey && e.code === "KeyB") return true;
  if (mod && e.shiftKey && !e.altKey && (/^Digit[1-9]$/.test(e.code) || e.code === "KeyN" || e.code === "KeyM")) return true;
  if (e.key === "F11" && e.shiftKey && !mod && !e.altKey) return true;
  if (e.key === "F6" && !mod && !e.altKey) return true;
  return false;
}
