// What a drag on the right side shows (RFC right-panel-rfc-20261009 §3.7): a shield over the window
// (cursor; nothing under it reacts or swallows events), the ghost that follows the pointer (a card /
// tab = icon + name, a page = a small pill), the insertion line, the label beside the target, the
// left-edge "新页" band, the lane's "新页" ghost, the outline of a column, and the overlay outside the
// side. Fixed layers driven by lib/sideDnd; nothing here takes pointer events except the shield.
import { Plus } from "lucide-react";
import { useI18n } from "../../i18n";
import { useSideRegistry } from "../../lib/sideComponents";
import { useSideDnd } from "../../lib/sideDnd";
import { SideDropOutside } from "./SideDropOutside";

const LINE = "pointer-events-none fixed z-[72] rounded-sm bg-accent shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_25%,transparent)]";
const NEW_CHIP = "flex items-center gap-1 rounded-full border-[1.5px] border-dashed border-accent bg-background px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-accent shadow-[var(--shadow)]";

function Ghost() {
  const { t } = useI18n();
  const registry = useSideRegistry();
  const ghost = useSideDnd((s) => s.ghost);
  const x = useSideDnd((s) => s.x);
  const y = useSideDnd((s) => s.y);
  if (!ghost) return null;
  // Near the window's right edge the ghost goes to the pointer's left (the side sits there).
  const style = x > window.innerWidth - 240 ? { left: x - 14, top: y + 12, transform: "translateX(-100%)" } : { left: x + 14, top: y + 12 };
  if (ghost.shape === "page") {
    return (
      <div data-side-dnd className="pointer-events-none fixed z-[73] flex items-center gap-2 rounded-xl border border-border bg-background py-1 pr-2.5 pl-1 text-xs whitespace-nowrap text-foreground shadow-[0_4px_14px_rgba(0,0,0,.14)]" style={style}>
        {/* A small pill like the page tab row's (icons side by side). */}
        <span className="flex items-center gap-1 rounded-xl bg-surface-2 px-[5px] py-[3px] text-muted">
          {ghost.kinds.map((kind, k) => {
            const Icon = registry.get(kind)?.item.icon;
            return Icon ? <Icon key={k} size={11} /> : null;
          })}
        </span>
        <span className="max-w-56 truncate">{ghost.title}</span>
        <span className="text-[10.5px] text-subtle">· {ghost.note}</span>
      </div>
    );
  }
  const Icon = ghost.icon;
  return (
    <div data-side-dnd className="pointer-events-none fixed z-[73] flex items-center gap-1.5 rounded-[10px] border border-border bg-background py-[5px] pr-2.5 pl-[7px] text-xs whitespace-nowrap text-foreground shadow-[0_4px_14px_rgba(0,0,0,.14)]" style={style}>
      {Icon && <Icon size={14} className="text-muted" />}
      <span className="max-w-56 truncate">{ghost.title}</span>
      {ghost.count > 1 && <span className="text-[10.5px] text-subtle">{t("side.pill.count", { n: ghost.count })}</span>}
      <span className="text-[10.5px] text-subtle">· {ghost.note}</span>
    </div>
  );
}

export function SideDndLayer() {
  const { t } = useI18n();
  const drag = useSideDnd((s) => s.drag);
  const target = useSideDnd((s) => s.target);
  const fb = useSideDnd((s) => s.feedback);
  if (!drag) return null;
  const cursor = target?.kind === "refuse" ? "not-allowed" : "grabbing";
  return (
    <>
      {/* The shield: owns the cursor; elements under it (a guest page, resize handles) never see the drag. */}
      <div data-side-dnd data-side-dnd-shield className="fixed inset-0 z-[70]" style={{ cursor }} />
      {fb.outside && <SideDropOutside outside={fb.outside} />}
      {fb.column && (
        <div
          data-side-dnd
          className="pointer-events-none fixed z-[71] rounded-[14px] bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--accent)_55%,transparent)]"
          style={{ left: fb.column.left, top: fb.column.top, width: fb.column.width, height: fb.column.height }}
        />
      )}
      {fb.band && (
        <div
          data-side-dnd
          className="pointer-events-none fixed z-[71] rounded-l-[14px] bg-[linear-gradient(90deg,color-mix(in_srgb,var(--accent)_16%,transparent),transparent)] shadow-[inset_2px_0_0_var(--accent)]"
          style={{ left: fb.band.left, top: fb.band.top, width: fb.band.width, height: fb.band.height }}
        >
          <span className={`absolute left-1 -translate-y-1/2 ${NEW_CHIP}`} style={{ top: fb.band.chipY - fb.band.top }}>
            <Plus size={11} />
            {t("side.dnd.newPageShort")}
          </span>
        </div>
      )}
      {fb.laneGhost && (
        <div
          data-side-dnd
          className="pointer-events-none fixed z-[72] flex h-[30px] w-[30px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-dashed border-accent bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg))] text-accent"
          style={{ left: fb.laneGhost.x, top: fb.laneGhost.y }}
          title={t("side.dnd.newPageShort")}
        >
          <Plus size={13} />
        </div>
      )}
      {fb.line && <div data-side-dnd className={LINE} style={{ left: fb.line.left, top: fb.line.top, width: fb.line.width, height: fb.line.height }} />}
      {fb.label && (
        <div
          data-side-dnd
          data-side-dnd-label
          className={`pointer-events-none fixed z-[72] -translate-y-1/2 rounded-[7px] px-2 py-[3px] text-[11.5px] whitespace-nowrap shadow-[var(--shadow)] ${
            target?.kind === "refuse" ? "bg-danger text-white" : target?.kind === "noop" || (target?.kind === "new" && target.unchanged) ? "border border-border bg-background text-muted" : "bg-accent text-white"
          } ${fb.label.side === "left" ? "-translate-x-full" : ""}`}
          style={{ left: fb.label.x, top: fb.label.y }}
        >
          {fb.label.text}
        </div>
      )}
      <Ghost />
    </>
  );
}
