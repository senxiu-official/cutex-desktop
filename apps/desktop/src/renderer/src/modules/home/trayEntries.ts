// The tray's agent entries (docs/design/039-workspace-groups.md, owner 2026-10-23): 钉住 on the left (the owner put
// them there: fixed order, a pin mark; a pin is one agent or a group — a workspace pinned whole), then a thin divider,
// then 最近 (every workspace that was on screen, newest first, at most MAX_RECENT; an entry is one agent or a capsule
// of the agents that were side by side). Pure (unit-tested in test/trayEntries.test.ts): the Dock feeds it the home
// pins, lib/workspaceSets' sets and what is on screen.
import type { HomeDoc, HomePin } from "../../../../shared/home";
import { agentKey, MAX_RECENT, type AgentId, type WsSet } from "../../lib/workspaceSets";
import { pinId, pinsOf, withPin, withoutPin } from "./model";
import type { TrayMark } from "./trayOrder";

export type { AgentId };

export interface TrayEntry {
  /** Stable key: a pin's id, or the set's id. */
  id: string;
  /** The agents left → right (one = a plain avatar, more = a capsule). */
  members: AgentId[];
  pinned: boolean;
  /** The home pin of a pinned entry. */
  pin: HomePin | null;
  /** The remembered workspace of a 最近 entry. */
  setId: string | null;
  mark: TrayMark;
}

// ── Group pins: the same pins store, an agent pin that lists its members ─────────────────────────────

/** The agents of an agent pin: itself, or (a group) its listed members. A pin of another kind: none. */
export function pinMembers(pin: HomePin): AgentId[] {
  if (pin.kind !== "agent") return [];
  const listed = Array.isArray(pin.members) ? (pin.members as unknown[]) : [];
  const out: AgentId[] = [];
  for (const m of listed) {
    if (!m || typeof m !== "object") continue;
    const { hostId, key } = m as Record<string, unknown>;
    if (typeof hostId === "string" && typeof key === "string" && hostId && key && !out.some((o) => o.hostId === hostId && o.sessionId === key)) out.push({ hostId, sessionId: key });
  }
  return out.length > 1 ? out : [{ hostId: pin.hostId, sessionId: pin.key }];
}

/**
 * The pin of a group of agents: an agent pin of the first member (a host that keeps only the known fields still
 * pins that agent) listing all of them. One agent: a plain agent pin.
 */
export function groupPin(members: readonly AgentId[], title?: string): HomePin {
  const [first, ...rest] = members;
  if (!first) throw new Error("groupPin: no members");
  const pin: HomePin = { hostId: first.hostId, kind: "agent", key: first.sessionId };
  if (title) pin.title = title.slice(0, 200);
  if (rest.length) pin.members = members.map((m) => ({ hostId: m.hostId, key: m.sessionId }));
  return pin;
}

/** The pin of any of `members` (single or in a group) that is in the doc. */
function pinsHolding(doc: HomeDoc, members: readonly AgentId[]): HomePin[] {
  return pinsOf(doc).filter((p) => p.kind === "agent" && pinMembers(p).some((m) => members.some((x) => agentKey(x) === agentKey(m))));
}

/** The entry pinned (members already in other agent pins leave them: an agent is in one pin). Pure. */
export function withGroupPin(doc: HomeDoc, members: readonly AgentId[], title?: string): HomeDoc {
  let next = doc;
  for (const p of pinsHolding(doc, members)) next = withoutPin(next, pinId(p));
  return withPin(next, groupPin(members, title));
}

// ── The entries ─────────────────────────────────────────────────────────────────────────────────────

export interface TrayEntriesInput {
  pins: readonly HomePin[];
  sets: readonly WsSet[];
  /** On screen (a conversation column), left → right. */
  onScreen: readonly AgentId[];
  /** Of those, folded to a strip. */
  strips?: readonly AgentId[];
  /** Shown elsewhere on screen (a Shelf's live pane). */
  projected?: readonly AgentId[];
  /** Whether the sidebar lists the agent (an unknown one of a 最近 entry is not shown). */
  known(a: AgentId): boolean;
  max?: number;
}

export function trayEntries(input: TrayEntriesInput): { pinned: TrayEntry[]; recent: TrayEntry[] } {
  const has = (list: readonly AgentId[] | undefined, a: AgentId) => !!list?.some((x) => agentKey(x) === agentKey(a));
  const markOf = (members: readonly AgentId[], fallback: TrayMark): TrayMark => {
    const shown = members.filter((m) => has(input.onScreen, m) || has(input.projected, m));
    if (!shown.length) return fallback;
    return shown.every((m) => has(input.strips, m)) ? "strip" : "on";
  };
  const taken = new Set<string>();
  const pinned: TrayEntry[] = [];
  for (const pin of input.pins) {
    if (pin.kind !== "agent") continue;
    const members = pinMembers(pin).filter((m) => !taken.has(agentKey(m)));
    if (!members.length) continue;
    for (const m of members) taken.add(agentKey(m));
    pinned.push({ id: pinId(pin), members, pinned: true, pin, setId: null, mark: markOf(members, "pinned") });
  }
  const recent: TrayEntry[] = [];
  for (const set of [...input.sets].sort((a, b) => b.at - a.at)) {
    const members = set.members.filter((m) => !taken.has(agentKey(m)) && (has(input.onScreen, m) || input.known(m)));
    if (!members.length) continue;
    recent.push({ id: set.id, members, pinned: false, pin: null, setId: set.id, mark: markOf(members, "open") });
    if (recent.length >= (input.max ?? MAX_RECENT)) break;
  }
  return { pinned, recent };
}

/** The tray's entries in order (pinned first, then 最近). */
export const allEntries = (e: { pinned: TrayEntry[]; recent: TrayEntry[] }): TrayEntry[] => [...e.pinned, ...e.recent];

/**
 * The entry that takes the screen when the one holding `closing` closes (owner 2026-10-23: the tray is the taskbar of
 * what is open; like a browser closing its active tab): its right neighbour in the tray's order (`entries`: pinned,
 * then 最近 newest first — so after a 最近 entry comes the one used before it), else its left one. An entry made only
 * of closing agents is skipped. The closing agents in no entry: null (the desktop). Pure.
 */
export function entryAfterClose(entries: readonly TrayEntry[], closing: readonly AgentId[]): TrayEntry | null {
  const gone = new Set(closing.map(agentKey));
  const at = entries.findIndex((e) => e.members.some((m) => gone.has(agentKey(m))));
  if (at < 0) return null;
  const stays = (e: TrayEntry) => e.members.some((m) => !gone.has(agentKey(m)));
  for (let i = at + 1; i < entries.length; i++) if (stays(entries[i]!)) return entries[i]!;
  for (let i = at - 1; i >= 0; i--) if (stays(entries[i]!)) return entries[i]!;
  return null;
}
