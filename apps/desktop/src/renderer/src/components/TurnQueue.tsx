// The queue panel's turn frame (cutex admission-order; docs/research/queue-turn-groups-plan-20261012.md,
// owner layout 2026-10-12): ONE frame above the composer, sections separated by a hairline, no header
// rows. A ~22px left rail labels each row (components/QueueRail); section names / status are the
// rail's tooltip and the section's aria-label; section actions show on hover / focus at the end of
// its first row.
//   下个工具边界 (only while a turn runs; each row its kind icon — no side bar since design 040 step 9): what enters the running
//     turn at its next tool boundary — the owner's inserts (↳ icon, 下一步), wakes past their wait (下一步),
//     wakes still waiting for the turn end (a depleting ring). The 「插入当前回合」 drop target
//     (lib/insertTarget) is no row: while an owner row is dragged, the card's 「接下来」 header line becomes
//     it (an overlay portalled into QueuePanel's header, `slots.target`; owner 2026-10-23), taking a drop
//     only after the drag stayed on it INSERT_DWELL_MS — a drop anywhere else only reorders (owner
//     2026-10-21, accidental inserts). Refused in a delegation's turn / without steering: it says why.
//     Waiting inserts say 「已插入 · 等下一个工具边界」; hovering one shows 打断并发送.
//     With ≥ 2 queued owner messages 「全部合并插入」 (shared/queueMerge) sits at the right of the header line
//     (`slots.actions`): all of them, in queue order, become ONE insert (delegations never merged).
//   ⤓ 本回合结束后 (running: alarms) or 等待投递 (idle: the host may coalesce delegation results).
//   Numbered turns: the number in the rail (the grip replaces it on hover; the only move control,
//     Alt+↑ / Alt+↓ / Alt+End from the keyboard). Drop between turns = queue/move, never onto a
//     delegation. A delegation's included tells are a `+N` chip.
//   The queue-paused divider is a thin warning hairline (❚❚ in the rail, 继续 / 放回 on hover).
//   Held ride-alongs (stop-holds-ridealongs, lib/stopHold): after a stop they don't start a turn by
//   themselves — their own group 「已随停止暂停」 (or 「委托已暂停」 for results an explicit 暂停委托
//   holds) after the ride-along groups: ❚❚ in the rail and in the timing slot, muted, no ring. One
//   继续发送 (the divider's, or the asks-paused section's) releases everything the stop held.
// Up to ROW_CAP (3) rows all show; past that the first FOLDED_ROWS (2; the boundary section always
// fully) and 「还有 N 项」, expanded while dragging and remembered per agent (lib/queueView,
// localStorage). Ride-along rows: kind icon, sender + first line, timing words (components/AdmissionRows).
// The card's header line (接下来 · N, 暂停委托, collapse) is QueuePanel's.
// (待处理委托 — awaiting the owner's review — stays QueuePanel's extra section below.)
import type { AgentRuntime } from "../lib/agentFeatures";
import type { InputRecord } from "@cutex-desktop/protocol";
import { LedgerAdmissionRow } from "./AdmissionRows";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDownToLine, ChevronDown, ChevronRight, Clock3, CornerDownRight, GripVertical } from "lucide-react";
import type { AdmissionCurrentTurn, AdmissionNextStep, AdmissionRef, QueueItem } from "@cutex-desktop/protocol";
import { useI18n } from "../i18n";
import { atBoundary, beforeForSlot, canMoveTo, foldQueueRows, foldRow, insertRefusal, moveTargets, pausedFrom, rideAlongsFollowTurn, slotForGroup, turnStopped, type AdmissionRow } from "../lib/legacyDelivery/admissionOrder";
import { formatElapsed } from "../lib/agentAttention";
import type { OutboxEntry } from "../lib/legacyDelivery/outbox";
import { steerDelivery, type PendingSteer } from "../lib/legacyDelivery/pendingSteers";
import { refusesImageSteer, type ImageSteering } from "../lib/imageSteer";
import type { StripLabel } from "../lib/railStrip";
import { INSERT_DWELL_MS, insertTargetShown, insertTargetState, mergeInsertShown } from "../lib/insertTarget";
import { mergeableOwnerItem } from "../../../shared/queueMerge";
import { heldKeys, splitHeld } from "../lib/stopHold";
import { immediateStartItems, STARTS_NOW_STUCK_MS, useWaitedIds } from "../lib/legacyDelivery/settledRideAlongs";
import { taskTag } from "../lib/tasks";
import { useNow } from "../lib/time";
import { queueViewOf, setQueueView } from "../lib/queueView";
import { queueItemText, useApp, viewOf } from "../store";
import { ledgerOrderRef } from "../lib/admissionOrder";
import { AskTurnRow, KindIcon, NextStepRow, SteerDeliveryNote, TimingSlot, type RideAlongOrder } from "./AdmissionRows";
import { META_YIELDS, QUEUE_ROW, ROW_ACTIONS, ROW_META, ROW_TEXT, rowText } from "../lib/queueRow";
import { useUserLayoutToggle } from "../lib/userLayoutToggle";
import { HoverActions, Rail, RailRow } from "./QueueRail";
import { QueuedImages } from "./ImageThumbs";
import { messageImages } from "../../../shared/input";
import { DROP_TINT, dropTint } from "../lib/dropTint";
import { formatAutoRetryWait } from "../lib/modelOverloadRetry";
import { useModelOverloadRetry } from "../lib/modelOverloadRetryView";

