// Rows of the turn-group queue panel (cutex admission-order, lib/admissionOrder.ts) other than the
// owner's queued messages: a delegation's turn (the 待处理委托 row + the tells it carries) and a
// ride-along delivery (queue redesign 2026-10-15): a small muted kind icon (its kind word is the
// icon's label), the most specific text — the sender (`from`) + the first line (`preview`, cutex
// admission-ridealong-detail) or a non-generic label — and the timing as quiet words at the end.
// Never only a kind word: without any text the row says kind · sender · when it was enqueued.
// A ride-along of a delegation (cutex `askId`, loaded in the asks store) shows that delegation instead:
// the other party · #tag · title; the tag / title open its card (on the session's host), right click =
// the delegation menu.
// Timing words (the full sentence is the tooltip / aria-label):
//   下一步 = read at the next step (the owner's inserts too: their kind icon is ↳, muted)
//   ring + N 秒后插入 = a wake waiting for the turn end, depleting until it inserts at the next step (legacy);
//   ledger rows: ring + 「1:45 后可插入」, then 「等待插入时机」 (WakeCountdown, the server's nextStepAt)
//   本回合结束后 = after this turn (alarms)
//   「随第 N 轮」 = after a ride-along-started turn the owner's turn N goes first; this joins it
//                  (a button: 让它先走 = cutex/userInput/queue/yield, then 「先于第 N 轮」)
//   已暂停 (warn) = held (an owner stop / 暂停委托, lib/stopHold): the row is dimmed, no ring runs; ❚❚ is the group rail's
import { useRef } from "react";
import type { AgentRuntime } from "../lib/agentFeatures";
import { MessageSettlementControl } from "./MessageSettlementControl";
import { Activity, AlarmClock, ArrowDownLeft, CornerDownLeft, Globe, Mail, MessageCircleQuestion, MessageSquareText, Paperclip } from "lucide-react";
import type { AdmissionHeld, AdmissionNextStep } from "@cutex-desktop/protocol";
import type { AskSummary } from "../../../shared/ipc";
import { useI18n, type MessageKey } from "../i18n";
import { formatAutoRetryWait, type ModelOverloadRetryWait } from "../lib/modelOverloadRetry";
import { askWithAdmissionPosition, rideAlongAsk, rideAlongTiming, rideAlongView, type AdmissionRow, type RideAlongAsk, type RideAlongKind } from "../lib/legacyDelivery/admissionOrder";
import { contextMenu } from "../lib/contextMenu";
import { delegationMenu } from "../lib/delegationMenu";
import { isOwnerRequest, peerSideOf, requesterName, requesterSession } from "../lib/delegations";
import { hasDelegationViews, useDelegation } from "../lib/delegationStore";
import { useAgentHost, useAgentNames } from "../lib/delegationsView";
import { openDelegationDetail } from "../lib/delegationOpen";
import { heldKeys } from "../lib/stopHold";
import { steerDelivery, type PendingSteer } from "../lib/legacyDelivery/pendingSteers";
import type { ImageSteering } from "../lib/imageSteer";
import { QUEUE_ROW, ROW_META, ROW_ACTIONS, rowText } from "../lib/queueRow";
import type { InputRecord } from "@cutex-desktop/protocol";
import { InputStatus, useClearedUnknown, type NextUpOverride } from "./InputStatus";
import { NEXT_UP_DETAILS, fill, langOf, type NextUpContext } from "../lib/inputLedger/nextUpRegistry";
import { formatAt, formatWhen, useClock, useNow } from "../lib/time";
import { blockOfNotice, grantNoticeRowOf } from "../lib/safetyGrantNotice";
import { useHostOwnerNotes } from "../lib/ownerNotifyStore";
import { safetyBlockState } from "../lib/ownerNotify";
import { agentState, sidebarOf, useApp, viewOf } from "../store";
import { readsEarly, wakeScheduleOf, wakeSourceOf, minSec } from "../lib/wakeCountdown";
import { useVisibleNow } from "../lib/visibleNow";
import { agentFeaturesOf } from "../lib/agentFeatures";
import { runtimeOf } from "../lib/agentList";
import { viewRow } from "../lib/viewHost";
import { rowsOf } from "../lib/viewHost";
import { SenderAvatar } from "./SystemAvatar";
import { convFeaturesOf, useConvHost, useConvScope } from "../lib/conversationScope";
import { DelegationTag } from "./DelegationParts";
import { DelegationRow } from "./DelegationQueue";
import { Who } from "./Parties";
import { PeerParty } from "./PeerParty";
import { Tag } from "./Tag";
import { CancelSendButton } from "./CancelSendButton";
import { matchCancelable, useCancelableSends } from "../lib/cancelSend";
import { dismissReceipt, isDismissibleReceipt } from "../lib/legacyDelivery/busReceiptVisibility";

