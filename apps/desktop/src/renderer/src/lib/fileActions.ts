import { bridge } from "../bridge";
import { translate, type MessageKey } from "../i18n";
import { useApp } from "../store";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { canOpenFileName, isAbsoluteFilePath } from "../../../shared/localFiles";
import type { MenuEntry } from "./contextMenu";
import type { WorkspaceScope } from "../../../shared/ipc";
import { scopeFor, rootFor } from "./workspace";
import { agentHost, sidebarOf } from "../store";
import { canDownload, requestCopy } from "./remoteCopies";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
export interface FileActionOptions {
  hostId: string;
  path: string;
  isDir?: boolean;
  download?: () => Promise<void> | void;
  copyLabel?: string;
  open?: boolean;
  /** Only for paths returned by this desktop's own file picker. */
  knownLocal?: boolean;
  scope?: WorkspaceScope;
  artifact?: { id: string; version: number };
}

export function downloadFileAction(opts: FileActionOptions, t: T): MenuEntry {
  const app = useApp.getState(), host = app.hosts?.hosts.find(h => h.id === opts.hostId);
  if (!host || host.kind === "local" || opts.isDir || opts.knownLocal) return false;
  const supported = canDownload(opts.hostId);
  if (!supported) return false;
  return { label: t("menu.downloadToLocal"), disabled: !supported, title: supported ? undefined : t("remote-copies.missingFeature"), onSelect: () => {
    const scope = opts.scope ?? (agentHost(app) === opts.hostId ? scopeFor(sidebarOf(app, opts.hostId), app.selectedId) : null);
    const root = scope ? rootFor(sidebarOf(app, opts.hostId), scope) : null;
    const normalPath = opts.path.replace(/\\/g, "/"), normalRoot = root?.replace(/\\/g, "/").replace(/\/+$/, "");
    const relative = scope && normalRoot && normalPath.startsWith(`${normalRoot}/`) ? normalPath.slice(normalRoot.length + 1) : null;
    return requestCopy(opts.hostId, relative ?? opts.path, opts.scope ?? (relative !== null ? scope ?? undefined : undefined), opts.artifact);
  } };
}

/** A matching path on this computer never makes a remote host local. */
export function canRevealLocal({ hostId, path, knownLocal }: Pick<FileActionOptions, "hostId" | "path" | "knownLocal">): boolean {
  return hostId === LOCAL_HOST_ID && (knownLocal === true || useApp.getState().hosts?.hosts.some((host) => host.id === hostId && host.kind === "local") === true) && isAbsoluteFilePath(path);
}

export function revealFileLabel(t: T = translate): string {
  return t(bridge.platform === "win32" ? "menu.revealExplorer" : bridge.platform === "darwin" ? "menu.revealFinder" : "menu.revealFileManager");
}

export async function performFilePathAction(hostId: string, path: string, action: "copy" | "reveal" | "open", knownLocal = false): Promise<void> {
  if (action === "copy") { await navigator.clipboard.writeText(path); return; }
  if (!canRevealLocal({ hostId, path, knownLocal })) throw new Error("this file is not on this machine");
  if (!bridge.shell?.filePath) throw new Error("local file actions are unavailable");
  await bridge.shell.filePath(hostId, path, action);
}

export function fileActions(opts: FileActionOptions, t: T): MenuEntry[] {
  const host = useApp.getState().hosts?.hosts.find((host) => host.id === opts.hostId);
  const local = canRevealLocal(opts);
  const label = opts.copyLabel ?? t("menu.copyPath");
  return [
    { label: local || host?.kind === "local" ? label : `${label} · ${host?.label ?? opts.hostId}`, onSelect: () => performFilePathAction(opts.hostId, opts.path, "copy") },
    local && { label: revealFileLabel(t), onSelect: () => performFilePathAction(opts.hostId, opts.path, "reveal", opts.knownLocal) },
    local && opts.open && !opts.isDir && canOpenFileName(opts.path) && {
      label: t("menu.openFile"),
      available: async () => {
        if (!canRevealLocal(opts) || !bridge.shell?.filePathInfo) return false;
        const result = await bridge.shell.filePathInfo(opts.hostId, opts.path);
        return result.canOpen && canRevealLocal(opts);
      },
      onSelect: () => performFilePathAction(opts.hostId, opts.path, "open", opts.knownLocal),
    },
    opts.download ? { label: t("menu.downloadToLocal"), onSelect: opts.download } : downloadFileAction(opts, t),
  ];
}
