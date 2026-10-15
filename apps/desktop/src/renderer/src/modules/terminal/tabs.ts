// 终端 tab titles / badges (useTab; kept out of the .tsx files). Title 终端 n (n = the PTY's place in its
// workspace), tooltip shell · cwd, unread = new output while no card shows it. No busy: cutex does not
// report a foreground process (RFC §6.1: not guessed on the desktop).
import { useEffect } from "react";
import { useI18n } from "../../i18n";
import type { SideTabInfo, SideTabProps } from "../slots";
import { ensureList, listKey, scopeOfBinding, useTerminals, watchTerminal } from "./terminals";
import { shellName, terminalNumber, type TerminalState } from "./terminalState";

export function useTerminalTab({ instance }: SideTabProps<TerminalState>): SideTabInfo {
  const { t } = useI18n();
  const state = instance.state;
  const terminalId = "terminalId" in state ? state.terminalId : null;
  const scope = scopeOfBinding(instance.binding);
  const hostId = instance.binding.hostId;
  const list = useTerminals((s) => (scope ? s.lists[listKey(hostId, scope)] : undefined));
  const unread = useTerminals((s) => (terminalId ? !!s.unread[terminalId] : false));
  const exited = useTerminals((s) => (terminalId ? terminalId in s.exited || !!s.gone[terminalId] : false));
  // While the tab is visible to this agent, keep the output stream (unread, exit) even off screen.
  useEffect(() => (terminalId ? watchTerminal(hostId, terminalId) : undefined), [hostId, terminalId]);
  useEffect(() => {
    if (scope && terminalId) ensureList(hostId, scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, scope?.kind, scope?.id, terminalId]);
  if (!terminalId) return { title: t("terminal.title") };
  const n = terminalNumber(list, terminalId);
  const summary = list?.find((x) => x.terminalId === terminalId);
  const title = n === null ? t("terminal.title") : t("terminal.tab", { n });
  // A loaded list without it: the daemon no longer has the PTY (a background tab is not probed).
  const missing = list !== undefined && !summary;
  return {
    title: exited || missing ? t("terminal.tabEnded", { title }) : title,
    tooltip: summary ? `${shellName(summary.shell)} · ${summary.cwd}` : undefined,
    unread: unread || undefined,
  };
}