const DELIVERY_ICONS: Record<RideAlongKind, typeof Mail> = { answer: CornerDownLeft, question: MessageCircleQuestion, status: Activity, alarm: AlarmClock, tell: MessageSquareText, peer: Globe, bus: Mail };
const DELIVERY_KEYS: Record<RideAlongKind, MessageKey> = {
  answer: "queue.delivery.answer",
  question: "queue.delivery.question",
  status: "queue.delivery.status",
  alarm: "queue.delivery.alarm",
  tell: "queue.delivery.tell",
  peer: "queue.delivery.peer",
  bus: "queue.delivery.bus",
};
const KNOWN_KINDS = new Set(["answer", "question", "alarm", "tell", "bus"]);

/** Asks supply presentation (title/link) only; ledger records alone decide membership, status and actions.
 * Never infer delivery state from ask execution, legacy settlement, timing or native receipts.
 * Status and buttons come only from the Next Up registry (components/InputStatus); the countdown, an admission hold and
 * the approval-notice line are add-ons to it and never take the place of its buttons (registry 1.1 / 1.4).
 * A delegation's rows (request, result, question, status) keep its #tag link. `handlers` / `ctx`: the owner queue's
 * own effects (insert / send now / edit / delete) and whether its QueueItem has loaded. */
export function LedgerAdmissionRow({ record, sessionId, hostId, body, rowProps, grip, media, handlers, ctx }: { record: InputRecord; sessionId: string; hostId?: string; body?: string; rowProps?: React.HTMLAttributes<HTMLDivElement>; grip?: React.ReactNode; media?: React.ReactNode; handlers?: React.ComponentProps<typeof InputStatus>["handlers"]; ctx?: NextUpContext }) {
  const { t } = useI18n();
  const viewHost = useConvHost();
  const rowHost = hostId ?? viewHost;
  const agentSender = record.sender.kind === "agent" || record.sender.kind === "peer";
  const senderId = record.sender.cutexSessionId ?? record.sender.id;
  // Only this host owns local sender ids; unknown/peer senders get the shared agent fallback.
  const senderAvatar = useApp(s => record.sender.kind === "agent" ? rowsOf(sidebarOf(s, rowHost)).find(r => r.cutexSessionId === senderId)?.avatar ?? null : null);
  const senderName = useApp(s => (record.sender.kind === "agent" ? rowsOf(sidebarOf(s, rowHost)).find(r => r.cutexSessionId === senderId)?.displayName : null) ?? record.sender.name);
  const statusNotice = record.kind === "delegationStatus";
  const askId = record.askId;
  const ask = useDelegation(rowHost, askId);
  // Status previews contain internal event reference keys, not owner-facing prose.
  const text = statusNotice ? ask?.title ?? t("inputLedger.statusNotification") : body ?? record.preview ?? record.inputId;
  const openAsk = askId ? () => openDelegationDetail(rowHost, askId, { title: ask?.title }) : undefined;
  const statusRef = useRef<HTMLSpanElement>(null);
  const wake = useWakeOverride(record, sessionId, rowHost, statusRef);
  const grant = <GrantNoticeStatus record={record} sessionId={sessionId} hostId={rowHost} />;
  const cleared = useClearedUnknown(record, sessionId, rowHost);
  if (cleared) return null;
  return <div {...rowProps} className={`${QUEUE_ROW} min-h-6 max-h-6 shrink-0 overflow-hidden hover:bg-hover`} data-testid="ledger-queue-row" data-input-id={record.inputId} data-surface={record.surface}>
    {grip}
    {media}
    {agentSender ? <SenderAvatar id={senderId} name={senderName} avatar={senderAvatar} size={16} agent />
      : <KindIcon icon={record.kind === "owner" ? CornerDownLeft : record.kind === "alarm" ? AlarmClock : Mail} label={t(record.kind === "owner" ? "queue.delivery.owner" : "queue.delivery.bus")} />}
    {record.kind !== "owner" && <span className="max-w-[25%] shrink truncate text-ui font-medium" title={record.sender.host ?? undefined}>{senderName}</span>}
    {askId && <DelegationTag askId={askId} onJump={openAsk} />}
    {statusNotice && openAsk ? <button type="button" onClick={openAsk} className="min-w-0 flex-1 truncate text-left text-ui hover:text-accent hover:underline" title={text}>{rowText(text)}</button>
      : <span className="min-w-0 flex-1 truncate text-ui" title={statusNotice ? text : body ?? record.preview}>{rowText(text)}</span>}
    {/* Today's look: the status always shows; an owner's waiting row keeps its queue buttons on hover (owner 2026-11-02). */}
    <span ref={statusRef} className="flex h-5 max-h-5 min-w-0 shrink items-center">
      <InputStatus record={record} sessionId={sessionId} hostId={hostId} handlers={handlers} ctx={ctx} override={{ ...wake, addOn: grant }} buttonsClassName={record.kind === "owner" && record.state === "waiting" ? `${ROW_ACTIONS} h-5 max-h-5` : undefined} />
    </span>
  </div>;
}

