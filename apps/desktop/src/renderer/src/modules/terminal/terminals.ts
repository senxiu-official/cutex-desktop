// The terminal module's runtime (RFC right-panel-rfc-20261009 §6.1, §3.11): what the daemon says about
// the workspace's PTYs, unread / exited marks for the tabs, the output-stream attach count (main keeps
// one stream per PTY), and Ctrl+`. PTYs live in cutex; nothing here spawns a shell.
import { create } from "zustand";
import type { TerminalSummary, WorkspaceScope } from "../../../../shared/ipc";
import type { DaemonApi } from "../../../../shared/ipc";
import { bridge } from "../../bridge";
import { hostApi } from "../../store";
import { services } from "../app";
import { missingTerminals, scopeOfKey, TERMINAL, terminalIdOf } from "./terminalState";
import { scopeKey } from "../../lib/workspace";
import { shortcutKeyUsed } from "../../lib/browserCapture";
import type { AppModuleContext, SideBinding } from "../slots";
import type { MessageKey } from "../../i18n";

interface TerminalsState {
  /** terminalList per host + workspace scope (`listKey`; refreshed on open / create / exit). */
  lists: Record<string, TerminalSummary[]>;
  /** New output while no card shows the PTY. */
  unread: Record<string, true>;
  /** Exited PTYs (exit code); a PTY missing from the daemon's list is "gone". */
  exited: Record<string, number | null>;
  gone: Record<string, true>;
}

export const useTerminals = create<TerminalsState>(() => ({ lists: {}, unread: {}, exited: {}, gone: {} }));

/**
 * PTYs live in the daemon of the workspace's host: the binding's host (multi-host P1: an agent of another
 * host than the focus host opens in place, and its terminals are on that host).
 */
export const terminalApi = (hostId: string): DaemonApi => hostApi(hostId);

/** Key of a host's workspace in `lists`. */
export const listKey = (hostId: string, scope: WorkspaceScope): string => `${hostId}|${scopeKey(scope)}`;

/** The workspace scope of an instance's binding (null: not a workspace binding / malformed). */
export function scopeOfBinding(binding: SideBinding): WorkspaceScope | null {
  return binding.kind === "workspace" ? scopeOfKey(binding.key) : null;
}

/** Reloads a workspace's PTY list; marks instances whose PTY the daemon no longer has. */
export async function refreshList(hostId: string, scope: WorkspaceScope, known: readonly string[] = []): Promise<TerminalSummary[]> {
  const list = await terminalApi(hostId).terminalList(scope);
  useTerminals.setState((s) => {
    const gone = { ...s.gone };
    const exited = { ...s.exited };
    for (const id of known) if (!list.some((t) => t.terminalId === id)) gone[id] = true;
    for (const t of list) {
      delete gone[t.terminalId];
      if (t.exited) exited[t.terminalId] = t.exitCode;
    }
    return { lists: { ...s.lists, [listKey(hostId, scope)]: list }, gone, exited };
  });
  return list;
}

const loading = new Set<string>();
/** Loads a workspace's PTY list once (tab titles of restored terminals); concurrent callers share it. */
export function ensureList(hostId: string, scope: WorkspaceScope): void {
  const key = listKey(hostId, scope);
  if (useTerminals.getState().lists[key] || loading.has(key)) return;
  loading.add(key);
  void refreshList(hostId, scope)
    .catch(() => {})
    .finally(() => loading.delete(key));
}

export async function createTerminal(hostId: string, scope: WorkspaceScope, cols = 100, rows = 24): Promise<TerminalSummary> {
  const created = await terminalApi(hostId).terminalCreate(scope, cols, rows);
  useTerminals.setState((s) => {
    const key = listKey(hostId, scope);
    const list = (s.lists[key] ?? []).filter((t) => t.terminalId !== created.terminalId);
    return { lists: { ...s.lists, [key]: [...list, created] } };
  });
  return created;
}

/** Ends the PTY (closing its tab, §3.8 / D15). Never throws: a PTY already gone is fine. */
export async function killTerminal(hostId: string, terminalId: string): Promise<void> {
  shown.delete(terminalId);
  attached.delete(terminalId);
  await terminalApi(hostId).terminalKill(terminalId).catch(() => {});
  useTerminals.setState((s) => {
    const lists: Record<string, TerminalSummary[]> = {};
    for (const [k, list] of Object.entries(s.lists)) lists[k] = list.filter((t) => t.terminalId !== terminalId);
    const unread = { ...s.unread };
    delete unread[terminalId];
    return { lists, unread };
  });
}

// ── Output streams ──────────────────────────────────────────────────────────────────────────────
// main keeps one SSE stream per PTY (terminalAttach is a no-op when attached). Two kinds of holders:
// a tab's watcher (unread / exit while the card is off screen) and a mounted xterm (needs the
// scrollback replayed: detach + attach). Calls per PTY run in order.

const attached = new Map<string, number>();
/** The host each retained PTY belongs to: output / exit events of another host's same id are not ours. */
const owners = new Map<string, string>();
/** An event of `hostId` about `terminalId` concerns the PTY this module holds (unknown ids: as before). */
export function ownsTerminalEvent(terminalId: string, hostId: string): boolean {
  const owner = owners.get(terminalId);
  return owner === undefined || owner === hostId;
}
const shown = new Set<string>();
const queues = new Map<string, Promise<void>>();

