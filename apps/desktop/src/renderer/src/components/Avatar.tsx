import { useState, type ReactNode } from "react";
import type { AvatarMode, SessionAvatar } from "@cutex-desktop/protocol";
import { avatarColor, hashColor } from "../lib/avatar";
import { agentPictureOf } from "../lib/agentPicture";
import { useDirectorAvatarUrl } from "../lib/directorAvatars";
import { portraitFor, portraitRefOf, usePortraitImage, usePortraitPacks } from "../lib/portraitPacks";
import { bundledEmoji, emojiTint, emojiUrl } from "../lib/agentEmoji";
import { minorTileSize } from "../lib/avatarDefault";
import { getAppAvatarStyle } from "../lib/avatarStyle";
import { themedEmoji } from "../lib/avatarThemes";
import { useAgentLook, useMinorDot, useProjectStyleWorn } from "../lib/agentLook";
import { pickStyleAvatar } from "../lib/avatarStyleAssign";
import { useStyleAssignmentPreview } from "../lib/avatarStylePreview";
import { useUiPrefs } from "../lib/prefs";
import { badgeBox, type AvatarBadgeTone, type AvatarStatus } from "../lib/avatarStatus";
import { projectIcon } from "../lib/projectIcons";
import { projectColor } from "../lib/sidebar";
import { avatarCarriesMark, avatarMark, MARK_GLASS_TINT, MARK_RADIUS, markTextColor, projectMarkCrowded, projectMarkFont, projectMarkHeight, projectMarkText, type AvatarMark } from "../lib/projectMark";
import { badgeColor } from "../lib/sessionBadge";
import { useI18n } from "../i18n";
import { headwearBox, headwearFor, headwearSources, useSeasonalHeadwear, type HeadwearPicture } from "../lib/directorHeadwear";

/**
 * Small round avatar. Precedence: custom picture (device-local) / 「Director 头像」 portrait / a 拟人头像包 picture
 * (lib/portraitPacks: the stored one, or its stand-in when the pack no longer has it) → custom emoji (cutex metadata) →
 * a 拟人头像 pick when Settings → 外观 → 拟人头像 enables themes and the agent has no avatar of its own (the picture it is
 * given when one is stored: lib/portraitPacks portraitFor) →
 * the default (Settings → 外观 → 默认头像): an emoji picked from `seed` (the agent's cutexSessionId)
 * within its Profile's 头像主题 (lib/avatarThemes, lib/agentLook), or the letter. Colour: the avatar's
 * own (a `color` avatar, or `color` on an emoji / picture) → `color` (callers pass the Profile colour)
 * → the agent's Profile colour (lib/agentLook) → stable hash colour; emoji sit on a soft tint of it,
 * letters on the full colour. Letter = `initial` (sidebar rows: lib/agentInitials) or the first char of
 * the name. No `seed` (the owner, unknown senders, an agent not created yet) = always the letter.
 * Missing / broken pictures fall back to the default.
 *
 * `minor`: a list row (sidebar, agent lists, pickers) — with 默认头像 = 仅重要智能体 an agent that is
 * not important (lib/avatarDefault isMinorAgent) shows only its minor mark — a small rounded tile in the Profile colour
 * with its initial (owner 2026-10-24; still called the dot in code) — in the same `size` box, so names stay aligned. Conversation headers, approval cards and toasts never pass it.
 *
 * `status` (docs/design/040 §3.1, lib/avatarStatus): what the agent is doing, drawn here the same at every
 * site — the running ring, the corner badge (需要你 / ? / ! / unread; a dot under 24 px), the presence dot
 * (online green, unknown hollow) and grey when offline. The badge and dot cut into the avatar with a
 * 2 px edge in `--avatar-cut` (default the card background; a site on another surface sets it).
 * Pictures follow 头像底色 (UiPrefs.avatarTint): as they are with a hairline edge, or on the provider colour.
 * `cutout` (the desktop's agent tiles, owner 2026-10-24: 「不要框，png 没背景」): a picture is drawn whole in the
 * box the caller sizes (size only picks the picture resolution) — not clipped to a circle, no edge, no tint, no
 * project mark — so a transparent portrait stands on what is
 * behind it; an emoji / letter / dot face stays round.
 *
 * A Director (lib/agentLook `isDirector`) wears its headwear (Settings → 外观 → 主管头饰, lib/directorHeadwear) on
 * avatars of 28 px and more: over the face, sticking out above it; under the ring / badges. Not on a minor dot or a
 * cut-out portrait. Operator uses a separate O chip at the top-left, including minor tiles and cut-outs;
 * it does not change Director headwear or the project mark.
 *
 * The owner's badge on an agent (cutex `badge`, lib/agentLook) is drawn as that mark too (owner 2026-10-27): bottom-left,
 * the same box and font rules, in the badge's tint; on a Director it replaces the project's text (lib/projectMark avatarMark).
 */
