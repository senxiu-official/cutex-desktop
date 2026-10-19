// Requester side of a delegation (委托): the `agent_delegate` call rendered as one live line —
// ⇄ 委托 [avatar] Helper · model  #3 title  ● 运行中 · 12s ▸ — plus a second line while it is held
// (queue position / what it waits for). While it runs the title gives way to the target's live
// activity line. Expanded: brief, progress notes, questions, the result, actions. The state comes
// from lib/delegationStore through selectors (MemoEntry only re-renders on entry changes), else
// from what the transcript says (purged delegations).
import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import type { AskAnswerPage } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { ARMED_BUTTON, ARMED_FRAME, useArmed } from "../lib/armedConfirm";
import { contextMenu, openMenuFrom } from "../lib/contextMenu";
import { attemptSeconds, delegateCallOf, delegationActions, delegationStatus, formatSpan, peerPartyText, requesterSession, stopPending, waitSeconds, type DelegationStatus } from "../lib/delegations";
import { delegationMenu, runDelegationCommand } from "../lib/delegationMenu";
import { delegationApi, hasDelegationViews, loadDelegationDetail, useDelegations } from "../lib/delegationStore";
import { hostKey } from "../lib/hostKeys";
import { useAgentNames, useAgentProfile, useCardDelegation, useDelegationContext, useOwnerSteered, useResolvedAskId } from "../lib/delegationsView";
import { OwnerSteeredBadge } from "./DelegationComposer";
import { focusTurn } from "../lib/focusRequest";
import { useP2Access } from "../lib/p2Access";
import type { RawItem } from "../lib/timeline";
import { useNow } from "../lib/time";
import { featuresOf, useApp } from "../store";
import { useConvHost } from "../lib/conversationScope";
import type { AskQuestion, AskSummary } from "../../../shared/ipc";
import { DelegationHops, DelegationStatusMark, DelegationTag } from "./DelegationParts";
import { PeerParty } from "./PeerParty";
import { DelegationPeerSection } from "./DelegationPeer";
import { DelegationReviewActions } from "./DelegationReview";
import { Markdown } from "./Markdown";
import { Who } from "./Parties";
import { rawIdTitle, useModelName } from "../lib/modelDisplay";

const NO_NOTES: { text: string; at: string }[] = [];
const NO_QUESTIONS: AskQuestion[] = [];
const NO_COMMANDS = { stop: false, retry: false, accept: false, abandon: false } as const;

/** Running / waiting time after the status word. */
function statusTime(d: AskSummary, status: DelegationStatus, now: number): string | null {
  if (status.key === "running" || status.key === "question" || status.key === "answered" || status.key === "accepted") {
    const s = attemptSeconds(d.attempt, now);
    return s === null ? null : formatSpan(s);
  }
  return null;
}

/** Plain question text out of a cutex question record's `questions` (native request shape). */
function questionText(q: AskQuestion): string {
  const list = Array.isArray(q.questions) ? q.questions : [q.questions];
  return list
    .map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? String((x as { question?: unknown }).question ?? (x as { header?: unknown }).header ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <div className="mb-0.5 text-[11px] text-subtle">{title}</div>
      {children}
    </div>
  );
}

/** "查看完整": the answer, page by page (8 KiB each), from `hostId` (the card's host). */
function FullAnswer({ askId, hostId }: { askId: string; hostId: string }) {
  const { t } = useI18n();
  const [pages, setPages] = useState<AskAnswerPage[]>([]);
  const [loading, setLoading] = useState(false);
  const next = pages.length ? pages[pages.length - 1]!.nextCursor : 0;
  const load = async () => {
    if (next === null) return;
    setLoading(true);
    try {
      const page = await delegationApi(hostId).askAnswer(askId, next || undefined);
      if (page) setPages((p) => [...p, page]);
    } finally {
      setLoading(false);
    }
  };
  if (!pages.length)
    return (
      <button onClick={() => void load()} disabled={loading} className="mt-1 text-accent hover:underline disabled:opacity-50">
        {t("delegation.viewFull")}
      </button>
    );
  return (
    <div className="mt-1">
      <Markdown text={pages.map((p) => p.text).join("")} streaming={false} />
      {next !== null && (
        <button onClick={() => void load()} disabled={loading} className="mt-1 text-accent hover:underline disabled:opacity-50">
          {t("delegation.loadMore")}
        </button>
      )}
    </div>
  );
}

