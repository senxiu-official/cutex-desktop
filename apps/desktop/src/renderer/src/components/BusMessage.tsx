// Core fallback for all external messages, including unknown or unavailable module schemas.
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { useApp } from "../store";
import { convFeaturesOf, useConvScope } from "../lib/conversationScope";
import { useUiPrefs } from "../lib/prefs";
import { AGENT_MESSAGES_V2, deliveryKindOf, stripLegacyPrefix, type AgentEnvelope, type DeliveryKind } from "../lib/agentMessages";
import { senderLabel } from "../lib/systemSenders";
import { SenderAvatar } from "./SystemAvatar";
import { useWakeHint } from "../lib/wakeBusyWaitView";
import { EnvelopeBadges, KindTag, SentStatus } from "./AgentMessageParts";
import { ScriptText } from "./ScriptText";

/**
 * Agent-bus message. Compact (default): one line — the peer's avatar, ↙ 来自 / ↗ 发给 + name, delivery
 * tag and a one-line preview — expanding to the full bubble. Full mode always shows the bubble.
 * With agent-messages-v2 the tag is 留言 / 唤醒 (`kind`, else mapped from the wire mode), a sent
 * row gets its live status (`messageId`) and a received one its envelope facts. The 唤醒 tooltip says
 * what a wake does to a busy recipient on this host (cutex wake-busy-wait), by `recipientRuntime`
 * (the viewed agent for a received row, the addressee for a sent one).
 */
export function BusMessage({ direction, name: rawName, mode, text: raw, onContextMenu, kind = null, downgraded = false, messageId = null, envelope = null, senderId = null, sourceKind = null, recipientRuntime = "codex" }: { direction: "in" | "out"; name: string; mode: string | null; text: string; onContextMenu: React.MouseEventHandler; kind?: DeliveryKind | null; downgraded?: boolean; messageId?: string | null; envelope?: AgentEnvelope | null; /** Received only: the sender id / source kind, so cutex services show as 委托系统 / Cutex 系统 (lib/systemSenders). */ senderId?: string | null; sourceKind?: string | null; /** The runtime of the agent the message went to (a Claude agent always waits for the turn end). */ recipientRuntime?: "codex" | "claude" }) {
  const { t } = useI18n();
  const conv = useConvScope();
  const v2 = useApp((s) => convFeaturesOf(conv, s).has(AGENT_MESSAGES_V2));
  // History from before v2: drop the exact default `[message from X] ` prefix (contract §6.6).
  const text = v2 && direction === "in" && !envelope ? stripLegacyPrefix(raw, rawName) : raw;
  const { agentMessages } = useUiPrefs();
  const [open, setOpen] = useState(agentMessages === "full");
  const incoming = direction === "in";
  const id = incoming ? senderId : null;
  const name = incoming ? senderLabel(t, id, sourceKind, rawName) : rawName;
  const Arrow = incoming ? ArrowDownLeft : ArrowUpRight;
  const shownKind = kind ?? deliveryKindOf(null, mode);
  const wakeHint = useWakeHint(v2 && shownKind === "wake", recipientRuntime);
  return (
    <div className="group/msg my-2" onContextMenu={onContextMenu}>
      <button onClick={() => setOpen(!open)} className="flex w-full max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-xs text-muted hover:text-foreground">
        <Arrow size={13} className="shrink-0 text-subtle" />
        <span className="shrink-0">{t(incoming ? "conversation.from" : "conversation.to")}</span>
        <SenderAvatar id={id} sourceKind={incoming ? sourceKind : null} name={name} size={18} />
        <span className="shrink-0 font-medium text-foreground">{name}</span>
        {v2 ? <KindTag kind={shownKind} downgraded={downgraded || !!envelope?.downgraded} wakeHint={wakeHint} /> : <DeliveryTag mode={mode} />}
        {v2 && envelope && <EnvelopeBadges envelope={envelope} reveal={open ? "" : "hidden group-hover/msg:inline group-focus-within/msg:inline"} />}
        {v2 && !incoming && messageId && <SentStatus messageId={messageId} />}
        {!open && <span className="min-w-0 truncate text-subtle"><ScriptText text={text.replace(/\s+/g, " ")} /></span>}
        {open ? <ChevronDown size={13} className="ml-auto shrink-0" /> : <ChevronRight size={13} className="ml-auto shrink-0" />}
      </button>
      {open && (
        <div className={`font-chat-context mt-1 ml-6 max-w-[75%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${incoming ? "bg-peer" : "border border-dashed border-border text-muted"}`}><ScriptText text={text} /></div>
      )}
    </div>
  );
}

function DeliveryTag({ mode }: { mode: string | null }) {
  const { t } = useI18n();
  if (!mode) return null;
  const key = `delivery.${mode}` as MessageKey;
  return <span className="shrink-0 rounded bg-surface-2 px-1.5 py-px text-[10px] whitespace-nowrap text-muted">{t(key) === key ? mode : t(key)}</span>;
}

