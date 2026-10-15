// Notification levels of the Settings target host (review 2026-10-15 UI-02). The focus host's tables
// live in lib/notificationLevelsStore (the title-bar bell, the project menu and the runtime read
// them); another host's are read and patched here, on that host's connection only. Every write goes
// to `hostId` — never to the focus host in its place.
import { useEffect, useState } from "react";
import { INDEPENDENT_PROJECT, projectMutedIn, type NotificationLevelsPatch, type NotificationLevelsView } from "../../../../shared/notificationLevels";
import { patchNotificationLevels, useNotificationLevels } from "../../lib/notificationLevelsStore";
import { daemonApiOf } from "../../lib/targetHost";

/** PATCH the tables of `hostId` (`focus`: the focus host id). Resolves with the answered view. */
export function patchHostNotificationLevels(hostId: string, focus: string, patch: NotificationLevelsPatch): Promise<NotificationLevelsView> {
  return hostId === focus ? patchNotificationLevels(patch) : daemonApiOf(hostId, focus).patchNotificationLevels(patch);
}

/** The patch that flips one project's mute in `view`. */
export function projectMutePatch(view: NotificationLevelsView | null, groupId: string | null | undefined): NotificationLevelsPatch {
  const id = groupId ?? INDEPENDENT_PROJECT;
  return { projectOverrides: { [id]: projectMutedIn(view, id) ? null : "mute" } };
}

export interface TargetLevels {
  view: NotificationLevelsView | null;
  error: string | null;
  /** PATCH the target host's tables (errors are kept in `error` and re-thrown). */
  patch(patch: NotificationLevelsPatch): Promise<NotificationLevelsView>;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The tables of `hostId` (`supported`: it has notification-levels). */
export function useHostNotificationLevels(hostId: string, focus: string, supported: boolean): TargetLevels {
  const store = useNotificationLevels();
  const isFocus = hostId === focus;
  const [own, setOwn] = useState<{ hostId: string; view: NotificationLevelsView | null; error: string | null }>({ hostId, view: null, error: null });
  useEffect(() => {
    if (isFocus || !supported) return;
    let live = true;
    setOwn({ hostId, view: null, error: null });
    daemonApiOf(hostId, focus)
      .notificationLevels()
      .then(
        (view) => live && setOwn({ hostId, view, error: null }),
        (e: unknown) => live && setOwn((s) => ({ ...s, hostId, error: errorText(e) })),
      );
    return () => {
      live = false;
    };
  }, [hostId, focus, isFocus, supported]);
  if (isFocus) return { view: store.view, error: store.error, patch: (p) => patchNotificationLevels(p) };
  const mine = own.hostId === hostId ? own : { view: null, error: null };
  return {
    view: mine.view,
    error: mine.error,
    patch: async (p) => {
      try {
        const view = await patchHostNotificationLevels(hostId, focus, p);
        setOwn({ hostId, view, error: null });
        return view;
      } catch (e) {
        setOwn((s) => ({ ...s, hostId, error: errorText(e) }));
        throw e;
      }
    },
  };
}
