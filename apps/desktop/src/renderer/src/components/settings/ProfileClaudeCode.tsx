// Profile → 行为, Claude profiles (cutex `claude-code-sources`): which of Claude Code's own settings the
// profile's agents read — the workspace's project settings (CLAUDE.md, .claude/ rules, subagents,
// commands, skills, hooks, permissions) and the Claude account's user settings (the account home, not
// ~/.claude) — and whether a subscription login's claude.ai connectors load. Part of the page draft
// (sticky save bar); cutex applies it at each agent's next runtime launch. Shown only when cutex
// reports the fields. 共享技能 (cutex `claude-skills-import`): 「从 ~/.claude/skills 导入…」 copies Claude
// Code skills into the edited host's shared ~/.cutex/claude-skills (host-level, not a profile field).
import { useState } from "react";
import type { ProfileDetail, ProfilePatch } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { CLAUDE_SETTING_SOURCES, profileSources, toggledSources } from "../../lib/claudeCodeSources";
import { CLAUDE_SKILLS_IMPORT_FEATURE } from "../../lib/claudeSkillsImport";
import { fieldEditable } from "../../lib/profileKind";
import { useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { ClaudeSkillsImportDialog } from "../ClaudeSkillsImportDialog";
import { SettingRow, Toggle } from "./Form";

/** 共享技能 · 从 ~/.claude/skills 导入… on the edited host (cutex claude-skills-import). */
export function ClaudeSkillsImportRow() {
  const { t } = useI18n();
  const features = useTargetFeatures();
  const hostId = useTargetHostId();
  const [open, setOpen] = useState(false);
  if (!features.has(CLAUDE_SKILLS_IMPORT_FEATURE)) return null;
  return (
    <SettingRow label={t("agent-config.profile.claudeSkillsImport")} hint={t("agent-config.profile.claudeSkillsImportHint")}>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-2" data-testid="profile-claude-skills-import">
        {t("composer.tools.skillsImport")}
      </button>
      {open && <ClaudeSkillsImportDialog hostId={hostId} onClose={() => setOpen(false)} />}
    </SettingRow>
  );
}

export function ClaudeCodeSourceRows({ detail, patch, set }: { detail: ProfileDetail; patch: ProfilePatch; set(p: ProfilePatch): void }) {
  const { t } = useI18n();
  if (detail.claudeSettingSources === undefined || detail.claudeSettingSources === null) return null;
  const sources = profileSources(patch, detail);
  const editable = fieldEditable(detail, "claudeSettingSources");
  return (
    <>
      {CLAUDE_SETTING_SOURCES.map((source) => (
        <SettingRow key={source} label={t(`agent-config.profile.claudeSource.${source}` as MessageKey)} hint={t(`agent-config.profile.claudeSource.${source}Hint` as MessageKey)}>
          <Toggle
            label={t(`agent-config.profile.claudeSource.${source}` as MessageKey)}
            checked={sources.includes(source)}
            disabled={!editable}
            onChange={(on) => set({ claudeSettingSources: toggledSources(sources, source, on) })}
          />
        </SettingRow>
      ))}
      {detail.claudeAiConnectors != null && (
        <SettingRow label={t("agent-config.profile.claudeAiConnectors")} hint={t("agent-config.profile.claudeAiConnectorsHint")}>
          <Toggle
            label={t("agent-config.profile.claudeAiConnectors")}
            checked={patch.claudeAiConnectors ?? detail.claudeAiConnectors ?? false}
            disabled={!fieldEditable(detail, "claudeAiConnectors")}
            onChange={(v) => set({ claudeAiConnectors: v })}
          />
        </SettingRow>
      )}
    </>
  );
}
