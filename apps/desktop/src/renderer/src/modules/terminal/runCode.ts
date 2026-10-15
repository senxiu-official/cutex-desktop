// ▶ 运行 on a reply's code block (timeline.codeBlockAction, docs/desktop-modules.md §22): picks the agent's
// workspace terminal (or starts one), shows it, and types the block in. Kept out of terminals.ts so that
// file stays free of i18n (tests mock React around it).
import type { WorkspaceScope } from "../../../../shared/ipc";
import { translate, type MessageKey } from "../../i18n";
import { scopeFor, scopeKey } from "../../lib/workspace";
import { sidebarOf, useApp } from "../../store";
import { services } from "../app";
import { terminalInputOf } from "./codeRun";
import { TERMINAL, terminalIdOf } from "./terminalState";
import { createTerminal, lastFocusedTerminal, refreshList, terminalApi, useTerminals } from "./terminals";

/** A PTY still running (not exited, not gone from the daemon). */
function alive(terminalId: string): boolean {
  const { exited, gone } = useTerminals.getState();
  return !(terminalId in exited) && !gone[terminalId];
}

/**
 * The terminal a code block runs in: an open tab of this workspace (the last focused one, else the most
 * recent), else the workspace's newest live PTY, else a new PTY at the workspace root.
 */
async function terminalFor(hostId: string, scope: WorkspaceScope): Promise<string> {
  const key = scopeKey(scope);
  const open = services.side
    .list(TERMINAL)
    .filter((i) => i.binding.hostId === hostId && i.binding.kind === "workspace" && i.binding.key === key)
    .map((i) => ({ id: i.id, terminalId: terminalIdOf(i.state) }))
    .filter((o): o is { id: string; terminalId: string } => !!o.terminalId && alive(o.terminalId));
  const pick = open.find((o) => o.id === lastFocusedTerminal()) ?? open[open.length - 1];
  if (pick) return pick.terminalId;
  const live = (await refreshList(hostId, scope)).filter((t) => !t.exited).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  if (live[0]) return live[0].terminalId;
  return (await createTerminal(hostId, scope)).terminalId;
}

/**
 * Runs a code block in the agent's workspace terminal: shows the 终端 card on that PTY, then types the
 * block in and presses Enter. The caller has confirmed (multi-line blocks: the armed second click).
 */
export async function runCode(hostId: string, sessionId: string, code: string): Promise<void> {
  const notice = (text: string, tone: "info" | "error") => services.ui.notice(text, tone);
  const scope = scopeFor(sidebarOf(useApp.getState(), hostId), sessionId);
  if (!scope) return notice(translate("terminal.noWorkspace"), "info");
  try {
    const terminalId = await terminalFor(hostId, scope);
    const opened = services.side.open(TERMINAL, { terminalId }, { focus: true, binding: { kind: "workspace", hostId, key: scopeKey(scope) } });
    if (opened.status !== "opened") {
      const reason = opened.status === "stale" ? "stale" : opened.reason;
      return notice(translate("side.unavailable", { what: translate("terminal.title"), reason: translate(`side.reason.${reason}` as MessageKey) }), "info");
    }
    await terminalApi(hostId).terminalInput(terminalId, terminalInputOf(code));
  } catch (e) {
    notice(translate("terminal.runFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
  }
}
