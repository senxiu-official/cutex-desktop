// The 后台终端 status category: the agent's background terminals (CPU / memory, terminate). Capsule
// section and status-row chip share the rows. `/ps` (and the tool row's background chip) opens the
// list where the category lives; with no terminal it hands over to the sub-agents (`ps` "agents").
import { useState } from "react";
import { SquareTerminal, Square } from "lucide-react";
import type { BackgroundTerminal } from "../../../../shared/ipc";
import { StatusChip } from "../../components/StatusChip";
import { useI18n } from "../../i18n";
import { ARMED_BUTTON, ARMED_FRAME, useArmed } from "../../lib/armedConfirm";
import { useUiSignal } from "../../lib/uiSignal";
import { sessionApi, useApp } from "../../store";
import { CAPSULE_ROW, CAPSULE_ROW_ACTION, CAPSULE_ROW_ICON, CAPSULE_ROW_META, capsuleRowActions } from "../../lib/capsuleRows";
import type { StatusBarProps } from "../slots";
import { useTerminals, type TerminalsData } from "./useTerminalsStatus";

function formatRss(kb: number | null): string {
  if (kb === null) return "";
  return kb > 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`;
}

/** One background terminal (lib/capsuleRows): command · CPU / memory; terminate (and the disabled
 *  输出) take the meta's place on hover / focus. Terminate is click-twice (lib/armedConfirm). */
function TerminalRow({ term, onTerminate }: { term: BackgroundTerminal; onTerminate(): Promise<void> }) {
  const { t } = useI18n();
  const [armed, setArmed] = useArmed();
  const usage = [term.cpuPercent !== null && `${term.cpuPercent.toFixed(0)}%`, formatRss(term.rssKb)].filter(Boolean).join(" · ");
  const where = [term.cwd, term.osPid !== null && `pid ${term.osPid}`].filter(Boolean).join(" · ");
  return (
    <div data-capsule-row="" title={`${term.command}\n${where}`} className={`${CAPSULE_ROW} border transition-colors ${armed ? ARMED_FRAME : "border-transparent hover:bg-hover"}`}>
      <span className={CAPSULE_ROW_ICON}>
        <SquareTerminal size={14} className={armed ? "text-danger" : ""} />
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{term.command}</span>
      {armed ? <span className="shrink-0 text-[11px] text-danger">{t("background-terminals.terminateAgain")}</span> : usage && <span className={CAPSULE_ROW_META}>{usage}</span>}
      <span className={capsuleRowActions(armed)}>
        {!armed && (
          <button title={t("background-terminals.output")} disabled className={CAPSULE_ROW_ACTION}>
            {t("background-terminals.output")}
          </button>
        )}
        <button
          onClick={() => {
            if (!armed) return setArmed(true);
            setArmed(false);
            void onTerminate();
          }}
          title={t("background-terminals.terminate")}
          aria-label={t("background-terminals.terminate")}
          className={armed ? `${ARMED_BUTTON} shrink-0` : `${CAPSULE_ROW_ACTION} hover:text-danger`}
        >
          {armed ? t("background-terminals.terminate") : <Square size={12} />}
        </button>
      </span>
    </div>
  );
}

function TerminalRows({ sessionId, data }: { sessionId: string; data: TerminalsData }) {
  const { threadId, terminals, refresh } = data;
  const terminate = async (processId: string) => {
    if (!threadId) return;
    try {
      await sessionApi(sessionId).terminateBackgroundTerminal(sessionId, threadId, processId);
    } catch (e) {
      useApp.getState().notify(e instanceof Error ? e.message : String(e), "error");
    }
    refresh();
  };
  return (
    <div>
      {terminals.map((term) => (
        <TerminalRow key={term.processId} term={term} onTerminate={() => terminate(term.processId)} />
      ))}
    </div>
  );
}

export function TerminalsMeta({ data }: { sessionId: string; data: TerminalsData }) {
  return <span>{data.terminals.length}</span>;
}

export function TerminalsBody({ sessionId, data }: { sessionId: string; data: TerminalsData }) {
  return <TerminalRows sessionId={sessionId} data={data} />;
}

/** Status-row chip「N 后台终端」+ the `/ps` requests. */
export function TerminalsStatusBar({ sessionId, inline, reveal }: StatusBarProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const data = useTerminals(sessionId);
  const n = data.terminals.length;
  useUiSignal("ps", (arg) => {
    if (arg === "agents") return;
    if (n === 0) return useApp.getState().signal("ps", "agents");
    reveal("view", () => setOpen(true));
  });
  if (n === 0 || (!inline && !open)) return null;
  return (
    <StatusChip
      open={open}
      onOpenChange={setOpen}
      panelClassName="right-6 w-[28rem]"
      label={
        <>
          <SquareTerminal size={13} />
          {t("background-terminals.count", { n })}
        </>
      }
    >
      <TerminalRows sessionId={sessionId} data={data} />
    </StatusChip>
  );
}
