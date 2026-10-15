// The core reference component (docs/desktop-modules.md §19.4; RFC §7.4 `turn.peek`): one turn,
// peekable (left-gutter reference card), multi + transient, bound to the host. Placement §18.6:
// home "reference", prefer a page already holding one, else the page in view — the one default that
// follows the hand, so a quick look lands where the owner is and the next one replaces it; keep it
// open (pin) to keep it. State = the ref itself (≤ 1 KiB, no content). Its refs are `turn` refs.
import { TextQuote } from "lucide-react";
import { useApp } from "../../store";
import { REF_MAX_SNIPPET, turnTitle } from "../../lib/refs";
import { TURN_PEEK, type TurnPeekParams } from "../../lib/sideKinds";
import type { Json } from "../types";
import type { RefParams, SideComponentItem } from "../slots";
import { TurnPeekActions, TurnPeekBody } from "./TurnPeek";
import { useTurnPeekTab } from "./turnPeekData";

const ID = /^[^\s]{1,200}$/;

function parse(raw: Json): TurnPeekParams | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, Json>;
  const str = (v: Json | undefined, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
  const sessionId = str(r.sessionId, 200);
  const turnId = str(r.turnId, 200);
  if (!sessionId || !turnId || !ID.test(sessionId) || !ID.test(turnId)) return null;
  const hostId = str(r.hostId, 200) ?? useApp.getState().hosts?.active ?? "local";
  const threadId = str(r.threadId, 200);
  const ordinal = typeof r.ordinal === "number" && Number.isInteger(r.ordinal) && r.ordinal > 0 ? r.ordinal : undefined;
  const agentName = str(r.agentName, 200);
  const snippet = typeof r.snippet === "string" && r.snippet ? r.snippet.slice(0, REF_MAX_SNIPPET) : undefined;
  return { hostId, sessionId, turnId, ...(threadId ? { threadId } : {}), ...(ordinal ? { ordinal } : {}), ...(agentName ? { agentName } : {}), ...(snippet ? { snippet } : {}) };
}

export const turnPeekComponent: SideComponentItem<TurnPeekParams, TurnPeekParams> = {
  id: TURN_PEEK,
  titleKey: "conversation.turnPeek",
  icon: TextQuote,
  instances: "multi",
  defaultBinding: "host",
  placement: { home: "reference", prefer: [{ containing: TURN_PEEK }, "active"], order: 150 },
  transient: true,
  peekable: true,
  parseParams: parse,
  dedupeKey: (p) => `turn:${p.hostId}:${p.sessionId}:${p.turnId}`,
  init: (p) => p,
  restore: (raw) => parse(raw),
  toRef(state) {
    const params: Record<string, string> = { sessionId: state.sessionId, turnId: state.turnId };
    if (state.threadId) params.threadId = state.threadId;
    if (state.ordinal) params.ordinal = String(state.ordinal);
    return { key: `${state.sessionId}:${state.turnId}`, title: turnTitle(state.agentName ?? state.sessionId, state.ordinal, null), params: params as RefParams, ...(state.snippet ? { snippet: state.snippet } : {}) };
  },
  fromRef(params) {
    return parse({ ...params, ...(params.ordinal ? { ordinal: Number(params.ordinal) } : {}) });
  },
  useTab: useTurnPeekTab,
  Body: TurnPeekBody,
  Actions: TurnPeekActions,
};