/** No candidates (a turn runs: nothing waits to start by itself). */
const NONE: readonly AdmissionNextStep[] = [];

/** Queue items supply content/actions, never membership or ordering. */
export function LedgerTurnQueue({ records, sessionId, hostId, items, canEdit, onSendNow, onEdit, onDelete, sendNowStartsTurn }: {
  records: readonly InputRecord[]; sessionId: string; hostId?: string; items: readonly QueueItem[];
  canEdit: boolean; onSendNow?: (item: QueueItem) => void; onEdit: (item: QueueItem) => void; onDelete: (item: QueueItem) => void; sendNowStartsTurn?: boolean;
}) {
  const { t } = useI18n();
  const byId = new Map(items.map(item => [item.clientUserMessageId, item]));
  const admission = useApp(s => viewOf(s, hostId ?? "local", sessionId)?.admission);
  const [dragged, setDragged] = useState<QueueItem | null>(null);
  const move = (item: QueueItem, target: InputRecord | null) => {
    const before = target ? ledgerOrderRef(target, items, admission) : null;
    if (before === undefined) return;
    void useApp.getState().queueMove(item, before, sessionId, hostId).catch(error => useApp.getState().notify(String(error), "error", { hostId: hostId ?? "local", sessionId }));
  };
  return <>{records.map(record => {
    const item = record.kind === "owner" ? byId.get(record.inputId) : undefined;
    const movable = !!item && !!admission && record.actions?.includes("edit");
    return <LedgerAdmissionRow key={record.inputId} record={record} sessionId={sessionId} hostId={hostId} body={item ? queueItemText(item) : undefined}
      media={item ? <QueuedImages images={messageImages(item.input as { type: string }[])} hostId={hostId} /> : undefined}
      grip={movable ? <GripVertical size={12} className="shrink-0 cursor-grab text-subtle" aria-hidden /> : undefined}
      rowProps={{
        draggable: movable, tabIndex: movable ? 0 : undefined, title: movable ? t("queue.move.dragHint") : undefined,
        onDragStart: item && movable ? e => { e.dataTransfer.setData("application/x-cutex-ledger-queue", item.clientUserMessageId); e.dataTransfer.effectAllowed = "move"; setDragged(item); } : undefined,
        onDragEnd: () => setDragged(null),
        onDragOver: e => { if (dragged && dragged.clientUserMessageId !== record.inputId && ledgerOrderRef(record, items, admission)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } },
        onDrop: e => { if (dragged && dragged.clientUserMessageId !== record.inputId) { e.preventDefault(); move(dragged, record); setDragged(null); } },
        onKeyDown: e => {
          if (!movable || !item || !e.altKey || !["ArrowUp", "ArrowDown", "End"].includes(e.key)) return;
          const index = records.indexOf(record);
          const target = e.key === "End" ? null : e.key === "ArrowUp" ? records[index - 1] : records[index + 2] ?? null;
          if (target === undefined) return;
          e.preventDefault(); move(item, target);
        },
      }}>
      {item && <>
        {record.actions?.includes("sendNow") && onSendNow && <button type="button" className="h-5 rounded px-1 text-caption hover:bg-surface-2" onClick={() => onSendNow(item)}>{t(sendNowStartsTurn ? "queue.sendNowIdle" : "queue.sendNow")}</button>}
        {record.actions?.includes("edit") && <button type="button" className="h-5 rounded px-1 text-caption hover:bg-surface-2" disabled={!canEdit} onClick={() => onEdit(item)}>{t("queue.edit")}</button>}
        {record.actions?.includes("cancel") && <button type="button" className="h-5 rounded px-1 text-caption hover:bg-surface-2" onClick={() => onDelete(item)}>{t("queue.delete")}</button>}
      </>}
    </LedgerAdmissionRow>;
  })}</>;
}

