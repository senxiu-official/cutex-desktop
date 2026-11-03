import { useState, type ReactNode } from "react";
import type { AvatarMode, SessionAvatar } from "@cutex-desktop/protocol";
import { avatarColor, hashColor } from "../lib/avatar";
import { agentPictureOf } from "../lib/agentPicture";
import { useDirectorAvatarUrl } from "../lib/directorAvatars";
import { portraitFor, portraitRefOf, usePortraitImage, usePortraitPacks } from "../lib/portraitPacks";
import { bundledEmoji, emojiTint, emojiUrl } from "../lib/agentEmoji";
import { letterTileRadius, letterTileSize, letterTileText } from "../lib/avatarDefault";
import { initialStem, twoLetterInitials } from "../lib/agentInitials";
import { getAppAvatarStyle } from "../lib/avatarStyle";
import { themedEmoji } from "../lib/avatarThemes";
import { useAgentLook, useMinorDot, useProjectStyleWorn } from "../lib/agentLook";
import { useHintLook, type AgentHint } from "../lib/agentHint";
import { pickStyleAvatar } from "../lib/avatarStyleAssign";
import { useStyleAssignmentPreview } from "../lib/avatarStylePreview";
import { useUiPrefs } from "../lib/prefs";
import { badgeBox, type AvatarBadgeTone, type AvatarStatus } from "../lib/avatarStatus";
import { projectIcon } from "../lib/projectIcons";
import { projectColor } from "../lib/sidebar";
import { avatarCarriesMark, avatarMark, MARK_RADIUS, markInk, projectMarkCrowded, projectMarkFont, projectMarkHeight, projectMarkText, type AvatarMark } from "../lib/projectMark";
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
 * → the agent's Profile colour (lib/agentLook) → stable hash colour; emoji sit on a soft tint of it.
 * No `seed` and no `agent` (the owner, users) = always the letter: `initial` or the first char of the name, on the colour.
 * An agent without a `seed` or with one the snapshots do not hold (`agent` hint; owner 2026-11-01) = its letter tile.
 * Missing / broken pictures fall back to the default.
 *
 * An agent's letters (owner 2026-11-01): a rounded tile (lib/avatarDefault letterTileSize) with NO colour fill — a neutral
 * surface with readable ink; the model shows only through the provider-colour frame — and two letters (lib/agentInitials:
 * the agent's list initials from lib/agentLook, else `initial`, else the name's). With 默认头像 = 仅重要智能体 an agent that
 * is not important (lib/avatarDefault isMinorAgent) shows this tile (still called the dot in code) instead of a default
 * avatar, and does so in every place and state — sidebar rows big or small, Rail, tray, header, messages, strips, peers,
 * pickers — so an agent's avatar is the same everywhere (rule A); with 默认头像 = 字母 every agent without one does.
 *
 * `status` (docs/design/040 §3.1, lib/avatarStatus): what the agent is doing, drawn here the same at every
 * site — the running ring, the corner badge (需要你 / ? / ! / unread; a dot under 24 px), the presence dot
 * (online green, unknown hollow) and grey when offline. The badge and dot cut into the avatar with a
 * 2 px edge in `--avatar-cut` (default the card background; a site on another surface sets it).
 * The frame (owner 2026-11-01): every round face — picture, emoji, letter — is clipped to its circle with a 1 px outline in
 * the agent's provider colour (lib/avatarThemes providerTint, `--prov-*`; a neutral hairline when the agent is unknown),
 * idle and busy alike: the running ring sits outside it, so a status change never moves, resizes or re-crops the face.
 * The letter tile keeps its shape and gets the same outline (stronger: it is the tile's only colour). 头像底色 (UiPrefs.avatarTint) only decides what is behind a
 * picture: nothing (无) or a 16 % backdrop of the provider colour (按模型) — the outline is the same, never doubled.
 * `cutout` (the desktop's agent tiles, owner 2026-10-24: 「不要框，png 没背景」): a picture is drawn whole in the
 * box the caller sizes (size only picks the picture resolution) — not clipped to a circle, no edge, no tint, no
 * project mark — so a transparent portrait stands on what is
 * behind it; an emoji / letter / dot face stays round.
 *
 * A Director (lib/agentLook `isDirector`) wears its headwear (Settings → 外观 → 主管头饰, lib/directorHeadwear) on
 * avatars of 28 px and more: over the face, sticking out above it; under the ring / badges. Not on a minor dot or a
 * cut-out portrait. An Operator carries no avatar marker (owner 2026-11-01: the O chip is gone); its role shows in
 * text (header, menus) and, if 副主管也戴 is on, in its headwear.
 *
 * The owner's badge on an agent (cutex `badge`, lib/agentLook) is drawn as that mark too (owner 2026-10-27): bottom-left,
 * the same box and font rules, in the badge's tint; on a Director it replaces the project's text (lib/projectMark avatarMark).
 */
export function Avatar({ name, color, avatar, avatarMode: draftMode, picture, size = 28, initial: given, seed, status, cutout, agent }: { name: string; color?: string | null; avatar?: SessionAvatar | null; avatarMode?: AvatarMode; picture?: string | null; size?: number; initial?: string | null; seed?: string | null; status?: AvatarStatus | null; cutout?: boolean; /** An agent without a `seed` (or one the snapshots do not hold): what is known of it (lib/agentHint AgentHint). */ agent?: AgentHint | null }) {
  const { avatarTint, projectIcons, directorHeadwear, operatorHeadwear, seasonalHeadwear } = useUiPrefs();
  const festival = useSeasonalHeadwear(seasonalHeadwear);
  const look = useAgentLook(seed);
  // An agent the snapshots do not hold (being created, another host, deleted; owner 2026-11-01): its letter tile with the
  // initials the sidebar gives it and the model colour if the caller knows it (lib/agentHint useHintLook), never a picked
  // emoji / portrait (its Profile and project are unknown) nor a person's round letter on a fill.
  const unknownAgent = !look && (!!seed || agent != null);
  const hinted = useHintLook(name, agent, unknownAgent);
  const mode = draftMode !== undefined ? draftMode : look?.avatarMode ?? null;
  const fixedLetter = draftMode !== undefined ? mode === "fixed" && !avatar : look?.fixedLetter ?? (mode === "fixed" && !avatar);
  const style = fixedLetter || unknownAgent ? { kind: "letter" as const } : look?.style ?? getAppAvatarStyle();
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
  const dot = useMinorDot(seed, avatar, stored);
  const [broken, setBroken] = useState<string | null>(null);
  // The themes' pick never turns a minor agent's dot into a face (仅重要智能体 still decides).
  const pictureUrl = stored ?? (dot ? null : fromPack);
  const shown = pictureUrl && pictureUrl !== broken ? pictureUrl : null;
  const packPicture = !!shown && shown === fromPack;
  // An agent's letters are its list initials wherever it is drawn (lib/agentLook), so a caller without the row agrees.
  const initial = (seed ? look?.initial : null) || given || hinted?.initial || (seed ? twoLetterInitials(initialStem(name)) : ([...name.trim()][0]?.toUpperCase() ?? "?"));
  const base = avatarColor(avatar) ?? color ?? look?.color ?? hashColor(name);
  // A cut-out avatar without a picture: the round face at half the box (a 96 px circle would outweigh the portraits).
  if (cutout && !shown) size = Math.round(size / 2);
  // The frame's outline (see above): the provider colour, softer under 24 px so a 16–20 px row avatar stays a hairline.
  const tint = look ? (look.tint ?? look.family) : (hinted?.tint ?? null);
  const prov = `var(--prov-${tint ?? "other"})`;
  const edge = tint ? `color-mix(in oklab, ${prov} ${size < 24 ? 55 : 70}%, transparent)` : "color-mix(in oklab, var(--fg) 12%, transparent)";
  const defaultAvatar = !dot && seed && style.kind === "emoji" ? pickStyleAvatar(style, index, look?.family ?? null, seed, worn) : null;
  const glyph = dot || shown ? null : avatar?.kind === "emoji" ? avatar.value : planned?.kind === "emoji" ? planned.value : seed && style.kind !== "letter" ? (defaultAvatar?.value ?? themedEmoji(seed, look?.themes).glyph) : null;
  // An agent with no face to show: its letter tile (see above); people (no seed, no `agent`) keep the round letter on their colour.
  const tile = dot || ((!!seed || unknownAgent) && !shown && !glyph);
  let face;
  if (cutout && shown) {
    return (
      <div className="relative flex h-full w-full min-h-0 select-none items-end justify-center" data-avatar="cutout" aria-hidden>
        <img src={shown} alt="" draggable={false} className="max-h-full max-w-full object-contain" onError={() => setBroken(pictureUrl)} />
      </div>
    );
  }
  if (tile) {
    // The letter tile (owner 2026-10-24 option 甲: square, so it never reads as the round host dot beside it; 2026-11-01:
    // no fill, two letters). Running = the tile's edge lights up.
    const d = letterTileSize(size);
    const radius = letterTileRadius(d);
    const label = letterTileText(initial, d);
    const frame = tint ? `color-mix(in oklab, ${prov} 85%, transparent)` : edge;
    face = (
      <div className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }} data-avatar={dot ? "dot" : "letter"} aria-hidden>
        <span
          data-minor-tile=""
          className="relative flex items-center justify-center font-semibold leading-none whitespace-nowrap"
          data-avatar-frame={tint}
          style={{ width: d, height: d, borderRadius: radius, fontSize: label.fontSize, letterSpacing: label.letterSpacing, background: "var(--surface)", color: "color-mix(in oklab, var(--fg) 84%, var(--surface))", boxShadow: `inset 0 0 0 1px ${frame}` }}
        >
          {label.text}
          {status?.running && <span className="agent-ring-tile" style={{ borderRadius: radius + 2 }} aria-hidden />}
        </span>
      </div>
    );
  } else {
    // 头像底色 = 按模型 puts a picture on its provider colour; otherwise the picture is as it is (no Profile colour behind it).
    const tinted = !!shown && avatarTint === "provider" && !!look;
    face = (
      <div
        className="relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold text-white"
        style={{ width: size, height: size, fontSize: size * 0.45, background: shown ? (tinted ? `color-mix(in oklab, ${prov} 16%, var(--bg))` : "transparent") : glyph ? emojiTint(base) : base }}
        data-avatar={shown ? "picture" : glyph ? "emoji" : "letter"}
        data-avatar-frame={tint}
        data-avatar-tint={tinted ? tint : undefined}
        aria-hidden
      >
        {/* The box is reserved before the picture loads (`width`/`height` on top of the fixed px face div), so a
            loading portrait, its letter / emoji stand-in and a swap between them never move the row around it. */}
        {shown ? <img src={shown} alt="" draggable={false} width={size} height={size} className={`h-full w-full ${packPicture ? "object-contain" : "object-cover"}`} onError={() => setBroken(pictureUrl)} /> : glyph ? <EmojiGlyph glyph={glyph} size={Math.round(size * 0.64)} /> : initial}
        {/* The frame's outline, over the picture so a pale one doesn't melt into the card. */}
        <span data-avatar-edge="" className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: `inset 0 0 0 1px ${edge}` }} />
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
  if (!status || (!status.running && !status.badge && !status.presence)) return mark?.text ? <AvatarMarkFrame size={size} mark={mark}>{face}</AvatarMarkFrame> : face;
  return <AvatarStatusFrame size={size} status={status} minorDot={tile} mark={mark?.text ? mark : null}>{face}</AvatarStatusFrame>;
}

