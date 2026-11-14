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
const BUTTON = "h-5 shrink-0 rounded px-1 hover:bg-surface-2 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

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
    readNow: () => app().sessionAction(sessionId, MESSAGES_WAKE_METHOD, {}, host),
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
  const diagnostics = [`${record.kind} · ${record.state}${record.reason ? ` · ${record.reason}` : ""}${record.stage ? ` · ${record.stage}` : ""}`,
    record.error?.code, record.error ? JSON.stringify(record.error.details) : null, record.details.nativeReason ? String(record.details.nativeReason) : null, record.stalled ? `stalled: ${record.stalled.reason}` : null,
    lastError ? `last action: ${lastError}` : null, `inputId ${record.inputId}`, `registry ${REGISTRY_VERSION}`].filter(Boolean).join("\n");
  return <span className="inline-flex h-5 min-w-0 max-w-full items-center gap-1 text-caption text-subtle" data-testid="input-status" data-state={record.state} data-next-up-state={state} data-input-id={record.inputId}>
    {!silentLabel && <span className={`flex min-w-0 items-center gap-1 ${TONE[def.tone]}`} data-tip={def.meaning[lang]} data-testid="next-up-label" data-variant={variant}>{overlay?.symbol}<span className="min-w-0 truncate tabular-nums">{label}</span></span>}
    {!silentLabel && info && <span className="inline-flex shrink-0 cursor-help text-subtle" data-tip={info} aria-label={info} role="img" data-testid="next-up-info"><Info aria-hidden className="size-3" /></span>}
    {overlay?.addOn}
    {Number.isFinite(coalescing) && <span className="shrink-0 tabular-nums" data-testid="next-up-coalescing">{fill(NEXT_UP_DETAILS.coalescing[lang], { n: Math.max(0, Math.ceil((coalescing - now) / 1000)) })}</span>}
    {record.stalled && <span className="shrink-0 truncate text-warn-text" data-testid="next-up-stalled">{fill(NEXT_UP_DETAILS.stalled[lang], { n: minutes })}</span>}
    {(() => {
      const list = buttons.map(button => <EffectButton key={button.effect} button={button} lang={lang} pending={pending} onRun={run} anchor={button.effect === "viewDetails" || button.effect === "viewReason" ? detailsAnchor : undefined} />);
      return buttonsClassName && list.length ? <span className={buttonsClassName} data-next-up-buttons="">{list}</span> : list;
    })()}
    {details && <AnchoredPanel anchor={detailsAnchor} side="above" label={label} onClose={() => setDetails(false)} className="w-80" data-next-up-details="">
      <div className="space-y-1 p-3 text-caption">
        <div className="font-medium text-foreground">{label}</div>
        <div className="text-muted">{def.meaning[lang]}</div>
        <pre className="selectable whitespace-pre-wrap break-all text-subtle">{diagnostics}</pre>
      </div>
    </AnchoredPanel>}
  </span>;
}

function EffectButton({ button, lang, pending, onRun, anchor }: { button: NextUpButton; lang: Lang; pending: NextUpEffectId | null; onRun(effect: NextUpEffectId, event: React.MouseEvent): void; anchor?: React.RefObject<HTMLButtonElement | null> }) {
  const def = NEXT_UP_EFFECTS[button.effect];
  const tip = !button.enabled && button.reason ? DISABLED_REASONS[button.reason][lang] : "tip" in def ? def.tip[lang] : undefined;
  return <button ref={anchor} type="button" disabled={!button.enabled || pending !== null} onClick={event => onRun(button.effect, event)} data-tip={tip} aria-label={tip ? `${def.label[lang]} — ${tip}` : undefined}
    className={BUTTON} data-effect={button.effect} data-enabled={button.enabled ? "" : undefined} data-disabled-reason={button.reason}>{def.label[lang]}</button>;
}
