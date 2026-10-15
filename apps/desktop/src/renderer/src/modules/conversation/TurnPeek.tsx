// One turn as a reference (core component conversation.turnPeek; docs/desktop-modules.md §19.4): the
// read-only TimelineBody of that turn only, in the left-gutter reference card or a right-side card.
// Read from the agent's loaded timeline when it is there (live), else from history pages (lib/turnRefs).
// Opening it never selects the agent, never moves the main timeline and shows nothing newer.
import { useMemo } from "react";
import { CornerDownRight, RotateCw } from "lucide-react";
import { TimelineBody } from "../../components/Timeline";
import { useI18n, type MessageKey } from "../../i18n";
import { jumpToTurn } from "../../lib/jump";
import { closePeek } from "../../lib/peekStore";
import { shortTime } from "../../lib/refs";
import type { TurnPeekParams } from "../../lib/sideKinds";
import { orderedEntries } from "../../lib/timeline";
import { lookupTurn, useTurnRef } from "../../lib/turnRefs";
import type { SideBodyProps } from "../slots";
import { turnTarget as target, useNames } from "./turnPeekData";
import { ScriptText } from "../../components/ScriptText";

const REASON: Record<string, MessageKey> = {
  reverted: "conversation.turnPeek.reverted",
  "too-old": "conversation.turnPeek.tooOld",
  unknown: "conversation.turnPeek.unknown",
};

/** The stored snapshot when the turn itself is not readable (plain text, never markup). */
function Snapshot({ state, reason, onRetry }: { state: TurnPeekParams; reason: MessageKey; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="px-3.5 py-3 text-[13px] text-subtle">
      <p className="m-0 font-medium text-muted">{t(reason)}</p>
      {state.snippet && <p className="font-chat-context mt-2 mb-0 line-clamp-6 whitespace-pre-wrap opacity-80"><ScriptText text={state.snippet} /></p>}
      {onRetry && (
        <button onClick={onRetry} className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-accent hover:bg-hover">
          <RotateCw size={12} />
          {t("conversation.turnPeek.retry")}
        </button>
      )}
    </div>
  );
}

export function TurnPeekBody({ instance, where }: SideBodyProps<TurnPeekParams>) {
  const { t } = useI18n();
  const s = instance.state;
  const nameOf = useNames(s.hostId);
  const result = useTurnRef(target(s));
  const found = result.status === "found" ? result.found : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => (found ? orderedEntries(found.timeline) : []), [found?.timeline, found?.turn.entryIds.length]);
  const frame = where === "card" ? "h-full overflow-y-auto" : "";
  let body;
  if (result.status === "loading") body = <p className="m-0 px-3.5 py-3 text-[13px] text-subtle">{t("conversation.turnPeek.loading")}</p>;
  else if (result.status === "host-offline") body = <Snapshot state={s} reason="conversation.turnPeek.hostOffline" />;
  else if (result.status === "error") body = <Snapshot state={s} reason="conversation.turnPeek.error" onRetry={() => void lookupTurn(target(s), true)} />;
  else if (result.status === "not-found") body = <Snapshot state={s} reason={REASON[result.reason] ?? "conversation.turnPeek.unknown"} onRetry={() => void lookupTurn(target(s), true)} />;
  else
    body = (
      <div className="px-3.5 pb-2 text-[13px]">
        <TimelineBody timeline={found!.timeline} entries={entries} sessionId={s.sessionId} nameOf={nameOf} readOnly />
      </div>
    );
  return (
    <div className={frame} data-turn-peek={s.turnId}>
      {where === "card" && found?.turn.startedAt && (
        <p className="m-0 px-3.5 pt-2 text-[11px] text-subtle">
          {nameOf(s.sessionId)} · {shortTime(found.turn.startedAt)}
        </p>
      )}
      {body}
    </div>
  );
}

/** 跳过去 (the reference card's footer; the right-side card's header). Disabled when the turn is not there. */
export function TurnPeekActions({ instance, where }: SideBodyProps<TurnPeekParams>) {
  const { t } = useI18n();
  const s = instance.state;
  const result = useTurnRef(target(s));
  const can = result.status === "found";
  const jump = () => {
    if (where === "peek") closePeek();
    void jumpToTurn(s.hostId, s.sessionId, s.turnId);
  };
  if (where === "peek")
    return (
      <button
        onClick={jump}
        disabled={!can}
        title={can ? t("gutter.jumpHint") : t("gutter.jumpUnavailable")}
        className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted hover:bg-hover hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <CornerDownRight size={13} />
        {t("gutter.jump")}
      </button>
    );
  return (
    <button onClick={jump} disabled={!can} title={can ? t("gutter.jumpHint") : t("gutter.jumpUnavailable")} aria-label={t("gutter.jump")} className="flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground disabled:opacity-40">
      <CornerDownRight size={14} />
    </button>
  );
}
