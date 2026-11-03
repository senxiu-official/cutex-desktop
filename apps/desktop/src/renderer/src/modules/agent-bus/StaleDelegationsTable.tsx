// 待清理 → 停滞的委托: open delegations of the host that are not moving (useCleanup / cleanup.ts
// staleDelegations), oldest change first. The action is the owner command cutex allows now
// (lib/delegations delegationActions): 停止 (queued / running) or 放弃 (interrupted, awaiting acceptance),
// both click-twice, sent as cutex/ask/stop | close. A row opens the details: the full title, status, the
// last error, the delegation's ids and a jump to its card.
import { ArmedButton } from "../../components/ArmedButton";
import { EmptyState, ErrorNote, Loading, TextLink } from "../../components/settings/Form";
import type { AskSummary } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { delegationActions, delegationStatus, interruptReasonOf, requesterName, requesterSession } from "../../lib/delegations";
import { useStatusWord } from "../../lib/delegationsView";
import { focusDelegation } from "../../lib/focusRequest";
import { p2AccessNow } from "../../lib/p2Access";
import { isShortId } from "../../lib/shortIds";
import { useTargetHostId } from "../../lib/targetHost";
import { CleanupTable } from "./CleanupTable";
import { secondsSince } from "./cleanup";
import { CLEANUP_ACTION, CLEANUP_ACTION_DANGER, cleanupAge } from "./cleanupText";
import type { StaleDelegationsState } from "./useCleanup";

export function StaleDelegationsTable({ state, minAge, nameOf }: { state: StaleDelegationsState; minAge: number; nameOf(id: string): string }) {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const statusWord = useStatusWord();
  if (state.error && !state.rows) return <ErrorNote>{state.error}</ErrorNote>;
  if (!state.rows) return <Loading rows={2} />;
  const from = (d: AskSummary) => (d.requester.kind === "owner" ? t("agent-bus.stuck.sender.owner") : (requesterName(d.requester) ?? nameOf(requesterSession(d.requester) ?? "")) || t("agent-bus.stuck.unknownParty"));
  const to = (d: AskSummary) => d.targetName ?? nameOf(d.target);
  const owner = p2AccessNow(hostId).delegations;
  return (
    <>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {state.rows.length === 0 ? (
        <EmptyState>{minAge === 0 ? t("agent-bus.cleanup.delegations.emptyAll") : t("agent-bus.cleanup.delegations.empty", { age: cleanupAge(minAge, t) })}</EmptyState>
      ) : (
        <CleanupTable
          rows={state.rows}
          rowKey={(d) => d.askId}
          testId="stale-delegation"
          foldPrefix="cleanup.delegations"
          cells={(d) => {
            const can = isShortId(d.askId) || !owner ? null : delegationActions(d);
            const busy = state.busy.has(d.askId);
            return {
              what: d.title,
              whatTitle: d.title,
              who: `${from(d)} → ${to(d)}`,
              whoTitle: [requesterSession(d.requester), d.target].filter(Boolean).join(" → "),
              age: cleanupAge(secondsSince(d.updatedAt, Date.now()), t),
              state: state.refusals[d.askId] ? <span className="text-warn-text">{t("agent-bus.cleanup.refused")}</span> : statusWord(delegationStatus(d, state.ctxOf(d)), to(d)),
              action: can?.stop ? (
                <ArmedButton shape={`${CLEANUP_ACTION} whitespace-nowrap`} idle={CLEANUP_ACTION_DANGER} hint={`${t("delegation.stopConfirm")}${t("delegation.again")}`} disabled={busy} resetKey={d.revision} testId="stale-delegation-stop" onConfirm={() => void state.command(d, "cutex/ask/stop")}>
                  {busy ? t("agent-bus.cleanup.working") : t("delegation.stop")}
                </ArmedButton>
              ) : can?.abandon ? (
                <ArmedButton shape={`${CLEANUP_ACTION} whitespace-nowrap`} idle={CLEANUP_ACTION_DANGER} hint={`${t("delegation.abandonConfirm")}${t("delegation.again")}`} disabled={busy} resetKey={d.revision} testId="stale-delegation-abandon" onConfirm={() => void state.command(d, "cutex/ask/close", "abandoned")}>
                  {busy ? t("agent-bus.cleanup.working") : t("delegation.abandon")}
                </ArmedButton>
              ) : undefined,
            };
          }}
          details={(d) => {
            const error = d.attempt?.lastError ?? d.remote?.lastError ?? null;
            const requester = requesterSession(d.requester);
            const reason = interruptReasonOf(d);
            const progress = d.attempt?.progress?.at(-1)?.text ?? null;
            return (
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{d.title}</p>
                <p className="text-muted">
                  {statusWord(delegationStatus(d, state.ctxOf(d)), to(d))}
                  {reason ? ` · ${reason}` : ""}
                  {d.hold ? ` · ${d.hold.reason}` : ""}
                </p>
                {progress && <p className="text-subtle [overflow-wrap:anywhere]">{progress}</p>}
                {error && <p className="text-danger [overflow-wrap:anywhere]">{t("agent-bus.cleanup.lastError", { error })}</p>}
                {state.refusals[d.askId] && <p role="status" className="text-warn-text [overflow-wrap:anywhere]">{t("delegation.commandFailed", { error: state.refusals[d.askId]! })}</p>}
                <p className="text-subtle [overflow-wrap:anywhere]">
                  {from(d)} → {to(d)} · {new Date(d.createdAt).toLocaleString()} · {d.askId}
                </p>
                {requester && (
                  <div>
                    <TextLink onClick={() => focusDelegation(requester, d.askId, hostId)}>{t("delegation.jumpCard")}</TextLink>
                  </div>
                )}
              </div>
            );
          }}
        />
      )}
    </>
  );
}
