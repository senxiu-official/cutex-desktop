import { useI18n, type MessageKey } from "../../i18n";
import type { CutexRef } from "../slots";
import { refKey } from "./model";
import { problemKey, useBookmarks } from "./state";

export function useBookmarkAction(ref: CutexRef) {
  const { t } = useI18n();
  const active = useBookmarks((s) => s.document.records.some((r) => refKey(r.ref) === refKey(ref)));
  const error = useBookmarks((s) => s.storageError);
  return { active, titleKey: (active ? "bookmarks.active" : "bookmarks.add") as MessageKey, ...(error ? { disabledReason: t(problemKey(error)) } : {}) };
}
export function useBookmarksTab() { const { t } = useI18n(); return { title: t("bookmarks.list") }; }
export function refusalKey(reason: string): MessageKey {
  return ({ gone: "bookmarks.unavailable.gone", reverted: "bookmarks.unavailable.reverted", "module-off": "bookmarks.unavailable.module-off", capability: "bookmarks.unavailable.capability", "host-offline": "bookmarks.unavailable.host-offline", "host-changed": "bookmarks.unavailable.host-changed", "bad-ref": "bookmarks.unavailable.bad-ref", stale: "bookmarks.unavailable.stale" } as Record<string, MessageKey>)[reason] ?? "bookmarks.unavailable.gone";
}