/**
 * The 「主人已批准一次」 notice of a safety-block grant (cutex safety-grant-delivery; the block names this record as
 * its `noticeInputId`): 「已批准一次，等待当前工具返回后送达 · 最晚 HH:MM 前有效」 until the agent reads it, then
 * 「已送达 · 有效至 HH:MM」 (lib/safetyGrantNotice). A display-only add-on after the row's status: it never hides the
 * row's buttons (registry §三: 批准通知等待送达 — 只显示，不吞掉「放弃」). Nothing without a grant.
 */
export function GrantNoticeStatus({ record, sessionId, hostId }: { record: Pick<InputRecord, "inputId" | "kind" | "state" | "evidence">; sessionId: string; hostId: string }) {
  const { t, locale } = useI18n();
  const lang = langOf(locale);
  const notes = useHostOwnerNotes(hostId);
  // r282 sends the approval notice as systemNotice (approval before alarm); older hosts as alarm.
  const block = record.kind === "systemNotice" || record.kind === "alarm" ? blockOfNotice(notes, sessionId, record.inputId) : null;
  const now = Date.now();
  const status = block ? grantNoticeRowOf({ ...block, state: safetyBlockState(block, now) }, record) : null;
  if (!block || !status) return null;
  const at = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? formatAt(Date.parse(iso) / 1000, now) : "");
  const time = at(status.until);
  const minutes = Math.max(1, Math.round(block.grantSeconds / 60));
  return status.kind === "waiting" ? (
    <TimingMeta label={t("safetyBlock.notice.waitingHint", { minutes, time })} text={time ? `${NEXT_UP_DETAILS.grantWaiting[lang]} · ${fill(NEXT_UP_DETAILS.grantCap[lang], { time })}` : NEXT_UP_DETAILS.grantWaiting[lang]} testId="grant-notice-waiting" />
  ) : (
    <TimingMeta label={t("safetyBlock.notice.readHint", { time })} text={fill(NEXT_UP_DETAILS.grantRead[lang], { time })} tone="text-ok-text" testId="grant-notice-read" />
  );
}

/**
 * A wake (or delegation results) waiting on a busy agent, read from the server's deadline (the record's `wakeSchedule`,
 * else `nextStepAt` of its admission ride-along matched by id; lib/wakeCountdown wakeSourceOf), as the registry state it
 * makes the row (registry 1.5): counting down → `afterWork` variant `timed` (「{time} 内发送」 after the depleting ring,
 * today's look and place); past the deadline → `awaitingRead`; held by an owner stop / 暂停委托 → `paused` (an
 * owner hold of this one item → `held`). Without a server deadline a state-3 row is the `untimed` variant. Ticks once a
 * second only while the row is on screen (lib/visibleNow). Changes only the shown state, never the buttons' disposals.
 */
