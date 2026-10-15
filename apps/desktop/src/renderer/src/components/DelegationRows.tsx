// Delegation events received by an agent (external_event with a cutex.delegation-*.v1 view), as
// compact rows like agent-bus messages:
// - handler side, ASK (opens the turn): ↙ 来自 [avatar] Lead 的委托 #3 title (第 2 次尝试) ▸ → brief;
// - requester side, ANSWER / QUESTION batch: one sub-row per delegation — ↩ 收到 [avatar] Helper 的结果
//   · #3 title  preview — expanding to the event's full text. The card updates in place too: the
//   row says why this turn started, the card is the delegation's one status page.
// - the 已回复 badge under the final reply of a turn an ASK started.
// A #tag opens the delegation's detail on the right side; 跳到委托卡片 is in the right-click menu.
import { useState } from "react";
import { ArrowDownLeft, ChevronDown, ChevronRight, CircleQuestionMark, CornerDownLeft, RefreshCw } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { contextMenu } from "../lib/contextMenu";
import { delegationStatus, type DelegationAskRow as AskRowModel, type DelegationResultItem } from "../lib/delegations";
import { useDelegation } from "../lib/delegationStore";
import { useAgentHost, useDelegationContext, useOwnerSteered } from "../lib/delegationsView";
import { OwnerSteeredBadge } from "./DelegationComposer";
import { openDelegationDetail } from "../lib/delegationOpen";
import { focusDelegation } from "../lib/focusRequest";
import { copyText } from "../lib/menus";
import type { ExternalMessage } from "../lib/timeline";
import { DelegationStatusMark, DelegationTag } from "./DelegationParts";
import { Markdown } from "./Markdown";
import { Who } from "./Parties";
import { PeerParty } from "./PeerParty";

/** A verb template with the party spliced in at `{who}` (like task rows). */
function Sentence({ k, who }: { k: MessageKey; who: React.ReactNode }) {
  const { t } = useI18n();
  const [before = "", after = ""] = t(k).split("{who}");
  return (
    <>
      {before.trim() && <span className="shrink-0">{before.trim()}</span>}
      {who}
      {after.trim() && <span className="shrink-0">{after.trim()}</span>}
    </>
  );
}

function YouOrWho({ owner, id, name, peerLabel }: { owner: boolean; id: string | null; name: string | null; peerLabel?: string | null }) {
  const { t } = useI18n();
  if (peerLabel) return <PeerParty text={name ?? ""} label={peerLabel} size={16} />;
  return owner ? <span className="shrink-0 font-medium text-foreground">{t("delegation.you")}</span> : <Who id={id} name={name} size={16} />;
}

