// The composer's parts while the agent runs a delegation turn (lib/delegationTurn): the one-line
// hint over the empty input (正在处理 [avatar] Lead 的委托 #3 title · 已运行 2m), the small line above
// a draft (Enter 排到委托完成后), the 主人插话过 badge, and the send menu with the explicit choices
// (排队 / 加入此委托 / 打断委托, each with what it means for the requester).
import { ArrowDownLeft, ChevronUp } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { formatSpan } from "../lib/delegations";
import { delegationTurnSeconds, type DelegationSendChoice, type DelegationTurn } from "../lib/delegationTurn";
import { useNow } from "../lib/time";
import { DelegationTag } from "./DelegationParts";
import { Popover } from "./Menu";
import { Who } from "./Parties";

/** "正在处理 {who} 的委托" with the requester (avatar + name, or 你) spliced in. */
function Handling({ turn }: { turn: DelegationTurn }) {
  const { t } = useI18n();
  const [before = "", after = ""] = t("delegationTurn.handling").split("{who}");
  return (
    <>
      {before.trim() && <span className="shrink-0">{before.trim()}</span>}
      {turn.owner || (!turn.requesterId && !turn.requesterName) ? <span className="shrink-0">{t("delegation.you")}</span> : <Who id={turn.requesterId} name={turn.requesterName} size={14} quiet />}
      {after.trim() && <span className="shrink-0">{after.trim()}</span>}
    </>
  );
}

/**
 * Over the empty input (in place of the placeholder; `draft` false), or a small line above a draft.
 * One line, truncated; never takes clicks (the textarea underneath does).
 */
export function DelegationTurnHint({ turn, draft }: { turn: DelegationTurn; draft: boolean }) {
  const { t } = useI18n();
  const now = useNow(!draft);
  const seconds = delegationTurnSeconds(turn, now);
  if (draft)
    return (
      <div className="flex min-w-0 items-center gap-1 pt-0.5 text-[11px] text-subtle">
        <ArrowDownLeft size={11} className="shrink-0 text-accent" />
        <DelegationTag askId={turn.askId} />
        <span className="truncate">{t("delegationTurn.typing")}</span>
      </div>
    );
  return (
    // On the queue card's grid (components/TurnQueue): the icon in its rail column, the words from its icon column.
    <div aria-hidden className="pointer-events-none absolute inset-x-2 top-2 flex min-w-0 items-center gap-1 py-1 pr-24 text-sm text-subtle">
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
    <span className="shrink-0 rounded bg-warn/15 px-1 text-[10px] leading-4 text-warn-text" title={t("delegationTurn.ownerSteeredHint")}>
      {t("delegationTurn.ownerSteered")}
    </span>
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
