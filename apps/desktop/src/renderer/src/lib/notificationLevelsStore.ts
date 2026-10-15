// The connected host's notification levels (cutex `GET|PATCH /v2/notification-levels`, capability
// `notification-levels`): both tables, presets, events and the project mutes. Loaded by the core
// `notifications` module when it activates on a host with the capability (reset otherwise), patched
// from Settings → 通知 and the project mute toggles (title bar bell, project menu). Without the
// capability there are no project mutes (`supported` false: the toggles hide).
import { create } from "zustand";
import { INDEPENDENT_PROJECT, projectMutedIn, type NotificationLevelsPatch, type NotificationLevelsView } from "../../../shared/notificationLevels";
import { api } from "../bridge";

export interface NotificationLevelsState {
  /** The host has `notification-levels`. */
  supported: boolean;
  view: NotificationLevelsView | null;
  error: string | null;
}

export const useNotificationLevels = create<NotificationLevelsState>(() => ({ supported: false, view: null, error: null }));

let generation = 0;

/** Host changed / module stopped: forget the old host's tables. */
export function resetNotificationLevels(supported: boolean): void {
  generation++;
  useNotificationLevels.setState({ supported, view: null, error: null });
}

export async function refreshNotificationLevels(): Promise<NotificationLevelsView | null> {
  if (!useNotificationLevels.getState().supported) return null;
  const gen = generation;
  try {
    const view = await api.notificationLevels();
    if (gen === generation) useNotificationLevels.setState({ view, error: null });
    return view;
  } catch (error) {
    if (gen === generation) useNotificationLevels.setState({ error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** PATCH and take the answered view; errors are kept for the page (and re-thrown). */
export async function patchNotificationLevels(patch: NotificationLevelsPatch): Promise<NotificationLevelsView> {
  const gen = generation;
  try {
    const view = await api.patchNotificationLevels(patch);
    if (gen === generation) useNotificationLevels.setState({ view, error: null });
    return view;
  } catch (error) {
    if (gen === generation) useNotificationLevels.setState({ error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** Sidebar group id (project id or "__independent__") muted on the host. */
export function projectMuted(groupId: string | null | undefined): boolean {
  return projectMutedIn(useNotificationLevels.getState().view, groupId);
}

export function useProjectMuted(groupId: string | null | undefined): boolean {
  return useNotificationLevels((s) => projectMutedIn(s.view, groupId));
}

/** Project mutes are available (host capability + view loaded). */
export function useProjectMuteSupported(): boolean {
  return useNotificationLevels((s) => s.supported && s.view !== null);
}

export function projectMuteSupported(): boolean {
  const s = useNotificationLevels.getState();
  return s.supported && s.view !== null;
}

/** Mute / unmute a project (or the independent agents) on the host. */
export function toggleProjectMuted(groupId: string | null | undefined): void {
  const id = groupId ?? INDEPENDENT_PROJECT;
  void patchNotificationLevels({ projectOverrides: { [id]: projectMuted(id) ? null : "mute" } }).catch(() => {});
}