export function useWakeOverride(record: Pick<InputRecord, "inputId" | "createdAt" | "wakeSchedule" | "state" | "kind">, sessionId: string, hostId: string, ref: React.RefObject<HTMLElement | null>): NextUpOverride {
  const { t, locale } = useI18n();
  const lang = langOf(locale);
  const applies = record.state === "waiting" && record.kind !== "owner";
  const ride = useApp((s) => applies ? viewOf(s, hostId, sessionId)?.admission?.nextStep?.find((i) => i.id === record.inputId) ?? null : null);
  const ridealongsHeld = useApp((s) => viewOf(s, hostId, sessionId)?.admission?.ridealongsHeld);
  const busy = useApp((s) => {
    const state = agentState(s.inputs, hostId, sessionId)?.delivery?.state;
    return state === "turn" || state === "finishing";
  });
  const runtimeEarly = useApp((s) => {
    const row = viewRow(s, hostId, sessionId);
    return !!row && readsEarly(runtimeOf(row), agentFeaturesOf(row).map);
  });
  const source = applies ? wakeSourceOf(record, ride, runtimeEarly, ridealongsHeld) : null;
  const held = source?.held;
  const counting = busy && !!source && source.early && !held && !source.read && !!source.item.nextStepAt && source.item.timing !== "nextStep";
  const now = useVisibleNow(ref, counting);
  if (!applies) return {};
  if (held) return { state: held === "ownerPause" ? "held" : "paused", tip: `${t("queue.turn.heldItem")}${held === "ownerStop" || held === "ownerPause" ? ` · ${t(heldKeys(held as AdmissionHeld).strip)}` : ""}` };
  const schedule = busy && source && !source.read ? wakeScheduleOf(source.item, now, source.early) : null;
  if (!schedule) return { variant: "untimed" };
  if (schedule.kind === "readPoint") return { state: "awaitingRead" };
  const time = minSec(schedule.secs);
  return { state: "afterWork", variant: "timed", time, symbol: <CountdownRing left={schedule.left} />, tip: undefined };
}

/** A row's kind: a small muted icon, its word as the label (no text pill). */
/**
 * A waiting steer's delivery note: 已插入 · 等下一个工具边界, or 下一回合发送 for a Claude steer with images that
 * is not inserted (lib/pendingSteers steerDelivery). An image-input-steering receipt (`imageDelivery`, cutex's
 * word only) names how the images went in: 已以文件路径插入 / 已直接插入图片.
 */
export function SteerDeliveryNote({ steer, runtime, imageSteering, className = "", onRecheck }: { steer: Pick<PendingSteer, "imageCount" | "extra" | "imageDelivery" | "state" | "checkFailed">; runtime: AgentRuntime; imageSteering?: ImageSteering | null; className?: string; onRecheck?: () => void }) {
  const { t } = useI18n();
  if (steer.state === "checking") return <span className="flex min-w-0 max-w-[45%] shrink items-center gap-1 text-caption text-subtle" data-testid="steer-check-status">
    <span className="truncate" title={t(steer.checkFailed ? "queue.insert.unknown" : "queue.insert.checking")}>{t(steer.checkFailed ? "queue.insert.unknown" : "queue.insert.checking")}</span>
    {steer.checkFailed && onRecheck && <button type="button" onClick={onRecheck} className="shrink-0 rounded px-1 hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-accent" data-testid="steer-recheck">{t("steer.recheck")}</button>}
  </span>;
  const nextTurn = steerDelivery(steer, runtime, imageSteering) === "nextTurn";
  const receipt = nextTurn ? null : steer.imageDelivery;
  const label = nextTurn ? "queue.meta.nextTurn" : receipt === "pathText" ? "queue.meta.insertedPath" : receipt === "nativeImage" ? "queue.meta.insertedImage" : "queue.meta.inserted";
  const hint = nextTurn ? "queue.meta.nextTurnHint" : receipt === "pathText" ? "queue.meta.insertedPathHint" : receipt === "nativeImage" ? "queue.meta.insertedImageHint" : "queue.meta.insertedHint";
  return (
    <span className={`${ROW_META} text-subtle ${className}`} data-delivery={nextTurn ? "nextTurn" : "toolBoundary"} data-image-delivery={receipt ?? undefined} title={t(hint)} data-testid="steer-delivery-note">
      {t(label)}
    </span>
  );
}

