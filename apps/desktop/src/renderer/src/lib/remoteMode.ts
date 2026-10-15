// Remote-host behaviour (the target host is not this machine): folders are picked with the in-app
// browser over the daemon (fs-dir-browse) — a native dialog would show this machine's disk — and
// picked image files are uploaded by main on send (session-attachments). Older remote cutex builds
// without those features degrade to typing paths / pasting images. The target host is the page's
// (lib/targetHost: a create form's chosen host, Settings' host), else the focus host.
import { LOCAL_HOST_ID, REMOTE_FEATURES } from "../../../shared/hosts";
import { apiFor } from "../bridge";
import { featuresOf, useApp } from "../store";
import { folderDialog } from "./contextMenu";
import { useTargetFeatures, useTargetHostId } from "./targetHost";

/** null = cancelled. `hostId` = whose disk (default: the focus host). */
export async function pickDirectory(defaultPath?: string | null, hostId?: string): Promise<string | null> {
  const host = hostId ?? useApp.getState().hosts?.active ?? LOCAL_HOST_ID;
  // A native dialog of this machine: the local host's connection, whichever host has the focus.
  if (host === LOCAL_HOST_ID) return apiFor(LOCAL_HOST_ID).pickFolder(defaultPath || undefined).catch(() => null);
  return folderDialog(defaultPath, host);
}

/**
 * Folder picking is unavailable: a remote cutex without fs-dir-browse (the path can still be typed).
 * Callers show `remote.noDirBrowse`.
 */
export function useFolderPickBlocked(): boolean {
  const remote = useTargetHostId() !== LOCAL_HOST_ID;
  const browse = useTargetFeatures().has(REMOTE_FEATURES.dirBrowse);
  return remote && !browse;
}

/**
 * Picking image files is unavailable: a remote cutex without session-attachments (pasted / dropped
 * images still go inline as data URLs). Callers show `remote.noAttachments`. `hostId`: the host the
 * images go to (a composer's: the open agent's), default the page's target host.
 */
export function useImagePickBlocked(hostId?: string): boolean {
  const target = useTargetHostId();
  const host = hostId ?? target;
  const upload = useApp((s) => featuresOf(s, host).has(REMOTE_FEATURES.attachments));
  return host !== LOCAL_HOST_ID && !upload;
}
