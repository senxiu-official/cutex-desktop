// A list row's checkbox for batch selection (设置 → 归档的智能体, the 项目 table): a button that sees the click, so
// Shift-click can select a range; `mixed` for a 全选 box when only some rows are picked.
import type { MouseEvent } from "react";
import { Check } from "lucide-react";

export function RowCheck({ checked, mixed, disabled, label, onClick }: { checked: boolean; mixed?: boolean; disabled?: boolean; label: string; onClick(e: MouseEvent): void }) {
  return (
    <button type="button" role="checkbox" aria-checked={mixed ? "mixed" : checked} aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className={`press-solid flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${checked || mixed ? "border-accent bg-accent text-on-accent" : "border-border bg-background hover:border-accent/70"}`}>
      {checked ? <Check size={11} strokeWidth={3} /> : mixed ? <span className="h-0.5 w-2 rounded bg-on-accent" /> : null}
    </button>
  );
}
