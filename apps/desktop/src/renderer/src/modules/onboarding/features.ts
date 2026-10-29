import type { MessageKey } from "../../i18n";
import type { SettingsTab } from "../../store";

export interface NewFeature { id: string; title: MessageKey; body: MessageKey; capabilities: readonly string[]; page?: SettingsTab }
export const NEW_FEATURES: readonly NewFeature[] = [
  {"id":"pause","title":"onboarding.feature.pause.title","body":"onboarding.feature.pause.body","capabilities":["agent-pause"]},
  {"id":"images","title":"onboarding.feature.images.title","body":"onboarding.feature.images.body","capabilities":["event-media-blobs"]},
  {"id":"claudeSource","title":"onboarding.feature.claudeSource.title","body":"onboarding.feature.claudeSource.body","capabilities":["claude-cli-choice"]},
  {"id": "roster", "title": "onboarding.feature.roster.title", "body": "onboarding.feature.roster.body", "capabilities": [], "page": "sidebar"},
  {"id": "shelves", "title": "onboarding.feature.shelves.title", "body": "onboarding.feature.shelves.body", "capabilities": [], "page": "sides"},
  {"id": "tray", "title": "onboarding.feature.tray.title", "body": "onboarding.feature.tray.body", "capabilities": [], "page": "tray"},
  {"id": "badges", "title": "onboarding.feature.badges.title", "body": "onboarding.feature.badges.body", "capabilities": ["session-badge"]},
  {"id": "projectBadges", "title": "onboarding.feature.projectBadges.title", "body": "onboarding.feature.projectBadges.body", "capabilities": ["project-badge-wide"]},
  {"id": "fork", "title": "onboarding.feature.fork.title", "body": "onboarding.feature.fork.body", "capabilities": ["session-fork", "session-fork-profile", "session-fork-preview"]},
  {"id": "storage", "title": "onboarding.feature.storage.title", "body": "onboarding.feature.storage.body", "capabilities": ["host-storage"], "page": "storage"},
  {"id": "html", "title": "onboarding.feature.html.title", "body": "onboarding.feature.html.body", "capabilities": ["workspace-fs"]},
  {"id": "widgets", "title": "onboarding.feature.widgets.title", "body": "onboarding.feature.widgets.body", "capabilities": [], "page": "desktop"},
  {"id": "flow", "title": "onboarding.feature.flow.title", "body": "onboarding.feature.flow.body", "capabilities": []},
  {"id": "confirm", "title": "onboarding.feature.confirm.title", "body": "onboarding.feature.confirm.body", "capabilities": []},
  {"id": "director", "title": "onboarding.feature.director.title", "body": "onboarding.feature.director.body", "capabilities": ["director-address"]},
  {"id": "directorNotices", "title": "onboarding.feature.directorNotices.title", "body": "onboarding.feature.directorNotices.body", "capabilities": ["director-change-notices"]},
  {"id": "handover", "title": "onboarding.feature.handover.title", "body": "onboarding.feature.handover.body", "capabilities": ["director-handover"]},
  {"id": "startReview", "title": "onboarding.feature.startReview.title", "body": "onboarding.feature.startReview.body", "capabilities": ["management-start-adoption"]},
  {"id": "idle", "title": "onboarding.feature.idle.title", "body": "onboarding.feature.idle.body", "capabilities": ["stop-idle-agents"]},
  {"id": "compact", "title": "onboarding.feature.compact.title", "body": "onboarding.feature.compact.body", "capabilities": ["claude-compaction-models"], "page": "profiles"},
  {"id": "activity", "title": "onboarding.feature.activity.title", "body": "onboarding.feature.activity.body", "capabilities": ["project-events"]},
  {"id": "promptCache", "title": "onboarding.feature.promptCache.title", "body": "onboarding.feature.promptCache.body", "capabilities": ["prompt-cache-key"], "page": "defaults"},
];

export function supportsFeature(feature: NewFeature, capabilities: ReadonlySet<string>): boolean {
  return feature.capabilities.every((capability) => capabilities.has(capability));
}
