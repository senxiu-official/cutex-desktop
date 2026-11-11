import { create } from "zustand";
import type { CopySource, CopyState } from "../../../shared/remoteCopies";
import type { CopyRequest, DownloadFolder, PreparedCopy } from "../../../shared/remoteCopyRequests";
import type { ArtifactScope, ArtifactVersion } from "../../../shared/artifactStore";
import type { WorkspaceScope } from "../../../shared/ipc";
import type { HostBinding } from "../../../shared/hosts";
import { bridge } from "../bridge";
import { translate } from "../i18n";
import { featuresOf, useApp } from "../store";
import { openSide } from "./sideOpen";

export const COPIES = "remote-copies.list";
export const COPY_FEATURE = "fs-file-transfer-v1";
export const ARTIFACTS_FEATURE = "artifacts";
export const useCopies = create<{ state: CopyState | null; folder: DownloadFolder | null; pending: (PreparedCopy & { binding: HostBinding; replaceId?: string }) | null; busy: boolean; starting: boolean; error: string | null }>(() => ({ state: null, folder: null, pending: null, busy: false, starting: false, error: null }));
export async function copyCall<T = CopyState>(request: CopyRequest): Promise<T> {
  if (!bridge.shell?.remoteCopies) throw new Error("copy manager unavailable");
  return bridge.shell.remoteCopies<T>(request);
}
export function canDownload(hostId: string): boolean {
  const app = useApp.getState();
  if (!app.features || !app.byHost) return false;
  return app.hosts?.hosts.some(h => h.id === hostId && h.kind !== "local") === true && featuresOf(app, hostId).has(COPY_FEATURE);
}
/** A pinned artifact version can be saved from any host with the artifact store, this computer's included. */
export function canSaveArtifact(hostId: string): boolean {
  const app = useApp.getState();
  if (!app.features || !app.byHost) return false;
  return app.hosts?.hosts.some(h => h.id === hostId) === true && featuresOf(app, hostId).has(ARTIFACTS_FEATURE);
}
/** 保存到这台电脑: the version's exact bytes into the download folder (progress and errors on the 下载 page). */
export function saveArtifact(hostId: string, version: Pick<ArtifactVersion, "artifactId" | "version">, scope?: ArtifactScope) {
  return requestCopy(hostId, `${version.artifactId}@${version.version}`, scope ? { kind: scope.kind, id: scope.id } : undefined, { id: version.artifactId, version: version.version });
}
export function binding(hostId: string) {
  const host = useApp.getState().hosts?.hosts.find(h => h.id === hostId);
  return { hostId, epoch: host?.conn?.epoch ?? "" };
}
export async function refreshCopies() {
  try { useCopies.setState({ state: await copyCall({ kind: "list" }) }); }
  catch (error) { useCopies.setState({ error: String(error) }); }
}
export async function runCopyAction(request: CopyRequest) {
  try { await copyCall(request); await refreshCopies(); }
  catch (error) { useCopies.setState({ error: String(error) }); }
}
let intent = 0;
export async function requestCopy(hostId: string, path: string, scope?: WorkspaceScope, artifact?: CopySource["artifact"], replaceId?: string, savedSource?: CopySource) {
  const n = ++intent;
  openSide(COPIES, {}, { binding: { kind: "host", hostId } });
  useCopies.setState({ pending: null, error: null, busy: true });
  try {
    if (!(artifact ? canSaveArtifact(hostId) : canDownload(hostId))) throw new Error(translate(artifact ? "remote-copies.missingArtifacts" : "remote-copies.missingFeature"));
    const host = useApp.getState().hosts?.hosts.find(h => h.id === hostId);
    const source: CopySource = savedSource ?? { hostId, hostLabel: host?.label ?? hostId, hostIdentity: "", path, ...(scope ? { scope } : {}), ...(artifact ? { artifact } : {}) };
    const expectedBinding = binding(hostId);
    const prepared = await copyCall<PreparedCopy>({ kind: "inspect", source, binding: expectedBinding });
    if (n !== intent) return;
    if (savedSource && savedSource.hostIdentity !== prepared.source.hostIdentity) throw new Error(translate("remote-copies.offline"));
    useCopies.setState({ pending: { ...prepared, binding: expectedBinding, ...(replaceId ? { replaceId } : {}) }, busy: false });
    const state = useCopies.getState().state ?? await copyCall<CopyState>({ kind: "list" });
    if (n === intent && prepared.meta.size <= state.settings.largeFileBytes) await startPrepared();
  } catch (error) { if (n === intent) useCopies.setState({ error: String(error), busy: false }); }
}
export async function startPrepared() {
  const pending = useCopies.getState().pending;
  if (!pending || useCopies.getState().starting) return;
  useCopies.setState({ starting: true });
  try {
    await copyCall<string>({ kind: "start", source: pending.source, expected: { revision: pending.meta.revision, size: pending.meta.size }, binding: pending.binding, ...(pending.replaceId ? { replaceId: pending.replaceId } : {}) });
    if (useCopies.getState().pending === pending) useCopies.setState({ pending: null });
    await refreshCopies();
  } catch (error) { useCopies.setState({ error: String(error) }); }
  finally { useCopies.setState({ starting: false }); }
}
async function folderCall(kind: "folder" | "openFolder" | "chooseFolder" | "defaultFolder") {
  try {
    const folder = await copyCall<DownloadFolder | undefined>({ kind });
    if (folder) useCopies.setState({ folder, ...(kind === "folder" ? {} : { error: null }) });
    if (kind !== "folder" && kind !== "openFolder") await refreshCopies();
  } catch (error) { useCopies.setState({ error: String(error) }); }
}
export const refreshDownloadFolder = () => folderCall("folder");
export const openDownloadFolder = () => folderCall("openFolder");
/** Main's own folder dialog; the downloads move there (nothing may be downloading). */
export const chooseDownloadFolder = () => folderCall("chooseFolder");
export const defaultDownloadFolder = () => folderCall("defaultFolder");
export function dismissCopy() { ++intent; useCopies.setState({ pending: null, busy: false }); }