export function KindIcon({ icon: Icon, label, className = "text-subtle" }: { icon: typeof Mail; label: string; className?: string }) {
  return (
    <span role="img" aria-label={label} title={label} className={`flex h-4 w-4 shrink-0 items-center justify-center ${className}`} data-testid="queue-kind-icon">
      <Icon size={14} aria-hidden />
    </span>
  );
}

/** The fixed 16px slot at the end of a row that holds a timing symbol (rows align). */
export function TimingSlot({ label, children, testId }: { label?: string; children?: React.ReactNode; testId?: string }) {
  if (!label) return <span className="h-4 w-4 shrink-0" />;
  return (
    <span role="img" aria-label={label} title={label} className="flex h-4 w-4 shrink-0 items-center justify-center" data-testid={testId}>
      {children}
    </span>
  );
}

/** Timing as quiet words at the row end (the full sentence = tooltip / aria-label), `symbol` before them. */
export function TimingMeta({ label, text, symbol, testId, tone = "text-subtle" }: { label: string; text: string; symbol?: React.ReactNode; testId?: string; tone?: string }) {
  return (
    <span role="img" aria-label={label} title={label} className={`flex shrink-0 items-center gap-1 pl-1 text-caption font-normal whitespace-nowrap tabular-nums ${tone}`} data-testid={testId}>
      {symbol}
      <span aria-hidden>{text}</span>
    </span>
  );
}

/** A depleting ring: `left` 1 = full … 0 = empty. Stepped (no transition) under reduced motion. */
function CountdownRing({ left }: { left: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" className="-rotate-90" aria-hidden>
      <circle cx={7} cy={7} r={r} fill="none" strokeWidth={2} className="stroke-border" />
      <circle cx={7} cy={7} r={r} fill="none" strokeWidth={2} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - left)} className="stroke-muted transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none" />
    </svg>
  );
}

/** The timing symbol of a ride-along item while a turn runs (ticks every second while it counts down). */
/**
 * A waiting ride-along against the owner's next turn after a ride-along-started turn: it joins that
 * turn (`follows`, with 让它先走 when cutex offers it), or goes first because the owner yielded.
 */
export type RideAlongOrder = { kind: "follows"; turn: number; onYield?: () => void } | { kind: "first"; turn: number };

function OrderChip({ order }: { order: RideAlongOrder }) {
  const { t } = useI18n();
  const chip = "shrink-0 rounded bg-surface-2 px-1 text-caption/[inherit]";
  if (order.kind === "first")
    return (
      <span className={`${chip} text-accent`} title={t("queue.turn.yieldedHint", { n: order.turn })} data-testid="timing-first">
        {t("queue.turn.yielded", { n: order.turn })}
      </span>
    );
  if (!order.onYield)
    return (
      <span className={`${chip} text-subtle`} title={t("queue.turn.followsHint", { n: order.turn })} data-testid="timing-follows">
        {t("queue.turn.follows", { n: order.turn })}
      </span>
    );
  return (
    <button onClick={order.onYield} className={`${chip} text-subtle hover:text-accent`} title={`${t("queue.turn.followsHint", { n: order.turn })}\n${t("queue.turn.yieldHint", { n: order.turn })}`} data-testid="timing-follows">
      {t("queue.turn.follows", { n: order.turn })} · {t("queue.turn.yield")}
    </button>
  );
}

