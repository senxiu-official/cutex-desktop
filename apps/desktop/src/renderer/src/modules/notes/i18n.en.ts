// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "notes.title": "Notes", "notes.description": "Keep independent notes beside their source turns, outside the main chat.", "notes.list": "All notes", "notes.note": "Note",
  "notes.conversation": "Conversation notes", "notes.browseAll": "View all", "notes.backToConversation": "Back to conversation notes", "notes.closeList": "Close notes list", "notes.projectSelected": "Project notes (in or pinned to this project)",
  "notes.new": "New note", "notes.addToTurn": "Add a note to this turn", "notes.addAnother": "This turn has notes · add another", "notes.edit": "Edit note", "notes.delete": "Delete note", "notes.deleteConfirm": "Delete this note?",
  "notes.floating": "Note window", "notes.closeFloat": "Close note window", "notes.viewFloat": "View {n} notes in a floating window", "notes.floatHint": "No conversation space used · Closing keeps drafts · Esc to close",
  "notes.titleField": "Title", "notes.bodyField": "Body (Markdown)", "notes.save": "Save", "notes.saving": "Saving…", "notes.cancel": "Cancel", "notes.untitled": "Untitled note",
  "notes.pins": "Also show in", "notes.pinHint": "Only adds a shortcut; the note stays in its own scope", "notes.pinSession": "This {{agent}}’s notes", "notes.pinHost": "Host notes",
  "notes.chooseProject": "Choose project", "notes.pin": "Pin", "notes.unpin": "Unpin", "notes.pinned": "Pinned", "notes.all": "All", "notes.pinnedOnly": "Pinned only",
  "notes.scope.session": "{{agent}}", "notes.scope.project": "Project", "notes.scope.host": "Host", "notes.chooseSession": "Choose {{agent}}",
  "notes.conflict": "This note changed elsewhere. Your draft is preserved.", "notes.latestVersion": "View latest saved version", "notes.useLatestRevision": "Reviewed: overwrite the latest version with my draft", "notes.conflictHint": "You can retry. Review the latest version first if there is a conflict.",
  "notes.source": "Jump to source", "notes.peekSource": "Peek at source", "notes.sourceSession": "Source {{agent}}", "notes.reverted": "The source turn was reverted. This note is kept.", "notes.sessionDeleted": "The source {{agent}} was deleted. This note is kept.", "notes.sourceUnknown": "Source history is not loaded yet. Peek or jump to find it.",
  "notes.quote": "Quote in input", "notes.quoteHint": "Append to the current {{agent}}’s draft only; do not send.", "notes.quoteUnavailable": "Select an {{agent}} on this note’s host to quote it.",
  "notes.savedAt": "Updated {time}", "notes.openRight": "Open on the right", "notes.expand": "Expand {n} notes", "notes.collapse": "Collapse notes", "notes.empty": "No notes here yet.", "notes.emptyHint": "Use “Add a note to this turn” in a reply's action bar, or “New note” above.", "notes.search": "Search notes", "notes.refresh": "Refresh", "notes.more": "Load more", "notes.loading": "Loading…", "notes.noContext": "Notes stay outside the main chat context by default.", "notes.missing": "This note does not exist or was deleted.", "notes.unsupportedHost": "This host's cutex does not support notes yet (needs r226 or newer).",
  "notes.settings": "Notes", "notes.showTimeline": "Show notes in the timeline", "notes.showTimelineHint": "Shown as a compact entry; click to view in a floating window. Notes are kept when this is off",
};
