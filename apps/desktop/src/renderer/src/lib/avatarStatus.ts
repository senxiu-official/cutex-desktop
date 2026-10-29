// What an agent's avatar shows about it (docs/design/040 §3.1), drawn by components/Avatar the same way at
// every size and place: a spinning ring while it runs, a corner badge for what it wants (需要你 count / 「?」
// a question / 「!」 an approval, an error, unread turns), a presence dot (online green, unknown hollow) and
// grey when offline. Pure, so it is unit-tested; sites map their own data (sidebar signals, tray badges)
// through here instead of drawing their own rings and badges.
import type { AgentSignal, NeedsYou, NeedsYouReason } from "./agentAttention";

/** attention = 需要你 (amber), danger = 出错 (red), accent = unread / done (blue). */
export type AvatarBadgeTone = "attention" | "danger" | "accent";

export interface AvatarBadge {
  tone: AvatarBadgeTone;
  /** What the badge says; null = a plain dot (no number to show, or the avatar is too small for text). */
  text: string | null;
}

export type AvatarPresence = "online" | "offline" | "unknown";

export interface AvatarStatus {
  running?: boolean;
  badge?: AvatarBadge | null;
  presence?: AvatarPresence | null;
}

const count = (n: number) => (n > 99 ? "99+" : String(n));

/** Reasons the owner answers with words (「?」); every other single request is 「!」. */
const ASKS: ReadonlySet<NeedsYouReason> = new Set<NeedsYouReason>(["question", "ownerReply"]);

/**
 * The corner badge for an agent signal: 需要你 = how many requests wait when more than one, else 「?」 for a
 * question to answer and 「!」 for anything to approve / check; 出错 = 「!」 (red); a finished turn not seen
 * yet = the unread count (blue; a dot when the count is unknown). Running, idle, offline: no badge (the
 * ring / grey say it).
 */
export function avatarBadge(signal: AgentSignal | undefined, needs?: Pick<NeedsYou, "count" | "reasons"> | number | null, unread?: number | null): AvatarBadge | null {
  if (signal === "needsYou") {
    const n = typeof needs === "number" ? needs : (needs?.count ?? 0);
    if (n > 1) return { tone: "attention", text: count(n) };
    const reason = typeof needs === "object" && needs ? needs.reasons[0] : undefined;
    return { tone: "attention", text: reason && ASKS.has(reason) ? "?" : "!" };
  }
  if (signal === "error") return { tone: "danger", text: "!" };
  if (signal === "done") return { tone: "accent", text: unread == null ? null : count(Math.max(1, unread)) };
  return null;
}

/** Presence from a signal: offline grey, unknown hollow dot; online only when the site asks for it (`online`). */
export function avatarPresence(signal: AgentSignal | undefined, online = false): AvatarPresence | null {
  if (signal === "offline") return "offline";
  if (signal === "unknown") return "unknown";
  return online && signal ? "online" : null;
}

/**
 * Badge geometry by avatar size (design 040 scale 16 / 20 / 28 / 32 / 40 / 72): the count from 20 px up — 14 px tall
 * on 20, 16 on 28 / 32, 18 from 36 — so every list row shows how many (owner 2026-10-23); a dot on 16 px (no room).
 */
export function badgeBox(size: number): { height: number; text: boolean } {
  if (size >= 36) return { height: 18, text: true };
  if (size >= 24) return { height: 16, text: true };
  if (size >= 20) return { height: 14, text: true };
  return { height: 7, text: false };
}
