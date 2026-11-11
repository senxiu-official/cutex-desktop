// Core fallback for all external messages, including unknown or unavailable module schemas.
import type { AgentRuntime } from "../lib/agentFeatures";
import { MessageSettlementControl } from "./MessageSettlementControl";
import { useAgentMessage } from "../lib/agentMessageStore";
import { useConvHost } from "../lib/conversationScope";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { useApp } from "../store";
import { convFeaturesOf, useConvScope } from "../lib/conversationScope";
import { useUiPrefs } from "../lib/prefs";
import { AGENT_MESSAGES_V2, deliveryKindOf, stripLegacyPrefix, type AgentEnvelope, type DeliveryKind } from "../lib/legacyDelivery/agentMessages";
import { senderLabel } from "../lib/systemSenders";
import { useSenderName } from "../lib/viewHost";
import { SenderAvatar } from "./SystemAvatar";
import { useWakeHint } from "../lib/wakeBusyWaitView";
import { EnvelopeBadges, KindTag, SentStatus } from "./AgentMessageParts";
import { ScriptText } from "./ScriptText";
import { Tag } from "./Tag";
import { useUserLayoutToggle } from "../lib/userLayoutToggle";

/**
 * Agent-bus message. Compact (default): one line — the peer's avatar, ↙ 来自 / ↗ 发给 + name, delivery
 * tag and a one-line preview — expanding to the full bubble. Full mode always shows the bubble.
 * With agent-messages-v2 the tag is 留言 / 唤醒 (`kind`, else mapped from the wire mode), a sent
 * row gets its live status (`messageId`) and a received one its envelope facts. The 唤醒 tooltip says
 * what a wake does to a busy recipient on this host (cutex wake-busy-wait), by `recipientRuntime`
 * (the viewed agent for a received row, the addressee for a sent one).
 */
export function BusMessage({ direction, name: rawName, mode, text: raw, preview = null, onContextMenu, kind = null, downgraded = false, messageId = null, envelope = null, senderId = null, sourceKind = null, recipientId = null, recipientRuntime = "codex", recipientFeatures = null }: { direction: "in" | "out"; name: string; mode: string | null; text: string; /** Sent only: the one-line text when it differs from the body (the agent's own words, lib/sentToolPairs); opened, the row shows the whole body. */ preview?: string | null; onContextMenu: React.MouseEventHandler; kind?: DeliveryKind | null; downgraded?: boolean; messageId?: string | null; envelope?: AgentEnvelope | null; /** Received only: the sender id / source kind, so cutex services show as 委托系统 / Cutex 系统 (lib/systemSenders). */ senderId?: string | null; sourceKind?: string | null; /** Sent only: the addressee's id, so 发给 shows its avatar (owner 2026-11-01: it drew a round letter on a fill). */ recipientId?: string | null; /** The runtime of the agent the message went to and its adapter feature map (lib/wakeCountdown readsEarly). */ recipientRuntime?: AgentRuntime; recipientFeatures?: Readonly<Record<string, unknown>> | null }) {
  const { t } = useI18n();
  const userToggle = useUserLayoutToggle();
  const conv = useConvScope();
  const v2 = useApp((s) => convFeaturesOf(conv, s).has(AGENT_MESSAGES_V2));
  // History from before v2: drop the exact default `[message from X] ` prefix (contract §6.6).
  const text = v2 && direction === "in" && !envelope ? stripLegacyPrefix(raw, rawName) : raw;
  const { agentMessages } = useUiPrefs();
  const [open, setOpen] = useState(agentMessages === "full");
  const incoming = direction === "in";
  const id = incoming ? senderId : recipientId;
  const sender = useSenderName(incoming ? id : null, rawName);
  const name = incoming ? senderLabel(t, id, sourceKind, sender.name) : rawName;
  const Arrow = incoming ? ArrowDownLeft : ArrowUpRight;
  const shownKind = kind ?? deliveryKindOf(null, mode);
  const wakeHint = useWakeHint(v2 && shownKind === "wake", recipientRuntime, recipientFeatures);
  return (
    <div className="group/msg my-2 min-w-0 max-w-full" onContextMenu={onContextMenu}>
      <button onClick={() => userToggle(() => setOpen(!open))} className="flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-md py-0.5 text-left text-xs text-muted hover:text-foreground">
        <Arrow size={13} className="shrink-0 text-subtle" />
        <span className="shrink-0">{t(incoming ? "conversation.from" : "conversation.to")}</span>
        <SenderAvatar id={id} sourceKind={incoming ? sourceKind : null} name={name} size={20} agent />
        <span data-testid="bus-message-name" className="min-w-0 max-w-[16em] shrink-0 truncate whitespace-nowrap font-medium text-foreground" title={sender.real ?? name}>{name}</span>
        {v2 ? <KindTag kind={shownKind} downgraded={downgraded || !!envelope?.downgraded} wakeHint={wakeHint} /> : <DeliveryTag mode={mode} />}
        {v2 && envelope && <EnvelopeBadges envelope={envelope} reveal={open ? "" : "hidden group-hover/msg:inline group-focus-within/msg:inline"} />}
        {v2 && !incoming && messageId && <SentStatus messageId={messageId} />}
        {!open && <span data-testid="bus-message-preview" className="min-w-0 flex-1 truncate text-subtle"><ScriptText text={(preview ?? text).replace(/\s+/g, " ")} /></span>}
        {open ? <ChevronDown size={13} className="ml-auto shrink-0" /> : <ChevronRight size={13} className="ml-auto shrink-0" />}
      </button>
      {messageId && <CardSettlement messageId={messageId} />}
      {open && (
        <div className={`selectable message-body font-chat-context mt-1 ml-6 max-w-[75%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${incoming ? "bg-peer" : "border border-dashed border-border text-muted"}`}><ScriptText text={text} /></div>
      )}
    </div>
  );
}

function CardSettlement({ messageId }: { messageId: string }) {
  const hostId = useConvHost();
  const record = useAgentMessage(messageId);
  return <MessageSettlementControl hostId={hostId} messageId={messageId} settlement={record?.settlement} sessionId={record?.to ?? record?.from ?? undefined} />;
}

function DeliveryTag({ mode }: { mode: string | null }) {
  const { t } = useI18n();
  if (!mode) return null;
  const key = `delivery.${mode}` as MessageKey;
  return <Tag>{t(key) === key ? mode : t(key)}</Tag>;
}
