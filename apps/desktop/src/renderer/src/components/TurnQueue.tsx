// The queue panel's turn frame (cutex admission-order; docs/research/queue-turn-groups-plan-20261012.md,
// owner layout 2026-10-12): ONE frame above the composer, sections separated by a hairline, no header
// rows. A ~22px left rail labels each row (components/QueueRail); section names / status are the
// rail's tooltip and the section's aria-label; section actions show on hover / focus at the end of
// its first row.
//   下个工具边界 (only while a turn runs; accent bar, each row its kind icon): what enters the running
//     turn at its next tool boundary — the owner's inserts (↳ icon, 下一步), wakes past their wait (下一步),
//     wakes still waiting for the turn end (a depleting ring). The drop target for "insert" (refused
//     in a delegation's turn / without steering, the reason on a hint row while dragging).
//   ⤓ 本回合结束后 (running: alarms) or ⚡ 马上开始 (idle: every ride-along item starts one turn).
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
import { useContext, useState, type DragEvent, type KeyboardEvent } from "react";
import { ArrowDownToLine, ChevronDown, ChevronUp, CornerDownRight, GripVertical, Zap } from "lucide-react";
import type { AdmissionCurrentTurn, AdmissionNextStep, AdmissionRef, QueueItem } from "@cutex-desktop/protocol";
import { useI18n } from "../i18n";
import { atBoundary, beforeForSlot, canMoveTo, foldQueueRows, foldRow, insertRefusal, moveTargets, pausedFrom, rideAlongsFollowTurn, slotForGroup, turnStopped, type AdmissionRow } from "../lib/admissionOrder";
import { formatElapsed } from "../lib/agentAttention";
import type { OutboxEntry } from "../lib/outbox";
import type { PendingSteer } from "../lib/pendingSteers";
import { RailStripContext, type StripLabel } from "../lib/railStrip";
import { heldKeys, splitHeld } from "../lib/stopHold";
import { taskTag } from "../lib/tasks";
import { useNow } from "../lib/time";
import { queueViewOf, setQueueView } from "../lib/queueView";
import { queueItemText } from "../store";
import { AskTurnRow, KindIcon, NextStepRow, TimingSlot, type RideAlongOrder } from "./AdmissionRows";
import { META_YIELDS, QUEUE_ROW, ROW_ACTIONS, ROW_META, ROW_TEXT, rowText } from "../lib/queueRow";
import { HoverActions, Rail, RailRow } from "./QueueRail";

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

