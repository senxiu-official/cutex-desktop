import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import type { InputRecord } from "@cutex-desktop/protocol";
import { useI18n, type MessageKey } from "../i18n";
import { stalledMinutes } from "../lib/inputLedger/labels";
import {
  DISABLED_REASONS, NEXT_UP_DETAILS, buttonsFor, rowIdentity, NEXT_UP_EFFECTS, NEXT_UP_STATES, REGISTRY_VERSION, fill, langOf, projectNextUp, rowButtons, stateLabelKey,
  type AfterWorkVariant, type Lang, type NextUpStateDef, type NextUpButton, type NextUpContext, type NextUpEffectId, type NextUpStateId,
} from "../lib/inputLedger/nextUpRegistry";
import { REFUSAL_TEXT, type InputActionResult } from "../lib/inputLedger/actionResult";
import { addTombstone, hasTombstone, tombstoneKey, unknownWhat, useTombstones } from "../lib/inputLedger/nextUpTombstones";
import { agentState, featuresOf, useApp } from "../store";
import { usesInputDisposal } from "../lib/deliveryMode";
import { bridge } from "../bridge";
import { useNow } from "../lib/time";
import { useConvHost } from "../lib/conversationScope";
import { useDelegation } from "../lib/delegationStore";
import { awaitsOwnerReview } from "../lib/delegations";
import { decideApprovalOn, useAskReview } from "../lib/approvalDecision";
import { reviewReferences } from "../../../shared/delegationReviews";
import { openDelegationDetail } from "../lib/delegationOpen";
import { MESSAGES_WAKE_METHOD } from "../../../shared/ipc";
import { decisionInput } from "../lib/approvals";
import { AnchoredPanel } from "./AnchoredPanel";
import { hasNoteDiagnostics, noteActionCode, readNowParams, readNowResult, readsSelectedNotes, releaseLiftsPauseOnly, reportsPreTurnNotes } from "../lib/inputLedger/noteDelivery";
import { reportLines, useNoteDeliveryLines } from "../lib/inputLedger/noteDeliveryView";
import { INTERRUPT_SEND_MAX, TooManyToInterrupt, interruptSelection, sendsManyAtOnce } from "../lib/inputLedger/interruptSelection";
import { batchRetryTip, interruptBatchLines } from "../lib/inputLedger/interruptBatchView";

/** Row parts the queue sets: the state shown instead (countdown read point / admission hold), add-ons, own handlers. */
export interface NextUpOverride {
  state?: NextUpStateId;
  /** Row-end add-ons (countdown, grant notice): after the label, never instead of the buttons. */
  addOn?: ReactNode;
  /** State 3 variant (registry 1.5): `timed` reads `{time}` (the countdown), shown after `symbol` (its ring). */
  variant?: AfterWorkVariant;
  time?: string;
  symbol?: ReactNode;
  /** Not used for the label any more (registry 1.6: the label always explains the state); kept for callers. */
  tip?: string;
}

/** Registered words of a failed action (the raw code goes to the details panel and the log, never the toast). */
const ACTION_FAILED = { zh: "没能完成，这一行还在；「查看详情」/「查看原因」里有原因", en: "Could not complete; the row stays. “View details” / “View reason” has the cause" } as const;

const TONE: Record<string, string> = { neutral: "", warn: "text-warn-text", danger: "text-danger-text" };
const BUTTON = "press h-5 shrink-0 rounded px-1 hover:bg-surface-2 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

/** The record's tombstone for 「清除此提示」 (state 14), if any. */
export function useClearedUnknown(record: InputRecord, sessionId: string, hostId: string): boolean {
  useTombstones();
  return hasTombstone(tombstoneKey(hostId, sessionId, rowIdentity(record), unknownWhat(record)));
}

/**
 * The status of one input, from the Next Up registry only (lib/inputLedger/nextUpRegistry): the state's label, fixed
 * add-ons, and its registered buttons — each working now or grey with a registered reason. Shared by Next Up rows and
 * the timeline. `timeline`: a timeline row already says it arrived, so a read / plain accepted record is silent.
 */
