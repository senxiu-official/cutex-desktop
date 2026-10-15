// How a profile looks: its colour and the ink that reads on it (pure; lib/profileAvatar holds pictures).
import { AVATAR_PALETTE, hashColor } from "./avatar";

/** Preset profile colours (the agent-avatar palette). */
export const PROFILE_COLORS = AVATAR_PALETTE;

/** The colour a profile shows in: its own (cutex `appearance.color` / effective), else a stable hash. */
export function profileColor(p: { name: string; appearance?: { color?: string | null; effectiveColor?: string | null } | null }): string {
  return p.appearance?.color ?? p.appearance?.effectiveColor ?? hashColor(p.name);
}

/** Black or white, whichever reads better on `hex` (#rgb / #rrggbb; anything else → white). */
export function inkOn(hex: string): "#fff" | "#111" {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return lum > 0.45 ? "#111" : "#fff";
}
