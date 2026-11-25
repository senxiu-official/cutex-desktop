// How a delegation ended (cutex r295 terminal notices; lib/delegationTerminal): the detail's 「结束经过」 section — one
// chronological sequence, e.g. 「14:02 第 2 次尝试失败 · 由 Helper 的运行时 · 原因：…」 then 「14:05 已停止 · 由你 · 第 2 次尝试」 —
// and the short 「由 X」 beside a status word (card line, detail header, Next Up status rows, delivered state rows), with
// the whole sequence on hover. An unknown actor reads 「未记录由谁」; the requester's own stop is said in plain muted text.
// Hosts without the fields (and records from before them): nothing renders, every surface stays as it was.
import { useEffect, useState, type RefObject } from "react";
import type { AskDetail, AskSummary } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { requesterSession } from "../lib/delegations";
import { currentEnding, isHandlerFailure, KNOWN_COMPONENTS, noticeWordKey, pendingRetryAfter, reasonOf, selfCaused, terminalNoticesOf, type TerminalActor, type TerminalNotice } from "../lib/delegationTerminal";
import { hostKey } from "../lib/hostKeys";
import { loadDelegationDetail, useDelegations } from "../lib/delegationStore";
import { noteDetail, requestEnding, useEndingHosts } from "../lib/endingLoader";
import { useOwnerWindow } from "../lib/ownerContext";
import { useAgentNames } from "../lib/delegationsView";
import { formatAbsolute, formatAt } from "../lib/time";

type T = ReturnType<typeof useI18n>["t"];
type Key = Parameters<T>[0];

/** Who or what: 你 / an agent's name / cutex's part / 未记录由谁 (never the owner by guess). */
export function actorText(actor: TerminalActor, t: T, nameOf: (id: string) => string, targetName: string): string {
  switch (actor.kind) {
    // 「由你」 / "by you" (not delegation.you's owner term: an ending line speaks to the owner).
    case "owner": return t("delegation.ending.byYou");
    case "agent": return t("delegation.ending.by", { who: nameOf(actor.sessionId) });
    case "system": {
      const known = (KNOWN_COMPONENTS as readonly string[]).includes(actor.component);
      const who = known ? t(`delegation.ending.system.${actor.component}` as Key, { name: targetName }) : t("delegation.ending.system.other", { component: actor.component });
      return t("delegation.ending.by", { who });
    }
    default: return t("delegation.ending.byUnknown");
  }
}

export function reasonText(n: TerminalNotice, t: T): string | null {
  const reason = reasonOf(n);
  if (!reason) return null;
  return "code" in reason ? t(`delegation.ending.reason.${reason.code}` as Key) : reason.text;
}

/** One notice as words: status, by whom, its attempt (a failure says it in its status), its reason. */
export function noticeParts(n: TerminalNotice, t: T, nameOf: (id: string) => string, targetName: string) {
  const word = t(noticeWordKey(n) as Key, { n: n.attempt ?? "", name: targetName });
  const by = actorText(n.actor, t, nameOf, targetName);
  const attempt = !isHandlerFailure(n) && n.attempt !== null ? t("delegation.ending.attempt", { n: n.attempt }) : null;
  return { word, by, attempt, reason: reasonText(n, t) };
}

/** The whole sequence as plain lines (hover text). */
export function sequenceText(notices: readonly TerminalNotice[], t: T, nameOf: (id: string) => string, targetName: string, now = Date.now()): string {
  return notices.map((n) => {
    const p = noticeParts(n, t, nameOf, targetName);
    const at = Date.parse(n.at);
    const time = Number.isFinite(at) ? formatAt(at / 1000, now) : "";
    return [time, [p.word, p.by, p.attempt].filter(Boolean).join(" · "), p.reason ? t("delegation.ending.reason", { reason: p.reason }) : null].filter(Boolean).join(" ");
  }).join("\n");
}

/**
 * The detail of a delegation that may have ended other than by an answer (closed without one, or its attempt failed /
 * was interrupted): loaded for its notices. Others load nothing new.
 */
export function mayHaveEnding(d: Pick<AskSummary, "closed" | "answerId" | "execution" | "revision">): boolean {
  if (d.revision < 0) return false;
  return (!!d.closed && !d.answerId) || d.execution === "failed" || d.execution === "interrupted" || d.execution === "rejected" || d.execution === "cancelled";
}

/** The ending facts of `d` on `host` from the stored detail (reads nothing): the sequence and the one its status names. */
export function useDelegationEnding(host: string, d: AskSummary | null | undefined): { notices: TerminalNotice[]; ending: TerminalNotice | null; detail: AskDetail | null } {
  const key = d ? hostKey(host, d.askId) : null;
  const detail = useDelegations((s) => (key ? (s.details[key] ?? null) : null));
  // A detail read for any reason tells whether this host sends terminal fields (lib/endingLoader).
  useEffect(() => noteDetail(host, detail), [host, detail]);
  if (!d || !detail) return { notices: [], ending: null, detail };
  const notices = terminalNoticesOf(detail);
  return { notices, ending: currentEnding(detail, notices), detail };
}

