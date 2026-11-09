// Who is involved in a task / delegation row: the colored "#5e89dd" tag and an agent as [avatar] name
// (click = open that agent). Shared by task rows, delegation cards and the overviews.
import { taskTag } from "../lib/tasks";
import { useApp } from "../store";
import { convSidebarOf, useConvHost, useConvScope } from "../lib/conversationScope";
import { rowsOf } from "../lib/viewHost";
import { useI18n } from "../i18n";
import { SYSTEM_SENDER_NAME, systemSender } from "../lib/systemSenders";
import { Avatar } from "./Avatar";
import type { AgentHint } from "../lib/agentHint";
import { SystemAvatar } from "./SystemAvatar";
import { isShortId, resolveId } from "../lib/shortIds";

/** Colored short tag for a task or delegation id (lib/tasks taskTag: text and colour from the id). */
export function TaskTag({ taskId, assignmentId, title }: { taskId: string; assignmentId?: string; title?: string }) {
  const tag = taskTag(taskId);
  return (
    <span className="shrink-0 rounded px-1 text-caption/[inherit] font-semibold" style={{ color: tag.color, background: `${tag.color}1f` }} title={title ?? `task ${taskId}${assignmentId ? `\nassignment ${assignmentId}` : ""}`}>
      {tag.label}
    </span>
  );
}

/**
 * An agent as [avatar] name; click / Enter opens it. A span with role=link, not a button: it often
 * sits inside a row's toggle button. `name` is the fallback when the agent is not in the sidebar.
 * A cutex service id (lib/systemSenders) shows as 委托系统 / Cutex 系统 with the logo, not a link.
 * A bare name (agent_tell / agent_delegate by name) resolves to the one agent of that name on the conversation's host.
 * An agent the sidebar does not hold (being created by an agent_create row, another host's, deleted) still draws its
 * letter tile (components/Avatar `agent`): initials as the sidebar will give it, with `hint`'s project / model if known.
 * `realAvatar`: no effect since 2026-11-01 — every place draws an agent's real avatar (components/Avatar, rule A); kept for its callers.
 */
export function Who({ id: ref, name, size = 16, quiet = false, realAvatar = false, hint }: { id: string | null; name: string | null; size?: number; quiet?: boolean; realAvatar?: boolean; hint?: AgentHint | null }) {
  // `ref` may be a short session id from agent-facing tool text (`cutex.…3f9a1c`): resolved
  // against the sidebar; unknown or ambiguous = shown as text, not a link (lib/shortIds).
  const conv = useConvScope();
  const session = useApp((s) => {
    if (!ref && !name) return undefined;
    const all = rowsOf(s.sidebar, convSidebarOf(conv, s));
    if (!ref) {
      // A unique name is an agent reference too (lib/taskRows party).
      const named = all.filter((x) => x.displayName === name);
      return named.length === 1 ? named[0] : undefined;
    }
    const exact = all.find((x) => x.cutexSessionId === ref);
    if (exact || !isShortId(ref)) return exact;
    const full = resolveId(ref, all.map((x) => x.cutexSessionId));
    return full ? all.find((x) => x.cutexSessionId === full) : undefined;
  });
  const id = session?.cutexSessionId ?? (!ref || isShortId(ref) ? null : ref);
  const select = useApp((s) => s.select);
  // Names are resolved from the conversation's host (lib/conversationScope): open them there too.
  const host = useConvHost();
  const { t } = useI18n();
  const system = session ? null : systemSender(id);
  if (system) {
    return (
      <span className={`inline-flex min-w-0 max-w-full items-center gap-1 ${quiet ? "" : "text-foreground"}`}>
        <SystemAvatar kind={system} size={size} />
        <span className="truncate">{t(SYSTEM_SENDER_NAME[system])}</span>
      </span>
    );
  }
  const label = session?.displayName ?? name ?? ref;
  if (!label) return null;
  const agent = session ? null : { ...hint, hostId: hint?.hostId ?? host };
  if (!id)
    return (
      <span className={`inline-flex min-w-0 max-w-full items-center gap-1 ${quiet ? "" : "text-foreground"}`} title={[label, ref].filter(Boolean).join("\n")}>
        <Avatar name={label} agent={agent} size={size} />
        <span className="truncate">{label}</span>
      </span>
    );
  return (
    <span
      title={[label, ref].filter(Boolean).join("\n")}
      role="link"
      tabIndex={0}
      onClick={(e) => (e.stopPropagation(), id && void select(id, host))}
      onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), id && void select(id, host))}
      className={`inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 hover:underline ${quiet ? "" : "text-foreground"}`}
    >
      <Avatar name={label} avatar={session?.avatar} seed={id} agent={agent} size={size} />
      <span className="truncate">{label}</span>
    </span>
  );
}
