// 终端 card (RFC right-panel-rfc-20261009 §6.1): an xterm view of one cutex PTY (the old bottom panel's
// TerminalView, moved into a right-side card), a placeholder that creates / takes in PTYs and hands
// over, and the card's ＋. Closing the tab ends the PTY (index.ts onClose); moving, maximising or
// hiding the column only moves the view (the instance layer never remounts it).
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useI18n } from "../../i18n";
import { useModuleHostGate } from "../../lib/hostGatingView";
import type { SideBodyProps } from "../slots";
import { adoptTerminals, createTerminal, refreshList, scopeOfBinding, useTerminals } from "./terminals";
import { TERMINAL, type TerminalState } from "./terminalState";

// xterm.js stays out of the main bundle until a PTY is shown.
const XtermView = lazy(() => import("./XtermView").then((m) => ({ default: m.XtermView })));
const XTERM_PLACEHOLDER = <div className="h-full min-h-0 w-full flex-1 bg-background" />;

const BTN = "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground";

/** A PTY that ended / that the daemon no longer has: say so, offer a new one or closing the tab. */
function Ended({ props, code, gone }: { props: SideBodyProps<TerminalState>; code: number | null; gone: boolean }) {
  const { t } = useI18n();
  // A gone PTY has nothing left to read: 新终端 takes its place. An exited one keeps its output.
  const fresh = () => {
    props.open(TERMINAL, { create: true }, { focus: true });
    if (gone) props.close();
  };
  const button = "shrink-0 rounded-md border border-border px-2 py-0.5 text-xs whitespace-nowrap hover:bg-hover hover:text-foreground";
  return (
    <div className={gone ? "flex flex-1 flex-col items-center justify-center gap-2.5 p-4 text-center text-xs text-muted" : "flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-xs text-muted"}>
      <span className={gone ? "max-w-72" : "min-w-0 flex-1 truncate"}>{gone ? t("terminal.gone") : code === null ? t("terminal.exited") : t("terminal.exitedCode", { code })}</span>
      <span className="flex shrink-0 gap-1.5">
        <button onClick={fresh} className={button}>
          {t("terminal.new")}
        </button>
        <button onClick={props.close} className={button}>
          {t("terminal.closeTab")}
        </button>
      </span>
    </div>
  );
}

function PtyBody({ props, terminalId }: { props: SideBodyProps<TerminalState>; terminalId: string }) {
  const exited = useTerminals((s) => (terminalId in s.exited ? s.exited[terminalId]! : undefined));
  const gone = useTerminals((s) => !!s.gone[terminalId]);
  const scope = scopeOfBinding(props.instance.binding);
  // Does the daemon still have it (a restart of cutex ends every PTY)?
  useEffect(() => {
    if (scope) void refreshList(props.instance.binding.hostId, scope, [terminalId]).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, props.instance.binding.hostId, scope?.kind, scope?.id]);
  if (gone) return <Ended props={props} code={null} gone />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Suspense fallback={XTERM_PLACEHOLDER}>
        <XtermView hostId={props.instance.binding.hostId} terminalId={terminalId} instanceId={props.instance.id} visible={props.visible} revealed={props.revealed} />
      </Suspense>
      {exited !== undefined && <Ended props={props} code={exited} gone={false} />}
    </div>
  );
}

// Placeholders run once per id (StrictMode mounts effects twice; the run outlives a remount).
const runs = new Map<string, Promise<void>>();

function PendingBody({ props, pending, adopt }: { props: SideBodyProps<TerminalState>; pending: string; adopt: boolean }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    if (runs.has(pending)) return;
    const scope = scopeOfBinding(props.instance.binding);
    const run = (async () => {
      if (!scope) throw new Error(t("terminal.noWorkspace"));
      const openOne = (terminalId: string) => latest.current.open(TERMINAL, { terminalId }, { focus: true });
      const hostId = props.instance.binding.hostId;
      if (adopt && (await adoptTerminals(hostId, scope, openOne)) > 0) return;
      const created = await createTerminal(hostId, scope);
      openOne(created.terminalId);
    })().then(
      () => latest.current.close(),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
    runs.set(pending, run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-subtle">
      {error ? (
        <>
          <span className="text-danger">{error}</span>
          <button onClick={props.close} className="rounded-md border border-border px-2 py-0.5 hover:bg-hover hover:text-foreground">
            {t("terminal.closeTab")}
          </button>
        </>
      ) : (
        <span>{t(adopt ? "terminal.adopting" : "terminal.creating")}</span>
      )}
    </div>
  );
}

export function TerminalBody(props: SideBodyProps<TerminalState>) {
  const { t } = useI18n();
  // The card acts on its binding's host (the agent's), which need not be the focus host: a host
  // without cutex `terminal` (or not loaded yet) gets a calm notice and no calls.
  const gate = useModuleHostGate("terminal", props.instance.binding.hostId);
  if (!gate.ok)
    return (
      <p data-side-unsupported className="p-4 text-xs text-subtle">
        {gate.waiting ? t("modules.missing.waiting") : t("modules.needsCapability", { list: gate.missing.join(", ") })}
      </p>
    );
  const state = props.instance.state;
  if ("pending" in state) return <PendingBody props={props} pending={state.pending} adopt={state.adopt} />;
  return <PtyBody props={props} terminalId={state.terminalId} />;
}

/** The card's ＋: another PTY in the same workspace, as a tab of this card (the page = this page). */
export function TerminalActions(props: SideBodyProps<TerminalState>) {
  const { t } = useI18n();
  return (
    <button onClick={() => props.open(TERMINAL, { create: true }, { focus: true })} title={t("terminal.new")} aria-label={t("terminal.new")} className={BTN}>
      <Plus size={13} />
    </button>
  );
}
