// Store / module-host side of lib/projectTabs.ts: the 项目 page's tabs for a project on one host.
import { useMemo } from "react";
import { appModules } from "../modules/app";
import { useSlot } from "../modules/react";
import { entryGateNow, useHostEntryGate } from "./hostGatingView";
import { mergeProjectTabs, type ProjectTabEntry, type ProjectTabSlot } from "./projectTabs";

/** Hook: the 项目 page's tabs for a project on `hostId`. */
export function useProjectTabs(hostId: string): ProjectTabSlot[] {
  const entries = useSlot("project.tab");
  const onHost = useHostEntryGate(hostId);
  return useMemo(() => mergeProjectTabs(entries.filter((e) => e.mode === "show" && onHost(e))), [entries, onHost]);
}

/** Non-React (menus): the same tabs for a project on `hostId` now. */
export function projectTabsNow(hostId: string): ProjectTabSlot[] {
  let entries: readonly ProjectTabEntry[];
  try {
    entries = appModules().snapshot("project.tab");
  } catch {
    entries = [];
  }
  return mergeProjectTabs(entries.filter((e) => e.mode === "show" && entryGateNow(hostId, e).ok));
}
