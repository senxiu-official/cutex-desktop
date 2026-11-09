// Conversation search: native `thread/searchOccurrences` of the open agent's own thread (cutex
// `thread-search-occurrences`; Codex natives 0.160+, Claude adapters with `threadSearch`).
import { Search } from "lucide-react";
import { setGutterPopover } from "../../lib/gutterStore";
import { matchesCommand } from "../../lib/keybindings";
import { useApp } from "../../store";
import { defineModule, type ModuleContext } from "../slots";
import { SEARCH_GUTTER_ID, THREAD_SEARCH_CAPABILITY } from "./model";
import { SearchGutter, SearchTrigger } from "./SearchGutter";
import { onEveryAppWindow } from "../../lib/appWindowSet";

/** The search key (lib/keybindings `threadSearch`, default Ctrl+F / ⌘F) in the conversation opens the search (Settings keeps its own). */
function activate(context: ModuleContext): void {
  if (typeof window === "undefined") return;
  // In every app window: the search of the conversation in the window the key was pressed in (multi-window).
  const stop = onEveryAppWindow((win) => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !matchesCommand("threadSearch", e)) return;
      if (useApp.getState().view.kind !== "conversation") return;
      const trigger = win.document.querySelector<HTMLElement>(`[data-gutter-trigger="${SEARCH_GUTTER_ID}"]`);
      if (!trigger) return;
      e.preventDefault();
      setGutterPopover(SEARCH_GUTTER_ID, trigger);
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  });
  context.signal.addEventListener("abort", stop, { once: true });
}

export default defineModule({
  id: "thread-search",
  titleKey: "thread-search.title",
  descriptionKey: "thread-search.description",
  requires: { capabilities: [THREAD_SEARCH_CAPABILITY] },
  contributes: {
    "conversation.gutter": [
      { id: SEARCH_GUTTER_ID, side: "left", anchor: "top", order: 90, titleKey: "thread-search.title", icon: Search, agentFeature: "threadSearch", Trigger: SearchTrigger, Body: SearchGutter },
    ],
  },
  activate,
});
