// Who is involved in a task / delegation row: the colored "#5e89dd" tag, an agent as [avatar] name (click = open
// that agent) and a project as [icon] name (click = its project page). The app's one agent / project reference:
// task rows, delegation cards, the overviews and the approval cards.
import { taskTag } from "../lib/tasks";
import { sidebarOf, useApp } from "../store";
import { convSidebarOf, useConvHost, useConvScope } from "../lib/conversationScope";
import { rowsOf } from "../lib/viewHost";
import { useI18n } from "../i18n";
import { SYSTEM_SENDER_NAME, systemSender } from "../lib/systemSenders";
import { Avatar } from "./Avatar";
import type { AgentHint } from "../lib/agentHint";
import { SystemAvatar } from "./SystemAvatar";
import { isShortId, resolveId } from "../lib/shortIds";
import { Folder } from "lucide-react";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { projectIcon } from "../lib/projectIcons";
import { useProjectIcons } from "../lib/projectIconSync";
import { hostPageParam } from "../lib/targetHost";
import { services as appServices } from "../modules/app";
import { ProjectBadge } from "./ProjectBadge";

/** A host's label when it is not the focus host and there are several (`@label`, muted), else null. */
function useOtherHostLabel(hostId: string | null | undefined): string | null {
  return useApp((s) => {
    const hosts = s.hosts?.hosts ?? [];
    if (!hostId || hosts.length < 2 || hostId === (s.hosts?.active ?? LOCAL_HOST_ID)) return null;
    return hosts.find((h) => h.id === hostId)?.label ?? hostId;
  });
}

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
export function Who({ id: ref, name, size = 16, quiet = false, realAvatar = false, hint, hostId: on }: { id: string | null; name: string | null; size?: number; quiet?: boolean; realAvatar?: boolean; hint?: AgentHint | null; /** Resolve and open on this host (a page outside a conversation, e.g. 审批); another host than the focus shows `@host`. */ hostId?: string }) {
  // `ref` may be a short session id from agent-facing tool text (`cutex.…3f9a1c`): resolved
  // against the sidebar; unknown or ambiguous = shown as text, not a link (lib/shortIds).
  const conv = useConvScope();
  const session = useApp((s) => {
    if (!ref && !name) return undefined;
    const all = on ? rowsOf(sidebarOf(s, on)) : rowsOf(s.sidebar, convSidebarOf(conv, s));
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
  const openAgent = useApp((s) => s.openAgent);
  // Names are resolved from the conversation's host (lib/conversationScope), or the given host: open them there too.
  const convHost = useConvHost();
  const host = on ?? convHost;
  const otherHost = useOtherHostLabel(on);
  const open = (sessionId: string) => void (on ? openAgent(sessionId, on) : select(sessionId, host));
  const hostMark = otherHost && <span data-who-host="" className="shrink-0 text-subtle">@{otherHost}</span>;
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
  // Not resolvable to a session here (deleted, archived beyond the list, not on that host): its letter tile, no link.
  if (!id || (on && !session))
    return (
      <span data-who="" className={`inline-flex min-w-0 max-w-full items-center gap-1 ${quiet ? "" : "text-foreground"}`} title={[label, ref].filter(Boolean).join("\n")}>
        <Avatar name={label} agent={agent} size={size} />
        <span className="truncate">{label}</span>
        {hostMark}
      </span>
    );
  return (
    <span
      data-who=""
      title={[label, ref, otherHost && `@${otherHost}`].filter(Boolean).join("\n")}
      role="link"
      tabIndex={0}
      onClick={(e) => (e.stopPropagation(), open(id))}
      onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), open(id))}
      className={`inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 hover:underline ${quiet ? "" : "text-foreground"}`}
    >
      <Avatar name={label} avatar={session?.avatar} seed={id} agent={agent} size={size} />
      <span className="truncate">{label}</span>
      {hostMark}
    </span>
  );
}

/**
 * A project as [icon] name: its chosen icon or letter tile in the project colour (components/ProjectBadge); click /
 * Enter opens its project page on `hostId`. A project the host's sidebar does not list shows `name` (or the id) with
 * a neutral folder icon, not a link.
 */
export function ProjectRef({ hostId, projectId, name = null, quiet = false }: { hostId: string; projectId: string; name?: string | null; quiet?: boolean }) {
  const { t } = useI18n();
  const project = useApp((s) => sidebarOf(s, hostId)?.projects?.projects.find((p) => p.project_id === projectId));
  const icons = useProjectIcons();
  const otherHost = useOtherHostLabel(hostId);
  const label = project?.presentation.display_name || name || projectId;
  const tone = quiet ? "" : "text-foreground";
  const title = [label, projectId, otherHost && `@${otherHost}`].filter(Boolean).join("\n");
  if (!project)
    return (
      <span data-project-ref="" className={`inline-flex min-w-0 max-w-full items-center gap-1 ${tone}`} title={title}>
        <Folder size={13} strokeWidth={1.75} className="shrink-0 text-subtle" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    );
  const open = () => appServices.ui.openPage("projects.page", { project: projectId, ...hostPageParam(hostId) });
  return (
    <span
      data-project-ref={projectId}
      role="link"
      tabIndex={0}
      title={title}
      aria-label={t("titlebar.openProject", { name: label })}
      onClick={(e) => (e.stopPropagation(), open())}
      onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), open())}
      className={`inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 hover:underline ${tone}`}
    >
      <ProjectBadge icon={projectIcon(icons, hostId, projectId)} badge={project.presentation.badge_label || label.slice(0, 1)} color={project.presentation.color} />
      <span className="truncate">{label}</span>
      {otherHost && <span className="shrink-0 text-subtle">@{otherHost}</span>}
    </span>
  );
}
