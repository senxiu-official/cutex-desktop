// The row-end ⋯ of a list row (服务, 作业, 远程副本 …; UI audit 2026-11-24 #5): one look and behaviour everywhere —
// the same icon and size, the app's tip (data-tip: hover and keyboard focus, lib/tips), an accessible name, the menu
// affordance (aria-haspopup) and the focus ring. Shown on row hover / focus-within, or when it has the focus itself.
import type { MouseEvent } from "react";
import { MoreHorizontal } from "lucide-react";

export const ROW_MORE_CLASS =
  "press-icon reveal-focus rounded p-1 text-subtle opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-0";

export function RowMoreButton({ label, onOpen, disabled, ...data }: { label: string; onOpen(e: MouseEvent<HTMLButtonElement>): void; disabled?: boolean } & { [attr: `data-${string}`]: string | boolean | undefined }) {
  return (
    <button type="button" disabled={disabled} onClick={onOpen} aria-label={label} data-tip={label} aria-haspopup="menu" data-row-more="" className={ROW_MORE_CLASS} {...data}>
      <MoreHorizontal size={14} />
    </button>
  );
}
