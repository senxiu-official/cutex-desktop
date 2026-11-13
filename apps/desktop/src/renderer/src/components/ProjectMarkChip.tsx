// The project mark chip on an avatar (also the owner's badge, lib/projectMark avatarMark), bottom-left (owner's pick
// 2026-11-13, TODO 项目徽章): the sidebar's project icon (components/ProjectBadge, 淡底色) at the avatar's corner — the
// project colour as a soft tile over an opaque base (`--avatar-cut`, the card behind the avatar, so a portrait never
// shows through), the letters / lucide glyph / emoji in the project ink (lib/projectMark markTileInks, ≥ 4.5:1 per
// theme family), the UI font. The same picture the sidebar header shows, so the two read as one project.
// A 1 px cut in `--avatar-cut` (as the corner badge has) parts it from the face.
import type { CSSProperties } from "react";
import { markTileInks, MARK_RADIUS, projectMarkCrowded, projectMarkFont, projectMarkHeight, type AvatarMark } from "../lib/projectMark";
import { projectLucideIcon } from "../lib/projectIcons";
import { projectColor } from "../lib/sidebar";
import { graphemes } from "../lib/graphemes";

/** The glyph's stroke in px (lucide strokeWidth is in 24-unit viewBox space): a touch bolder than the sidebar's 1.15
 *  since the mark is smaller and sits on a busy portrait. */
const MARK_STROKE_PX = 1.4;

/** `inline`: in the flow instead of at the avatar's corner (the colour picker's preview). */
export function ProjectMarkChip({ size, mark, dot = false, inline = false }: { size: number; mark: AvatarMark; dot?: boolean; inline?: boolean }) {
  const h = projectMarkHeight(size);
  const hex = projectColor(mark.color);
  const Lucide = mark.icon?.kind === "icon" ? projectLucideIcon(mark.icon.value) : null;
  const text = mark.text;
  // A lone emoji (the project's emoji icon) is a picture, not letters: drawn square like a glyph.
  const emoji = !Lucide && graphemes(text).length === 1 && /\p{Extended_Pictographic}/u.test(text) ? text : null;
  const glyphOnly = !!Lucide || !!emoji;
  const crowded = !glyphOnly && projectMarkCrowded(size, text, dot);
  const font = projectMarkFont(h, text, crowded);
  const place: CSSProperties = inline ? { position: "relative" } : { left: crowded ? -5 : -3, bottom: -2 };
  // White (the picker's first swatch) has no tint to show: the tile takes the foreground colour instead (as ProjectBadge).
  const white = hex.toLowerCase() === "#ffffff";
  const tone = white ? "var(--fg)" : hex;
  // The ink per theme family; white and a colour that is no #rrggbb: the foreground colour, which reads on any faint tile.
  const inks = !white && /^#[0-9a-f]{6}$/i.test(hex) ? markTileInks(hex) : null;
  const glyph = Math.max(8, h - 4);
  return (
    <span
      data-project-mark=""
      data-mark-glyph={Lucide ? "icon" : emoji ? "emoji" : undefined}
      aria-hidden
      className={`project-icon project-mark-tile pointer-events-none ${inline ? "" : "absolute "}flex shrink-0 items-center justify-center font-bold whitespace-nowrap`}
      style={{
        ...place,
        "--project-icon-color": tone,
        "--mark-ink-light": inks?.light ?? "var(--fg)",
        "--mark-ink-dark": inks?.dark ?? "var(--fg)",
        height: h,
        minWidth: h,
        padding: glyphOnly ? 0 : crowded ? "0 1px" : "0 3px",
        borderRadius: Math.max(MARK_RADIUS, Math.round(h * 0.3)),
        // `.project-icon` lays the tint over transparent; here it is over the card colour, so it is opaque.
        background: `color-mix(in oklab, ${tone} var(--project-icon-tint), var(--avatar-cut, var(--bg)))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tone} 45%, transparent), 0 0 0 1px var(--avatar-cut, var(--bg))`,
        fontFamily: "var(--font-sans)",
        letterSpacing: 0,
        fontSize: font.size,
        lineHeight: 1,
      } as CSSProperties}
    >
      {Lucide ? <Lucide size={glyph} strokeWidth={(MARK_STROKE_PX * 24) / glyph} className="block" /> : emoji ? <span className="block leading-none" style={{ fontSize: glyph - 1 }}>{emoji}</span> : text}
    </span>
  );
}
