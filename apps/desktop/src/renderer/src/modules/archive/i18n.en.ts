// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "archive.title": "Archive",
  "archive.description": "View and restore archived {{agents}} and set archive behavior",
  // ---- settings (moved from the base catalog, 2026-10-09) ----
  "archive.list": "Archived {{agents}}",
  "archive.all": "All {n}",
  "archive.page": "Archive",
  "archive.archiveEmpty": "No archived {{agents}}",
  "archive.archiveHint": "Archived {{agents}} are always offline; view their history (read-only) or restore them",
  "archive.deleteEmpty": "Delete empty {{agents}} / work instead of archiving",
  "archive.deleteEmptyHint": "Ones without any turns are deleted rather than archived",
  "archive.archiveHintDelete": "Archived {{agents}} are always offline; view their history (read-only), restore or delete them",
  // ---- archived agent: list rows, banner, read-only history (2026-10-09) ----
  "archive.row.view": "View history",
  "archive.row.restore": "Restore",
  "archive.row.delete": "Delete permanently",
  "archive.row.deleteArmed": "Click again to delete",
  "archive.row.archivedAt": "Archived {when}",
  "archive.row.projectArchived": "{project} (project archived)",
  "archive.banner.title": "Archived",
  "archive.banner.body": "Read-only history. Restore it to send messages or start it.",
  "archive.banner.projectArchived": "Its project “{project}” is archived too; restoring brings the project back first.",
  "archive.banner.restore": "Restore",
  "archive.banner.restoreWithProject": "Restore project and {{agent}}",
  "archive.banner.restoreOnly": "Restore only the {{agent}}",
  "archive.banner.restoring": "Restoring…",
  "archive.restoreProjectConfirm": "Restoring {name} first restores its project “{project}”.",
  "archive.restoreDirector": "Also restore the {{director}} {name}",
  "archive.history.note": "Archived · saved history (read-only)",
  "archive.history.empty": "No saved conversation.",
  "archive.history.unsupported": "This cutex cannot read an archived {{agent}}'s history; restore it to view.",
};