/** Handler side: the delegation that started this turn. */
export function DelegationAskRow({ row, body }: { row: AskRowModel; body: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // The row is in the open agent's timeline; its requester is an agent of the same host.
  const host = useAgentHost();
  const jump = row.requesterId ? () => focusDelegation(row.requesterId!, row.askId, host) : undefined;
  const menu = contextMenu(() => [jump && { label: t("delegation.jumpCard"), onSelect: jump }, { label: t("delegation.copyId"), onSelect: () => copyText(row.askId) }]);
  return (
    <div className="my-2" onContextMenu={menu} data-ask-row={row.askId}>
      <button onClick={() => setOpen(!open)} className="flex w-full max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-xs text-muted hover:text-foreground">
        <ArrowDownLeft size={13} className="shrink-0 text-accent" />
        <Sentence k="delegation.from" who={<YouOrWho owner={row.owner} id={row.requesterId} name={row.requesterName} peerLabel={row.peerLabel} />} />
        <DelegationTag askId={row.askId} onJump={() => openDelegationDetail(host, row.askId, { title: row.title })} />
        <span className="min-w-0 truncate text-foreground">{row.title}</span>
        {row.attempt > 1 && <span className="shrink-0 text-subtle">（{t("delegation.attempt", { n: row.attempt })}）</span>}
        {open ? <ChevronDown size={13} className="ml-auto shrink-0" /> : <ChevronRight size={13} className="ml-auto shrink-0" />}
      </button>
      {open && (
        <div className="mt-1 ml-6 max-w-[85%] rounded-2xl border border-border bg-peer px-4 py-2 text-[13px]">
          <Markdown text={body} streaming={false} />
        </div>
      )}
    </div>
  );
}

const RESULT_ICON = { answer: CornerDownLeft, question: CircleQuestionMark, state: RefreshCw } as const;
const RESULT_VERB: Record<DelegationResultItem["kind"], MessageKey> = { answer: "delegation.resultFrom", question: "delegation.questionFrom", state: "delegation.stateFrom" };

function ResultLine({ item, sessionId, onToggle, open }: { item: DelegationResultItem; sessionId: string; onToggle(): void; open: boolean }) {
  const host = useAgentHost();
  const record = useDelegation(host, item.askId);
  const Icon = RESULT_ICON[item.kind];
  const name = record?.targetName ?? item.targetName ?? item.targetId ?? "";
  const ownerSteered = useOwnerSteered(item.askId, item.kind === "answer");
  const ctxOf = useDelegationContext();
  const { t } = useI18n();
  const menu = contextMenu(() => [{ label: t("delegation.jumpCard"), onSelect: () => focusDelegation(sessionId, item.askId, host) }, { label: t("delegation.copyId"), onSelect: () => copyText(item.askId) }]);
  return (
    <button onClick={onToggle} onContextMenu={menu} className="flex w-full max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-xs text-muted hover:text-foreground">
      <Icon size={13} className={`shrink-0 ${item.kind === "question" ? "text-warn" : "text-accent"}`} />
      <Sentence k={RESULT_VERB[item.kind]} who={<Who id={item.targetId} name={item.targetName} size={16} />} />
      <span className="shrink-0 text-subtle">·</span>
      <DelegationTag askId={item.askId} onJump={() => openDelegationDetail(host, item.askId, { title: item.title })} />
      <span className="max-w-[40%] shrink-0 truncate text-foreground">{item.title}</span>
      {ownerSteered && <OwnerSteeredBadge />}
      {item.kind === "state" && record ? (
        <DelegationStatusMark status={delegationStatus(record, ctxOf(record))} name={name} className="shrink-0" />
      ) : (
        !open && item.preview && <span className="min-w-0 truncate text-subtle">{item.preview.replace(/\s+/g, " ")}</span>
      )}
      {open ? <ChevronDown size={13} className="ml-auto shrink-0" /> : <ChevronRight size={13} className="ml-auto shrink-0" />}
    </button>
  );
}

/** Requester side: answers / questions / state changes of this agent's delegations (one event). */
export function DelegationResultsRow({ items, message, sessionId }: { items: DelegationResultItem[]; message: ExternalMessage; sessionId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2">
      {items.map((item, i) => (
        <ResultLine key={`${item.askId}:${i}`} item={item} sessionId={sessionId} open={open} onToggle={() => setOpen(!open)} />
      ))}
      {open && (
        <div className="mt-1 ml-6 max-w-[85%] rounded-2xl border border-border bg-peer px-4 py-2 text-[13px]">
          <Markdown text={message.text} streaming={false} />
        </div>
      )}
    </div>
  );
}

/** Handler side: under the final reply of a turn a delegation started. */
export function RepliedBadge({ row }: { row: AskRowModel }) {
  const host = useAgentHost();
  const record = useDelegation(host, row.askId);
  const ctxOf = useDelegationContext();
  const { t } = useI18n();
  const jump = row.requesterId ? () => focusDelegation(row.requesterId!, row.askId, host) : undefined;
  const menu = contextMenu(() => [jump && { label: t("delegation.jumpCard"), onSelect: jump }, { label: t("delegation.copyId"), onSelect: () => copyText(row.askId) }]);
  return (
    <div className="-mt-1 mb-2 flex items-center gap-1.5 text-[11px] text-subtle" onContextMenu={menu}>
      <CornerDownLeft size={12} className="shrink-0" />
      <Sentence k="delegation.replied" who={<YouOrWho owner={row.owner} id={row.requesterId} name={row.requesterName} peerLabel={row.peerLabel} />} />
      <span>·</span>
      <DelegationTag askId={row.askId} onJump={() => openDelegationDetail(host, row.askId, { title: row.title })} />
      {record && <DelegationStatusMark status={delegationStatus(record, ctxOf(record))} name={record.targetName ?? ""} />}
    </div>
  );
}
