// Dragging a card / tab / reference out of the right side (RFC right-panel-rfc-20261009 §3.4 1a,
// §3.7): a faint overlay on the visible part of the conversation card says "放开 = 新页面"; a page
// that already holds only this card says "放开不变"; the composer (later: quote into the message)
// and the drag's own origin get their own quiet look. Drawn from the feedback lib/sideDnd computes.
import { Plus } from "lucide-react";
import type { DropFeedback } from "../../lib/sideDnd";

const LOOK = {
  new: "bg-[color-mix(in_srgb,var(--accent)_9%,transparent)] shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--accent)_55%,transparent)]",
  future: "bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] shadow-[inset_0_0_0_1.5px_var(--accent)]",
  neutral: "bg-[color-mix(in_srgb,var(--fg)_5%,transparent)] shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--fg)_22%,transparent)]",
} as const;

const CHIP = {
  new: "gap-2 bg-accent px-3.5 py-2 text-[13px] font-medium text-white",
  future: "border border-accent bg-background px-2.5 py-1 text-xs text-accent",
  neutral: "border border-border bg-background px-2.5 py-1.5 text-xs text-muted",
} as const;

export function SideDropOutside({ outside }: { outside: NonNullable<DropFeedback["outside"]> }) {
  return (
    <div
      data-side-dnd
      className={`pointer-events-none fixed z-[71] flex items-center justify-center rounded-[14px] ${LOOK[outside.ui]}`}
      style={{ left: outside.left, top: outside.top, width: outside.width, height: outside.height }}
    >
      <div className={`flex items-center rounded-xl whitespace-nowrap shadow-[var(--shadow)] ${CHIP[outside.ui]}`}>
        {outside.ui === "new" && <Plus size={15} />}
        <span>{outside.text}</span>
        {outside.sub && <small className="text-[11px] font-normal opacity-80">{outside.sub}</small>}
      </div>
    </div>
  );
}
