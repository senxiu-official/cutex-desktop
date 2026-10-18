// Conversation search: native `thread/searchOccurrences` of the open agent's own thread (cutex
// `thread-search-occurrences`; Codex natives 0.160+, Claude adapters with `threadSearch`).
import { Search } from "lucide-react";
import { setGutterPopover } from "../../lib/gutterStore";
import { useApp } from "../../store";
import { defineModule, type AppModuleContext } from "../slots";
import { SEARCH_GUTTER_ID, THREAD_SEARCH_CAPABILITY } from "./model";
import { SearchGutter, SearchTrigger } from "./SearchGutter";

/** Ctrl+F / ⌘F in the conversation opens the search (Settings keeps its own Ctrl+F). */
function activate(context: AppModuleContext): void {
  if (typeof window === "undefined") return;
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f" || e.defaultPrevented) return;
    if (useApp.getState().view.kind !== "conversation") return;
    const trigger = document.querySelector<HTMLElement>(`[data-gutter-trigger="${SEARCH_GUTTER_ID}"]`);
    if (!trigger) return;
    e.preventDefault();
    setGutterPopover(SEARCH_GUTTER_ID, trigger);
  };
  window.addEventListener("keydown", onKey);
  context.signal.addEventListener("abort", () => window.removeEventListener("keydown", onKey), { once: true });
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
