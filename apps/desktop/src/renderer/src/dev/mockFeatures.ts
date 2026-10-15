// The mock bridge's /v2/capabilities featureList (shared with test/modules.test.ts, which snapshots
// module gating under both lists). Remote-only features are added by mockBridge itself. A new
// module adds its capability names in its own modules/<id>/mock.ts `features` (appended here), not
// in these lists.
import { MODULE_MOCKS } from "./mockModules";

/** Every mock cutex reports these. */
const CORE_BASE_FEATURES: readonly string[] = [
  "queue-pause",
  "include-hidden",
  "session-metadata",
  "project-workspace-root",
  "human-create-agent",
  "profile-quota",
  "offline-history",
  "offline-submit",
  "services",
  "workspace-fs",
];

/** Newer cutex only (absent under `?legacy`). */
const CORE_NEW_FEATURES: readonly string[] = [
  "agent-avatar-color",
  "session-fast-mode",
  "runtime-restore-candidates",
  "history-pages",
  "queue-steer",
  "admission-order",
  "admission-owner-yield",
  "admission-ridealong-detail",
  "stop-holds-ridealongs",
  "human-create-session",
  "human-agent-claude",
  "claude-tool-defaults",
  "new-thread-defaults",
  "fresh-agent-auto-permissions",
  "profile-quota-native",
  "session-history-revert",
  "session-fork",
  "session-delete",
  "session-delete-empty-on-archive",
  "profile-create",
  "profile-duplicate",
  "profile-model-variants",
  "profile-model-display-names",
  "profile-delete",
  "profile-delete-detach-archived",
  "profile-switch-family",
  "quick-chat-default-profile",
  "auto-thread-titles",
  "owner-approvals",
  "agent-project-boundary",
  "agent-external-grants",
  "profile-native-subagents",
  "profile-agent-approval",
  "profile-plan-label",
  "profile-plan-label-override",
  "profile-plan-label-claude",
  "claude-profile-default-model",
  "profile-generic-switches",
  "profile-tool-schema-compat",
  "claude-runtime-features",
  "delegation-tools",
  "fs-file-read",
  "agent-messages-v2",
  "agent-asks",
  "asks-pause-v2",
  "delegation-views",
  "owner-messages",
  "owner-notify-delete",
  "codex-plugins",
  "listen-settings",
  "device-pairing",
  "remote-listeners",
  "job-service",
  "runtime-package-upgrade",
  "task-service-removed",
  "runtime-gate-pause",
  "claude-quota-auto-continue",
];

export const MOCK_BASE_FEATURES: readonly string[] = [...CORE_BASE_FEATURES, ...MODULE_MOCKS.flatMap(({ mock }) => mock.features?.base ?? [])];
export const MOCK_NEW_FEATURES: readonly string[] = [...CORE_NEW_FEATURES, ...MODULE_MOCKS.flatMap(({ mock }) => mock.features?.new ?? [])];
