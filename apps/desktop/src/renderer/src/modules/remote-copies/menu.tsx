// One copy's actions, shared by the card buttons, the list row's hover buttons and its right-click / ⋯ menu so
// the three never diverge (same enabled rules, same armed confirm before deleting).
import { ExternalLink, FolderOpen, Pin, PinOff, RefreshCw, Server, Trash2, X } from "lucide-react";
import type { RemoteCopy } from "../../../../shared/remoteCopies";
import { canOpenCopy } from "../../../../shared/remoteCopyRequests";
import type { HostView } from "../../../../shared/hosts";
import type { MenuEntry } from "../../lib/contextMenu";
import { openSide } from "../../lib/sideOpen";
import { canDownload, requestCopy, runCopyAction } from "../../lib/remoteCopies";
import type { useI18n } from "../../i18n";

type T = ReturnType<typeof useI18n>["t"];

export interface CopyCaps {
  /** The copy is on this desktop (open / reveal / keep). */
  local: boolean;
  /** Its source host is connected to the same daemon (open original / download again). */
  remote: boolean;
  active: boolean;
  openable: boolean;
}

export function copyCaps(copy: RemoteCopy, host: Pick<HostView, "conn"> | undefined): CopyCaps {
  const connected = host?.conn?.daemon;
  const remote = canDownload(copy.source.hostId) && connected?.kind === "connected" && connected.hostId === copy.source.hostIdentity;
  const local = copy.status === "complete" || (!!copy.downloadedAt && copy.status !== "expired" && copy.status !== "missing");
  return { local, remote, active: copy.status === "downloading", openable: local && canOpenCopy(copy.name) };
}

export function openOriginal(copy: RemoteCopy): void {
  const binding = { kind: "host" as const, hostId: copy.source.hostId };
  if (copy.source.artifact) openSide("artifacts.view", { ref: `${copy.source.artifact.id}@${copy.source.artifact.version}` }, { binding });
  else openSide("workspace.preview", { path: copy.source.path, host: !copy.source.scope, ...(copy.source.scope ? { scope: { ...copy.source.scope } } : {}) }, { binding });
}

export const openCopy = (copy: RemoteCopy) => void runCopyAction({ kind: "open", id: copy.id });
export const revealCopy = (copy: RemoteCopy) => void runCopyAction({ kind: "reveal", id: copy.id });
export const cancelCopy = (copy: RemoteCopy) => void runCopyAction({ kind: "cancel", id: copy.id });
export const keepCopy = (copy: RemoteCopy) => void runCopyAction({ kind: "keep", id: copy.id, value: !copy.kept });
export const removeCopy = (copy: RemoteCopy) => void runCopyAction({ kind: "remove", id: copy.id });
export const downloadAgain = (copy: RemoteCopy) => void requestCopy(copy.source.hostId, copy.source.path, copy.source.scope, copy.source.artifact, copy.id, copy.source);

/** The list row's right-click / ⋯ menu: the card's buttons in the same order; delete is armed (click twice). */
export function copyMenu(copy: RemoteCopy, caps: CopyCaps, t: T): MenuEntry[] {
  const offline = !caps.remote ? t("remote-copies.offline") : undefined;
  return [
    { label: t("remote-copies.open"), icon: <ExternalLink size={14} />, disabled: !caps.openable, onSelect: () => openCopy(copy) },
    { label: t("remote-copies.reveal"), icon: <FolderOpen size={14} />, disabled: !caps.local, onSelect: () => revealCopy(copy) },
    "separator",
    { label: t("remote-copies.original"), icon: <Server size={14} />, disabled: !caps.remote, title: offline, onSelect: () => openOriginal(copy) },
    caps.active
      ? { label: t("remote-copies.cancel"), icon: <X size={14} />, onSelect: () => cancelCopy(copy) }
      : { label: t("remote-copies.refresh"), icon: <RefreshCw size={14} />, disabled: !caps.remote, title: offline, onSelect: () => downloadAgain(copy) },
    { label: t(copy.kept ? "remote-copies.unkeep" : "remote-copies.keep"), icon: copy.kept ? <PinOff size={14} /> : <Pin size={14} />, disabled: !caps.local, onSelect: () => keepCopy(copy) },
    "separator",
    { label: t("remote-copies.remove"), icon: <Trash2 size={14} />, danger: true, disabled: caps.active, armed: t("remote-copies.removeConfirm"), onSelect: () => removeCopy(copy) },
  ];
}