export function InputStatus({ record, sessionId, hostId, readOnly = false, timeline = false, ctx: given, handlers, override, buttonsClassName }: {
  record: InputRecord; sessionId: string; hostId?: string; readOnly?: boolean; timeline?: boolean;
  /** Wraps the buttons (a row shows them on hover); the label and add-ons always show. */
  buttonsClassName?: string;
  ctx?: NextUpContext; handlers?: Partial<Record<NextUpEffectId, (event: React.MouseEvent) => unknown>>; override?: NextUpOverride;
}) {
  const { t, locale } = useI18n();
  const lang: Lang = langOf(locale);
  const convHost = useConvHost();
  const host = hostId ?? convHost;
  const live = !!record.stalled || record.reason === "resultCoalescing";
  const now = useNow(live);
  const projection = projectNextUp(record);
  // An unrecognised status stays state 14 with its own buttons: no countdown / hold / grant overlay may turn it into another state.
  const unknownRow = projection.kind === "state" && !!projection.unknown;
  const overlay: NextUpOverride | undefined = unknownRow ? undefined : override;
  const [pending, setPending] = useState<NextUpEffectId | null>(null);
  const busy = useRef(false);
  const [details, setDetails] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const detailsAnchor = useRef<HTMLButtonElement>(null);
  const cleared = useClearedUnknown(record, sessionId, host);
  const delivery = useApp(s => agentState(s.inputs, host, sessionId)?.delivery);
  const disposal = useApp(s => usesInputDisposal(featuresOf(s, host)));
  const disposing = useApp(s => !!agentState(s.inputDisposals ?? {}, host, sessionId)?.[record.inputId]);
  const ownerDraft = useApp(s => record.kind === "owner" ? agentState(s.ledgerOwnerDrafts, host, sessionId)?.[record.inputId] : undefined);
  // Note delivery (owner 2026-11-19): where it is, what it waits for, what blocks it — hover and details lines only.
  const noteLines = useNoteDeliveryLines(record, host, sessionId);
  const selectedRead = useApp(s => readsSelectedNotes(featuresOf(s, host)));
  const diagnosticsOn = useApp(s => hasNoteDiagnostics(featuresOf(s, host)));
  // interrupt-send-many-v1: 打断并发送 takes every unread 插话 of the turn along; its tip says how many go.
  const manyOn = useApp(s => sendsManyAtOnce(featuresOf(s, host)));
  // A batch member's own words (why the batch was not sent / may have been taken), on a host with that contract.
  const deliveryLines = manyOn ? [...noteLines, ...interruptBatchLines(t, record)] : noteLines;
  const sendsTogether = useApp(s => {
    if (!manyOn || record.kind !== "owner" || !record.actions?.includes("interruptSend")) return 0;
    const ledger = agentState(s.inputs, host, sessionId);
    return ledger ? interruptSelection(ledger.records.values(), ledger.delivery, record.inputId).length : 0;
  });
  const notesReportOn = useApp(s => reportsPreTurnNotes(featuresOf(s, host)));
  const ask = useDelegation(host, record.askId);
  const shownState = projection.kind === "state" ? overlay?.state ?? projection.state : null;
  const reviewing = shownState === "review" && !!ask && awaitsOwnerReview(ask);
  const refs = ask ? reviewReferences(ask) : [];
  const review = useAskReview(host, record.askId ?? "", reviewing, refs.filter(ref => ref.kind === "capability").map(ref => ref.approvalId));
  const unknownCode = projection.kind === "state" && projection.unknown ? `${projection.unknown.field}:${projection.unknown.code}` : null;
  useEffect(() => {
    if (unknownCode) bridge.shell?.logError({ kind: "reported", message: `input-ledger unknown status ${unknownCode} (${record.inputId})` });
  }, [unknownCode, record.inputId]);

  // Read in / left Next Up, or plain accepted on the timeline: nothing to show but a screen-reader word.
  if (projection.kind === "hidden" || (timeline && record.state === "accepted" && record.surface !== "pendingNotes" && !record.stalled)) {
    const word = record.state === "accepted" ? "accepted" : record.state;
    return <span className="sr-only" data-testid="input-status" data-state={record.state} data-input-id={record.inputId}>{t(`inputLedger.record.${word}` as MessageKey)}</span>;
  }
  if (cleared) return null;
  const state = shownState!;
  const def: NextUpStateDef = NEXT_UP_STATES[state];
  const shown = { ...projection, state, buttons: state === projection.state ? projection.buttons : buttonsFor(state, record) };
  const ctx: NextUpContext = {
    readOnly,
    askKnown: !!ask,
    canReview: reviewing && !!review.canDecide && !!review.record && !refs.some(ref => ref.kind === "routing"),
    canResume: delivery?.state === "held" && (delivery.reason === "paused" || delivery.reason === "stopHold"),
    canStart: delivery?.state === "offline",
    canReadNow: delivery?.state === "idle",
    idle: delivery?.state === "idle",
    hasText: !!ownerDraft?.text,
    disposal,
    ...given,
    disposing: disposing || !!given?.disposing,
  };
  const buttons = timeline && state !== "unconfirmed" && state !== "failed" && state !== "unknown"
    ? rowButtons(shown, record, ctx).filter(b => b.enabled && b.effect !== "viewDelegation") // the timeline keeps only working actions
    : rowButtons(shown, record, ctx);
  const tell = (text: { zh: string; en: string } | null, tone: "error" | "info" = "info") => { if (text) useApp.getState().notify(text[lang], tone, { hostId: host, sessionId }); };
  const answer = (result: unknown) => {
    const r = result as InputActionResult | undefined;
    if (r && r.ok === false) tell(REFUSAL_TEXT[r.reason], r.reason === "gone" ? "info" : "error");
  };
  /** A failed call: plain words for the owner; the raw code only in the details panel and the diagnostic log. */
  const failed = (error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error);
    setLastError(raw);
    bridge.shell?.logError({ kind: "reported", message: `next-up action failed (${record.inputId}): ${raw}` });
    // Codes the note-delivery contract answers in its own words: never retried here, the row is re-read instead. Only
    // on a host with that contract (现在读取 codes: agent-bus-read-notes-v1; release / revision codes:
    // passive-note-diagnostics-v1); an older host keeps the one plain failure notice below.
    const found = noteActionCode(error);
    const readCode = found === "read_notes_unsupported" || found === "read_notes_unavailable" || found === "request_outcome_unknown";
    // A host that interrupts several at once answers its revision / gone refusals the same way (re-read, no retry).
    const code = found && (readCode ? selectedRead : diagnosticsOn || manyOn) ? found : null;
    const say = (key: MessageKey, tone: "error" | "info") => useApp.getState().notify(t(key), tone, { hostId: host, sessionId });
    // More unread 插话 than one interrupt takes: refused whole before any request (the rest would be dropped).
    if (error instanceof TooManyToInterrupt) { useApp.getState().notify(error.message, "error", { hostId: host, sessionId }); return; }
    // An older runtime pin refuses a batch before interrupting: nothing happened, and no one-at-a-time fallback.
    if (manyOn && /(^|[^_\w])interrupt_send_many_unsupported\b/.test(raw)) { say("interruptSend.manyUnsupported", "error"); return; }
    if (code === "bus_redrive_failed") { say("noteDelivery.release.recorded", "info"); void app().refreshInputs(sessionId, host); return; }
    if (code === "read_notes_unsupported") { say("noteDelivery.readNow.unsupported", "error"); return; }
    if (code === "read_notes_unavailable") { say("noteDelivery.readNow.unavailable", "info"); void app().refreshInputs(sessionId, host); return; }
    if (code === "request_outcome_unknown") { say("noteDelivery.readNow.outcomeUnknown", "error"); void app().refreshInputs(sessionId, host); return; }
    if (code === "revision_conflict" || code === "input_not_holdable" || code === "input_not_found") { tell(REFUSAL_TEXT[code === "input_not_found" ? "gone" : "changed"]); void app().refreshInputs(sessionId, host); return; }
    tell(ACTION_FAILED, "error");
  };
  const app = () => useApp.getState();
  const builtIn: Partial<Record<NextUpEffectId, (event: React.MouseEvent) => unknown>> = {
    dismiss: async () => answer(await app().dismissInput(sessionId, record.inputId, host)),
    ignoreNotice: async () => answer(await app().dismissInput(sessionId, record.inputId, host)),
    retry: async () => answer(await app().retryInput(sessionId, record.inputId, host)),
    retryNotice: async () => answer(await app().retryInput(sessionId, record.inputId, host)),
    interruptSend: async () => answer(await app().interruptSendInput(sessionId, record.inputId, host)),
    hold: async () => answer(await app().holdInput(sessionId, record.inputId, true, host)),
    releaseHold: async () => answer(await app().holdInput(sessionId, record.inputId, false, host)),
    viewDelegation: () => record.askId && openDelegationDetail(host, record.askId, { title: ask?.title }),
    resume: () => app().resumePaused(sessionId, host),
    start: () => app().sessionAction(sessionId, "cutex/runtime/online", {}, host),
    // 现在读取: the clicked note as a fixed set when the host takes one (carried with the owner input atomically); an
    // older host keeps the capture-what-is-pending call. The answer's counts are not read receipts: the row stays until
    // the ledger says the note is in context. Notes the turn did not carry are said, never resent from here.
    readNow: async () => {
      const result = readNowResult(await app().sessionAction(sessionId, MESSAGES_WAKE_METHOD, readNowParams([record.inputId], selectedRead), host));
      // Not confirmed carried (skipped may include notes whose admission answer was lost) and whole-report errors, said
      // as they are; a carried count is not news here (the row itself goes once the ledger says it is in context).
      const report = notesReportOn ? result.passiveNotes : null;
      if (report && (report.skipped.length || report.errors.length)) {
        const lines = reportLines(t, { ...report, admitted: [] });
        app().notify(lines.join(" · "), report.errors.length ? "error" : "info", { hostId: host, sessionId });
      }
    },
    refresh: () => app().refreshInputs(sessionId, host),
    viewDetails: () => setDetails(open => !open),
    viewReason: () => setDetails(open => !open),
    clearNotice: () => { if (!addTombstone(tombstoneKey(host, sessionId, rowIdentity(record), unknownWhat(record)))) tell({ zh: "没能保存，这条提示还会显示", en: "Could not save; this notice still shows" }, "error"); },
    moveToComposer: async () => {
      const result = await app().dismissInput(sessionId, record.inputId, host);
      if (result.ok && ownerDraft) app().insertIntoComposer(sessionId, ownerDraft.text, "append", ownerDraft.extra.length ? ownerDraft.extra : undefined, host);
      else answer(result);
    },
    approve: async (event) => { if (review.record) { const r = await decideApprovalOn(host, review.record, "approve", { surface: "delegation", input: decisionInput(event) }); if (!r.ok) tell({ zh: r.error.message, en: r.error.message }, "error"); } },
    reject: async (event) => { if (review.record) { const r = await decideApprovalOn(host, review.record, "deny", { surface: "delegation", input: decisionInput(event) }); if (!r.ok) tell({ zh: r.error.message, en: r.error.message }, "error"); } },
  };
  const run = async (effect: NextUpEffectId, event: React.MouseEvent) => {
    if (busy.current) return;
    // input-disposal-v1: 删除 is the owner's durable dispose (receipt + pending handling), never the old revisioned
    // queue remove a caller may pass; older hosts keep that handler.
    const handler = effect === "remove" && ctx.disposal ? builtIn.dismiss : handlers?.[effect] ?? builtIn[effect];
    if (!handler) return;
    busy.current = true; setPending(effect);
    try { await handler(event); }
    catch (error) { failed(error); }
    finally { busy.current = false; setPending(null); }
  };
  const minutes = stalledMinutes(record, now);
  const coalescing = record.reason === "resultCoalescing" ? Date.parse(record.deadline ?? "") : NaN;
  const variant = overlay?.variant;
  const label = t(stateLabelKey(state, variant) as MessageKey, { time: overlay?.time ?? "" });
  // Registry 1.6: ⓘ only on passiveNote, afterWork timed, unconfirmed and needsAction.
  const info = def.info && (state !== "afterWork" || variant === "timed") ? def.info[lang] : null;
  const silentLabel = timeline && (state === "awaitingRead" || state === "sending");
  const detailLines = deliveryLines.length ? `\n${deliveryLines.join("\n")}` : "";
  const diagnostics = [`${record.kind} · ${record.state}${record.reason ? ` · ${record.reason}` : ""}${record.stage ? ` · ${record.stage}` : ""}`,
    record.error?.code, record.error ? JSON.stringify(record.error.details) : null, record.details.nativeReason ? String(record.details.nativeReason) : null, record.stalled ? `stalled: ${record.stalled.reason}` : null,
    lastError ? `last action: ${lastError}` : null, `inputId ${record.inputId}`, `registry ${REGISTRY_VERSION}`].filter(Boolean).join("\n");
  return <span className="inline-flex h-5 min-w-0 max-w-full items-center gap-1 text-caption text-subtle" data-testid="input-status" data-state={record.state} data-next-up-state={state} data-input-id={record.inputId}>
    {!silentLabel && <span className={`flex min-w-0 items-center gap-1 ${TONE[def.tone]}`} data-tip={def.meaning[lang] + detailLines} data-testid="next-up-label" data-variant={variant}>{overlay?.symbol}<span className="min-w-0 truncate tabular-nums">{label}</span></span>}
    {!silentLabel && info && <span className="inline-flex shrink-0 cursor-help text-subtle" data-tip={info + detailLines} aria-label={info + detailLines} role="img" data-testid="next-up-info"><Info aria-hidden className="size-3" /></span>}
    {overlay?.addOn}
    {Number.isFinite(coalescing) && <span className="shrink-0 tabular-nums" data-testid="next-up-coalescing">{fill(NEXT_UP_DETAILS.coalescing[lang], { n: Math.max(0, Math.ceil((coalescing - now) / 1000)) })}</span>}
    {record.stalled && <span className="shrink-0 truncate text-warn-text" data-testid="next-up-stalled">{fill(NEXT_UP_DETAILS.stalled[lang], { n: minutes })}</span>}
    {(() => {
      // 允许发送 on a note both paused by you and held at an old send point: say that this click lifts only your pause.
      const extraTip = (effect: NextUpEffectId) => effect === "releaseHold" && releaseLiftsPauseOnly(record) ? t("noteDelivery.release.pauseOnly") : undefined;
      const tipFor = (effect: NextUpEffectId) => effect === "interruptSend" && sendsTogether > INTERRUPT_SEND_MAX ? t("interruptSend.tooMany", { max: INTERRUPT_SEND_MAX })
        : effect === "interruptSend" && sendsTogether > 1 ? t("interruptSend.manyTip", { n: sendsTogether })
        : effect === "retry" && manyOn ? batchRetryTip(t, record) : undefined;
      const list = buttons.map(button => <EffectButton key={button.effect} button={button} lang={lang} pending={pending} onRun={run} extraTip={extraTip(button.effect)} tipOverride={tipFor(button.effect)} anchor={button.effect === "viewDetails" || button.effect === "viewReason" ? detailsAnchor : undefined} />);
      return buttonsClassName && list.length ? <span className={buttonsClassName} data-next-up-buttons="">{list}</span> : list;
    })()}
    {details && <AnchoredPanel anchor={detailsAnchor} side="above" label={label} onClose={() => setDetails(false)} className="w-80" data-next-up-details="">
      <div className="space-y-1 p-3 text-caption">
        <div className="font-medium text-foreground">{label}</div>
        <div className="text-muted">{def.meaning[lang]}</div>
        {deliveryLines.length > 0 && <div className="space-y-0.5 text-foreground" data-testid="next-up-delivery-lines">{deliveryLines.map((line, i) => <div key={i}>{line}</div>)}</div>}
        <pre className="selectable whitespace-pre-wrap break-all text-subtle">{diagnostics}</pre>
      </div>
    </AnchoredPanel>}
  </span>;
}

function EffectButton({ button, lang, pending, onRun, anchor, extraTip, tipOverride }: { button: NextUpButton; lang: Lang; pending: NextUpEffectId | null; onRun(effect: NextUpEffectId, event: React.MouseEvent): void; anchor?: React.RefObject<HTMLButtonElement | null>; extraTip?: string; tipOverride?: string }) {
  const def = NEXT_UP_EFFECTS[button.effect];
  const base = !button.enabled && button.reason ? DISABLED_REASONS[button.reason][lang] : tipOverride ?? ("tip" in def ? def.tip[lang] : undefined);
  const tip = button.enabled && extraTip ? [base, extraTip].filter(Boolean).join("\n") : base;
  return <button ref={anchor} type="button" disabled={!button.enabled || pending !== null} onClick={event => onRun(button.effect, event)} data-tip={tip} aria-label={tip ? `${def.label[lang]} — ${tip}` : undefined}
    className={BUTTON} data-effect={button.effect} data-enabled={button.enabled ? "" : undefined} data-disabled-reason={button.reason}>{def.label[lang]}</button>;
}
