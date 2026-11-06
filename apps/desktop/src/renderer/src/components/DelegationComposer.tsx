// The composer's parts while the agent runs a delegation turn (lib/delegationTurn): the one-line
// hint over the empty input (正在处理 [avatar] Lead 的委托 #3 title · 已运行 2m), the small line above
// a draft (Enter 排到委托完成后), the 主人插话过 badge, and the send menu with the explicit choices
// (排队 / 加入此委托 / 打断委托, each with what it means for the requester).
import { ArrowDownLeft, ChevronUp, Hourglass } from "lucide-react";
import type { AskSummary } from "../../../shared/ipc";
import { useI18n, type MessageKey } from "../i18n";
import { delegationWait, formatSpan } from "../lib/delegations";
import { delegationTurnSeconds, type DelegationSendChoice, type DelegationTurn } from "../lib/delegationTurn";
import { formatAbsolute, useNow } from "../lib/time";
import { DelegationTag, useWaitText } from "./DelegationParts";
import { Popover } from "./Menu";
import { Who } from "./Parties";
import { Tag } from "./Tag";

/** "正在处理 {who} 的委托" with the requester (avatar + name, or 你) spliced in. */
function Handling({ turn }: { turn: DelegationTurn }) {
  const { t } = useI18n();
  const [before = "", after = ""] = t("delegationTurn.handling").split("{who}");
  return (
    <>
      {before.trim() && <span className="shrink-0">{before.trim()}</span>}
      {turn.owner || (!turn.requesterId && !turn.requesterName) ? <span className="shrink-0">{t("delegation.you")}</span> : <Who id={turn.requesterId} name={turn.requesterName} size={16} quiet />}
      {after.trim() && <span className="shrink-0">{after.trim()}</span>}
    </>
  );
}

/**
 * A delegation turn's draft label: 「正在回复委托 …」 while there is a draft, laid on the input box's top edge (a
 * legend; the box is its positioning box). It takes no room: the first keystroke, a send and the delegation turn
 * ending never change the box's size (it was a line above the draft; flicker recorder 2026-10-26). Never takes clicks.
 */
export function DelegationTurnHint({ turn, draft }: { turn: DelegationTurn; draft: boolean }) {
  const { t } = useI18n();
  if (!draft) return null;
  return (
    <div className="pointer-events-none absolute -top-2 left-2.5 z-10 flex max-w-[calc(100%-1.25rem)] min-w-0 items-center gap-1 rounded-full bg-surface px-1.5 text-caption/[inherit] text-subtle" data-delegation-draft-line="">
      <ArrowDownLeft size={11} className="shrink-0 text-accent" />
      <DelegationTag askId={turn.askId} />
      <span className="truncate">{t("delegationTurn.typing")}</span>
    </div>
  );
}

/**
 * Over the empty input, in place of the placeholder (inside the input row, which is its positioning box). One line,
 * truncated; never takes clicks (the textarea underneath does).
 */
export function DelegationTurnOverlay({ turn }: { turn: DelegationTurn }) {
  const { t } = useI18n();
  const now = useNow(true);
  const seconds = delegationTurnSeconds(turn, now);
  return (
    // On the queue card's grid (components/TurnQueue): the icon in its rail column, the words from its icon column.
    <div aria-hidden className="pointer-events-none absolute -left-1 right-0 top-0 flex min-w-0 items-center gap-1 py-1 pr-24 text-sm text-subtle">
      <span className="-mr-0.5 flex w-[22px] shrink-0 justify-center">
        <ArrowDownLeft size={13} className="text-accent" />
      </span>
      <Handling turn={turn} />
      <DelegationTag askId={turn.askId} />
      {turn.title && <span className="min-w-0 truncate">{turn.title}</span>}
      {seconds !== null && <span className="shrink-0 tabular-nums">· {t("delegationTurn.elapsed", { t: formatSpan(seconds) })}</span>}
    </div>
  );
}