/** The turn frame's data (QueuePanel `ordered`). */
export interface OrderedQueue {
  /** Numbered turns, in admission order (lib/admissionOrder `turnGroups`). */
  turns: AdmissionRow[];
  /** Ride-along deliveries. */
  nextStep: AdmissionNextStep[];
  /** admission `ridealongsHeld` (stop-holds-ridealongs): every ride-along held by the owner's stop. */
  ridealongsHeld?: "ownerStop";
  /** admission `ownerYielded` (admission-owner-yield): the waiting ride-alongs go first this time. */
  ownerYielded?: boolean;
  /** Let the waiting ride-alongs go first (cutex/userInput/queue/yield); undefined = not supported. */
  onYield?: () => void;
  /** A turn runs now. */
  running: boolean;
  /** When it started (ms), for the rail tooltip; null = unknown. */
  runningSince: number | null;
  /** Whose turn runs (null = idle). */
  currentTurn: AdmissionCurrentTurn | null;
  /** cutex `queue.ownerMayPassAsks`: false = no move ahead of a delegation that is ahead now. */
  mayPass: boolean;
  onMove(item: QueueItem, before: AdmissionRef | null): void;
  /** Insert into the running turn (the 插入 path); undefined = this runtime cannot steer now. */
  onInsert?: (item: QueueItem) => void;
  /** 「全部合并插入」: merge the queued owner messages (queue order) into one insert; undefined = not offered. */
  onMergeInsert?: (items: QueueItem[]) => void;
  sessionId: string;
  /** Queue actions (暂停委托), shown in the card's header line (QueuePanel). */
  actions?: React.ReactNode;
}

/** Owner-row parts the frame sets on QueuePanel's row. */
export interface OwnerRowExtra {
  grip?: React.ReactNode;
  rowProps?: React.HTMLAttributes<HTMLDivElement>;
  /** Held by the queue pause / a stop: ❚❚ 已暂停 as the row's meta (warn), instead of `note`. */
  paused?: boolean;
  /** When it will reach the agent (queue.deliver*), quiet text hidden on hover (the row actions take its place). */
  note?: string;
}

/** The paused divider's controls (shown there when the paused section has no undelivered steers of its own). */
export interface PausedDivider {
  controls: boolean;
  /** An owner stop hold is on: 继续发送 releases everything it held (the hint says so). */
  stopHold?: boolean;
  onResume(): void;
  onRestore(): void;
}

/** The insert target's tints under 框线+底色 (lib/dropTint; the former accent-soft / danger-soft, made opaque). */
const TARGET_ARMED_TINT = dropTint("var(--accent)", 12, "var(--surface)");
const TARGET_REFUSED_TINT = dropTint("var(--danger)", 12, "var(--surface)");
const TINY = "rounded-chip px-1.5 py-0.5 text-caption focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none";

