// "✓ 已结束 · N ›" at the end of a capsule category (委托 / 作业): expands inline to the most recent
// finished rows (the caller's), then "在…页查看全部 ›" opens the full page filtered to this agent.
import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { CAPSULE_LINE } from "../lib/capsuleRows";

export function FinishedFold({ label, viewAll, onViewAll, children }: { label: string; viewAll: string; onViewAll(): void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // lib/capsuleRows line (marked, so a kind with one row and this fold keeps its heading).
  const quiet = `${CAPSULE_LINE} gap-1 hover:bg-hover hover:text-foreground`;
  return (
    <>
      <button onClick={() => setOpen(!open)} aria-expanded={open} data-capsule-line="" className={quiet}>
        <Check size={12} className="shrink-0" />
        {label}
        {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
      </button>
      {open && (
        <>
          {children}
          <button onClick={onViewAll} data-capsule-line="" className={`${quiet} pl-[1.625rem]`}>
            {viewAll}
            <ChevronRight size={12} className="shrink-0" />
          </button>
        </>
      )}
    </>
  );
}
