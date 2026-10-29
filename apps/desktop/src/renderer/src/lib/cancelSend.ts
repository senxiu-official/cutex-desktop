// 取消发送 (owner 2026-10-24, preview-next-strip-clear): a note / opening message cutex has not handed to the agent can be
// cancelled for real — cutex `agent-bus-stuck-messages` discard (POST /v2/agent-bus/stuck-messages/discard): the record
// becomes 「主人已丢弃」, is never delivered, and the sender sees it. Only messages still `pending` / `stale_held` qualify;
// one in the agent's inbox (`inbox_accepted`) is refused by cutex (message_not_discardable), so it gets no button.
import { useCallback, useEffect, useRef, useState } from "react";
import type { StuckBusMessage } from "../../../shared/ipc";
import { STUCK_MESSAGES_FEATURE } from "../../../shared/agentBusStuck";
import { hostApi } from "./hostLists";
import { featuresOf, useApp } from "../store";

/** Only waiting states cutex still lets the owner withdraw. */
export const CANCELABLE_STATES: readonly string[] = ["pending", "stale_held"];
/** Listed from this age on (a minute is when 「没开始」 shows). */
export const CANCEL_MIN_AGE_SECS = 60;
const REFRESH_MS = 30_000;
/** Refusals that only mean "not waiting any more" (delivered, failed or discarded since the list was read). */
const GONE_CODES = ["message_not_found", "message_not_discardable"];

/** The stuck messages addressed to `sessionId` that can still be cancelled, oldest first. */
export function cancelableTo(list: readonly StuckBusMessage[], sessionId: string): StuckBusMessage[] {
  return list.filter((m) => m.to?.id === sessionId && !m.settlement && CANCELABLE_STATES.includes(m.state)).sort((a, b) => (b.ageSecs ?? 0) - (a.ageSecs ?? 0));
}

/** Which of `candidates` a queue / pending row stands for: by sender, then by its text; a lone candidate is it. */
export function matchCancelable(candidates: readonly StuckBusMessage[], row: { fromId?: string | null; from?: string | null; text?: string | null }): StuckBusMessage | null {
  const knownSender = !!row.fromId || !!row.from;
  const pool = candidates.filter((m) => !knownSender || (!!row.fromId && m.from?.id === row.fromId) || (!!row.from && (m.from?.name === row.from || m.from?.id === row.from)));
  if (pool.length === 1) return pool[0]!;
  const head = (row.text ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
  if (head) {
    const hit = pool.filter((m) => {
      const preview = m.contentPreview.replace(/\s+/g, " ").trim();
      return !!preview && (preview.startsWith(head) || head.startsWith(preview.slice(0, 24)));
    });
    if (hit.length === 1) return hit[0]!;
  }
  return null;
}

export interface CancelSend {
  /** The cancellable messages to this agent (empty without the capability). */
  list: StuckBusMessage[];
  cancel(m: StuckBusMessage): Promise<{ ok: true } | { ok: false; error: string }>;
}

/** The host's cancellable messages to `sessionId`, read while `active` (a row that may be stuck is on screen). */
export function useCancelableSends(hostId: string, sessionId: string, active: boolean): CancelSend {
  const supported = useApp((s) => featuresOf(s, hostId).has(STUCK_MESSAGES_FEATURE));
  const [list, setList] = useState<StuckBusMessage[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    try {
      const view = await hostApi(hostId).stuckBusMessages(CANCEL_MIN_AGE_SECS);
      if (alive.current) setList(cancelableTo(view?.messages ?? [], sessionId));
    } catch {
      if (alive.current) setList([]);
    }
  }, [hostId, sessionId]);
  useEffect(() => {
    if (!supported || !active) {
      setList([]);
      return;
    }
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [supported, active, load]);
  const cancel = useCallback(
    async (m: StuckBusMessage) => {
      try {
        const result = await hostApi(hostId).discardStuckBusMessage({ messageId: m.messageId, expectedSemanticSha256: m.semanticSha256, ...(m.protectedControl ? { allowProtected: true } : {}) });
        void load();
        if (!result.ok && !GONE_CODES.includes(result.error.code)) return { ok: false as const, error: `${result.error.code}: ${result.error.message}` };
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [hostId, load],
  );
  return { list: supported ? list : [], cancel };
}