const BADGE_TONE: Record<AvatarBadgeTone, { background: string; color: string }> = {
  attention: { background: "var(--attention)", color: "var(--on-attention)" },
  danger: { background: "var(--danger-solid)", color: "#ffffff" },
  accent: { background: "var(--accent)", color: "var(--on-accent)" },
};

type DirectorMark = AvatarMark;

/** The project mark chip (also the owner's badge, lib/projectMark avatarMark): a small opaque rectangle in the project colour,
 *  1–4 columns in white or black, whichever reads (lib/projectMark markInk, ≥ 4.5:1 over any portrait, either theme). A 1 px
 *  cut in `--avatar-cut` (as the corner badge has) parts it from the face, so it reads as a label, not a second avatar. */
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
        background: hex,
        color: markInk(hex),
        // The code font (Latin letters even-spaced at 9 px); text with a hanzi: the UI font, bigger (lib/projectMark).
        fontFamily: font.sans ? "var(--font-sans)" : "var(--font-mono), var(--font-sans)",
        letterSpacing: font.sans ? 0 : "0.02em",
        fontSize: font.size,
        lineHeight: 1,
        boxShadow: "0 0 0 1px var(--avatar-cut, var(--bg))",
      }}
    >
      {mark.text}
    </span>
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
function AvatarMarkFrame({ size, mark, children }: { size: number; mark?: DirectorMark | null; children: ReactNode }) {
  return (
    <span className="relative inline-flex shrink-0">
      {children}
      {mark && <ProjectMarkChip size={size} mark={mark} />}
    </span>
  );
}

/** The status layer round an avatar (Avatar `status`): ring, corner badge, presence dot, offline grey. */
function AvatarStatusFrame({ size, status, minorDot, mark, children }: { size: number; status: AvatarStatus; minorDot: boolean; mark?: DirectorMark | null; children: ReactNode }) {
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
