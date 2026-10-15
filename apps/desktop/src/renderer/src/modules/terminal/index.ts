// 终端 (RFC right-panel-rfc-20261009 §6.1, DESIGN §4.19): cutex PTYs rooted at the agent's workspace,
// as tabs of a right-side card (default: the 工作区 page's bottom, 35 %). Replaces the old bottom
// panel. The PTYs live in the daemon: moving / hiding a card only moves the view; closing a tab ends
// its PTY (owner decision D15). Ctrl+` and the title-bar button open the card and take in the
// workspace's live PTYs. ▶ 运行 on a reply's shell code block (timeline.codeBlockAction, §22) types the
// block into the agent's workspace terminal.
import { SquareTerminal } from "lucide-react";
import { translate } from "../../i18n";
import { selectedSidebar, useApp } from "../../store";
import { scopeFor } from "../../lib/workspace";
import { defineModule } from "../slots";
import { TerminalActions, TerminalBody } from "./TerminalBody";
import { RunCodeButton } from "./RunCodeButton";
import { runnableOn } from "./codeRun";
import { useTerminalTab } from "./tabs";
import { killTerminal, listKey, scopeOfBinding, startTerminals, useTerminals } from "./terminals";
import { initTerminal, parseTerminalParams, restoreTerminal, TERMINAL, terminalIdOf, terminalKey, terminalNumber, type TerminalParams, type TerminalState } from "./terminalState";

const TERMINAL_FEATURE = "terminal";

export default defineModule({
  id: "terminal",
  titleKey: "terminal.moduleTitle",
  descriptionKey: "terminal.description",
  // PTYs belong to the agent's host (the card's binding): any connected host with `terminal` activates
  // the module; the card body and ▶ 运行 gate on the binding's / reply's host (TerminalBody, §22).
  requires: { capabilities: [TERMINAL_FEATURE] },
  contributes: {
    "side.component": [
      {
        id: TERMINAL,
        titleKey: "terminal.title",
        icon: SquareTerminal,
        instances: "multi",
        defaultBinding: "workspace",
        keepAlive: "unmount",
        placement: { home: "workspace", order: 800, share: 0.35 },
        parseParams: parseTerminalParams,
        dedupeKey: terminalKey,
        init: (params: TerminalParams, previous: TerminalState | null) => initTerminal(params, previous),
        restore: (raw) => restoreTerminal(raw),
        toRef: (state: TerminalState) => ("terminalId" in state ? { key: `pty:${state.terminalId}`, title: translate("terminal.title"), params: { terminalId: state.terminalId } } : null),
        fromRef: (params) => (params.terminalId ? parseTerminalParams({ terminalId: params.terminalId }) : null),
        useTab: useTerminalTab,
        Body: TerminalBody,
        Actions: TerminalActions,
        // Closing the tab ends the PTY (D15); a placeholder has none yet.
        onClose: async (instance) => {
          const id = terminalIdOf(instance.state);
          if (id) await killTerminal(instance.binding.hostId, id);
          return true;
        },
        closeConfirm: (instance) => {
          const id = terminalIdOf(instance.state);
          if (!id) return null;
          const scope = scopeOfBinding(instance.binding);
          const { lists, exited, gone } = useTerminals.getState();
          const list = scope ? lists[listKey(instance.binding.hostId, scope)] : undefined;
          // An ended PTY (exited, or gone from the daemon) has nothing left to end.
          if (id in exited || gone[id] || (list && !list.some((t) => t.terminalId === id))) return null;
          const n = terminalNumber(list, id);
          return n === null ? translate("terminal.willEnd") : translate("terminal.willEndN", { n });
        },
        // Title-bar launcher (pinned by default) and Ctrl+`: the workspace's terminals (live PTYs taken in,
        // else a new one); ⌥ / middle click and 「新终端」 = always a new PTY.
        launcher: {
          order: 800,
          pin: "default",
          newParams: () => {
            const s = useApp.getState();
            return scopeFor(selectedSidebar(s), s.selectedId) ? { create: true } : null;
          },
          params: () => {
            const s = useApp.getState();
            return scopeFor(selectedSidebar(s), s.selectedId) ? { adopt: true } : null;
          },
        },
      },
    ],
    // The block's tag must be the host's shell (Windows: PowerShell / cmd; Linux / macOS: POSIX shells).
    "timeline.codeBlockAction": [{ id: "terminal.runCode", order: 100, match: ({ language, platform }) => runnableOn(language, platform), Action: RunCodeButton }],
  },
  activate: (ctx) => startTerminals(ctx),
});