export function Avatar({ name, color, avatar, avatarMode: draftMode, picture, size = 28, initial: given, seed, minor, status, cutout }: { name: string; color?: string | null; avatar?: SessionAvatar | null; avatarMode?: AvatarMode; picture?: string | null; size?: number; initial?: string | null; seed?: string | null; minor?: boolean; status?: AvatarStatus | null; cutout?: boolean }) {
  const { avatarTint, projectIcons, directorHeadwear, operatorHeadwear, seasonalHeadwear } = useUiPrefs();
  const festival = useSeasonalHeadwear(seasonalHeadwear);
  const look = useAgentLook(seed);
  const mode = draftMode !== undefined ? draftMode : look?.avatarMode ?? null;
  const fixedLetter = draftMode !== undefined ? mode === "fixed" && !avatar : look?.fixedLetter ?? (mode === "fixed" && !avatar);
  const style = fixedLetter ? { kind: "letter" as const } : look?.style ?? getAppAvatarStyle();
  // Inheritance is draw-time intent: stale stored pictures and planned fixed assignments never win.
  if (mode === "inherit" || fixedLetter) { avatar = null; picture = null; }
  const preview = useStyleAssignmentPreview(seed);
  const planned = mode === "inherit" || fixedLetter ? null : preview;
  // A 「Director 头像」 portrait (lib/directorAvatars) resolves on this device even when the caller passes no picture.
  const portrait = useDirectorAvatarUrl(avatar);
  // 拟人头像包: the stored picture (or its stand-in), else the enabled themes' pick for an agent with no avatar — the
  // one it gets stored (skipping pictures its project wears), so a new agent's picture never switches when that lands.
  const { index } = usePortraitPacks();
  const projectWorn = useProjectStyleWorn(seed, !!avatar);
  const worn = mode === "inherit" ? undefined : projectWorn;
  const fromPack = usePortraitImage(portraitFor(index, avatar ?? planned, seed, look?.family, style.kind === "portrait" ? style.portraitThemes : [], worn)?.picture, size);
  const stored = (picture !== undefined ? picture : agentPictureOf(avatar)) ?? portrait ?? (portraitRefOf(avatar) ? fromPack : null);
  const dot = useMinorDot(seed, avatar, stored, minor);
  const [broken, setBroken] = useState<string | null>(null);
  // The themes' pick never turns a minor agent's dot into a face (仅重要智能体 still decides).
  const pictureUrl = stored ?? (dot ? null : fromPack);
  const shown = pictureUrl && pictureUrl !== broken ? pictureUrl : null;
  const packPicture = !!shown && shown === fromPack;
  const initial = given || ([...name.trim()][0]?.toUpperCase() ?? "?");
  const base = avatarColor(avatar) ?? color ?? look?.color ?? hashColor(name);
  // A cut-out avatar without a picture: the round face at half the box (a 96 px circle would outweigh the portraits).
  if (cutout && !shown) size = Math.round(size / 2);
  let face;
  if (cutout && shown) {
    return (
      <div className="relative flex h-full w-full min-h-0 select-none items-end justify-center" data-avatar="cutout" aria-hidden>
        <img src={shown} alt="" draggable={false} className="max-h-full max-w-full object-contain" onError={() => setBroken(pictureUrl)} />
        {look?.isOperator && <OperatorMarkChip size={size} />}
      </div>
    );
  }
  if (dot) {
    // 仅重要智能体's minor mark (owner 2026-10-24, option 甲): a small rounded tile in the Profile colour with the initial,
    // so it never reads as the round host dot beside it. Running = the tile's edge lights up.
    const d = minorTileSize(size);
    face = (
      <div className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }} data-avatar="dot" aria-hidden>
        <span
          data-minor-tile=""
          className="relative flex items-center justify-center font-mono font-bold leading-none"
          style={{ width: d, height: d, borderRadius: d >= 15 ? 4 : 3, fontSize: d >= 15 ? 9.5 : 8, background: `color-mix(in oklab, ${base} 20%, transparent)`, color: `color-mix(in oklab, ${base} 80%, var(--fg))` }}
        >
          {[...initial][0]}
          {status?.running && <span className="agent-ring-tile" aria-hidden />}
        </span>
      </div>
    );
  } else {
    const defaultAvatar = seed && style.kind === "emoji" ? pickStyleAvatar(style, index, look?.family ?? null, seed, worn) : null;
    const glyph = shown ? null : avatar?.kind === "emoji" ? avatar.value : planned?.kind === "emoji" ? planned.value : seed && style.kind !== "letter" ? (defaultAvatar?.value ?? themedEmoji(seed, look?.themes).glyph) : null;
    // 头像底色 = 按模型 puts a picture on its provider colour; otherwise the picture is as it is (no Profile colour behind it).
    const tinted = !!shown && avatarTint === "provider" && !!look;
    const prov = `var(--prov-${look?.family ?? "other"})`;
    face = (
      <div
        className={`relative flex shrink-0 select-none items-center justify-center font-semibold text-white ${packPicture ? "" : "overflow-hidden rounded-full"}`}
        style={{ width: size, height: size, fontSize: size * 0.45, background: shown ? (tinted ? `color-mix(in oklab, ${prov} 16%, var(--bg))` : "transparent") : glyph ? emojiTint(base) : base }}
        data-avatar={shown ? "picture" : glyph ? "emoji" : "letter"}
        data-avatar-tint={tinted ? (look?.family ?? "other") : undefined}
        aria-hidden
      >
        {/* The box is reserved before the picture loads (`width`/`height` on top of the fixed px face div), so a
            loading portrait, its letter / emoji stand-in and a swap between them never move the row around it. */}
        {shown ? <img src={shown} alt="" draggable={false} width={size} height={size} className={`h-full w-full ${packPicture ? "object-contain" : "rounded-full object-cover"}`} onError={() => setBroken(pictureUrl)} /> : glyph ? <EmojiGlyph glyph={glyph} size={Math.round(size * 0.64)} /> : initial}
        {/* A picture's edge: a hairline so a pale picture doesn't melt into the card; the provider ring when tinted. */}
        {shown && !packPicture && <span className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: `inset 0 0 0 1px ${tinted ? `color-mix(in oklab, ${prov} 40%, transparent)` : "color-mix(in oklab, var(--fg) 10%, transparent)"}` }} />}
      </div>
    );
  }
  // The mark (lib/projectMark): a Director's project mark and / or the owner's badge, bottom-left, mirroring the corner
  // badge; not on small avatars or a minor tile.
  const marked = !dot && avatarCarriesMark(size);
  const directed = marked && look?.isDirector ? look.project : null;
  const projectMark = directed ? { text: projectMarkText(projectIcon(projectIcons, directed.hostId, directed.id), directed.mark), color: directed.color } : null;
  const mark = marked ? avatarMark(projectMark, look?.badge ? { text: look.badge.text, color: badgeColor(look.badge.tint) } : null) : null;
  const hat = dot || cutout || !look ? null : headwearFor(directorHeadwear, look, size, { operators: operatorHeadwear, seasonal: festival });
  if (hat) face = <HeadwearFrame size={size} style={hat}>{face}</HeadwearFrame>;
  const operator = look?.isOperator === true;
  if (!status || (!status.running && !status.badge && !status.presence)) return mark?.text || operator ? <AvatarMarkFrame size={size} mark={mark?.text ? mark : null} operator={operator}>{face}</AvatarMarkFrame> : face;
  return <AvatarStatusFrame size={size} status={status} minorDot={!!dot} mark={mark?.text ? mark : null} operator={operator}>{face}</AvatarStatusFrame>;
}

