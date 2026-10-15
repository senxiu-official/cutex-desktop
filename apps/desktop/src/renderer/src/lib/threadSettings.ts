// Seeding a conversation's live thread settings from the cutex session resource. Pure.
import type { ThreadSettingsView } from "./timeline";

type CollaborationMode = NonNullable<ThreadSettingsView["collaborationMode"]>;

/**
 * cutex builds `runtime.threadSettings` from the thread/resume response after a runtime comes
 * online, and (up to r193 at least) leaves out `collaborationMode`, although cute-codex restores
 * the persisted mode on resume. Without the field the composer would claim "default" while the
 * agent still plans. Fill it from the last mode this window saw for the session (cute-codex
 * restores exactly that persisted value); `null` when there is nothing to seed from.
 */
export function seedThreadSettings(resource: ThreadSettingsView | null | undefined, lastKnown: CollaborationMode | null | undefined): ThreadSettingsView | null {
  if (!resource) return null;
  if (resource.collaborationMode?.mode || !lastKnown) return resource;
  return { ...resource, collaborationMode: lastKnown };
}

/** The collaboration mode carried by settings, if they carry one. */
export function collaborationModeOf(settings: ThreadSettingsView | null | undefined): CollaborationMode | null {
  return settings?.collaborationMode?.mode ? settings.collaborationMode : null;
}
