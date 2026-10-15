// References only, persisted in device-local prefs. The container owns all viewing and navigation.
import { Bookmark } from "lucide-react";
import { defineModule } from "../slots";
import { BookmarkRibbon } from "./BookmarkRibbon";
import { BookmarksGutter, BookmarksList, BookmarksTrigger } from "./BookmarksList";
import { BookmarksSettings } from "./BookmarksSettings";
import { useBookmarkAction, useBookmarksTab } from "./hooks";
import { BOOKMARKS, parseList, type ListState } from "./model";
import { activateBookmarks, toggleBookmark } from "./state";
import { bookmarkContext } from "./context";

export default defineModule({
  id: "bookmarks", titleKey: "bookmarks.title", descriptionKey: "bookmarks.description",
  contributes: {
    "conversation.gutter": [{ id: "bookmarks.gutter", side: "left", anchor: "top", order: 100, dockMinWidth: 240, titleKey: "bookmarks.title", icon: Bookmark, Trigger: BookmarksTrigger, Body: BookmarksGutter }],
    "side.component": [{ id: BOOKMARKS, titleKey: "bookmarks.list", icon: Bookmark, instances: "singleton", defaultBinding: "host", placement: { home: "reference" }, parseParams: parseList,
      init: (params: ListState, previous: ListState | null) => ({ ...previous, ...params }), restore: (raw) => parseList(raw), useTab: useBookmarksTab, Body: BookmarksList, launcher: { order: 400, params: () => ({}) } }],
    "ref.action": [{ id: "bookmarks.toggle", icon: Bookmark, titleKey: "bookmarks.add", useState: useBookmarkAction, run: ref => toggleBookmark(ref, bookmarkContext(ref)) }],
    "timeline.turnAttachment": [{ id: "bookmarks.ribbon", order: 100, margin: { side: "left", minWidth: 24 }, Attachment: BookmarkRibbon }],
    "settings.section": [{ id: "bookmarks.settings", page: "sidebar", titleKey: "bookmarks.settings", keywords: ["bookmarks.showRibbon", "bookmarks.showRibbonHint"], Section: BookmarksSettings }],
  }, activate: activateBookmarks,
});