/** 主人插话过 (requester side card, result rows). */
export function OwnerSteeredBadge() {
  const { t } = useI18n();
  return (
    <Tag tone="attention" title={t("delegationTurn.ownerSteeredHint")}>
      {t("delegationTurn.ownerSteered")}
    </Tag>
  );
}

const CHOICE_LABEL: Record<DelegationSendChoice, MessageKey> = { queue: "delegationTurn.choice.queue", join: "delegationTurn.choice.join", interrupt: "delegationTurn.choice.interrupt" };
const CHOICE_HINT: Record<DelegationSendChoice, MessageKey> = { queue: "delegationTurn.choice.queueHint", join: "delegationTurn.choice.joinHint", interrupt: "delegationTurn.choice.interruptHint" };

/** The chevron next to ↵: how to send during a delegation turn. */
export function DelegationSendMenu({ choices, disabled, onPick }: { choices: DelegationSendChoice[]; disabled: boolean; onPick(choice: DelegationSendChoice): void }) {
  const { t } = useI18n();
  if (disabled) return null;
  return (
    <div className="mb-0.5">
      <Popover align="right" width="w-80" triggerTitle={t("delegationTurn.menu")} trigger={<ChevronUp size={14} />}>
        {(close) => (
          <div className="flex flex-col">
            {choices.map((c, i) => (
              <button
                key={c}
                onClick={() => {
                  close();
                  onPick(c);
                }}
                className="flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2"
              >
                <span className="text-sm">
                  {t(CHOICE_LABEL[c])}
                  {i === 0 && <span className="ml-1.5 text-xs text-subtle">↵</span>}
                </span>
                <span className={`text-xs ${c === "queue" ? "text-subtle" : c === "interrupt" ? "text-danger" : "text-warn-text"}`}>{t(CHOICE_HINT[c])}</span>
              </button>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
}

/**
 * The handler ended its turn with delegation_await (hold waitingForEvent): idle, but on purpose. Over the empty input
 * in place of the placeholder (same box as DelegationTurnOverlay, no room taken): 在等委托事件 #3 title · 等 1 个作业 ·
 * 最晚 06:11; with a draft, the short form on the input's top edge. The handler's own note on hover.
 */
export function DelegationAwaitLine({ d, draft }: { d: AskSummary; draft: boolean }) {
  const { t } = useI18n();
  const wait = delegationWait(d);
  const what = useWaitText()(wait);
  const deadline = wait.timeoutAt ? Date.parse(wait.timeoutAt) : NaN;
  const hint = [t("delegation.wait.hint"), wait.note, Number.isFinite(deadline) ? formatAbsolute(deadline / 1000) : null].filter(Boolean).join("\n");
  if (draft)
    return (
      <div className="pointer-events-none absolute -top-2 left-2.5 z-10 flex max-w-[calc(100%-1.25rem)] min-w-0 items-center gap-1 rounded-full bg-surface px-1.5 text-caption/[inherit] text-subtle" data-delegation-await="" title={hint}>
        <Hourglass size={11} className="shrink-0 text-muted" />
        <span className="shrink-0">{t("delegationAwait.waiting")}</span>
        <DelegationTag askId={d.askId} />
      </div>
    );
  return (
    <div role="status" className="pointer-events-none absolute -left-1 right-0 top-0 flex min-w-0 items-center gap-1 py-1 pr-24 text-sm text-subtle" data-delegation-await="" title={hint}>
      <span className="-mr-0.5 flex w-[22px] shrink-0 justify-center">
        <Hourglass size={13} className="text-muted" />
      </span>
      <span className="shrink-0">{t("delegationAwait.waiting")}</span>
      <DelegationTag askId={d.askId} />
      {d.title && <span className="min-w-0 truncate">{d.title}</span>}
      {what && <span className="shrink-0 tabular-nums">· {what}</span>}
    </div>
  );
}
