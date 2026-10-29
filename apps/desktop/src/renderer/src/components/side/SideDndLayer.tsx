// What a pane drag shows (docs/desktop-modules.md §24 step 4): a shield over the window (cursor; nothing
// under it reacts or swallows events), the ghost that follows the pointer (icon + name), the zone the drop
// takes — half of a pane, its header, a column, the work area's edge band — lit up with a label saying
// what the drop does, and a label by the pointer when the drop is refused. Fixed layers driven by
// lib/sideDnd; nothing here takes pointer events except the shield.
// The zone is where the dragged pane lands after the drop and the dashed boxes where the panes it moves end up
// (lib/dropForecast, owner 2026-10-23); 拖放落点预览 (Settings → 外观) draws the zone as an outline (default) or
// an outline over a tint.
import type { CSSProperties } from "react";
import { MessageSquare } from "lucide-react";
import { useI18n } from "../../i18n";
import { useSideDnd } from "../../lib/sideDnd";
import { useOverlayHoles } from "../../lib/overlayHoles";
import { DROP_TINT, dropTint } from "../../lib/dropTint";
import { useOwnerWindow } from "../../lib/ownerContext";
import { OwnerLayer } from "../OwnerLayer";

/** The refusing tab strip's tint (允许混排 off): red stripes, painted by .drop-tint only under 框线+底色. */
const NOPE_STRIPES = { "--drop-tint": "repeating-linear-gradient(-45deg, color-mix(in srgb, var(--danger) 9%, transparent) 0 6px, transparent 6px 12px)" } as CSSProperties;

function Ghost() {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const ghost = useSideDnd((s) => s.ghost);
  const x = useSideDnd((s) => s.x);
  const y = useSideDnd((s) => s.y);
  if (!ghost) return null;
  // Near the window's right edge the ghost goes to the pointer's left.
  const style = x > win.innerWidth - 240 ? { left: x - 14, top: y + 12, transform: "translateX(-100%) rotate(-1.5deg)" } : { left: x + 14, top: y + 12, transform: "rotate(-1.5deg)" };
  const Icon = ghost.icon ?? (ghost.kind ? null : MessageSquare);
  return (
    <div data-side-dnd data-pane-ghost className="pointer-events-none fixed z-[49] flex items-center gap-1.5 rounded-ctl border border-border bg-background py-[5px] pr-2.5 pl-[7px] text-xs font-medium whitespace-nowrap text-foreground shadow-e2" style={style}>
      {Icon && <Icon size={14} className="text-muted" />}
      <span className="max-w-56 truncate">{ghost.title}</span>
      {ghost.count > 1 && <span className="text-caption/[inherit] font-normal text-subtle">{t("pane.chip.more", { n: ghost.count - 1 })}</span>}
      <span className="text-caption/[inherit] font-normal text-subtle">· {ghost.note}</span>
    </div>
  );
}

/** In the window the drag runs in (a desk window's drag draws there, multi-window). */
export function SideDndLayer() {
  const doc = useSideDnd((s) => s.doc);
  return (
    <OwnerLayer doc={doc}>
      <SideDndView />
    </OwnerLayer>
  );
}

function SideDndView() {
  const drag = useSideDnd((s) => s.drag);
  const target = useSideDnd((s) => s.target);
  const fb = useSideDnd((s) => s.feedback);
  const holes = useOverlayHoles(!!drag);
  if (!drag) return null;
  const cursor = target?.kind === "refuse" ? "not-allowed" : "grabbing";
  const zone = fb.zone;
  return (
    <>
      {/* The shield: owns the cursor; elements under it (a guest page, resize handles) never see the drag. */}
      <div data-side-dnd data-side-dnd-shield className="fixed inset-0 z-[47]" style={{ cursor }} />
      {/* Under every menu / popover (styles.css 「Layers」; lib/overlayHoles: a hole where each open one is). */}
      <div data-side-dnd aria-hidden className="pointer-events-none fixed inset-0 z-[48]" style={holes ? { clipPath: holes } : undefined}>
        {zone && (
          <div
            data-side-dnd
            data-pane-drop-zone={target?.kind}
            data-pane-drop-tone={zone.tone}
            className={`pane-drop-zone ${DROP_TINT} pointer-events-none fixed z-[48] flex items-center justify-center border-2 ${
              zone.tone === "warn" ? "border-[color-mix(in_srgb,var(--warn,#d97706)_75%,transparent)]" : "border-[color-mix(in_srgb,var(--accent)_75%,transparent)]"
            }`}
            style={{ ...(zone.tone === "warn" ? dropTint("var(--warn,#d97706)", 12) : dropTint("var(--accent)", 13)), left: zone.left + (zone.float ? 0 : 4), top: zone.top + (zone.float ? 0 : 4), width: Math.max(0, zone.width - (zone.float ? 0 : 8)), height: Math.max(0, zone.height - (zone.float ? 0 : 8)), borderRadius: zone.round }}
          >
            <span
              className={`max-w-[90%] truncate rounded-full px-2.5 py-[3px] text-xs whitespace-nowrap text-white shadow-e2 ${zone.tone === "warn" ? "bg-[var(--warn,#d97706)]" : "bg-accent"} ${zone.float ? "absolute top-1/2 max-w-none -translate-y-1/2" : ""}`}
              style={zone.float === "left" ? { right: "calc(100% + 8px)" } : zone.float === "right" ? { left: "calc(100% + 8px)" } : undefined}
            >
              {zone.text}
            </span>
          </div>
        )}
        {/* The panes the drop moves or resizes: where each ends up, dashed, with its name. */}
        {zone &&
          !fb.morph &&
          fb.ghosts?.filter((g) => !g.self).map((g, i) => (
            <div
              key={i}
              data-side-dnd
              data-pane-drop-ghost=""
              className="pane-drop-zone pointer-events-none fixed z-[48] rounded-inner border-[1.5px] border-dashed border-[color-mix(in_srgb,var(--color-foreground)_35%,transparent)]"
              style={{ left: g.left + 4, top: g.top + 4, width: Math.max(0, g.width - 8), height: Math.max(0, g.height - 8) }}
            >
              <span className="absolute top-1.5 left-1.5 max-w-[90%] truncate rounded-md bg-background/85 px-1.5 py-px text-caption/[inherit] text-muted shadow-e2">{g.text}</span>
            </div>
          ))}
        {/* 允许混排 off (§24.12): the tab bar that does not take the dragged kind, striped. */}
        {fb.nope && (
          <div
            data-side-dnd
            data-pane-drop-nope=""
            // Its line (the inset underline) always; its stripes are its tint: only under 框线+底色 (lib/dropTint).
            className={`${DROP_TINT} pointer-events-none fixed z-[48] rounded-t-inner shadow-[inset_0_-2px_0_color-mix(in_srgb,var(--danger)_45%,transparent)]`}
            style={{ ...NOPE_STRIPES, left: fb.nope.left, top: fb.nope.top, width: fb.nope.width, height: fb.nope.height }}
          />
        )}
        {fb.label && (
          <div
            data-side-dnd
            data-side-dnd-label
            className={`pointer-events-none fixed z-[49] -translate-y-1/2 rounded-ctl px-2 py-[3px] text-meta/[inherit] whitespace-nowrap shadow-e2 ${fb.label.tone === "refuse" ? "bg-danger-solid text-white" : "border border-border bg-background text-muted"} ${fb.label.side === "left" ? "-translate-x-full" : ""}`}
            style={{ left: fb.label.x, top: fb.label.y }}
          >
            {fb.label.text}
          </div>
        )}
        <Ghost />
      </div>
    </>
  );
}
