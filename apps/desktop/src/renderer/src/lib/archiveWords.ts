// Archived agents in two words (state surfaces W13, owner-approved 2026-11-17): cutex calls every archived agent
// `retired`, but an archive the owner can undo and a permanent retirement are different things. From the session's
// `archiveKind` / `restorable` (r266 lifecycle projection): soft (or restorable) → 已归档（可恢复）; permanent →
// 已永久退休. A host without the projection keeps the plain 已归档.
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SearchablePickerOption } from "../components/SearchablePicker";

export type ArchiveWord = "restorable" | "permanent" | "archived";

/** The archive word of an agent; null when it is not archived. */
export function archiveWord(s: Pick<SessionResource, "lifecycle"> & Partial<Pick<SessionResource, "archiveKind" | "restorable">>): ArchiveWord | null {
  if (s.archiveKind === "permanent") return "permanent";
  if (s.archiveKind === "soft") return s.restorable === false ? "archived" : "restorable";
  if (s.lifecycle !== "retired") return null;
  return s.restorable === true ? "restorable" : "archived";
}

export interface ArchiveLabels {
  /** The picker's plain 已归档 group (agentPickerOptions `labels.archived`). */
  archived: string;
  restorable: string;
  permanent: string;
}

const RANK: Record<ArchiveWord, number> = { restorable: 0, archived: 1, permanent: 2 };

/**
 * The agent picker's 已归档 rows (group `labels.archived`, maybe with a ` · host` suffix; a top row carries it as
 * `detail`) split into 已归档（可恢复） / 已归档 / 已永久退休 by each agent's archive word (`wordOf(value)`; null keeps
 * the row as it is). Archived rows stay last, in that group order, each group keeping its rows' order.
 */
export function splitArchivedOptions(options: readonly SearchablePickerOption[], labels: ArchiveLabels, wordOf: (value: string) => ArchiveWord | null): SearchablePickerOption[] {
  const relabel = (text: string, word: ArchiveWord) => (word === "archived" ? text : (word === "restorable" ? labels.restorable : labels.permanent) + text.slice(labels.archived.length));
  const isArchived = (text: string | undefined) => !!text && (text === labels.archived || text.startsWith(`${labels.archived} · `));
  const head: SearchablePickerOption[] = [];
  const tail: { option: SearchablePickerOption; rank: number; at: number }[] = [];
  options.forEach((o, at) => {
    const word = isArchived(o.group) || isArchived(o.detail) ? wordOf(o.value) : null;
    if (!word) return head.push(o);
    if (isArchived(o.detail)) return head.push({ ...o, detail: relabel(o.detail!, word) });
    tail.push({ option: { ...o, group: relabel(o.group, word) }, rank: RANK[word], at });
  });
  tail.sort((a, b) => a.rank - b.rank || a.at - b.at);
  return [...head, ...tail.map((x) => x.option)];
}
