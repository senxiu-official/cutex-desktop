import { useState } from "react";
import type { SessionAvatar } from "@cutex-desktop/protocol";
import { avatarColor, hashColor } from "../lib/avatar";
import { agentPictureOf } from "../lib/agentPicture";
import { bundledEmoji, defaultEmoji, emojiTint, emojiUrl } from "../lib/agentEmoji";
import { useUiPrefs } from "../lib/prefs";

/**
 * Small round avatar. Precedence: custom picture (device-local) → custom emoji (cutex metadata) →
 * the default (Settings → 外观 → 默认头像): an emoji picked from `seed` (the agent's cutexSessionId,
 * lib/agentEmoji) or the letter. Colour: the avatar's own (a `color` avatar, or `color` on an emoji / picture) → profile appearance color → stable hash
 * color; emoji sit on a soft tint of it, letters on the full colour. Letter = `initial` (sidebar rows:
 * lib/agentInitials) or the first char of the name. No `seed` (the owner, unknown senders, an agent
 * not created yet) = always the letter. Missing / broken pictures fall back to the default.
 */
export function Avatar({ name, color, avatar, picture, size = 28, initial: given, seed }: { name: string; color?: string | null; avatar?: SessionAvatar | null; picture?: string | null; size?: number; initial?: string | null; seed?: string | null }) {
  const { agentAvatarDefault } = useUiPrefs();
  const stored = picture !== undefined ? picture : agentPictureOf(avatar);
  const [broken, setBroken] = useState<string | null>(null);
  const shown = stored && stored !== broken ? stored : null;
  const initial = given || ([...name.trim()][0]?.toUpperCase() ?? "?");
  const base = avatarColor(avatar) ?? color ?? hashColor(name);
  const glyph = shown ? null : avatar?.kind === "emoji" ? avatar.value : seed && agentAvatarDefault === "emoji" ? defaultEmoji(seed).glyph : null;
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
