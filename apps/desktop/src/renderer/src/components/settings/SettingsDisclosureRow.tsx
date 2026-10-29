import { ChevronRight } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useSettingsRowDecoration, type SettingsRowDecoration } from "./Form";

/** Settings card disclosure. Keep the panel mounted so collapsing preserves drafts. */
export function SettingsDisclosureRow({ title, summary, status, attention = false, open, onOpenChange, children, decoration }: {
  title: ReactNode;
  summary?: ReactNode;
  status?: ReactNode;
  attention?: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
  decoration?: SettingsRowDecoration;
}) {
  const inheritedDecoration = useSettingsRowDecoration(!decoration);
  decoration ??= inheritedDecoration;
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const summaryId = `${panelId}-summary`;
  return (
    <div {...decoration?.attributes} data-settings-disclosure={open ? "open" : "closed"}>
      <div className="relative flex w-full min-w-0 items-center gap-2 rounded-md py-2.5 text-left">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-labelledby={titleId}
          aria-describedby={summary || status ? summaryId : undefined}
          onClick={() => onOpenChange(!open)}
          className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        />
        <ChevronRight size={14} aria-hidden className={`pointer-events-none shrink-0 text-subtle ${open ? "rotate-90" : ""}`} />
        <span id={titleId} data-disclosure-title className="pointer-events-none min-w-0 max-w-[55%] shrink-0 truncate text-sm font-normal text-foreground">{title}</span>
        {/* Marker buttons are siblings of the disclosure button, never nested inside it. */}
        {decoration?.marker}
        <span id={summaryId} className="pointer-events-none contents">
          {summary && <span data-disclosure-summary className="min-w-0 flex-1 truncate text-xs text-muted">{summary}</span>}
          {status && <span data-disclosure-status className={`ml-auto min-w-0 max-w-[60%] shrink-0 truncate text-xs ${attention ? "text-warn" : "text-muted"}`}>{status}</span>}
        </span>
      </div>
      <div id={panelId} hidden={!open} className="mt-2">
        {children}
      </div>
    </div>
  );
}
