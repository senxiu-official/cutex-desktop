// cutex `claude-code-sources`: Claude Code settings sources / claude.ai connectors of a Claude profile
// and what a Claude agent actually got (GET /v2/sessions/{id}/claude-code). Pure helpers for the Profile
// rows (components/settings/ProfileClaudeCode) and the composer note (components/ClaudeCodeSourcesNote).
import type { ClaudeCodeLaunchSummary, ClaudeCodeSources, ClaudeSettingSource, ProfileDetail, ProfilePatch } from "../../../shared/ipc";

export const CLAUDE_CODE_SOURCES_FEATURE = "claude-code-sources";

/** Display order. */
export const CLAUDE_SETTING_SOURCES: readonly ClaudeSettingSource[] = ["project", "user"];

/** The sources the draft / stored profile has now (unset = cutex's default, none). */
export function profileSources(patch: ProfilePatch, detail: ProfileDetail): ClaudeSettingSource[] {
  if (patch.claudeSettingSources !== undefined) return patch.claudeSettingSources ?? detail.detail.claudeSettingSourcesDefault ?? [];
  return detail.claudeSettingSources ?? detail.detail.claudeSettingSourcesExplicit ?? detail.detail.claudeSettingSourcesDefault ?? [];
}

/** The full list after turning one source on / off (stable order). */
export function toggledSources(current: readonly ClaudeSettingSource[], source: ClaudeSettingSource, on: boolean): ClaudeSettingSource[] {
  return CLAUDE_SETTING_SOURCES.filter((s) => (s === source ? on : current.includes(s)));
}

/** What to show for an agent: the running adapter's launch, else what the next launch passes. */
export function claudeCodeShown(view: ClaudeCodeSources): ClaudeCodeLaunchSummary {
  return view.running && view.launched ? view.launched : view.next;
}
