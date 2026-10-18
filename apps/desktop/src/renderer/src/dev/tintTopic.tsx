// Variants topic 「表情底色」 (lead handoff 2026-10-18 §1): how much Profile colour goes into the emoji
// avatar's background (lib/agentEmoji emojiTint, now 30 % into --surface). Open with ?theme=light too.
import { PROFILE_COLORS } from "../lib/profileLook";
import { AVATAR_EMOJI_SET } from "../lib/agentEmoji";
import { EmojiGlyph } from "../components/Avatar";

const MIXES = [30, 45, 55, 65, 75];

export function TintTopic() {
  const emoji = AVATAR_EMOJI_SET.slice(0, PROFILE_COLORS.length);
  return (
    <div className="my-4 space-y-3">
      <p className="text-sm text-muted">每行一个混合比例（Profile 颜色占多少，其余是 --surface），最左是 Profile 颜色本身。</p>
      <div className="flex items-center gap-2">
        <span className="w-14 text-xs text-subtle">颜色</span>
        {PROFILE_COLORS.map((c) => <span key={c} className="size-8 rounded-full" style={{ background: c }} />)}
      </div>
      {MIXES.map((m) => (
        <div key={m} className="flex items-center gap-2">
          <span className="w-14 text-xs text-subtle">{m}%</span>
          {PROFILE_COLORS.map((c, i) => (
            <span key={c} className="flex size-8 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${c} ${m}%, var(--surface))` }}>
              <EmojiGlyph glyph={emoji[i]!.glyph} size={20} />
            </span>
          ))}
          <span className="ml-3 flex items-center gap-1">
            {PROFILE_COLORS.slice(0, 4).map((c, i) => (
              <span key={c} className="flex size-5 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${c} ${m}%, var(--surface))` }}>
                <EmojiGlyph glyph={emoji[i]!.glyph} size={13} />
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
