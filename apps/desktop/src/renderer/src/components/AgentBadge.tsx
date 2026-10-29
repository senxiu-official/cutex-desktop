import { memo } from "react";
import type { SessionBadge } from "@cutex-desktop/protocol";
import { featuresOf, useApp } from "../store";
import { badgeColor } from "../lib/sessionBadge";
import { ProjectBadge } from "./ProjectBadge";

/**
 * Owner label, separate from live status. Always use the agent's host capability. Memoized: the badge object is
 * shared across sidebar snapshots while it is unchanged, so a row re-rendering for a status tick skips it.
 * `onAvatar`: the avatar beside it draws the badge as its mark (components/Avatar, lib/projectMark avatarMark;
 * owner 2026-10-27) — only its text for screen readers stays here.
 */
export const AgentBadge = memo(function AgentBadge({ badge, hostId, onAvatar }: { badge?: SessionBadge | null; hostId?: string | null; onAvatar?: boolean }) {
  const enabled = useApp((s) => featuresOf(s, hostId ?? s.hosts?.active).has("session-badge"));
  if (!enabled || !badge) return null;
  if (onAvatar) return <span data-agent-badge="avatar" className="sr-only">{badge.text}</span>;
  return <span data-agent-badge="" role="img" aria-label={badge.text} title={badge.text}><ProjectBadge badge={badge.text} color={badgeColor(badge.tint)} /></span>;
});
