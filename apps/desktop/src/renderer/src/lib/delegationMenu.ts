// One action list per delegation, shared by the card's ⋯, the overview rows and the capsule: open
// either party, jump to the card / the handling turn, the commands that apply now (the owner's; a
// non-owner's with users-p2-access + send: lib/p2Access), copy.
import type { AskCommandMethod, AskSummary } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";
import type { MenuEntry } from "./contextMenu";
import { delegationActions, delegationCanResume, NO_DELEGATION_ACTIONS, requesterSession } from "./delegations";
import { delegationCommand, endDelegationFollowUp } from "./delegationStore";
import { OWNER_DISPOSITION_FEATURES, OWNER_DISPOSITION_UNSUPPORTED } from "../../../shared/ownerDispositions";
import { featuresOf } from "../store";
import { focusDelegation, focusTurn } from "./focusRequest";
import { copyText } from "./menus";
import { isShortId } from "./shortIds";
import { p2AccessNow } from "./p2Access";
import { useApp } from "../store";
import { isOwnerFeatures } from "../../../shared/users";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Run an owner command on `hostId`'s record of the delegation; a refusal shows as a notice. */
export async function runDelegationCommand(hostId: string, d: Pick<AskSummary, "askId" | "target">, method: AskCommandMethod, t: T, outcome?: "accepted" | "abandoned"): Promise<void> {
  try {
    const r = await delegationCommand(hostId, d, method, outcome);
    if (!r.ok) useApp.getState().notify(t("delegation.commandFailed", { error: r.error.message || r.error.code }), "error");
  } catch (e) {
    useApp.getState().notify(t("delegation.commandFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
  }
}

/** Whether `hostId` can end follow-up of a delegation (r289 owner-ask-disposition-v1); older hosts show it greyed. */
export function canEndDelegationFollowUp(features: ReadonlySet<string> | null | undefined): boolean {
  return !!features?.has(OWNER_DISPOSITION_FEATURES.askDisposition[0]);
}

/** 结束跟进 is the owner's (cutex: owner-only route): a member's connection never shows it, not even greyed. */
export function endFollowUpShown(features: ReadonlySet<string> | null | undefined): boolean {
  return !features || isOwnerFeatures(features);
}

/** The words for a refused 结束跟进: an older host, an action id already used with other details, anything else. */
export function endFollowUpError(error: { code: string; message?: string }, t: T): string {
  if (error.code === OWNER_DISPOSITION_UNSUPPORTED) return t("followUp.oldHost");
  if (error.code === "idempotency_conflict" || error.code === "action_id_conflict") return t("followUp.actionConflict");
  return t("delegation.endFollowUpFailed", { error: error.message || error.code });
}

/** 结束跟进 on `hostId`'s record of the delegation; a refusal shows as a notice. */
export async function runEndFollowUp(hostId: string, d: Pick<AskSummary, "askId" | "target" | "attempts" | "attempt">, t: T): Promise<void> {
  try {
    const r = await endDelegationFollowUp(hostId, d);
    if (!r.ok) useApp.getState().notify(endFollowUpError(r.error, t), "error");
  } catch (e) {
    useApp.getState().notify(t("delegation.endFollowUpFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
  }
}

/**
 * `host`: the host whose record `d` is (the view's host: the open agent's, the list's); its parties,
 * jumps and commands go there. `nameOf`: display name of an agent id. `here`: the session whose
 * timeline shows the row (its own card / turn jump is left out there). `views`: cutex
 * delegation-views (turn ids) available.
 */
export function delegationMenu(d: AskSummary, t: T, nameOf: (id: string) => string, opts: { host: string; here?: string | null; views?: boolean }): MenuEntry[] {
  // The parties of this record live on its host (a peer party is not a session here: requesterSession is null).
  const host = opts.host;
  const select = (id: string) => useApp.getState().openAgent(id, host);
  const requester = requesterSession(d.requester);
  // An unresolved short id (transcript-only card, cutex task 06) cannot address Management v2.
  // users-p2-access: a non-owner runs these only with send (and an older host: the owner only).
  const can = isShortId(d.askId) || !p2AccessNow(host).delegations ? NO_DELEGATION_ACTIONS : delegationActions(d);
  const followUpOk = canEndDelegationFollowUp(featuresOf(useApp.getState(), host));
  const resume = !isShortId(d.askId) && p2AccessNow(host).delegations && delegationCanResume(d);
  const turnId = opts.views ? (d.attempt?.turnId ?? null) : null;
  const error = d.attempt?.lastError ?? null;
  return [
    requester && { label: t("delegation.openRequester", { name: nameOf(requester) }), onSelect: () => void select(requester) },
    !!d.target && { label: t("delegation.openTarget", { name: d.targetName ?? nameOf(d.target) }), onSelect: () => void select(d.target) },
    requester && opts.here !== requester && { label: t("delegation.jumpCard"), onSelect: () => focusDelegation(requester, d.askId, host) },
    turnId && { label: t("delegation.jumpTurn"), onSelect: () => focusTurn(d.target, turnId, host) },
    (resume || can.stop || can.retry || can.accept || can.abandon || can.endFollowUp) && "separator",
    // Confirm by risk: 结束等待并继续 only lets work the owner delegated go on (one click); 停止 / 放弃 arm in
    // place, like the card's own buttons (components/DelegationCard).
    resume && { label: t("delegation.resumeWait"), info: t("delegation.resumeWaitHint"), onSelect: () => runDelegationCommand(host, d, "cutex/ask/resume", t) },
    can.stop && { label: t("delegation.stop"), danger: true, armed: t("delegation.stopArmed"), onSelect: () => runDelegationCommand(host, d, "cutex/ask/stop", t) },
    can.retry && { label: t("delegation.retry"), onSelect: () => runDelegationCommand(host, d, "cutex/ask/retry", t) },
    can.accept && { label: t("delegation.accept"), onSelect: () => runDelegationCommand(host, d, "cutex/ask/close", t, "accepted") },
    can.abandon && { label: t("delegation.abandon"), danger: true, armed: t("delegation.abandonArmed"), onSelect: () => runDelegationCommand(host, d, "cutex/ask/close", t, "abandoned") },
    can.endFollowUp && endFollowUpShown(featuresOf(useApp.getState(), host)) && (followUpOk
      ? { label: t("followUp.end"), info: t("followUp.confirm"), armed: t("followUp.confirmButton"), onSelect: () => runEndFollowUp(host, d, t) }
      : { label: t("followUp.end"), disabled: true, title: t("followUp.oldHost"), onSelect: () => {} }),
    "separator",
    { label: t("delegation.copyId"), onSelect: () => copyText(d.askId) },
    error && { label: t("delegation.copyError"), onSelect: () => copyText(error) },
  ];
}