function queue(id: string, op: () => Promise<void>): Promise<void> {
  const next = (queues.get(id) ?? Promise.resolve()).then(op, op).catch(() => {});
  queues.set(id, next);
  return next;
}

function retain(hostId: string, id: string, replay: boolean): () => void {
  const api = terminalApi(hostId);
  owners.set(id, hostId);
  const n = attached.get(id) ?? 0;
  attached.set(id, n + 1);
  if (n === 0) void queue(id, () => api.terminalAttach(id));
  else if (replay) {
    void queue(id, async () => {
      await api.terminalDetach(id);
      await api.terminalAttach(id);
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (attached.get(id) ?? 1) - 1;
    if (left > 0) attached.set(id, left);
    else {
      attached.delete(id);
      void queue(id, () => api.terminalDetach(id));
    }
  };
}

/** A tab's watcher: keeps the output stream while the instance is visible to this agent. */
export function watchTerminal(hostId: string, id: string): () => void {
  return retain(hostId, id, false);
}

/** A mounted xterm: attaches with a fresh scrollback replay; marks the PTY as on screen (no unread). */
export function showTerminal(hostId: string, id: string): () => void {
  shown.add(id);
  clearUnread(id);
  const release = retain(hostId, id, true);
  return () => {
    shown.delete(id);
    release();
  };
}

export function clearUnread(id: string): void {
  if (!useTerminals.getState().unread[id]) return;
  useTerminals.setState((s) => {
    const unread = { ...s.unread };
    delete unread[id];
    return { unread };
  });
}

// ── Ctrl+` (§3.11) ──────────────────────────────────────────────────────────────────────────────

/** Visible terminal instances of the selected agent's view, most recently active first. */
function openTerminals(): { id: string; terminalId: string | null }[] {
  return services.side.list(TERMINAL).map((i) => ({ id: i.id, terminalId: terminalIdOf(i.state) }));
}

function focusComposer(): void {
  document.querySelector<HTMLTextAreaElement>('[data-focus-region="main"] textarea:not([disabled])')?.focus();
}

let lastFocused: string | null = null;
/** The instance whose xterm had focus last (Ctrl+` goes back to it). */
export function noteFocused(instanceId: string): void {
  lastFocused = instanceId;
}

/** The instance whose xterm had focus last (null: none yet). */
export function lastFocusedTerminal(): string | null {
  return lastFocused;
}

/**
 * Ctrl+`: focus in a terminal → back to the composer; a terminal of this workspace open → focus it
 * (the last focused one); none → open by the placement rules, taking in the workspace's live PTYs.
 */
export function toggleTerminalFocus(notice: (reason: string) => void = () => {}): void {
  const active = document.activeElement;
  if (active instanceof Element && active.closest("[data-terminal-view]")) {
    focusComposer();
    return;
  }
  const open = openTerminals();
  if (open.length) {
    const pick = open.find((o) => o.id === lastFocused) ?? open[open.length - 1]!;
    services.side.reveal({ instanceId: pick.id });
    return;
  }
  const result = services.side.open(TERMINAL, { adopt: true }, { focus: true });
  if (result.status === "unavailable") notice(result.reason);
}

/** Takes in the live PTYs of `scope` that no tab shows yet; returns how many it opened. */
export async function adoptTerminals(hostId: string, scope: WorkspaceScope, openOne: (terminalId: string) => void): Promise<number> {
  const list = await refreshList(hostId, scope);
  const open = new Set(openTerminals().map((o) => o.terminalId).filter((x): x is string => !!x));
  const missing = missingTerminals(list, open);
  for (const t of missing) openOne(t.terminalId);
  return missing.length;
}

/** Module activation: the output / exit marks and Ctrl+`. Undone when the module stops. */
export function startTerminals(ctx: AppModuleContext): void {
  const notice = (reason: string) =>
    ctx.services.ui.notice(
      reason === "no-agent" ? ctx.t("terminal.noWorkspace") : ctx.t("side.unavailable", { what: ctx.t("terminal.title"), reason: ctx.t(`side.reason.${reason}` as MessageKey) }),
      "info",
    );
  const offOut =
    typeof bridge.on === "function"
      ? bridge.on("terminalOutput", (e) => {
          if (!ownsTerminalEvent(e.terminalId, e.hostId)) return;
          if (e.replay || shown.has(e.terminalId) || useTerminals.getState().unread[e.terminalId]) return;
          useTerminals.setState((s) => ({ unread: { ...s.unread, [e.terminalId]: true } }));
        })
      : () => {};
  const offExit =
    typeof bridge.on === "function"
      ? bridge.on("terminalExit", (e) => {
          if (!ownsTerminalEvent(e.terminalId, e.hostId)) return;
          attached.delete(e.terminalId); // main closed the stream
          useTerminals.setState((s) => ({ exited: { ...s.exited, [e.terminalId]: e.exitCode } }));
        })
      : () => {};
  const onKey = (e: KeyboardEvent) => {
    if (shortcutKeyUsed(e) || e.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "`" || e.code === "Backquote")) {
      e.preventDefault();
      toggleTerminalFocus(notice);
    }
  };
  // (no window in unit tests)
  const win = typeof window === "undefined" ? null : window;
  win?.addEventListener("keydown", onKey);
  ctx.signal.addEventListener("abort", () => {
    offOut();
    offExit();
    win?.removeEventListener("keydown", onKey);
  });
}
