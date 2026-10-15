import { Bookmark } from "lucide-react";
import { useI18n } from "../../i18n";
import { useModulePref } from "../react";
import type { TurnAttachmentProps } from "../slots";
import { openBookmark, useBookmarks } from "./state";

export function BookmarkRibbon({ hostId, sessionId, turnId, where }: TurnAttachmentProps) {
  const { t } = useI18n();
  const [show] = useModulePref<boolean>("bookmarks", "showRibbon", true);
  const record = useBookmarks((s) => s.document.records.find((r) => r.ref.hostId === hostId && r.ref.kind === "turn" && r.ref.params.sessionId === sessionId && r.ref.params.turnId === turnId));
  if (!show || where === "inline" || !record) return null;
  // Names the bookmark (its own label may differ from the turn) and what a click does.
  const label = t("bookmarks.ribbon", { title: record.ref.title });
  return <div className="flex justify-end"><button className="rounded p-1 text-accent/80 hover:bg-accent/10 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent" title={label} aria-label={label} onClick={() => void openBookmark(record)}><Bookmark size={14} fill="currentColor" /></button></div>;
}
