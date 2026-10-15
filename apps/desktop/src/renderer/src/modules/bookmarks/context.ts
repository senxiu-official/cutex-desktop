import { agentHost, sidebarOf, useApp } from "../../store";
import type { CutexRef } from "../slots";
import type { BookmarkScope } from "./model";

export function bookmarkProject(hostId: string, sessionId: string): string | undefined {
  const s = useApp.getState();
  return sidebarOf(s, hostId)?.hostRows[sessionId]?.projectId ?? undefined;
}
/** Captured once on save. Merely finding the source's project never opts it into project navigation. */
export function bookmarkContext(ref: CutexRef): BookmarkScope {
  const s = useApp.getState();
  const sessionId = ref.params.sessionId ?? (agentHost(s) === ref.hostId ? s.selectedId : undefined) ?? undefined;
  const projectId = sessionId ? bookmarkProject(ref.hostId, sessionId) : undefined;
  return { ...(sessionId ? { sessionId } : {}), ...(projectId ? { projectId } : {}), projectExplicit: false };
}
