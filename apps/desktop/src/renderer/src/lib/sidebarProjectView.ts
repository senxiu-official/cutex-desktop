// The sidebar project header's 「Project 视图」 button (owner 2026-10-21, sidebar density): the
// project-view pane for that project, opened through the pane service by its kind id (the shell never
// imports a module's code). The button shows only while a module contributes that pane kind.
import { translate } from "../i18n";
import { services } from "../modules/app";
import { useSlot } from "../modules/react";

/** The Project 视图 pane kind (modules/project-view `KIND`); params `{ hostId, projectId }`. */
export const PROJECT_VIEW_KIND = "project-view.view";

/** Whether the Project 视图 pane kind is available (its module enabled and not gated off). */
export function useProjectViewAvailable(): boolean {
  return useSlot("pane.kind").some((e) => e.item.id === PROJECT_VIEW_KIND && e.mode === "show");
}

/** Opens (or focuses) the Project 视图 pane of `projectId` on `hostId`; a notice when it cannot. */
export function openProjectViewPane(hostId: string, projectId: string): void {
  const r = services.panes.open(PROJECT_VIEW_KIND, { hostId, projectId }, { focus: true });
  if (r.status === "unavailable") services.ui.notice(translate("sidebar.projectViewFailed", { reason: r.reason }), "error");
}
