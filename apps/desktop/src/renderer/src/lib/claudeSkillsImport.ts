// 从 ~/.claude/skills 导入 (cutex `claude-skills-import`): Claude Code skills of a directory on the
// agent's host (default: that host user's ~/.claude/skills) are copied into the host's shared
// ~/.cutex/claude-skills, which every Claude agent there loads. Everything goes through cutex, so a
// remote host works the same; the desktop never reads either directory itself. Pure, unit-tested.
import type { ClaudeSkillImportItem, ClaudeSkillsImportResult } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";

export const CLAUDE_SKILLS_IMPORT_FEATURE = "claude-skills-import";

/** Skills checked when the list arrives: importable ones that do not exist yet. */
export function initialSelection(skills: readonly ClaudeSkillImportItem[]): Set<string> {
  return new Set(skills.filter((s) => s.importable && !s.exists).map((s) => s.name));
}

/** Can be checked: importable, and (when it exists already) only with overwrite. */
export function selectable(skill: ClaudeSkillImportItem, overwrite: boolean): boolean {
  return skill.importable && (!skill.exists || overwrite);
}

/** The names to send: checked and still selectable (overwrite may have been turned off since). */
export function namesToImport(skills: readonly ClaudeSkillImportItem[], selected: ReadonlySet<string>, overwrite: boolean): string[] {
  return skills.filter((s) => selected.has(s.name) && selectable(s, overwrite)).map((s) => s.name);
}

const REASONS = new Set(["symlinkOutsideSource", "tooLarge", "tooManyFiles", "tooDeep", "skillFileTooLarge", "invalidName", "notFound", "copyFailed", "exists"]);

/** Message key for a refusal / skip reason cutex reports (unknown reasons: the generic one). */
export function reasonKey(reason: string | undefined): MessageKey {
  return (reason && REASONS.has(reason) ? `claudeSkillsImport.reason.${reason}` : "claudeSkillsImport.reason.other") as MessageKey;
}

/** 12 KB / 1.2 MB (bytes reported by cutex; null = unknown). */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Counts for the result line. */
export function resultCounts(result: ClaudeSkillsImportResult): { imported: number; skipped: number; failed: number } {
  return { imported: result.imported.length, skipped: result.skipped.length, failed: result.failed.length };
}
