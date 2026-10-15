// 显示名: cutex's `displayNameOverride` (set by `cutex/session/metadata/update` `displayName`, capability
// `session-metadata`) is a display-only alias. `displayName` already resolves alias > real name, so lists
// and labels show it; the real name (formal agent name, else the thread name / id) stays the identity for
// the agent bus, delegations, mentions and the CLI, and search matches both.
import type { SessionResource } from "@cutex-desktop/protocol";

/** cutex SESSION_DISPLAY_NAME_MAX_CHARS. */
export const DISPLAY_NAME_MAX = 64;

type Named = Pick<SessionResource, "cutexSessionId" | "displayName"> & Partial<Pick<SessionResource, "formalAgentName" | "displayNameOverride" | "threadName">>;

/** The agent's real name (what it is addressed by), whatever alias it shows. */
export function realAgentName(session: Named): string {
  if (!session.displayNameOverride) return session.displayName;
  return session.formalAgentName || session.threadName || session.cutexSessionId;
}

/** The owner-set alias when it differs from the real name, else null. */
export function agentAlias(session: Named): string | null {
  const alias = session.displayNameOverride?.trim();
  return alias && alias !== realAgentName(session) ? alias : null;
}

/** Search: the shown name, the real name or the note contains `needle` (lowercase), or the id equals it. */
export function agentMatches(session: Named & Partial<Pick<SessionResource, "note">>, shown: string, needle: string): boolean {
  if (!needle) return true;
  return (
    shown.toLowerCase().includes(needle) ||
    realAgentName(session).toLowerCase().includes(needle) ||
    (session.note ?? "").toLowerCase().includes(needle) ||
    session.cutexSessionId.toLowerCase() === needle
  );
}

/** Tooltip for an agent label: the real name under an alias (null without one). */
export function realNameTip(session: Named): string | null {
  return agentAlias(session) ? realAgentName(session) : null;
}
