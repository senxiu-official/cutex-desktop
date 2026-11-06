// What an @-mention sends (owner 2026-10-26, replacing 10-25's 「@<formal name>」): the link itself, always with the full
// id — `[@名字](cutex:agent/<id>)` on the conversation's host, `[@名字@remote](cutex:agent/<id>@remote)` for an agent on
// another host (lib/agentMentions). The label is the agent's own name (lib/agentAlias realAgentName; owner 2026-11-05: the
// agent reads its own name, not the owner's 显示名称, which the chips still show); a mention whose id is not in the current
// lists keeps the name it was written with. The agent and every desktop resolve it by the id.
// Messages sent 10-25 – 10-26 as 「@<formal name>」 still show chips from the locally kept draft (sent text → draft
// text, per host + agent); old messages that carry the chip markup render as chips (components/MentionText).
import { useSyncExternalStore } from "react";
import { useApp } from "../store";
import { agentIndex } from "./agentLook";
import { agentMentionMarkdown, agentMentionTokens } from "./agentMentions";
import { realAgentName } from "./agentAlias";

type App = ReturnType<typeof useApp.getState>;

/** 「cutex.…d6a0e6」: the id's last 6 characters. */
export const shortAgentId = (id: string): string => (id.length > 12 ? `cutex.…${id.slice(-6)}` : id);

/** The draft text for the wire, as described above (`hostId`: the conversation's host). */
export function mentionWireText(text: string, hostId: string, _sessionId: string, app: App = useApp.getState()): string {
  const tokens = agentMentionTokens(text);
  if (!tokens.length) return text;
  const index = agentIndex(app);
  const hostLabel = (id: string) => app.hosts?.hosts.find((h) => h.id === id)?.label ?? id;
  let out = "", cursor = 0;
  for (const token of tokens) {
    out += text.slice(cursor, token.start);
    cursor = token.end;
    const entry = index.get(token.id);
    const name = (entry && realAgentName(entry.session)) || token.name;
    const host = entry ? (entry.hostId === hostId ? null : hostLabel(entry.hostId)) : token.host;
    out += agentMentionMarkdown(name, token.id, host);
  }
  return out + text.slice(cursor);
}

/** Copy: the names as read (no markup, no qualifiers). */
export function mentionPlainText(text: string): string {
  let out = "", cursor = 0;
  for (const token of agentMentionTokens(text)) {
    out += `${text.slice(cursor, token.start)}@${agentIndex(useApp.getState()).get(token.id)?.session.displayName || token.name}`;
    cursor = token.end;
  }
  return out + text.slice(cursor);
}

// ── sent text → draft text, per host + agent ─────────────────────────────────────────────────────────

export const MENTION_WIRE_KEY = "cutex-desktop.mentionWire";
const MAX = 500;
let entries: Map<string, string> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const keyOf = (hostId: string, sessionId: string, wire: string) => `${hostId}\n${sessionId}\n${wire}`;

function load(): Map<string, string> {
  if (entries) return entries;
  entries = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(MENTION_WIRE_KEY) ?? "null") as { version?: number; entries?: unknown } | null;
    if (raw?.version === 1 && Array.isArray(raw.entries)) {
      for (const pair of raw.entries) if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string") entries.set(pair[0], pair[1]);
    }
  } catch {
    // Unreadable: chips only for what is sent from now on (old chip-markup messages still render).
  }
  return entries;
}

/** Remember that `wire` was sent for the draft `rich` (no-op when they are the same). */
export function noteMentionWire(hostId: string, sessionId: string, wire: string, rich: string): void {
  if (wire === rich) return;
  const map = load();
  const key = keyOf(hostId, sessionId, wire);
  map.delete(key);
  map.set(key, rich);
  while (map.size > MAX) map.delete(map.keys().next().value!);
  try {
    localStorage.setItem(MENTION_WIRE_KEY, JSON.stringify({ version: 1, entries: [...map] }));
  } catch {
    // Kept for this run only.
  }
  version++;
  for (const listener of listeners) listener();
}

/** The draft text of a sent text (with chips), or the text itself. */
export function mentionRichText(hostId: string | null | undefined, sessionId: string, text: string): string {
  return (hostId && load().get(keyOf(hostId, sessionId, text))) || text;
}

/** For a send: the wire text, remembered against the draft. */
export function wireForSend(hostId: string, sessionId: string, text: string): string {
  const wire = mentionWireText(text, hostId, sessionId);
  noteMentionWire(hostId, sessionId, wire, text);
  return wire;
}

export function useMentionRichText(hostId: string | null | undefined, sessionId: string, text: string): string {
  useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => version, () => version);
  return mentionRichText(hostId, sessionId, text);
}

/** Tests: forget the in-memory map. */
export function resetMentionWireForTest(): void {
  entries = null;
  version++;
}