/**
 * A background read of `d`'s detail for its ending, once `ref` is on screen (IntersectionObserver; without one, at
 * once), bounded per host by lib/endingLoader (2 at a time, backoff after a failure, no reads to a host whose probe had
 * no terminal fields).
 */
export function useEndingRequest(host: string, d: AskSummary | null | undefined, ref: RefObject<Element | null>): void {
  const hostState = useEndingHosts((s) => s.hosts[host]);
  const win = useOwnerWindow();
  const [visible, setVisible] = useState(false);
  const wanted = !!d && mayHaveEnding(d);
  useEffect(() => {
    if (!wanted) return;
    const el = ref.current;
    if (!el || typeof win.IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new win.IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [wanted, ref, win]);
  useEffect(() => {
    if (!wanted || !visible || !d) return;
    const key = hostKey(host, d.askId);
    const has = () => { const s = useDelegations.getState(); const known = s.details[key]; return key in s.details && (known === null || (known?.revision ?? -Infinity) >= d.revision); };
    requestEnding(host, d.askId, loadDelegationDetail, has);
  }, [wanted, visible, host, d?.askId, d?.revision, hostState]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * 「由 X」 after a status word, with the sequence on hover. The requester's own stop is not a warning: muted like the
 * rest. `notices`: the sequence the hover lists (else just this notice).
 */
export function EndingBy({ notice, notices, targetName, className = "" }: { notice: TerminalNotice; notices?: readonly TerminalNotice[]; targetName: string; className?: string }) {
  const { t } = useI18n();
  const nameOf = useAgentNames();
  const by = actorText(notice.actor, t, nameOf, targetName);
  const hint = sequenceText(notices?.length ? notices : [notice], t, nameOf, targetName);
  return (
    <span className={`min-w-0 truncate text-subtle ${className}`} title={hint} data-delegation-ending-by={notice.actor.kind}>
      · {by}
    </span>
  );
}

/** The detail's 「结束经过」: every recorded failure and closure in order, then a retry that has not started. */
export function DelegationEndingSection({ d, host }: { d: AskSummary; host: string }) {
  const { t } = useI18n();
  const nameOf = useAgentNames();
  const { notices, detail } = useDelegationEnding(host, d);
  const requester = requesterSession(d.requester);
  const targetName = d.targetName ?? nameOf(d.target);
  // Only what is not a normal answer: a delegation answered at once has nothing to explain.
  const shown = notices.filter((n) => isHandlerFailure(n) || !(n.execution === "answered" && (n.closed === "completed" || n.closed === "accepted" || n.closed === "superseded" || !n.closed)));
  const retry = pendingRetryAfter(detail, notices);
  if (!shown.length) return null;
  const now = Date.now();
  return (
    <div className="mt-2 first:mt-0" data-delegation-ending="">
      <div className="mb-0.5 text-caption/[inherit] text-subtle">{t("delegation.ending.title")}</div>
      <ol className="flex flex-col gap-1">
        {shown.map((n) => {
          const p = noticeParts(n, t, nameOf, targetName);
          const at = Date.parse(n.at);
          const quiet = selfCaused(n, requester);
          const tone = quiet ? "text-muted" : isHandlerFailure(n) || n.execution === "failed" ? "text-danger-text" : "text-foreground";
          return (
            <li key={n.ref} className="flex min-w-0 gap-2" data-ending-ref={n.ref} data-ending-self={quiet ? "" : undefined}>
              <span className="shrink-0 text-subtle tabular-nums" title={Number.isFinite(at) ? formatAbsolute(at / 1000) : undefined}>{Number.isFinite(at) ? formatAt(at / 1000, now) : ""}</span>
              <span className="min-w-0 flex-1">
                <span className={tone}>{p.word}</span>
                <span className="text-muted"> · {p.by}</span>
                {p.attempt && <span className="text-subtle"> · {p.attempt}</span>}
                {p.reason && <span className="selectable mt-0.5 block line-clamp-3 whitespace-pre-wrap break-words text-muted" title={p.reason}>{t("delegation.ending.reason", { reason: p.reason })}</span>}
              </span>
            </li>
          );
        })}
        {retry !== null && (
          <li className="flex gap-2 text-muted" data-ending-retry={retry}>
            <span className="shrink-0 tabular-nums text-subtle">—</span>
            <span>{t("delegation.ending.retryPending", { n: retry })}</span>
          </li>
        )}
      </ol>
    </div>
  );
}
