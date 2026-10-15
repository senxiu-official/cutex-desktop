// One action list per delegation, shared by the card's ⋯, the overview rows and the capsule: open
// either party, jump to the card / the handling turn, the commands that apply now (the owner's; a
// non-owner's with users-p2-access + send: lib/p2Access), copy.
import type { AskCommandMethod, AskSummary } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";
import type { MenuEntry } from "./contextMenu";
import { delegationActions, requesterSession } from "./delegations";
import { delegationCommand } from "./delegationStore";
import { focusDelegation, focusTurn } from "./focusRequest";
import { copyText } from "./menus";
import { isShortId } from "./shortIds";
import { p2AccessNow } from "./p2Access";
import { useApp } from "../store";

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
  const can = isShortId(d.askId) || !p2AccessNow(host).delegations ? { stop: false, retry: false, accept: false, abandon: false } : delegationActions(d);
  const turnId = opts.views ? (d.attempt?.turnId ?? null) : null;
  const error = d.attempt?.lastError ?? null;
  return [
    requester && { label: t("delegation.openRequester", { name: nameOf(requester) }), onSelect: () => void select(requester) },
    !!d.target && { label: t("delegation.openTarget", { name: d.targetName ?? nameOf(d.target) }), onSelect: () => void select(d.target) },
    requester && opts.here !== requester && { label: t("delegation.jumpCard"), onSelect: () => focusDelegation(requester, d.askId, host) },
    turnId && { label: t("delegation.jumpTurn"), onSelect: () => focusTurn(d.target, turnId, host) },
    (can.stop || can.retry || can.accept || can.abandon) && "separator",
    can.stop && { label: t("delegation.stop"), danger: true, confirm: t("delegation.stopConfirm"), onSelect: () => runDelegationCommand(host, d, "cutex/ask/stop", t) },
    can.retry && { label: t("delegation.retry"), onSelect: () => runDelegationCommand(host, d, "cutex/ask/retry", t) },
    can.accept && { label: t("delegation.accept"), onSelect: () => runDelegationCommand(host, d, "cutex/ask/close", t, "accepted") },
    can.abandon && { label: t("delegation.abandon"), danger: true, confirm: t("delegation.abandonConfirm"), onSelect: () => runDelegationCommand(host, d, "cutex/ask/close", t, "abandoned") },
    "separator",
    { label: t("delegation.copyId"), onSelect: () => copyText(d.askId) },
    error && { label: t("delegation.copyError"), onSelect: () => copyText(error) },
  ];
}