function TimingSymbol({ item, order }: { item: AdmissionNextStep; order?: RideAlongOrder | null }) {
  const { t } = useI18n();
  const now = useNow(item.timing === "afterTurn" && !!item.nextStepAt);
  const timing = rideAlongTiming(item, now);
  // Still waiting for the turn end: it joins the owner's next turn, or (yielded) goes before it.
  const chip = order && timing.kind !== "nextStep" && <OrderChip order={order} />;
  const follows = order?.kind === "follows" ? order.turn : null;
  if (timing.kind === "waitInsert")
    return (
      <>
        {chip}
        <TimingMeta
          label={follows ? t("queue.turn.waitInsertFollows", { n: timing.secs, turn: follows }) : t("queue.turn.waitInsert", { n: timing.secs })}
          text={t("queue.meta.countdown", { n: timing.secs })}
          symbol={<CountdownRing left={timing.left} />}
          testId="timing-wait"
        />
      </>
    );
  if (timing.kind === "nextStep") return <TimingMeta label={t("queue.turn.nextStep")} text={t("queue.meta.nextStep")} testId="timing-next-step" />;
  return (
    <>
      {chip}
      {/* Joining turn N: the chip already says when, no second word. */}
      {follows || order?.kind === "first" ? (
        <TimingSlot label={follows ? t("queue.turn.followsHint", { n: follows }) : t("queue.turn.afterTurn")} testId="timing-after-turn" />
      ) : (
        <TimingMeta label={t("queue.turn.afterTurn")} text={t("queue.meta.afterTurn")} testId="timing-after-turn" />
      )}
    </>
  );
}

/** A held ride-along: 已暂停 (no countdown), the reason in its tooltip. */
function HeldSymbol({ held }: { held: AdmissionHeld }) {
  const { t } = useI18n();
  // The ❚❚ glyph is the group's (its rail); the row just says it.
  return <TimingMeta label={`${t("queue.turn.heldItem")} · ${t(heldKeys(held).strip)}`} text={t("queue.meta.held")} tone="text-warn-text" testId="timing-held" />;
}

/** The host owns batching policy and receipts. Only an explicit host deadline ticks. */
function IdleWaitMeta({ item }: { item: AdmissionNextStep }) {
  const { t } = useI18n();
  const deadline = item.nextStepAt ? Date.parse(item.nextStepAt) : NaN;
  const timed = item.waitReason === "resultCoalescing" && Number.isFinite(deadline);
  const now = useNow(timed);
  if (item.waitReason === "nativeReceipt")
    return <TimingMeta label={t("queue.turn.nativeReceiptHint")} text={t("queue.turn.nativeReceipt")} testId="timing-native-receipt" />;
  const seconds = timed ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  return <TimingMeta label={t("queue.turn.resultCoalescingHint")} text={seconds > 0 ? t("queue.turn.resultCoalescing", { n: seconds }) : t("queue.turn.resultReady")} testId="timing-result-coalescing" />;
}

/** The delegation part of a ride-along row: the other party · #tag · title (tag and title open its detail on the right side; right click = the delegation menu, with 跳到委托卡片). */
function RideAlongAskParts({ d, info, sessionId }: { d: AskSummary; info: RideAlongAsk; sessionId: string }) {
  const { t } = useI18n();
  const nameOf = useAgentNames();
  const conv = useConvScope();
  const views = useApp((s) => hasDelegationViews(convFeaturesOf(conv, s)));
  // This session's host's record (lib/agentHostRoute re-routes); its card is in the requester's timeline there.
  const host = useConvHost();
  const requester = requesterSession(d.requester);
  const show = () => openDelegationDetail(host, d.askId, { title: info.title || d.title });
  const peer = peerSideOf(d);
  const party =
    info.party === "target" ? (
      peer?.side === "target" ? <PeerParty text={peer.name} label={peer.label} size={16} /> : <Who id={d.target} name={d.targetName ?? nameOf(d.target)} size={16} realAvatar />
    ) : peer?.side === "requester" ? (
      <PeerParty text={peer.name} label={peer.label} size={16} />
    ) : isOwnerRequest(d.requester) ? (
      <span className="shrink-0 text-foreground">{t("delegation.you")}</span>
    ) : (
      <Who id={requester} name={requesterName(d.requester) ?? (requester ? nameOf(requester) : null)} size={16} realAvatar />
    );
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5" onContextMenu={contextMenu(() => delegationMenu(d, t, nameOf, { host, here: sessionId, views }))}>
      <span className="flex min-w-0 max-w-[40%] shrink items-center overflow-hidden" data-testid="ride-along-party">
        {party}
      </span>
      <DelegationTag askId={d.askId} onJump={show} />
      {info.title ? (
        <button onClick={show} className="min-w-0 flex-1 truncate text-left text-ui hover:underline" title={info.title} data-testid="ride-along-title">
          {info.title}
        </button>
      ) : (
        <span className="flex-1" />
      )}
    </span>
  );
}