const BADGE_TONE: Record<AvatarBadgeTone, { background: string; color: string }> = {
  attention: { background: "var(--attention)", color: "var(--on-attention)" },
  danger: { background: "var(--danger-solid)", color: "#ffffff" },
  accent: { background: "var(--accent)", color: "var(--on-accent)" },
};

type DirectorMark = AvatarMark;

/** The project mark chip (also the owner's badge, lib/projectMark avatarMark): a small frosted-glass rectangle tinted with the project colour, 1–4 columns in the project's hue
 *  at a per-theme lightness (readable on any surface); the blur sits under the text, never on it. */
function ProjectMarkChip({ size, mark, dot = false }: { size: number; mark: DirectorMark; dot?: boolean }) {
  const h = projectMarkHeight(size);
  const crowded = projectMarkCrowded(size, mark.text, dot);
  const font = projectMarkFont(h, mark.text, crowded);
  const hex = projectColor(mark.color);
  return (
    <span
      data-project-mark=""
      aria-hidden
      className="pointer-events-none absolute flex items-center justify-center font-semibold whitespace-nowrap"
      style={{
        left: crowded ? -5 : -3,
        bottom: -2,
        height: h,
        minWidth: h,
        padding: crowded ? "0 1px" : font.sans ? "0 2px" : "0 4px",
        borderRadius: MARK_RADIUS,
        background: `linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,.08)), color-mix(in oklab, ${hex} ${MARK_GLASS_TINT * 100}%, transparent)`,
        backdropFilter: "blur(8px) saturate(1.4)",
        color: markTextColor(hex),
        // The code font (Latin letters even-spaced at 9 px); text with a hanzi: the UI font, bigger (lib/projectMark).
        fontFamily: font.sans ? "var(--font-sans)" : "var(--font-mono), var(--font-sans)",
        letterSpacing: font.sans ? 0 : "0.02em",
        fontSize: font.size,
        lineHeight: 1,
        boxShadow: "inset 0 0 0 0.5px color-mix(in srgb, var(--fg) 16%, transparent), 0 1px 3px rgba(0,0,0,.2)",
      }}
    >
      {mark.text}
    </span>
  );
}

