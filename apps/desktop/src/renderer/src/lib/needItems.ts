// The items of the 需要你 list (tray 通知中心, the status-row bell) and of sidebar layout B's 「现在」 cards: one rule for
// both, so what was closed in one is gone in the other. Hosts with cross-device read state (design 061,
// lib/hostAttention) decide from the owner person's state there: an agent is listed while the host holds 需要你 items
// of it that the person has not dismissed (on any device), its 出错 while the host holds its runtime error or a failed
// reply waits unread; a × sends exactly those items' keys. The agent's own status badge in the sidebar stays as it is.
// Other hosts keep the device-local dismissals (lib/needsYouDismiss).
import type { AttentionNeed } from "../../../shared/attention";
import { attentionChips, type AttentionChip, type AgentSignal, type NeedsYou, type NeedsYouReason } from "./agentAttention";
import { attentionOn, markOf as hostMarkOf, needsOf, type HostAttention } from "./hostAttention";
import { hostKey } from "./hostKeys";
import { chipDismissed, type Dismissals } from "./needsYouDismiss";
import { rowKey, type AgentRow } from "./sidebar";
import type { TurnMark } from "./turnUnread";

export interface NeedItem {
  chip: AttentionChip;
  /** The agent's host (never undefined, unlike the chip's). */
  host: string;
  /** Host key (host + agent id): dismissals and React keys. */
  key: string;
  row: AgentRow | undefined;
  need: NeedsYou | undefined;
  /** Host with cross-device read state: the keys a × dismisses (needs-you items, or the runtime error of an 出错). */
  itemKeys?: string[];
  /** Host with cross-device read state, 出错: a failed reply waits unread (× reads it). */
  failedUnread?: boolean;
  /** A 个人助理 whose requests wait for the owner (lib/assistantNeeds): no agent row; opens its 请求 tab. */
  assistant?: { assistantId: string };
}

const REASONS = new Set<NeedsYouReason>(["confirm", "question", "approval", "acceptance", "review", "check", "ownerMessage", "ownerReply", "safetyBlock"]);
const ASK_KINDS = new Set(["question", "acceptance", "review", "check"]);
const NOTE_KINDS = new Set(["ownerMessage", "ownerReply"]);

/** The reason words of a host need kind: a native approval is 待确认 (`confirm`), an owner approval 待审批 (`approval`). */
export function reasonOfKind(kind: string): NeedsYouReason {
  if (kind === "approval") return "confirm";
  if (kind === "ownerApproval") return "approval";
  return REASONS.has(kind as NeedsYouReason) ? (kind as NeedsYouReason) : "confirm";
}

/** A host's needs of one agent as the desktop's NeedsYou (reasons in order, delegations, owner messages). */
export function needsYouOf(needs: readonly AttentionNeed[]): NeedsYou {
  const out: NeedsYou = { count: needs.length, reasons: [], askIds: [] };
  for (const n of needs) {
    const reason = reasonOfKind(n.kind);
    if (!out.reasons.includes(reason)) out.reasons.push(reason);
    if (n.id && ASK_KINDS.has(n.kind) && !n.id.startsWith("native:")) out.askIds.push(n.id);
    if (n.id && NOTE_KINDS.has(n.kind)) out.notificationIds = [...(out.notificationIds ?? []), n.id];
  }
  return out;
}

function needsYouChip(chip: AttentionChip, need: NeedsYou): AttentionChip {
  return { ...chip, signal: "needsYou", reason: need.reasons.length === 1 ? need.reasons[0]! : null, count: Math.max(1, need.count), askId: need.askIds[0] ?? null };
}

export interface NeedItemsInput {
  rows: readonly AgentRow[];
  signals: ReadonlyMap<string, AgentSignal>;
  needs: ReadonlyMap<string, NeedsYou>;
  markOf: (row: AgentRow) => TurnMark | undefined;
  /** The focus host (rows without a host are its). */
  focus: string;
  dismissals: Dismissals;
  /** A host's state when it has cross-device read state (default: lib/hostAttention). */
  stateOf?: (hostId: string) => HostAttention | null;
}

/** Every agent that waits on the owner (needs-you, 出错; finished turns are not in it), most urgent first. */
export function needItems({ rows, signals, needs, markOf, focus, dismissals, stateOf = attentionOn }: NeedItemsInput): NeedItem[] {
  const byKey = new Map(rows.map((r) => [hostKey(r.hostId ?? focus, r.id), r]));
  const out: NeedItem[] = [];
  const listed = new Set<string>();
  for (const chip of attentionChips(rows, signals, needs, markOf, null)) {
    if (chip.signal === "done") continue;
    const host = chip.hostId ?? focus;
    const key = hostKey(host, chip.id);
    const row = byKey.get(key);
    const state = stateOf(host);
    if (state) {
      // Not listed here (none, or all dismissed by the person): the pass below still shows what else the host holds.
      const own = needsOf(state, chip.id);
      if (chip.signal === "needsYou") {
        if (!own.needs.length) continue;
        const need = needsYouOf(own.needs);
        out.push({ chip: needsYouChip(chip, need), host, key, row, need, itemKeys: own.needs.map((n) => n.itemKey) });
      } else {
        const failedUnread = !!hostMarkOf(state.agents.get(chip.id))?.failed;
        if (!own.runtimeError && !failedUnread) continue;
        out.push({ chip, host, key, row, need: undefined, itemKeys: own.runtimeError ? [own.runtimeError.itemKey] : [], failedUnread });
      }
      listed.add(key);
      continue;
    }
    const need = needs.get(chip.key);
    if (chipDismissed(dismissals, key, chip, need, row, !!(row && markOf(row)?.failed))) continue;
    out.push({ chip, host, key, row, need });
  }
  // Agents the host says wait on the person that this desktop does not see waiting (e.g. a delegation it has not read,
  // a runtime error of an agent whose row is older).
  const extra: NeedItem[] = [];
  const errors: NeedItem[] = [];
  for (const row of rows) {
    const host = row.hostId ?? focus;
    const key = hostKey(host, row.id);
    const state = stateOf(host);
    if (!state || listed.has(key)) continue;
    const own = needsOf(state, row.id);
    const chip: AttentionChip = { id: row.id, key: rowKey(row), ...(row.hostId !== undefined ? { hostId: row.hostId } : {}), name: row.name, signal: "needsYou", reason: null, count: 1, askId: null, at: 0 };
    if (own.needs.length) {
      const need = needsYouOf(own.needs);
      extra.push({ chip: needsYouChip(chip, need), host, key, row, need, itemKeys: own.needs.map((n) => n.itemKey) });
    } else if (own.runtimeError) {
      const at = own.runtimeError.at ? Date.parse(own.runtimeError.at) : NaN;
      errors.push({ chip: { ...chip, signal: "error", at: Number.isFinite(at) ? at : 0 }, host, key, row, need: undefined, itemKeys: [own.runtimeError.itemKey], failedUnread: false });
    }
  }
  if (!extra.length && !errors.length) return out;
  // Needs-you items come first (attentionChips' order), then 出错: the extra ones join their kind.
  const firstOther = out.findIndex((i) => i.chip.signal !== "needsYou");
  const head = firstOther < 0 ? out : out.slice(0, firstOther);
  const tail = firstOther < 0 ? [] : out.slice(firstOther);
  return [...head, ...extra, ...tail, ...errors];
}
