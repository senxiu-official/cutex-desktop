// ⌘K quick switcher (docs/research/canvas-principles-20261020.md §3: an entry that never depends on any
// pane; prototype .claude/preview-shelves.html scenario D). Ctrl+K / ⌘K anywhere: search agents, services,
// artifacts, pages and Shelf pages of every host in the view scope; Enter opens in place, Ctrl/⌘+Enter
// beside. Locked on (a fallback must not be switched off). The palette is its own overlay (live.ts); its one
// slot item is the window bar's search field (contract 1.19 `window.search`, owner 2026-10-21 header split),
// a click opens the palette. Shelf pages come from the Shelves' read API (lib/shelves, shelfPages.ts).
import { bindingLabel } from "../../lib/keybindings";
import { defineModule } from "../slots";
import { openQuickSwitch, startQuickSwitch } from "./live";

export default defineModule({
  id: "quick-switch",
  titleKey: "quick-switch.title",
  descriptionKey: "quick-switch.description",
  required: true,
  contributes: {
    "window.search": [{ id: "quick-switch.search", placeholderKey: "quick-switch.placeholder", keys: () => bindingLabel("quickSwitch"), open: () => openQuickSwitch() }],
  },
  activate: (ctx) => startQuickSwitch(ctx),
});
