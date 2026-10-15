// Small status glyphs (Linear-style circles, used by the Services list), plus the status cell.
import type { StatusKind } from "../lib/status";
import type { ProjectIconChoice } from "../lib/projectIcons";
import { ProjectBadge } from "./ProjectBadge";

const TONE: Record<StatusKind, string> = {
  blocked: "text-danger",
  review: "text-warn",
  active: "text-accent",
  closed: "text-subtle",
  error: "text-danger",
  starting: "text-accent",
  running: "text-ok",
  stopped: "text-subtle",
};

export function StatusIcon({ kind, size = 14 }: { kind: StatusKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className={`shrink-0 ${TONE[kind]}`} aria-hidden>
      {kind === "blocked" && (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M4 12 12 4" />
        </>
      )}
      {kind === "review" && (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === "active" && (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 8V2a6 6 0 0 1 6 6Z" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === "closed" && (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="m5.3 8.2 1.9 1.9 3.6-3.8" />
        </>
      )}
      {kind === "error" && (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.8v3.6" />
          <circle cx="8" cy="11" r="0.6" fill="currentColor" />
        </>
      )}
      {kind === "starting" && <circle cx="8" cy="8" r="6" strokeDasharray="2.4 2.2" className="origin-center animate-spin [animation-duration:3s]" />}
      {kind === "running" && <circle cx="8" cy="8" r="4" fill="currentColor" stroke="none" />}
      {kind === "stopped" && <circle cx="8" cy="8" r="4.5" />}
    </svg>
  );
}

export function StatusCell({ kind, label }: { kind: StatusKind; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <StatusIcon kind={kind} />
      <span className="truncate text-xs text-muted">{label}</span>
    </span>
  );
}

/** Project as a group label: the badge (or chosen icon) + name. `color` is already a CSS colour. */
export function ProjectLabel({ name, badge, color, icon }: { name: string; badge?: string; color: string; icon?: ProjectIconChoice | null }) {
  return (
    <>
      <ProjectBadge icon={icon} badge={badge || name.slice(0, 1)} color={color} />
      <span>{name}</span>
    </>
  );
}
