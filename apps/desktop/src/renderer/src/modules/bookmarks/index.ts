// References only, persisted in device-local prefs. The container owns all viewing and navigation.
import { Bookmark } from "lucide-react";
import { defineModule } from "../slots";
import { BookmarkRibbon } from "./BookmarkRibbon";
import { BookmarksGutter, BookmarksList, BookmarksTrigger } from "./BookmarksList";
import { useBookmarkAction, useBookmarksTab } from "./hooks";
import { BOOKMARKS, parseList, UNBOOKMARKED_KINDS, type ListState } from "./model";
import { activateBookmarks, toggleBookmark } from "./state";
import { bookmarkContext } from "./context";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const BookmarksSettings = lazyPage(() => import("./BookmarksSettings").then((m) => m.BookmarksSettings));

export default defineModule({
  id: "bookmarks", titleKey: "bookmarks.title", descriptionKey: "bookmarks.description",
  contributes: {
    "conversation.gutter": [{ id: "bookmarks.gutter", side: "left", anchor: "top", order: 100, dockMinWidth: 240, titleKey: "bookmarks.title", icon: Bookmark, Trigger: BookmarksTrigger, Body: BookmarksGutter }],
    "side.component": [{ id: BOOKMARKS, titleKey: "bookmarks.list", icon: Bookmark, instances: "singleton", defaultBinding: "host", placement: { home: "reference" }, parseParams: parseList,
      init: (params: ListState, previous: ListState | null) => ({ ...previous, ...params }), restore: (raw) => parseList(raw), useTab: useBookmarksTab, Body: BookmarksList, launcher: { category: "content", order: 400, params: () => ({}) } }],
    // Not on agents (the sidebar agent menu): 置顶 keeps an agent at hand (owner 2026-10-16).
    // `inline`: 书签 is always on a message's hover bar (owner 2026-10-23); everything else is in its 「⋯」.
    "ref.action": [{ id: "bookmarks.toggle", icon: Bookmark, titleKey: "bookmarks.add", excludeKinds: UNBOOKMARKED_KINDS, inline: true, useState: useBookmarkAction, run: ref => toggleBookmark(ref, bookmarkContext(ref)) }],
    "timeline.turnAttachment": [{ id: "bookmarks.ribbon", order: 100, margin: { side: "left", minWidth: 24 }, Attachment: BookmarkRibbon }],
    "settings.section": [{ id: "bookmarks.settings", page: "conversation", order: 320, titleKey: "bookmarks.settings", keywords: ["bookmarks.showRibbon", "bookmarks.showRibbonHint"], Section: BookmarksSettings }],
  }, activate: activateBookmarks,
});