/** When a ride-along was enqueued, relative ("3 分钟前"); "" when unknown. */
function useEnqueuedAgo(enqueuedAt: string): string {
  const { locale } = useI18n();
  const now = useClock();
  const at = Date.parse(enqueuedAt);
  return Number.isFinite(at) ? formatWhen(at / 1000, now, locale ?? "en") : "";
}

/**
 * A ride-along delivery: kind icon · sender · text, and (while a turn runs) its timing words; held =
 * dimmed, 已暂停. `order`: against the owner's next turn after a ride-along-started turn
 * (lib/admissionOrder rideAlongsFollowTurn). `sessionId`: the agent whose queue shows the row (which
 * side of a delegation it is). `idleNote`: the words at the end while no turn runs (「等待处理」, a status, not
 * an action). `stuck` only enables cancellation lookup for older, undelivered messages;
 * elapsed time alone does not establish a delivery failure.
 */
export function NextStepRow({ item, running, held, order, sessionId, idleNote, stuck, autoRetry }: { item: AdmissionNextStep; running: boolean; held?: AdmissionHeld; order?: RideAlongOrder | null; sessionId?: string; idleNote?: string; stuck?: boolean; autoRetry?: ModelOverloadRetryWait | null }) {
  const { t } = useI18n();
  const view = rideAlongView(item);
  const Icon = DELIVERY_ICONS[view.kind];
  const kindWord = t(view.kind === "bus" && !KNOWN_KINDS.has(item.deliveryKind) ? "queue.delivery.other" : DELIVERY_KEYS[view.kind]);
  const ago = useEnqueuedAgo(item.enqueuedAt);
  // The queue is the open agent's: its host's record (a peers delegation has one per host).
  const host = useAgentHost();
  const d = useDelegation(host, item.askId);
  const info = sessionId ? rideAlongAsk(item, d, sessionId) : null;
  const tip = [view.from, view.text, view.note].filter(Boolean).join("\n") || undefined;
  const dismissible = isDismissibleReceipt(item);
  // A message cutex has not handed over can still be withdrawn (lib/cancelSend).
  const cancelable = useCancelableSends(host, sessionId ?? "", !dismissible && !!stuck && !!sessionId && !running && !held);
  const cancelTarget = !dismissible && stuck && !running && !held ? matchCancelable(cancelable.list, { fromId: view.fromId, from: view.from, text: view.text }) : null;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1" data-testid="queue-next-step" data-held={held} data-ask-id={info?.askId} data-kind={view.kind}>
      <div className={`${QUEUE_ROW} min-h-6 max-h-6 shrink-0 text-ui text-muted ${held ? "opacity-60" : ""}`}>
        <KindIcon icon={Icon} label={kindWord} />
        {d && info && sessionId ? (
          <RideAlongAskParts d={d} info={info} sessionId={sessionId} />
        ) : view.text ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5" title={tip}>
            {view.from &&
              (view.fromId ? (
                // Design 040 step 9: the sender as a 16 px avatar + name (a link to the agent), when cutex says who it is.
                <span className="flex max-w-[min(16em,50%)] shrink-0 items-center overflow-hidden font-semibold" data-testid="ride-along-from" data-from-id={view.fromId}>
                  <Who id={view.fromId} name={view.from} size={16} realAvatar />
                </span>
              ) : (
                <span className="max-w-[min(16em,50%)] shrink-0 truncate whitespace-nowrap font-semibold text-foreground" title={view.from} data-testid="ride-along-from">
                  {view.from}
                </span>
              ))}
            <span className="min-w-0 flex-1 truncate text-muted" data-testid="ride-along-text">
              {view.text}
            </span>
          </span>
        ) : (
          // Nothing specific (an older cutex): kind · sender · when — never a lone kind word.
          <span className="min-w-0 flex-1 truncate" data-testid="ride-along-fallback">
            <span className="text-foreground/80">{kindWord}</span>
            {view.from && <span> · {view.from}</span>}
            {ago && <span className="text-subtle"> · {ago}</span>}
          </span>
        )}
        {item.settlement?.state === "outcome_unknown" ? <span className={`${ROW_META} text-warn-text`} title={t("agent-bus.settlement.disclaimer")} data-testid="timing-outcome-unknown">{t("agent-bus.settlement.unknown")}</span> : held ? <HeldSymbol held={held} /> : autoRetry && item.waitReason !== "nativeReceipt" ? (
          <TimingMeta label={formatAutoRetryWait(t, autoRetry, autoRetry.phase === "pending" ? "queue.autoRetryOwnerOrder" : "queue.autoRetryWaiting")} text={formatAutoRetryWait(t, autoRetry, "queue.autoRetryWaiting")} testId="timing-auto-retry" />
        ) : running ? (
          <TimingSymbol item={item} order={order} />
        ) : item.waitReason === "resultCoalescing" || item.waitReason === "nativeReceipt" ? (
          <IdleWaitMeta item={item} />
        ) : idleNote || stuck ? (
          <span className={`${ROW_META} text-subtle`} title={t("queue.turn.startsNowHint")} data-testid="timing-starts-now">
            {idleNote ?? t("queue.turn.startsNow")}
          </span>
        ) : (
          <TimingSlot />
        )}
        <MessageSettlementControl hostId={host} messageId={item.id} settlement={item.settlement} sessionId={sessionId} discover={dismissible} compact retainActions={!!cancelTarget} actions={
          dismissible && sessionId ? <button type="button" onClick={(event) => { event.stopPropagation(); dismissReceipt(host, sessionId, item); }} title={t("queue.receipt.hideHint")} aria-label={t("queue.receipt.hideHint")} className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-accent" data-testid="hide-native-receipt">
            {t("queue.receipt.hide")}
          </button> : cancelTarget ? <div className="px-1 py-1"><CancelSendButton onCancel={() => cancelable.cancel(cancelTarget)} /></div> : null
        } />
      </div>
    </div>
  );
}

