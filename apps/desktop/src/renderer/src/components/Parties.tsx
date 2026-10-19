// Who is involved in a task / delegation row: the colored "#N" tag and an agent as [avatar] name
// (click = open that agent). Shared by task rows, delegation cards and the overviews.
import { taskTag } from "../lib/tasks";
import { useApp } from "../store";
import { convSidebarOf, useConvHost, useConvScope } from "../lib/conversationScope";
import { rowsOf } from "../lib/viewHost";
import { useI18n } from "../i18n";
import { SYSTEM_SENDER_NAME, systemSender } from "../lib/systemSenders";
import { Avatar } from "./Avatar";
import { SystemAvatar } from "./SystemAvatar";
import { isShortId, resolveId } from "../lib/shortIds";

/** Colored "#N" for a task or delegation id (lib/tasks taskTag: numbered per app run, colour from the id). */
export function TaskTag({ taskId, assignmentId, title }: { taskId: string; assignmentId?: string; title?: string }) {
  const tag = taskTag(taskId);
  return (
    <span className="shrink-0 rounded px-1 font-mono text-[11px] font-semibold" style={{ color: tag.color, background: `${tag.color}1f` }} title={title ?? `task ${taskId}${assignmentId ? `\nassignment ${assignmentId}` : ""}`}>
      {tag.label}
    </span>
  );
}

/**
 * An agent as [avatar] name; click / Enter opens it. A span with role=link, not a button: it often
 * sits inside a row's toggle button. `name` is the fallback when the agent is not in the sidebar.
 * A cutex service id (lib/systemSenders) shows as 委托系统 / Cutex 系统 with the logo, not a link.
 */
export function Who({ id: ref, name, size = 14, quiet = false }: { id: string | null; name: string | null; size?: number; quiet?: boolean }) {
  // `ref` may be a short session id from agent-facing tool text (`cutex.…3f9a1c`): resolved
  // against the sidebar; unknown or ambiguous = shown as text, not a link (lib/shortIds).
  const conv = useConvScope();
  const session = useApp((s) => {
    if (!ref) return undefined;
    const all = rowsOf(s.sidebar, convSidebarOf(conv, s));
    const exact = all.find((x) => x.cutexSessionId === ref);
    if (exact || !isShortId(ref)) return exact;
    const full = resolveId(ref, all.map((x) => x.cutexSessionId));
    return full ? all.find((x) => x.cutexSessionId === full) : undefined;
  });
  const id = session?.cutexSessionId ?? (isShortId(ref) ? null : ref);
  const select = useApp((s) => s.select);
  // Names are resolved from the conversation's host (lib/conversationScope): open them there too.
  const host = useConvHost();
  const { t } = useI18n();
  const system = session ? null : systemSender(id);
  if (system) {
    return (
      <span className={`inline-flex min-w-0 shrink-0 items-center gap-1 ${quiet ? "" : "text-foreground"}`}>
        <SystemAvatar kind={system} size={size} />
        <span className="truncate">{t(SYSTEM_SENDER_NAME[system])}</span>
      </span>
    );
  }
  const label = session?.displayName ?? name ?? ref;
  if (!label) return null;
  if (!id)
    return (
      <span className={`inline-flex min-w-0 shrink-0 items-center gap-1 ${quiet ? "" : "text-foreground"}`} title={ref ?? undefined}>
        <Avatar name={label} size={size} />
        <span className="truncate">{label}</span>
      </span>
    );
  return (
    <span
      role="link"
      tabIndex={0}
      onClick={(e) => (e.stopPropagation(), id && void select(id, host))}
      onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), id && void select(id, host))}
      className={`inline-flex min-w-0 shrink-0 cursor-pointer items-center gap-1 hover:underline ${quiet ? "" : "text-foreground"}`}
    >
      <Avatar name={label} avatar={session?.avatar} seed={id} size={size} minor />
      <span className="truncate">{label}</span>
    </span>
  );
}
