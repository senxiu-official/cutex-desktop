import { useState } from "react";
import type { SessionAvatar } from "@cutex-desktop/protocol";
import { avatarColor, hashColor } from "../lib/avatar";
import { agentPictureOf } from "../lib/agentPicture";
import { bundledEmoji, emojiTint, emojiUrl } from "../lib/agentEmoji";
import { drawsEmoji, minorDotSize } from "../lib/avatarDefault";
import { themedEmoji } from "../lib/avatarThemes";
import { useAgentLook, useMinorDot } from "../lib/agentLook";
import { useUiPrefs } from "../lib/prefs";

/**
 * Small round avatar. Precedence: custom picture (device-local) → custom emoji (cutex metadata) →
 * the default (Settings → 外观 → 默认头像): an emoji picked from `seed` (the agent's cutexSessionId)
 * within its Profile's 头像主题 (lib/avatarThemes, lib/agentLook), or the letter. Colour: the avatar's
 * own (a `color` avatar, or `color` on an emoji / picture) → `color` (callers pass the Profile colour)
 * → the agent's Profile colour (lib/agentLook) → stable hash colour; emoji sit on a soft tint of it,
 * letters on the full colour. Letter = `initial` (sidebar rows: lib/agentInitials) or the first char of
 * the name. No `seed` (the owner, unknown senders, an agent not created yet) = always the letter.
 * Missing / broken pictures fall back to the default.
 *
 * `minor`: a list row (sidebar, agent lists, pickers) — with 默认头像 = 仅重要智能体 an agent that is
 * not important (lib/avatarDefault isMinorAgent) shows only a small Profile-coloured dot in the same
 * `size` box, so names stay aligned. Conversation headers, approval cards and toasts never pass it.
 */
export function Avatar({ name, color, avatar, picture, size = 28, initial: given, seed, minor }: { name: string; color?: string | null; avatar?: SessionAvatar | null; picture?: string | null; size?: number; initial?: string | null; seed?: string | null; minor?: boolean }) {
  const { agentAvatarDefault } = useUiPrefs();
  const look = useAgentLook(seed);
  const stored = picture !== undefined ? picture : agentPictureOf(avatar);
  const dot = useMinorDot(seed, avatar, stored, minor);
  const [broken, setBroken] = useState<string | null>(null);
  const shown = stored && stored !== broken ? stored : null;
  const initial = given || ([...name.trim()][0]?.toUpperCase() ?? "?");
  const base = avatarColor(avatar) ?? color ?? look?.color ?? hashColor(name);
  if (dot) {
    const d = minorDotSize(size);
    return (
      <div className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }} data-avatar="dot" aria-hidden>
        <span className="block rounded-full" style={{ width: d, height: d, background: base }} />
      </div>
    );
  }
  const glyph = shown ? null : avatar?.kind === "emoji" ? avatar.value : seed && drawsEmoji(agentAvatarDefault) ? themedEmoji(seed, look?.themes).glyph : null;
  return (
    <div
      className="flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.45, background: glyph ? emojiTint(base) : base }}
      data-avatar={shown ? "picture" : glyph ? "emoji" : "letter"}
      aria-hidden
    >
      {shown ? <img src={shown} alt="" draggable={false} className="h-full w-full rounded-full object-cover" onError={() => setBroken(stored)} /> : glyph ? <EmojiGlyph glyph={glyph} size={Math.round(size * 0.64)} /> : initial}
    </div>
  );
}

/** A bundled emoji picture (the same on every OS), or the character in the system font if it is not ours. */
export function EmojiGlyph({ glyph, size }: { glyph: string; size: number }) {
  const emoji = bundledEmoji(glyph);
  const url = emoji && emojiUrl(emoji);
  if (url) return <img src={url} alt={emoji.name} draggable={false} className="block shrink-0" style={{ width: size, height: size }} />;
  return <span className="leading-none" style={{ fontSize: size * 0.94 }}>{glyph}</span>;
}