/** "查看完整" of a brief that cutex stored as an artifact (too long for the call's text). */
function FullBrief({ artifactId, hostId }: { artifactId: string; hostId: string }) {
  const { t } = useI18n();
  const [text, setText] = useState<string | null>(null);
  if (text !== null) return <Markdown text={text} streaming={false} />;
  return (
    <button onClick={() => void delegationApi(hostId).artifact(artifactId).then((a) => setText(a ? (a.encoding === "utf8" ? a.content : "") : ""))} className="mt-1 text-accent hover:underline">
      {t("delegation.viewFull")}
    </button>
  );
}

/**
 * The delegation's body: brief, progress notes, questions, the peer section, the result, actions.
 * `host`: the host whose record `d` is (the timeline card: the open agent's; the side detail: its
 * binding's). `here`: the session whose timeline shows it (its own card jump is left out of ⋯).
 * `layout`: "card" = under the timeline line (indented, capped); "side" = the right-side detail.
 */
export function DelegationDetailBody({ d, brief, here, host, layout = "card" }: { d: AskSummary; brief: string | null; here: string | null; host: string; layout?: "card" | "side" }) {
  const { t } = useI18n();
  const nameOf = useAgentNames();
  // The record's host, not the focus host: two hosts may run different cutex releases.
  const views = useApp((s) => hasDelegationViews(featuresOf(s, host)));
  const key = hostKey(host, d.askId);
  const liveNotes = useDelegations((s) => s.progress[key] ?? NO_NOTES);
  const liveQuestions = useDelegations((s) => s.questions[key] ?? NO_QUESTIONS);
  const detail = useDelegations((s) => s.details[key]);
  useEffect(() => {
    if (d.revision >= 0) void loadDelegationDetail(host, d.askId);
  }, [host, d.askId, d.revision]);
  const notes = useMemo(() => {
    const seen = new Set<string>();
    return [...(d.attempt?.progress ?? []), ...liveNotes].filter((n) => (seen.has(n.at + n.text) ? false : (seen.add(n.at + n.text), true)));
  }, [d.attempt?.progress, liveNotes]);
  const questions = useMemo(() => {
    const byId = new Map<string, AskQuestion>();
    for (const q of [...(detail?.questions ?? []), ...liveQuestions]) byId.set(q.questionId, { ...byId.get(q.questionId), ...q });
    return [...byId.values()];
  }, [detail?.questions, liveQuestions]);
  const [stopArmed, setStopArmed] = useArmed();
  const [abandonArmed, setAbandonArmed] = useArmed();
  // users-p2-access: a non-owner sees the commands only with send (lib/p2Access).
  const commands = useP2Access(host).delegations;
  const can = commands ? delegationActions(d) : NO_COMMANDS;
  const targetName = d.targetName ?? nameOf(d.target);
  const requester = requesterSession(d.requester);
  const artifact = detail?.body?.textArtifact ?? null;
  const took = attemptSeconds(d.attempt, Date.now());
  const answerMeta = [detail?.answer?.bytes ? `${Math.max(1, Math.round(detail.answer.bytes / 1024))} KB` : null, took !== null && d.execution === "answered" ? t("delegation.took", { t: formatSpan(took) }) : null].filter(Boolean).join(" · ");
  const armed = stopArmed || abandonArmed;
  // Its target is an agent of the open agent's host (not the focus host's).
  const openTarget = () => (views && d.attempt?.turnId ? focusTurn(d.target, d.attempt.turnId, host) : void useApp.getState().select(d.target, host));
  const button = "rounded-md px-2 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground";
  return (
    <div className={`${layout === "card" ? "mt-1 ml-5 max-w-[85%]" : ""} rounded-xl border px-3 py-2 text-xs transition-colors ${armed ? ARMED_FRAME : "border-transparent bg-surface"}`}>
      {/* The side detail (opened from the 需要你 strip, a queue row, a list): the owner review on top. The card has it under its line. */}
      {layout === "side" && <DelegationReviewActions d={d} host={host} variant="side" />}
      {brief && (
        <Section title={t("delegation.brief")}>
          <div className={`${layout === "card" ? "max-h-48 overflow-y-auto" : ""} text-[13px]`}>
            <Markdown text={brief} streaming={false} />
          </div>
          {artifact && <FullBrief artifactId={artifact} hostId={host} />}
        </Section>
      )}
      {notes.length > 0 && (
        <Section title={t("delegation.progress")}>
          <ul className="flex flex-col gap-0.5 text-muted">
            {notes.map((n) => (
              <li key={n.at + n.text} className="flex gap-2">
                <span className="shrink-0 text-subtle tabular-nums">{n.at.slice(11, 16)}</span>
                <span className="min-w-0">{n.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {questions.length > 0 && (
        <Section title={t("delegation.questions")}>
          {questions.map((q) => (
            <div key={q.questionId} className="flex gap-2">
              <span className="min-w-0 flex-1 whitespace-pre-wrap">{questionText(q)}</span>
              <span className={`shrink-0 ${q.state === "open" ? "text-warn" : "text-subtle"}`}>
                {q.state !== "open" ? t("delegation.question.resolved") : q.route === "owner" || q.routedToOwnerAt ? t("delegation.question.owner") : t("delegation.question.requester", { name: requester ? nameOf(requester) : t("delegation.you") })}
              </span>
            </div>
          ))}
        </Section>
      )}
      <DelegationPeerSection d={d} hostId={host} />
      {(d.answerPreview || d.answerId) && (
        <Section title={t("delegation.result")}>
          {d.answerPreview && <div className="text-[13px] whitespace-pre-wrap">{d.answerPreview}</div>}
          {answerMeta && <div className="mt-0.5 text-[11px] text-subtle">{answerMeta}</div>}
          {d.answerId && <FullAnswer askId={d.askId} hostId={host} />}
        </Section>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/60 pt-1.5">
        {armed ? (
          <>
            <span className="mr-1 text-danger">{t("delegation.again")}</span>
            <button
              className={ARMED_BUTTON}
              onClick={() => {
                setStopArmed(false);
                setAbandonArmed(false);
                void (stopArmed ? runDelegationCommand(host, d, "cutex/ask/stop", t) : runDelegationCommand(host, d, "cutex/ask/close", t, "abandoned"));
              }}
            >
              {t(stopArmed ? "delegation.stop" : "delegation.abandon")}
            </button>
          </>
        ) : (
          <>
            {!d.remote && (
              <button className={button} onClick={openTarget}>
                {t("delegation.open", { name: targetName })}
              </button>
            )}
            {can.stop && (
              <button className={`${button} hover:text-danger`} onClick={() => setStopArmed(true)}>
                {t("delegation.stop")}
              </button>
            )}
            {can.retry && (
              <button className={button} onClick={() => void runDelegationCommand(host, d, "cutex/ask/retry", t)}>
                {t("delegation.retry")}
              </button>
            )}
            {can.accept && (
              <button className={button} onClick={() => void runDelegationCommand(host, d, "cutex/ask/close", t, "accepted")}>
                {t("delegation.accept")}
              </button>
            )}
            {can.abandon && (
              <button className={`${button} hover:text-danger`} onClick={() => setAbandonArmed(true)}>
                {t("delegation.abandon")}
              </button>
            )}
            <button className={`${button} ml-auto`} title={t("delegation.more")} aria-label={t("delegation.more")} onClick={(e) => openMenuFrom(e.currentTarget, delegationMenu(d, t, nameOf, { host, here, views }))}>
              <MoreHorizontal size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The live activity line of the target (host feed) while the delegation runs. */
function useTargetActivity(targetId: string, running: boolean): string | null {
  return useApp((s) => (running ? (s.activity[targetId]?.text ?? null) : null));
}

export function DelegationCard({ item, sessionId }: { item: RawItem; sessionId: string }) {
  const { t } = useI18n();
  const call = useMemo(() => delegateCallOf(item)!, [item]);
  // The call result may carry the short form (`ask-123456`, cutex task 06): the store's full id when known.
  const askId = useResolvedAskId(call.askId!);
  const { d, live } = useCardDelegation(askId, call, sessionId);
  const [open, setOpen] = useState(false);
  const nameOf = useAgentNames();
  const host = useConvHost();
  const views = useApp((s) => hasDelegationViews(featuresOf(s, host)));
  const status = delegationStatus(d, useDelegationContext()(d));
  const running = status.key === "running" || status.key === "question";
  const now = useNow(running || status.glyph === "hollow");
  const activity = useTargetActivity(d.target, running);
  const profile = useAgentProfile(d.target || null);
  const modelName = useModelName();
  // The attempt model by the target profile's entry names (lib/modelDisplay); else the profile name.
  const model = d.attempt?.model ? modelName(d.attempt.model, null, profile) : profile;
  const targetName = d.targetName ?? (d.target ? nameOf(d.target) : (call.targetName ?? ""));
  const held = !d.closed && !stopPending(d) && !!d.hold && (d.execution === "queued" || d.execution === "admitted");
  // Held: the word on the right says 排队中 / 受阻; the second line says what for.
  const shown: DelegationStatus = held && status.key !== "question" ? { ...status, key: status.dangerText ? "blocked" : "queued", n: undefined } : status;
  const time = statusTime(d, status, now);
  const tools = running && typeof d.attempt?.activity?.toolCalls === "number" ? t("delegation.tools", { n: d.attempt.activity.toolCalls }) : null;
  const line = running ? (activity ?? d.attempt?.activity?.line ?? null) : null;
  const title = d.title || call.title || call.brief || "";
  const waited = held && d.createdAt ? formatSpan(waitSeconds(d, now) ) : null;
  const ownerSteered = useOwnerSteered(askId, live && !!d.answerId);
  return (
    <div className="my-2" data-ask-id={askId} onContextMenu={contextMenu(() => delegationMenu(d, t, nameOf, { host, here: sessionId, views }))}>
      <button onClick={() => setOpen(!open)} className="flex w-full max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-xs text-muted hover:text-foreground">
        <ArrowLeftRight size={13} className="shrink-0 text-subtle" />
        <span className="shrink-0">{t("delegation.label")}</span>
        {d.remote ? <PeerParty text={peerPartyText(d.remote.targetName || targetName, d.target, d.remote.label)} label={d.remote.label} size={16} /> : <Who id={d.target || null} name={targetName} size={16} />}
        {model && <span className="shrink-0 text-subtle" title={d.attempt?.model ? rawIdTitle(d.attempt.model, model) : undefined}>· {model}</span>}
        <DelegationTag askId={askId} />
        {line ? (
          <span className="min-w-0 truncate text-subtle" title={title}>
            {line}
            {tools && <span className="ml-1.5">· {tools}</span>}
          </span>
        ) : (
          <span className="min-w-0 truncate text-foreground" title={title}>
            {title}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          <DelegationHops hops={d.hops} />
          {ownerSteered && <OwnerSteeredBadge />}
          {live || d.revision >= 0 || status.key !== "queued" ? <DelegationStatusMark status={shown} name={targetName} trailing={time} error={d.attempt?.lastError ?? d.remote?.lastError} /> : null}
          {open ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
        </span>
      </button>
      {held && status.key !== "question" && (
        <div className={`ml-5 text-[11px] ${status.dangerText ? "text-danger" : "text-subtle"}`}>
          <DelegationHoldLine status={status} name={targetName} waited={waited} />
        </div>
      )}
      {/* Delegating to a wider target waits for the owner first (cutex pendingReview): decide it here. */}
      <DelegationReviewActions d={d} host={host} variant="card" />
      {open && <DelegationDetailBody d={d} brief={call.brief} here={sessionId} host={host} />}
    </div>
  );
}

function DelegationHoldLine({ status, name, waited }: { status: DelegationStatus; name: string; waited: string | null }) {
  const { t } = useI18n();
  return (
    <>
      {t(`delegation.status.${status.key}` as Parameters<typeof t>[0], { name, n: status.n ?? "", host: status.host ?? "" })}
      {waited && <span className="text-subtle"> · {t("delegation.waited", { t: waited })}</span>}
    </>
  );
}