/** A delegation the asks store has not loaded (or this client cannot see): kind + #tag only. */
function BareAskRow({ askId }: { askId: string }) {
  const { t } = useI18n();
  return (
    <div className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-ctl pr-1 pl-0.5 text-ui text-muted" data-testid="queue-delegation">
      <ArrowDownLeft size={13} className="shrink-0 text-accent" />
      <span className="shrink-0 font-medium text-foreground">{t("queue.order.delegation")}</span>
      <DelegationTag askId={askId} />
    </div>
  );
}

/** The passive tells a delegation carries: a `+N` chip, their labels in the tooltip. */
function IncludedChip({ labels }: { labels: string[] }) {
  const { t } = useI18n();
  if (!labels.length) return null;
  const tip = `${t("queue.turn.includedNote")}\n${labels.join("\n")}`;
  return (
    <Tag title={tip} aria-label={tip} data-testid="queue-included-chip" className="tabular-nums">
      <Paperclip size={10} />+{labels.length}
    </Tag>
  );
}

/** A delegation's turn: its row, with a `+N` chip for the tells it carries. */
export function AskTurnRow({ row, sessionId }: { row: Extract<AdmissionRow, { kind: "ask" }>; sessionId: string }) {
  const labels = (row.entry.includedNotes ?? []).map((n) => n.label);
  if (!row.ask)
    return (
      <span className="flex min-w-0 flex-1 items-center">
        <BareAskRow askId={row.entry.id} />
        <IncludedChip labels={labels} />
      </span>
    );
  return (
    <DelegationRow d={askWithAdmissionPosition(row.ask, row.entry)} sessionId={sessionId} dense>
      <IncludedChip labels={labels} />
    </DelegationRow>
  );
}
