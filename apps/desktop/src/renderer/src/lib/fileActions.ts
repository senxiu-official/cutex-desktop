import { bridge } from "../bridge";
import { translate, type MessageKey } from "../i18n";
import { useApp } from "../store";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { fileNameType, isAbsoluteFilePath } from "../../../shared/localFiles";
import type { MenuAction, MenuEntry } from "./contextMenu";
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
  /** false: no 打开 / 运行… rows (default: offered for a local file, by its type). */
  open?: boolean;
  /** The app's own text view of the file: offered as 以文本打开 for a script (its system app could run it). */
  viewText?: () => void;
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

export async function performFilePathAction(hostId: string, path: string, action: "copy" | "reveal" | "open" | "run", knownLocal = false): Promise<void> {
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
    ...localOpenEntries(opts, t),
    opts.download ? { label: t("menu.downloadToLocal"), onSelect: opts.download } : downloadFileAction(opts, t),
  ];
}

/**
 * 打开 (its system app) for a local file, decided by its type (shared/localFiles.ts), not by the +x bit; main checks
 * the real target again. A script or program: 打开 shows disabled with the reason, 以文本打开 (scripts, the app's own
 * view) and 运行… — main asks first in its own native dialog naming the full path and type (main/localFileRunPrompt.ts).
 * A name with no known type is decided by main (on macOS / Linux an executable bit makes it a program).
 */
export function localOpenEntries(opts: FileActionOptions, t: T): MenuEntry[] {
  if (opts.open === false || opts.isDir || !canRevealLocal(opts)) return [];
  // One main lookup per menu (shared by its rows), never cached across menus.
  let info: Promise<{ canOpen: boolean; runnable?: "script" | "program" }> | null = null;
  const lookup = async () => {
    if (!canRevealLocal(opts) || !bridge.shell?.filePathInfo) return null;
    info ??= bridge.shell.filePathInfo(opts.hostId, opts.path);
    const result = await info.catch(() => null);
    return result && canRevealLocal(opts) ? result : null;
  };
  const label = t("menu.openFile");
  const refused = (kind: "script" | "program"): MenuAction => ({ label, disabled: true, info: t(kind === "script" ? "menu.openFileScript" : "menu.openFileProgram"), onSelect: () => {} });
  const run: MenuAction = { label: t("menu.runFile"), danger: true, info: t("menu.runFileHint"), available: async () => !!(await lookup())?.runnable, onSelect: () => performFilePathAction(opts.hostId, opts.path, "run", opts.knownLocal) };
  const type = fileNameType(opts.path);
  if (type === "script" || type === "program") {
    return [{ ...refused(type), available: async () => !!(await lookup())?.runnable }, type === "script" && opts.viewText && { label: t("menu.openAsText"), onSelect: opts.viewText }, run];
  }
  return [
    { label, available: async () => (await lookup())?.canOpen === true, onSelect: () => performFilePathAction(opts.hostId, opts.path, "open", opts.knownLocal) },
    // A name that says nothing (no suffix) main found to be a program: the same refusal and 运行….
    { ...refused("program"), available: async () => (await lookup())?.runnable === "program" },
    run,
  ];
}