const TINY = "rounded px-1.5 py-0.5 text-[11px] focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none";

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
}) {
  const { t } = useI18n();
  const { turns, nextStep, running, currentTurn, mayPass, onMove, onInsert, sessionId } = ordered;
  const entries = turns.map((r) => r.entry);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const [overBoundary, setOverBoundary] = useState(false);
  // 「还有 N 项」 expanded, per agent (the same component shows another agent's queue after a switch).
  const [expandedFor, setExpandedFor] = useState<{ id: string; v: boolean } | null>(null);
  const expanded = expandedFor?.id === sessionId ? expandedFor.v : !!queueViewOf(sessionId).expanded;
  const now = useNow(running && ordered.runningSince !== null);
  const setExpanded = (v: boolean) => {
    setQueueView(sessionId, { expanded: v });
    setExpandedFor({ id: sessionId, v });
  };
  const endDrag = () => {
    setDragFrom(null);
    setDropSlot(null);
    setOverBoundary(false);
  };
  const { free, held } = splitHeld(nextStep, { ridealongsHeld: ordered.ridealongsHeld });
  const boundary = running ? free.filter(atBoundary) : [];
  // Idle: ride-alongs that start by themselves arrive here only once settled (lib/settledRideAlongs,
  // filtered by QueuePanel so the card's visibility and count agree with these rows).
  const afterTurn = running ? free.filter((i) => !atBoundary(i)) : free;
  const resumeHint = t(paused.stopHold ? "paused.resumeHintStop" : "paused.resumeHint");
  const refusal = insertRefusal(currentTurn, !!onInsert);
  const refusalText = refusal ? t(refusal === "askTurn" ? "queue.turn.refuseAsk" : "queue.turn.refuseNoSteer") : "";
  const dragging = dragFrom !== null && turns[dragFrom]?.kind === "owner";
  const boundaryCount = waiting.length + sendingSteers.length + boundary.length;
  const showBoundary = boundaryCount > 0 || (running && dragging);
  const pausedAt = pausedFrom(turns, heldIds);
  // After a ride-along-started turn the owner's next turn goes first, unless the owner yielded it.
  const ownerNext = rideAlongsFollowTurn(running, currentTurn, turns, heldIds);
  const follows = ordered.ownerYielded ? null : ownerNext;
  const order: RideAlongOrder | null = ownerNext === null ? null : ordered.ownerYielded ? { kind: "first", turn: ownerNext } : { kind: "follows", turn: ownerNext, onYield: ordered.onYield };
  const firstStoppedOwner = turns.findIndex((r) => r.kind === "owner" && turnStopped(r, heldIds));

  const { enabled: strips } = useContext(RailStripContext);
  // Section labels (rail tooltip, aria-label and the hover strip).
  const boundaryLabel =
    currentTurn?.kind === "ask" && currentTurn.askId
      ? `${t("queue.turn.stripBoundary")} · ${t("queue.turn.askTurn", { tag: taskTag(currentTurn.askId).label })}`
      : running && ordered.runningSince !== null
        ? `${t("queue.turn.stripBoundary")} · ${t("queue.turn.runningFor", { time: formatElapsed(now - ordered.runningSince) })}`
        : t("queue.turn.stripBoundary");
  const afterLabel = follows ? t("queue.turn.followsHint", { n: follows }) : running ? t("queue.turn.afterTurnHint") : t("queue.turn.startsNowHint");
  const afterStrip: StripLabel = follows ? { text: t("queue.turn.follows", { n: follows }), tone: "muted" } : running ? { text: t("queue.turn.afterTurn"), tone: "muted" } : { text: t("queue.turn.startsNow"), tone: "warn" };
  const queueLabel = t("queue.turn.queue", { n: turns.length });
  // While dragging over a section its strip is the drop hint.
  const boundaryHint: StripLabel | null = overBoundary && dragging ? (refusal ? { text: t(refusal === "askTurn" ? "queue.turn.dropRefuseAsk" : "queue.turn.dropRefuseNoSteer"), tone: "danger" } : { text: t("queue.turn.dropInsert"), tone: "accent" }) : null;

  const onKey = (item: QueueItem) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (!e.altKey || e.target !== e.currentTarget || (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "End")) return;
    e.preventDefault();
    const targets = moveTargets(entries, item.queueId, mayPass);
    const target = e.key === "ArrowUp" ? targets.up : e.key === "ArrowDown" ? targets.down : targets.last;
    if (target) onMove(item, target.before);
  };

  // The boundary section as a drop target: insert into the running turn.
  const boundaryDrop = {
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!dragging || !running) return;
      if (!overBoundary) setOverBoundary(true);
      if (dropSlot !== null) setDropSlot(null);
      if (refusal) {
        e.dataTransfer.dropEffect = "none";
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverBoundary(false);
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const row = dragFrom === null ? null : turns[dragFrom];
      if (row?.kind === "owner" && !refusal && onInsert) onInsert(row.item);
      endDrag();
    },
  };

  // A numbered turn as a drop target: a slot before / after it (a delegation only near its edges).
  const turnDrop = (index: number, kind: AdmissionRow["kind"]) => ({
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (dragFrom === null) return;
      if (overBoundary) setOverBoundary(false);
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
  // The section's glyph only on its placeholder rows (drop hint / empty): its rows carry their own
  // kind icon and the accent bar marks the section (no ↳ twice on one row).
  const bRail = (glyph = false) => (
    <Rail label={boundaryLabel} strip={{ text: boundaryLabel, tone: "accent" }} forced={boundaryList.length === 0 ? boundaryHint : null}>
      {glyph && <CornerDownRight size={12} className="text-accent" />}
    </Rail>
  );
  // Without strips the drop hint is a row of its own.
  if (overBoundary && dragging && !strips)
    boundaryList.push(
      <RailRow key="hint" rail={bRail(true)}>
        <span className={`min-w-0 flex-1 truncate pl-0.5 text-xs ${refusal ? "text-danger" : "text-accent"}`} title={refusalText || undefined} data-testid={refusal ? "boundary-refused" : "boundary-insert-here"}>
          {refusal ? refusalText : t("queue.turn.insertHere")}
        </span>
      </RailRow>,
    );
  else if (boundaryCount === 0 && showBoundary)
    boundaryList.push(
      <RailRow key="empty" rail={bRail(true)}>
        <span className="min-w-0 flex-1 truncate pl-0.5 text-xs text-subtle">{t("queue.turn.dropToInsert")}</span>
      </RailRow>,
    );
  for (const p of waiting) {
    const first = boundaryList.length === 0;
    boundaryList.push(
      <RailRow key={p.id} rail={bRail()} testId="boundary-steer">
        <div className={QUEUE_ROW}>
          <KindIcon icon={CornerDownRight} label={t("queue.turn.inserting")} />
          <span className={`${ROW_TEXT} text-foreground`}>{rowText(p.text)}</span>
          {p.imageCount > 0 && <span className="shrink-0 text-[11px] text-subtle">{t("steer.images", { n: p.imageCount })}</span>}
          <span className={`${ROW_META} text-subtle ${first ? META_YIELDS : ""}`} title={t("queue.deliverNextStep")} data-testid="steer-delivery-note">
            {t("queue.meta.nextStep")}
          </span>
          {first && (
            <span className={ROW_ACTIONS}>
              <button onClick={onInterruptSendSteers} title={t("steer.interruptSendHint")} className={`${TINY} text-danger hover:bg-danger/10`} data-testid="boundary-interrupt-send">
                {t("steer.interruptSend")}
              </button>
            </span>
          )}
        </div>
      </RailRow>,
    );
  }
  for (const e of sendingSteers)
    boundaryList.push(
      <RailRow key={e.id} rail={bRail()}>
        {renderOutbox(e, "steer")}
      </RailRow>,
    );
  for (const item of boundary)
    boundaryList.push(
      <RailRow key={item.id} rail={bRail()}>
        <NextStepRow item={item} running order={order} sessionId={sessionId} />
      </RailRow>,
    );

  // ---- queue rows (counted against the cap; the paused divider is not a row) ----
  const queueList: { node: React.ReactNode; counts: boolean }[] = [];
  afterTurn.forEach((item, i) =>
    queueList.push({
      counts: true,
      node: (
        <RailRow key={`after:${item.id}`} rail={<Rail label={afterLabel} strip={afterStrip}>{i === 0 && (running ? <ArrowDownToLine size={12} /> : <Zap size={12} className="text-warn" />)}</Rail>} testId={running ? "group-after-turn" : "group-starts-now"}>
          <NextStepRow item={item} running={running} order={order} sessionId={sessionId} idleNote={running || i > 0 ? undefined : t("queue.turn.startsNow")} />
        </RailRow>
      ),
    }),
  );
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
              note: running && index === 0 && !heldIds.has(row.item.queueId) && row.entry.state !== "paused" ? t("queue.deliverAfterTurn") : undefined,
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
  const fold = foldQueueRows(boundaryList.length, counted, expanded || dragging);
  const more = foldRow(boundaryList.length, counted, expanded, dragging);
  const shownRows: React.ReactNode[] = [];
  let used = 0;
  for (const r of queueList) {
    if (r.counts && used >= fold.shown) break;
    if (r.counts) used++;
    shownRows.push(r.node);
  }

  if (!showBoundary && queueList.length === 0) return null;
  return (
    <div className="flex flex-col" data-queue-section="" data-testid="turn-frame">
      {showBoundary && (
        <div
          role="group"
          aria-label={boundaryLabel}
          className={`relative transition-colors motion-reduce:transition-none ${overBoundary && dragging ? (refusal ? "bg-danger/5" : "bg-accent/5") : ""}`}
          data-testid="boundary-card"
          {...boundaryDrop}
        >
          <span className={`pointer-events-none absolute top-1 bottom-1 left-0.5 w-0.5 rounded ${overBoundary && dragging && refusal ? "bg-danger/70" : "bg-accent/70"}`} />
          {boundaryList}
        </div>
      )}
      {queueList.length > 0 && (
        <div role="group" aria-label={queueLabel} className={showBoundary ? "border-t border-border/60" : ""} data-testid="admission-queue">
          {shownRows}
          {/* Not while everything shows anyway (expanded by a drag, or it all fits): no 「还有 0 项」. */}
          {more.show && (
            <RailRow rail={<Rail>{expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</Rail>}>
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
