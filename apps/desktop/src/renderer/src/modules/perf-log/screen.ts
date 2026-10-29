// What was on screen when the UI stalled (性能记录, #27): read from the shell's stores only when an entry is
// written, never per frame.
import { useApp, viewOf } from "../../store";
import { usePanes } from "../../lib/paneStore";
import { conversationPanes, focusedConversation, paneBinding } from "../../lib/paneLayout";
import { useSide } from "../../lib/sideLayoutStore";
import type { ScreenReader } from "./recorder";

export const readScreen: ScreenReader = () => {
  const app = useApp.getState();
  const layout = usePanes.getState().layout;
  const name = (hostId: string, id: string) => app.sidebar?.active.find((r) => r.cutexSessionId === id)?.displayName ?? (hostId === (app.hosts?.active ?? hostId) ? id : `${id}@${hostId}`);
  const panes = conversationPanes(layout);
  const agents = panes.flatMap((p) => {
    const b = paneBinding(layout, p);
    return b?.sessionId ? [name(b.hostId, b.sessionId)] : [];
  });
  const focus = focusedConversation(layout);
  const bound = focus ? paneBinding(layout, focus) : null;
  const view = bound?.sessionId ? viewOf(app, bound.hostId, bound.sessionId) : undefined;
  // Tool panes on screen: the instances the layer shows (not hidden), by kind.
  const instances = useSide.getState().layout.instances;
  const tools = [...document.querySelectorAll<HTMLElement>("[data-side-instance]:not([aria-hidden])")].map((el) => instances[el.dataset.sideInstance ?? ""]?.kind ?? "?");
  return {
    view: app.view.kind === "page" ? app.view.page : "conversation",
    agents,
    workspaces: document.querySelectorAll("section.ws-col").length || (panes.length ? 1 : 0),
    tools,
    desktop: document.documentElement.dataset.deskState === "empty",
    turns: view ? view.timeline.turns.length : null,
    rows: view ? view.timeline.entries.size : null,
  };
};
