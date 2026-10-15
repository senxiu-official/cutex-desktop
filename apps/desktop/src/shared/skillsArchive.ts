// cutex skills-archive (`/v2/codex/skills/archive`): user skills of the shared CODEX_HOME moved to
// `<cutex home>/archive/skills/<id>/` and back. Never a delete.
import type { CutexRefusal } from "./ipc";

export const SKILLS_ARCHIVE_FEATURE = "skills-archive";
/** Archive ids: `<UTC yyyymmddThhmmssZ>-<dir name>` (cutex `valid_id`). */
export const SKILL_ARCHIVE_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,159}$/;

export type SkillArchiveRecord = {
  id: string;
  name: string;
  dirName: string;
  description?: string | null;
  scope: "user";
  root: "codexHome" | "agentsHome";
  originalPath: string;
  skillMdPath: string;
  entryKind: "directory" | "link";
  linkTarget?: string | null;
  archivedAt: string;
  by: string;
  archivePath?: string;
  restoredAt?: string;
};

export type SkillArchiveList = { archives: SkillArchiveRecord[] };
export type SkillArchiveResult = { ok: true; archive: SkillArchiveRecord } | { ok: false; error: CutexRefusal };
