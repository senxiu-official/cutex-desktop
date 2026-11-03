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
  "user-input-options-v1",
  "dsh-runtime",
  // r264 images in steers; `?noimagesteer` drops it (dev/mockBridge IMAGE_STEER).
  "image-input-steering",
  "profile-account-link",
  "host-owner-person",
  "profile-avatar",
  "profile-avatar-style",
  "profile-avatar-style-import-if-unset",
  "session-avatar-mode",
  "windows-sandbox-readiness",
  "session-conversation-activity",
  "session-sandbox-extras",
  "claude-permission-rules",
  "agent-avatar-color",
  "session-fast-mode",
  "runtime-restore-candidates",
  "stop-idle-agents",
  "history-pages",
  "queue-steer",
  "owner-join-delegation",
  "admission-order",
  "admission-owner-yield",
  "admission-ridealong-detail",
  "stop-holds-ridealongs",
  "human-create-session",
  "human-agent-claude",
  "claude-tool-defaults",
  "new-thread-defaults",
  "fresh-agent-auto-permissions",
  "launch-approvals-reviewer",
  "profile-quota-native",
  "quota-display-label",
  "session-history-revert",
  "session-fork",
  "session-delete",
  "session-delete-empty-on-archive",
  "profile-create",
  "profile-duplicate",
  "profile-transfer",
  "profile-model-variants",
  "profile-model-display-names",
  "profile-delete",
  "profile-delete-detach-archived",
  "profile-import-cc-switch",
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
  "profile-image-history-trim",
  "claude-runtime-features",
  "claude-session-skills",
  "claude-rewind-files",
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
  "profile-reset-credits",
  "agent-create-effort-fallback",
  "agent-create-abandon",
  "profile-auto-pick",
  "session-created-by",
  "guides.preferences",
];

export const MOCK_BASE_FEATURES: readonly string[] = [...CORE_BASE_FEATURES, ...MODULE_MOCKS.flatMap(({ mock }) => mock.features?.base ?? [])];
export const MOCK_NEW_FEATURES: readonly string[] = [...CORE_NEW_FEATURES, ...MODULE_MOCKS.flatMap(({ mock }) => mock.features?.new ?? [])];

/** Explicit preview scenarios only; ordinary and legacy mocks keep durable text deltas. */
export function mockScenarioFeatures(search: string): string[] {
  const q = new URLSearchParams(search);
  if (q.has("legacy")) return [];
  if (q.has("overloadretry") && !q.has("no-retry-visible")) return ["model-overload-retry-visible", ...(q.has("inputLedger") ? ["input-ledger-v1"] : [])];
  // ?variants: cutex profile-runtime-variants (r265; dev/mockProfileVariants.ts).
  return [...(q.has("inputLedger") ? ["input-ledger-v1"] : []), ...(q.has("live-deltas") ? ["live-text-deltas"] : []), ...(q.has("variants") ? ["profile-runtime-variants"] : []), ...(q.has("relay") ? ["profile-relay-runtimes"] : [])];
}
