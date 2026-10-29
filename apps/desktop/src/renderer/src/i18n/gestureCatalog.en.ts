// English strings of ./gestureCatalog.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { gestureZhCN } from "./gestureCatalog";

export const gestureEn: Record<keyof typeof gestureZhCN, string> = {
  "gestures.title": "Clicks and gestures",
  "gestures.hint": "The same gesture means the same thing everywhere:",
  "gestures.legend.beside": "Beside",
  "gestures.legend.beside.for": "{{agents}}, page entries",
  "gestures.legend.background": "New in background",
  "gestures.legend.background.for": "launchers, files",
  "gestures.legend.close": "Close",
  "gestures.legend.close.for": "tabs",
  "gestures.or": "or",
  "gestures.mod": "Ctrl/⌘",
  "gestures.shift": "Shift",
  "gestures.on.close": "the × shown on hover",
  "gestures.input.left": "Click",
  "gestures.input.right": "Right-click",
  "gestures.input.middle": "Middle-click",
  "gestures.input.drag": "Drag",
  "gestures.input.longPress": "Long-press",

  "gestures.agent.title": "{{Agents}}",
  "gestures.agent.where": "In the sidebar, the tray and ⌘K",
  "gestures.agent.click": "Its own workspace; the current one stays in the tray",
  "gestures.agent.beside": "Open beside; when full, pick a column to replace",
  "gestures.agent.drag": "Drop on a column to replace it",
  "gestures.agent.menu": "Open its menu",

  "gestures.group.title": "Groups in the tray",
  "gestures.group.where": "Several avatars joined in one capsule in the tray",
  "gestures.group.click": "Bring the group back; if on screen, go to that column",
  "gestures.group.beside": "Open the clicked one beside",
  "gestures.group.menu": "Menu: split a member out, unpin",
  "gestures.group.close": "Close its columns, remove from the tray",

  "gestures.page.title": "Page entries",
  "gestures.page.where": "Delegations, approvals and the other entries in the window bar",
  "gestures.page.click": "Open in place",
  "gestures.page.beside": "Open beside: the other {{shelf}}, or a new page",
  "gestures.page.menu": "Pin to the window bar / unpin",

  "gestures.launcher.title": "Launchers, files, tools",
  "gestures.launcher.where": "The launcher bar, the file tree and files in messages",
  "gestures.launcher.click": "Open, reusing the preview tab",
  "gestures.launcher.background": "New kept tab in the background",
  "gestures.launcher.shown": "New kept tab, switched to",
  "gestures.launcher.menu": "Open its menu",

  "gestures.tab.title": "Tabs",
  "gestures.tab.where": "Tabs at the top of a {{shelf}}",
  "gestures.tab.click": "Switch to it",
  "gestures.tab.close": "Close; unsaved work asks first",
  "gestures.tab.drag": "Move to another {{shelf}}, or to empty space for a new one",
  "gestures.tab.menu": "Open its menu",

  "gestures.strip.title": "‹ / › in a column header",
  "gestures.strip.where": "On the outer side of the header when two conversations are side by side",
  "gestures.strip.click": "Fold to a strip",
  "gestures.strip.hold": "{{shelf}} only",
  "gestures.strip.menu": "Menu: {{shelf}} only, conversation only, restore",

  "gestures.desktop.title": "Desktop",
  "gestures.desktop.where": "Desktop in the sidebar; the window bar has the same button",
  "gestures.desktop.click": "Show the desktop; again to restore",
};
