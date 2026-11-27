// Opening an assistant's conversation with its 今日 (the title-bar button and the popover; loaded on first use, so the
// module's eager part stays small).
import { openHostAgent } from "../../lib/hostLists";
import { usePa } from "../../lib/personalAssistantStore";
import { useApp } from "../../store";
import type { PaAssistant } from "../../../../shared/personalAssistants";
import { services } from "../app";
import { defaultRow, getDefaultAssistant } from "./defaultAssistant";
import { allAssistants, BAND_QUERY, TODAY_KIND } from "./todayModel";

export function hostLabel(hostId: string): string {
  return useApp.getState().hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId;
}

const bandWindowNow = () => typeof window !== "undefined" && !!window.matchMedia?.(BAND_QUERY).matches;

/** Open an assistant's conversation with its 今日 beside it (wide windows; a narrow one shows the band). */
export async function openAssistant(hostId: string, assistant: PaAssistant): Promise<void> {
  if (!assistant.sessionId) {
    services.ui.openPage("personal-assistants.page", { host: hostId, id: assistant.id });
    return;
  }
  await openHostAgent(hostId, assistant.sessionId);
  if (bandWindowNow()) return;
  // A context-following project view already turns into 今日 for an assistant (ProjectView); else open one.
  if (!services.side.list("project-view.view").length && !services.side.list(TODAY_KIND).length) services.panes.open(TODAY_KIND, {}, { focus: false });
}

/** The title-bar button: the default assistant's conversation; with none yet, the 个人助理 page to create one. */
export function openDefaultAssistant(): void {
  const d = defaultRow(allAssistants(usePa.getState().byHost), getDefaultAssistant());
  if (!d) services.ui.openPage("personal-assistants.page", {});
  else void openAssistant(d.hostId, d.assistant);
}