/** A role badge rather than headwear: top-left leaves project/status/presence corners free. */
function OperatorMarkChip({ size }: { size: number }) {
  const { t } = useI18n();
  const edge = size >= 64 ? 18 : size >= 40 ? 15 : size >= 24 ? 12 : 9;
  return (
    <span
      data-operator-mark=""
      title={t("sidebar.operator")}
      aria-label={t("sidebar.operator")}
      role="img"
      className="pointer-events-none absolute z-10 flex items-center justify-center font-fixed font-bold"
      style={{
        left: -2, top: -2, width: edge, height: edge,
        borderRadius: edge >= 12 ? 4 : 3,
        fontSize: edge >= 15 ? 10 : edge >= 12 ? 8.5 : 7,
        lineHeight: 1,
        color: "var(--fg)",
        background: "color-mix(in srgb, var(--surface) 88%, transparent)",
        backdropFilter: "blur(8px)",
        boxShadow: "inset 0 0 0 0.5px color-mix(in srgb, var(--fg) 24%, transparent), 0 0 0 1px var(--avatar-cut, var(--bg))",
      }}
    >O</span>
  );
}

/** The face with the Director's headwear over it (lib/directorHeadwear: the owner's fit, relative to the diameter). */
function HeadwearFrame({ size, style, children }: { size: number; style: HeadwearPicture; children: ReactNode }) {
  const box = headwearBox(style, size);
  const { src, srcSet } = headwearSources(style);
  return (
    <span className="relative inline-flex shrink-0" data-avatar-headwear={style}>
      {children}
      <img src={src} srcSet={srcSet} sizes={`${Math.ceil(box.width)}px`} alt="" aria-hidden draggable={false} data-headwear={style} className="pointer-events-none absolute max-w-none select-none" style={box} />
    </span>
  );
}

