import type { SessionBadge } from "@cutex-desktop/protocol";
import { displayWidth } from "./badgeWidth";
export const BADGE_TINTS = ["blue", "green", "amber", "pink", "violet"] as const;
/** A badge tint as a project colour (lib/sidebar projectColor): the inline chip and the avatar mark use the same. */
const TINT_COLORS: Record<NonNullable<SessionBadge["tint"]>, string> = { blue: "blue", green: "green", amber: "yellow", pink: "magenta", violet: "#8b5cf6" };
export function badgeColor(tint: SessionBadge["tint"] | null | undefined): string {
  return TINT_COLORS[tint ?? "blue"] ?? "blue";
}
export function validBadgeText(text: string): boolean {
  return !text || (displayWidth(text) >= 1 && displayWidth(text) <= 4 && !/[\s\p{Cc}]/u.test(text));
}
export function badgeDraft(text: string, tint: NonNullable<SessionBadge["tint"]>, initial?: SessionBadge | null): SessionBadge | null {
  if (!text) return null;
  return text === initial?.text && tint === (initial.tint ?? "blue") ? initial : { text, tint };
}
