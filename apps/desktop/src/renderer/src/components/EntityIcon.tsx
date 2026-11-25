// One icon for anything named in a row (owner 2026-11-24: projects, agents and Profiles always show their icon where
// they are named — pickers, pair lists, chips, settings lists). It draws the existing faces, so every surface shows the
// same thing: an agent's Avatar (by its session id: lib/agentLook resolves the rest from the snapshots), a project's
// ProjectBadge (prefs `projectIcons` over the cutex presentation), a Profile's ProfileAvatar.
//
// Alignment: the icon sits in a fixed slot (`slot`, default the icon box) centred on the text line, so names after
// symbol, emoji, letter and text icons start at the same x. A project text icon wider than the box ("MAST", "音声")
// keeps its width; a list gives every row the widest one's slot (entityIconSlot) so its names still line up.
import { memo, type ReactNode } from "react";
import { Avatar } from "./Avatar";
import { ProjectBadge } from "./ProjectBadge";
import { ProfileAvatar, type AvatarProfile } from "./ProfileAvatar";
import { projectIcon } from "../lib/projectIcons";
import { ENTITY_PROJECT_SIZE as PROJECT_SIZE, type EntityIconSize, type EntityRef } from "../lib/entityIcon";
import { useProjectIcons } from "../lib/projectIconSync";
import { sidebarOf, useApp } from "../store";
import { profileLookOf, useProfileLooksVersion } from "../lib/profileLooks";
import { focusHostId } from "../lib/hostKeys";

// Memoised: lists hand stable entity objects, so a picker adding icons chunk by chunk does not re-render the ones shown.
export const EntityIcon = memo(function EntityIcon({ entity, size = 16, slot }: { entity: EntityRef; size?: EntityIconSize; slot?: number }) {
  return (
    <span data-entity-icon={entity.kind} className="inline-flex shrink-0 items-center justify-center" style={{ width: Math.max(slot ?? size, size), height: size }} aria-hidden>
      {entity.kind === "agent" ? <Avatar name={entity.name} seed={entity.id} size={size} />
        : entity.kind === "profile" ? <ProfileEntityAvatar entity={entity} size={size} />
        : <ProjectEntityBadge entity={entity} size={size} />}
    </span>
  );
});

function ProjectEntityBadge({ entity, size }: { entity: Extract<EntityRef, { kind: "project" }>; size: EntityIconSize }) {
  const icons = useProjectIcons();
  // Only a reference by id reads the snapshot (rows that pass badge and colour subscribe to nothing more).
  const known = useApp((s) => entity.badge !== undefined && entity.color !== undefined ? null : sidebarOf(s, entity.hostId)?.projects?.projects.find((p) => p.project_id === entity.id)?.presentation ?? null);
  const badge = entity.badge ?? (known?.badge_label || (known?.display_name || entity.id).slice(0, 1));
  return <ProjectBadge icon={projectIcon(icons, entity.hostId, entity.id)} badge={badge} color={entity.color ?? known?.color ?? "gray"} size={PROJECT_SIZE[size]} />;
}

function ProfileEntityAvatar({ entity, size }: { entity: Extract<EntityRef, { kind: "profile" }>; size: EntityIconSize }) {
  useProfileLooksVersion();
  const hostId = entity.hostId ?? focusHostId();
  const look = entity.profile ? null : profileLookOf(hostId, entity.ref);
  const profile = entity.profile ?? (look ? { ...look, authKind: undefined, baseUrl: undefined } as unknown as AvatarProfile : { id: entity.ref ?? "", name: entity.ref ?? "?" } as AvatarProfile);
  return <ProfileAvatar profile={profile} size={size} host={hostId} />;
}

/**
 * A name in running text with its icon before it (owner 2026-11-25: summaries, banners, system cards). The icon box is
 * 0.9em tall, vertically centred on the text (the 16 px icon overflows it), so the line height never changes; icon and
 * name do not wrap apart. `entity` null = just the name.
 */
export function EntityMention({ entity, children, className = "" }: { entity: EntityRef | null | undefined; children: ReactNode; className?: string }) {
  if (!entity) return <>{children}</>;
  return (
    <span data-entity-mention={entity.kind} className={`whitespace-nowrap ${className}`}>
      <span className="mr-1 inline-flex h-[0.9em] items-center align-middle"><EntityIcon entity={entity} /></span>
      {children}
    </span>
  );
}