/** An avatar without a status layer that still carries the project mark. */
function AvatarMarkFrame({ size, mark, operator, children }: { size: number; mark?: DirectorMark | null; operator?: boolean; children: ReactNode }) {
  return (
    <span className="relative inline-flex shrink-0">
      {children}
      {mark && <ProjectMarkChip size={size} mark={mark} />}
      {operator && <OperatorMarkChip size={size} />}
    </span>
  );
}

/** The status layer round an avatar (Avatar `status`): ring, corner badge, presence dot, offline grey. */
function AvatarStatusFrame({ size, status, minorDot, mark, operator, children }: { size: number; status: AvatarStatus; minorDot: boolean; mark?: DirectorMark | null; operator?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const { presence, badge } = status;
  const box = badgeBox(size);
  const withText = box.text && badge?.text != null;
  const dotSize = Math.min(10, Math.max(6, Math.round(size * 0.26)));
  return (
    <span
      className={`relative inline-flex shrink-0 ${presence === "offline" ? "opacity-50 grayscale" : presence === "unknown" ? "opacity-60" : ""}`}
      data-avatar-status=""
      data-avatar-running={status.running ? "" : undefined}
      data-avatar-presence={presence ?? undefined}
      // Not confirmed yet: dimmed, with a hollow grey dot — 「连接中」, not offline.
      data-status-unknown={presence === "unknown" ? "" : undefined}
      title={presence === "unknown" ? t("status.unknown") : undefined}
    >
      {children}
      {status.running && !minorDot && <span className="agent-ring" aria-hidden />}
      {badge && (
        <span
          data-avatar-badge={badge.tone}
          aria-hidden
          className="pointer-events-none absolute flex items-center justify-center rounded-full font-fixed font-semibold whitespace-nowrap tabular-nums"
          style={{
            ...BADGE_TONE[badge.tone],
            top: withText ? -4 : -1,
            right: withText ? -5 : -1,
            height: withText ? box.height : Math.min(box.height, 10),
            minWidth: withText ? box.height : Math.min(box.height, 10),
            padding: withText ? "0 4px" : 0,
            fontSize: box.height >= 18 ? 11 : box.height >= 16 ? 10.5 : 9,
            lineHeight: 1,
            boxShadow: "0 0 0 2px var(--avatar-cut, var(--bg))",
          }}
        >
          {withText ? badge.text : null}
        </span>
      )}
      {mark && <ProjectMarkChip size={size} mark={mark} dot={presence === "online" || presence === "unknown"} />}
      {operator && <OperatorMarkChip size={size} />}
      {presence === "online" && (
        <span data-avatar-dot="online" aria-hidden className="pointer-events-none absolute -right-0.5 -bottom-0.5 rounded-full" style={{ width: dotSize, height: dotSize, background: "var(--ok)", boxShadow: "0 0 0 2px var(--avatar-cut, var(--bg))" }} />
      )}
      {presence === "unknown" && (
        <span role="img" aria-label={t("status.unknown")} data-avatar-dot="unknown" className="absolute -right-0.5 -bottom-0.5 rounded-full border-[1.5px] border-subtle bg-background" style={{ width: dotSize, height: dotSize }} />
      )}
    </span>
  );
}

/** A bundled emoji picture (the same on every OS), or the character in the system font if it is not ours. */
export function EmojiGlyph({ glyph, size }: { glyph: string; size: number }) {
  const emoji = bundledEmoji(glyph);
  const url = emoji && emojiUrl(emoji);
  if (url) return <img src={url} alt={emoji.name} draggable={false} className="block shrink-0" style={{ width: size, height: size }} />;
  return <span className="leading-none" style={{ fontSize: size * 0.94 }}>{glyph}</span>;
}