export function TurnQueue({
  ordered,
  waiting,
  sendingSteers,
  sendingQueue,
  renderOutbox,
  onInterruptSendSteers,
  heldIds,
  paused,
  itemRow,
  hostId,
  runtime = "codex",
  imageSteering = null,
  slots,
  insertStatus,
  onRecheckSteer,
}: {
  ordered: OrderedQueue;
  /** The owner's steers not read yet (lib/pendingSteers). */
  waiting: PendingSteer[];
  sendingSteers: OutboxEntry[];
  sendingQueue: OutboxEntry[];
  renderOutbox(entry: OutboxEntry, kind: "steer" | "queue"): React.ReactNode;
  onInterruptSendSteers(): void;
  heldIds: ReadonlySet<string>;
  paused: PausedDivider;
  itemRow(item: QueueItem, extra?: OwnerRowExtra): React.ReactNode;
  /** The agent's host: an insert's image stored as a host path is read through it (components/ImageThumbs). */
  hostId?: string;
  /** The agent's runtime: a Claude steer with images is sent as the next turn (lib/pendingSteers steerDelivery). */
  runtime?: AgentRuntime;
  /** image-input-steering: the session's declared image steering (lib/imageSteer); null = unknown / older cutex. */
  imageSteering?: ImageSteering | null;
  insertStatus?: (clientId: string) => React.ReactNode;
  onRecheckSteer?: (id: string) => void;
  /** QueuePanel's header line: `target` = the overlay the insert target is drawn into while dragging, `actions` = its
   *  right end (「全部合并插入」). Missing = neither shows. */
  slots?: { target: HTMLElement | null; actions: HTMLElement | null };
}) {
  const { t } = useI18n();
  const userToggle = useUserLayoutToggle();
  const { turns, nextStep, running, currentTurn, mayPass, onMove, onInsert, onMergeInsert, sessionId } = ordered;
  const retryStatus = useModelOverloadRetry(sessionId, hostId);
  const retry = retryStatus?.holdsAdmission ? retryStatus : null;
  const entries = turns.map((r) => r.entry);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const [overBoundary, setOverBoundary] = useState(false);
  // The insert target takes a drop only after the drag stayed on it INSERT_DWELL_MS (lib/insertTarget).
  const [armed, setArmed] = useState(false);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopDwell = () => {
    if (dwell.current !== null) clearTimeout(dwell.current);
    dwell.current = null;
  };
  useEffect(() => stopDwell, []);
  // 「还有 N 项」 expanded, per agent (the same component shows another agent's queue after a switch).
  const [expandedFor, setExpandedFor] = useState<{ id: string; v: boolean } | null>(null);
  const expanded = expandedFor?.id === sessionId ? expandedFor.v : !!queueViewOf(sessionId).expanded;
  const now = useNow(running && ordered.runningSince !== null);
  const setExpanded = (v: boolean) => {
    userToggle(() => {
      setQueueView(sessionId, { expanded: v });
      setExpandedFor({ id: sessionId, v });
    });
  };
  const leaveTarget = () => {
    stopDwell();
    setOverBoundary(false);
    setArmed(false);
  };
  const endDrag = () => {
    setDragFrom(null);
    setDropSlot(null);
    leaveTarget();
  };
  const { free, held } = splitHeld(nextStep, { ridealongsHeld: ordered.ridealongsHeld });
  // The next-step ride-alongs are the frame's first card, running or idle: running they go at the next tool boundary
  // (插话), idle they start now. Both ways always shown, never folded — so the panel keeps its height when the turn
  // ends (owner 2026-10-24: the timeline above moved by a row then); only the number of items changes it.
  const firstUp = free.filter(atBoundary);
  const boundary = running ? firstUp : [];
  const startsNow = running ? [] : firstUp;
  // Idle: ride-alongs that start by themselves arrive here only once settled (lib/settledRideAlongs,
  // filtered by QueuePanel so the card's visibility and count agree with these rows).
  const afterTurn = free.filter((i) => !atBoundary(i));
  // Ordinary inputs still waiting after a minute may be stuck. Answers may instead be in the host's
  // result-coalescing window; admission has no quiet deadline, so age alone cannot mark those stuck.
  const stuck = useWaitedIds(running ? NONE : immediateStartItems(free), STARTS_NOW_STUCK_MS);
  const resumeHint = t(paused.stopHold ? "paused.resumeHintStop" : "paused.resumeHint");
  const dragRow = dragFrom === null ? null : turns[dragFrom];
  const refusal = insertRefusal(currentTurn, !!onInsert, dragRow?.kind === "owner" && refusesImageSteer(imageSteering, dragRow.item.input));
  const refusalText = refusal ? t(refusal === "askTurn" ? "queue.turn.refuseAsk" : refusal === "noImages" ? "queue.turn.refuseImages" : "queue.turn.refuseNoSteer") : "";
  const dragging = dragRow?.kind === "owner";
  const boundaryCount = waiting.length + sendingSteers.length + boundary.length;
  const target = insertTargetShown(running, turns.some((r) => r.kind === "owner"), refusal, dragging);
  const targetState = insertTargetState(overBoundary && dragging, armed, refusal);
  const showBoundary = boundaryCount > 0;
  // 「全部合并插入」: every queued owner message, in queue order (delegation turns are never merged).
  const ownerMessages = turns.flatMap((r) => (r.kind === "owner" && mergeableOwnerItem(r.item) ? [r.item] : []));
  const mergeShown = mergeInsertShown(running, ownerMessages.length, refusal, dragging, !!onMergeInsert);
  const pausedAt = pausedFrom(turns, heldIds);
  // After a ride-along-started turn the owner's next turn goes first, unless the owner yielded it.
  const ownerNext = rideAlongsFollowTurn(running, currentTurn, turns, heldIds);
  const follows = ordered.ownerYielded ? null : ownerNext;
  const order: RideAlongOrder | null = ownerNext === null ? null : ordered.ownerYielded ? { kind: "first", turn: ownerNext } : { kind: "follows", turn: ownerNext, onYield: ordered.onYield };
  const firstStoppedOwner = turns.findIndex((r) => r.kind === "owner" && turnStopped(r, heldIds));

  // Section labels (rail tooltip, aria-label and the hover strip).
  const boundaryLabel =
    currentTurn?.kind === "ask" && currentTurn.askId
      ? `${t("queue.turn.stripBoundary")} · ${t("queue.turn.askTurn", { tag: taskTag(currentTurn.askId).label })}`
      : running && ordered.runningSince !== null
        ? `${t("queue.turn.stripBoundary")} · ${t("queue.turn.runningFor", { time: formatElapsed(now - ordered.runningSince) })}`
        : t("queue.turn.stripBoundary");
  const afterLabel = follows ? t("queue.turn.followsHint", { n: follows }) : running ? t("queue.turn.afterTurnHint") : t("queue.turn.startsNowHint");
  // A status in words, not an action (owner 2026-10-23: the old warn-toned 「马上开始」 read as a button).
  const afterStrip: StripLabel = follows
    ? { text: t("queue.turn.follows", { n: follows }), tone: "muted" }
    : running
      ? { text: t("queue.turn.afterTurn"), tone: "muted" }
      : { text: t("queue.turn.startsNow"), tone: "muted" };
  const queueLabel = t("queue.turn.queue", { n: turns.length });

  const onKey = (item: QueueItem) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (!e.altKey || e.target !== e.currentTarget || (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "End")) return;
    e.preventDefault();
    const targets = moveTargets(entries, item.queueId, mayPass);
    const target = e.key === "ArrowUp" ? targets.up : e.key === "ArrowDown" ? targets.down : targets.last;
    if (target) onMove(item, target.before);
  };

  // The 「插入当前回合」 row as a drop target: insert into the running turn — only once the drag has
  // stayed on it INSERT_DWELL_MS (before that it refuses the drop, so a quick pass never inserts).
  const targetDrop = {
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!dragging || !running) return;
      if (!overBoundary) {
        setOverBoundary(true);
        stopDwell();
        if (!refusal) dwell.current = setTimeout(() => setArmed(true), INSERT_DWELL_MS);
      }
      if (dropSlot !== null) setDropSlot(null);
      if (refusal || !armed) {
        e.dataTransfer.dropEffect = "none";
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) leaveTarget();
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const row = dragFrom === null ? null : turns[dragFrom];
      if (row?.kind === "owner" && armed && !refusal && onInsert) onInsert(row.item);
      endDrag();
    },
  };

  // A numbered turn as a drop target: a slot before / after it (a delegation only near its edges).
  const turnDrop = (index: number, kind: AdmissionRow["kind"]) => ({
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (dragFrom === null) return;
      if (overBoundary) leaveTarget();
      const r = e.currentTarget.getBoundingClientRect();
      const slot = slotForGroup(kind, index, r.height ? (e.clientY - r.top) / r.height : 0.5);
      if (slot === null || !canMoveTo(entries, dragFrom, slot, mayPass)) {
        e.dataTransfer.dropEffect = "none";
        if (dropSlot !== null) setDropSlot(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropSlot !== slot) setDropSlot(slot);
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const row = dragFrom === null ? null : turns[dragFrom];
      if (row?.kind === "owner" && dropSlot !== null && canMoveTo(entries, dragFrom!, dropSlot, mayPass)) onMove(row.item, beforeForSlot(entries, dropSlot));
      endDrag();
    },
  });
  const line = (where: "top" | "bottom") => <div className={`pointer-events-none absolute inset-x-1 ${where === "top" ? "-top-px" : "-bottom-px"} h-0.5 rounded bg-accent`} data-testid="queue-drop-line" />;

  // ---- boundary section rows (always shown fully) ----
  const boundaryList: React.ReactNode[] = [];
  const bRail = () => <Rail label={boundaryLabel} strip={{ text: boundaryLabel, tone: "accent" }} />;
  const targetText =
    targetState === "refused" ? refusalText : targetState === "armed" ? t("queue.turn.insertTargetArmed") : targetState === "hold" ? t("queue.turn.insertTargetHold") : t("queue.turn.insertTargetIdle");
  // The header line as the drop target (only while dragging): an overlay over 「接下来」, so nothing moves.
  const targetOverlay = target ? (
    <div
      className={`flex h-full min-w-0 items-center gap-1.5 rounded-ctl border border-dashed bg-surface px-1.5 text-meta transition-colors motion-reduce:transition-none ${
        targetState === "refused" ? `border-danger/60 text-danger ${DROP_TINT}` : targetState === "armed" ? `border-accent text-accent ${DROP_TINT}` : "border-accent/60 text-accent"
      }`}
      // 拖放落点预览: refused / armed tint only under 框线+底色 (lib/dropTint), over --surface so the header stays hidden.
      style={targetState === "refused" ? TARGET_REFUSED_TINT : targetState === "armed" ? TARGET_ARMED_TINT : undefined}
      title={targetState === "refused" ? refusalText : t("queue.turn.insertTargetHint")}
      data-testid="insert-target"
      data-state={targetState}
      {...targetDrop}
    >
      <CornerDownRight size={12} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate" data-testid={targetState === "refused" ? "boundary-refused" : targetState === "armed" ? "boundary-insert-here" : undefined}>
        {targetText}
      </span>
    </div>
  ) : null;
  const mergeButton = mergeShown ? (
    <button
      onClick={() => onMergeInsert?.(ownerMessages)}
      title={t("queue.merge.hint", { n: ownerMessages.length })}
      className={`${TINY} shrink-0 text-accent hover:bg-accent/10`}
      data-testid="queue-merge-insert"
    >
      {t("queue.merge.action")}
    </button>
  ) : null;
  // Each waiting insert says it is one; hovering any of them offers 打断并发送 (all of them, now).
  for (const p of waiting)
    boundaryList.push(
      <RailRow key={p.id} rail={bRail()} testId="boundary-steer">
        <div className={QUEUE_ROW}>
          {steerDelivery(p, runtime, imageSteering) === "nextTurn" ? <KindIcon icon={ArrowDownToLine} label={t("queue.meta.nextTurn")} /> : <KindIcon icon={CornerDownRight} label={t("queue.turn.inserting")} />}
          <span className={`${ROW_TEXT} text-foreground`}>{rowText(p.text)}</span>
          <QueuedImages images={messageImages((p.extra ?? []) as { type: string }[])} total={p.imageCount} hostId={hostId} />
          {(p.state === "checking" ? null : insertStatus?.(p.id)) ?? <SteerDeliveryNote steer={p} runtime={runtime} imageSteering={imageSteering} className={META_YIELDS} onRecheck={onRecheckSteer && (() => onRecheckSteer(p.id))} />}
          {p.state !== "checking" && <span className={`${ROW_ACTIONS} h-5 max-h-5`}>
            <button onClick={onInterruptSendSteers} title={t("steer.interruptSendHint")} className={`${TINY} text-danger hover:bg-danger/10`} data-testid="boundary-interrupt-send">
              {t("steer.interruptSend")}
            </button>
          </span>}
        </div>
      </RailRow>,
    );
  for (const e of sendingSteers)
    boundaryList.push(
      <RailRow key={e.id} rail={bRail()}>
        {renderOutbox(e, "steer")}
      </RailRow>,
    );
  for (const item of boundary)
    boundaryList.push(
      <RailRow key={item.id} rail={bRail()}>
        <NextStepRow item={item} running order={order} sessionId={sessionId} autoRetry={retry} />
      </RailRow>,
    );

  // ---- after-turn / starts-now rows (idle: the next-step ones lead in their own card, like the boundary card) ----
  const afterRow = (item: AdmissionNextStep, i: number) => (
    <RailRow key={`after:${item.id}`} rail={<Rail label={afterLabel} strip={afterStrip}>{i === 0 && (running ? <ArrowDownToLine size={12} /> : <Clock3 size={12} className="text-subtle" />)}</Rail>} testId={running ? "group-after-turn" : "group-starts-now"}>
      <NextStepRow item={item} running={running} order={order} sessionId={sessionId} autoRetry={retry} stuck={!retry && !running && stuck.has(item.id)} idleNote={running ? undefined : t("queue.turn.startsNow")} />
    </RailRow>
  );
  const startsNowList = startsNow.map((item, i) => afterRow(item, i));

  // ---- queue rows (counted against the cap; the paused divider is not a row) ----
  const queueList: { node: React.ReactNode; counts: boolean }[] = [];
  afterTurn.forEach((item, i) => queueList.push({ counts: true, node: afterRow(item, i + startsNow.length) }));
  // Held ride-alongs: their own group per reason, paused (no timing, no ring).
  for (const group of held) {
    const keys = heldKeys(group.reason);
    group.items.forEach((item, i) =>
      queueList.push({
        counts: true,
        node: (
          <RailRow
            key={`held:${item.id}`}
            rail={
              <Rail label={t(keys.hint)} strip={{ text: t(keys.strip), tone: "warn" }} className="text-warn">
                {i === 0 && <span className="text-[8px] leading-none">❚❚</span>}
              </Rail>
            }
            testId={group.reason === "ownerStop" ? "group-held-stop" : "group-held-pause"}
          >
            <NextStepRow item={item} running={running} held={group.reason} sessionId={sessionId} />
          </RailRow>
        ),
      }),
    );
  }
  turns.forEach((row, index) => {
    if (index === pausedAt)
      queueList.push({
        counts: false,
        node: (
          <RailRow
            key="paused-divider"
            role="separator"
            aria-label={t("queue.turn.pausedDivider")}
            className="!min-h-3"
            testId="queue-paused-divider"
            rail={
              <Rail label={t("queue.turn.pausedDivider")} strip={{ text: t("queue.turn.stripPaused"), tone: "warn" }} className="text-warn">
                <span className="text-[8px] leading-none">❚❚</span>
              </Rail>
            }
          >
            <span className="h-px min-w-0 flex-1 bg-warn/60" />
            {paused.controls && (
              <HoverActions>
                <button onClick={paused.onResume} title={resumeHint} className={`${TINY} bg-surface-2 text-foreground hover:text-accent`}>
                  {t("paused.resume")}
                </button>
                <button onClick={paused.onRestore} title={t("paused.restoreHint")} className={`${TINY} text-muted hover:text-foreground`}>
                  {t("paused.restore")}
                </button>
              </HoverActions>
            )}
          </RailRow>
        ),
      });
    const canGrip = row.kind === "owner" && (turns.length > 1 || (running && !refusal));
    // Stopped above a startable turn (no divider covers it): warn number + strip; with no divider at all
    // the first such owner row carries 继续 / 恢复.
    const stoppedAlone = index < (pausedAt < 0 ? turns.length : pausedAt) && turnStopped(row, heldIds);
    queueList.push({
      counts: true,
      node: (
        <RailRow
          key={row.key}
          rail={
            <Rail
              label={`${queueLabel} · ${t("queue.turn.numberHint", { n: index + 1 })}`}
              strip={stoppedAlone ? { text: t("queue.turn.stripPaused"), tone: "warn" } : { text: queueLabel, tone: "muted" }}
              forced={dropSlot !== null && index === Math.min(dropSlot, turns.length - 1) ? { text: t("queue.turn.dropMove"), tone: "accent" } : null}
            >
              <span className={`tabular-nums ${stoppedAlone ? "text-warn" : ""} ${canGrip ? "group-hover:opacity-0" : ""}`} aria-hidden>
                {index + 1}
              </span>
              {canGrip && row.kind === "owner" && (
                <span
                  draggable
                  title={t("queue.move.dragHint")}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", queueItemText(row.item));
                    setDragFrom(index);
                  }}
                  onDragEnd={endDrag}
                  className="absolute inset-0 flex cursor-grab items-center justify-center text-subtle opacity-0 group-hover:opacity-100 active:cursor-grabbing"
                  data-testid="queue-drag-grip"
                >
                  <GripVertical size={12} />
                </span>
              )}
            </Rail>
          }
          className={dragFrom === index ? "opacity-40" : ""}
          testId={`turn-group-${row.kind}`}
          {...turnDrop(index, row.kind)}
        >
          {dropSlot === index && line("top")}
          {row.kind === "owner" ? (
            itemRow(row.item, {
              // Only the first turn waits for nothing but the running one.
              note: retry ? formatAutoRetryWait(t, retry, retry.phase === "pending" ? "queue.autoRetryOwnerOrder" : "queue.autoRetryWaiting") : running && index === 0 && !heldIds.has(row.item.queueId) && row.entry.state !== "paused" ? t("queue.deliverAfterTurn") : undefined,
              paused: heldIds.has(row.item.queueId) || row.entry.state === "paused",
              // Alt+↑ / Alt+↓ / Alt+End stay as an unadvertised keyboard path.
              rowProps: { tabIndex: 0, onKeyDown: onKey(row.item) },
            })
          ) : (
            <AskTurnRow row={row} sessionId={sessionId} />
          )}
          {index === firstStoppedOwner && pausedAt < 0 && paused.controls && (
            <HoverActions>
              <button onClick={paused.onResume} title={resumeHint} className={`${TINY} bg-surface-2 text-foreground hover:text-accent`} data-testid="queue-paused-resume-row">
                {t("paused.resume")}
              </button>
              <button onClick={paused.onRestore} title={t("paused.restoreHint")} className={`${TINY} text-muted hover:text-foreground`}>
                {t("paused.restore")}
              </button>
            </HoverActions>
          )}
          {index === turns.length - 1 && dropSlot === turns.length && line("bottom")}
        </RailRow>
      ),
    });
  });
  for (const e of sendingQueue)
    queueList.push({
      counts: true,
      node: (
        <RailRow key={`out:${e.id}`} rail={<Rail />}>
          {renderOutbox(e, "queue")}
        </RailRow>
      ),
    });

  const counted = queueList.filter((r) => r.counts).length;
  // The leading card (boundary running, starts-now idle) is shown whole and counts toward the cap the same either way.
  const leading = boundaryList.length + startsNowList.length;
  const fold = foldQueueRows(leading, counted, expanded || dragging);
  const more = foldRow(leading, counted, expanded, dragging);
  const shownRows: React.ReactNode[] = [];
  let used = 0;
  for (const r of queueList) {
    if (r.counts && used >= fold.shown) break;
    if (r.counts) used++;
    shownRows.push(r.node);
  }

  const portals = (
    <>
      {slots?.target && targetOverlay && createPortal(targetOverlay, slots.target)}
      {slots?.actions && mergeButton && createPortal(mergeButton, slots.actions)}
    </>
  );
  const showLeading = showBoundary || startsNowList.length > 0;
  if (!retry && !showLeading && queueList.length === 0) return portals;
  return (
    <div className="flex flex-col" data-queue-section="" data-testid="turn-frame">
      {retry && <div role="status" className="border-b border-border/60 px-2 py-1 text-caption text-muted" data-testid="queue-auto-retry-wait">
        <div>{formatAutoRetryWait(t, retry, "queue.autoRetryWaiting")}</div>
        {retry.phase === "pending" && <div>{formatAutoRetryWait(t, retry, "queue.autoRetryOwnerOrder")}</div>}
      </div>}
      {portals}
      {showBoundary && (
        <div
          role="group"
          aria-label={boundaryLabel}
          className="relative"
          data-testid="boundary-card"
        >
          {boundaryList}
        </div>
      )}
      {startsNowList.length > 0 && (
        <div role="group" aria-label={afterLabel} className="relative" data-testid="starts-now-card">
          {startsNowList}
        </div>
      )}
      {queueList.length > 0 && (
        <div role="group" aria-label={queueLabel} className={showLeading ? "border-t border-border/60" : ""} data-testid="admission-queue">
          {shownRows}
          {/* Not while everything shows anyway (expanded by a drag, or it all fits): no 「还有 0 项」. */}
          {more.show && (
            <RailRow rail={<Rail>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</Rail>}>
              <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className={`${TINY} text-muted hover:text-foreground`} data-testid="queue-more">
                {expanded ? t("queue.turn.less") : t("queue.turn.moreItems", { n: more.hidden })}
              </button>
              <span className="flex-1" />
              <TimingSlot />
            </RailRow>
          )}
        </div>
      )}
    </div>
  );
}
