// References only, persisted in device-local prefs. The container owns all viewing and navigation.
// 备忘 (owner 2026-11-10): the bookmarks card is the 备忘 card, with a 要处理 tab for what agents left with owner_pin
// (cutex owner-pins, pins/: cutex owns those, nothing is stored here). Pin items need the owner-pins capability.
import { Bookmark, Pin } from "lucide-react";
import { OWNER_PINS_FEATURE } from "../../../../shared/ownerPins";
import { defineModule } from "../slots";
import { BookmarkRibbon } from "./BookmarkRibbon";
import { BookmarksGutter, BookmarksTrigger } from "./BookmarksList";
import { isPinTool, pinCallOf } from "./pins/calls";
import { startPinSync } from "./pins/store";
import { MemoCard, PinsGutter, PinsTrayButton, PinsTrigger, PinsWidget } from "./pins/Surfaces";
import { PinToolRow } from "./pins/ToolRow";
import { useBookmarkAction, useBookmarksTab } from "./hooks";
import { BOOKMARKS, parseList, UNBOOKMARKED_KINDS, type ListState } from "./model";
import { activateBookmarks, toggleBookmark } from "./state";
import { bookmarkContext } from "./context";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const PINS = { capabilities: [OWNER_PINS_FEATURE] };
const BookmarksSettings = lazyPage(() => import("./BookmarksSettings").then((m) => m.BookmarksSettings));

export default defineModule({
  id: "bookmarks", titleKey: "bookmarks.title", descriptionKey: "bookmarks.description",
  contributes: {
    "conversation.gutter": [
      { id: "bookmarks.pinsGutter", side: "left", anchor: "top", order: 95, dockMinWidth: 240, requires: PINS, titleKey: "bookmarks.memo.tab.pins", icon: Pin, Trigger: PinsTrigger, Body: PinsGutter },
      { id: "bookmarks.gutter", side: "left", anchor: "top", order: 100, dockMinWidth: 240, titleKey: "bookmarks.title", icon: Bookmark, Trigger: BookmarksTrigger, Body: BookmarksGutter },
    ],
    "side.component": [{ id: BOOKMARKS, titleKey: "bookmarks.memo.title", icon: Bookmark, instances: "singleton", defaultBinding: "host", placement: { home: "reference" }, parseParams: parseList,
      init: (params: ListState, previous: ListState | null) => ({ ...previous, ...params }), restore: (raw) => parseList(raw), useTab: useBookmarksTab, Body: MemoCard, launcher: { category: "content", order: 400, params: () => ({}) } }],
    // Not on agents (the sidebar agent menu): 置顶 keeps an agent at hand (owner 2026-10-16).
    // `inline`: 书签 is always on a message's hover bar (owner 2026-10-23); everything else is in its 「⋯」.
    "ref.action": [{ id: "bookmarks.toggle", icon: Bookmark, titleKey: "bookmarks.add", excludeKinds: UNBOOKMARKED_KINDS, inline: true, useState: useBookmarkAction, run: ref => toggleBookmark(ref, bookmarkContext(ref)) }],
    "timeline.turnAttachment": [{ id: "bookmarks.ribbon", order: 100, margin: { side: "left", minWidth: 24 }, Attachment: BookmarkRibbon }],
    // 要处理: the tray button, the open agent's in the tool strip, the tool call as a card, a desktop widget.
    "tray.entry": [{ id: "bookmarks.memoTray", order: 50, requires: PINS, Button: PinsTrayButton }],
    "timeline.tool": [{
      id: "bookmarks.pinTool", order: 160, requires: PINS, match: isPinTool, Row: PinToolRow,
      // A pin is a card of its own (like a published artifact), not folded into the work group.
      standalone: (item) => pinCallOf(item)?.status === "done",
      activity: () => "bookmarks.memo.tool.activity",
    }],
    "desktop.widget": [{
      id: "bookmarks.memoWidget", requires: PINS, titleKey: "bookmarks.memo.title", descriptionKey: "bookmarks.memo.widgetHint", icon: Pin,
      size: { min: [28, 16], max: [70, 100], default: [36, 40], units: { min: [4, 3], max: [12, 16], default: [6, 6] } },
      shape: "card", defaultPlace: { area: "side", order: 12 },
      settings: [{ key: "maxRows", type: "number", labelKey: "bookmarks.memo.maxRows", min: 1, max: 20, step: 1 }],
      defaults: { maxRows: 6 },
      refresh: "minute",
      Widget: PinsWidget,
    }],
    "settings.section": [{ id: "bookmarks.settings", page: "conversation", order: 320, titleKey: "bookmarks.settings", keywords: ["bookmarks.showRibbon", "bookmarks.showRibbonHint"], Section: BookmarksSettings }],
  }, activate: (ctx) => { activateBookmarks(ctx); startPinSync(ctx); },
});
