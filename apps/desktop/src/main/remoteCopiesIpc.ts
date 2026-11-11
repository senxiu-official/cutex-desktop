import type { HostManager } from "./hosts";
import { admitHostBinding } from "./hostFence";
import { RemoteCopyManager } from "./remoteCopies";
import { localFileAction } from "./localFiles";
import { canOpenCopy, type CopyRequest } from "../shared/remoteCopyRequests";
import type { CopySource } from "../shared/remoteCopies";
import { copyStore, defaultDownloadRoot, readDownloadRoot, removeOldStore, targetRoot, writeDownloadRoot } from "./downloadFolder";

type Shell = Parameters<typeof localFileAction>[3];

/** Downloads to this computer: files from remote hosts, and pinned artifact versions from any host (the local one too). */
export function createRemoteCopies(userData: string, getHosts: () => HostManager | null, shell: Shell, pickFolder: () => Promise<string | null> = async () => null) {
  const connect = (source: CopySource) => {
    const hosts = getHosts(), conn = hosts?.connection(source.hostId);
    const host = hosts?.state().hosts.find(h => h.id === source.hostId);
    const identity = conn?.daemon.currentState;
    if (!conn || !host || (host.kind === "local" && !source.artifact) || identity?.kind !== "connected" || source.hostIdentity !== identity.hostId) throw new Error("source host unavailable or changed");
    const generation = conn.daemon.generation;
    const check = () => {
      if (getHosts()?.connection(source.hostId) !== conn || conn.daemon.generation !== generation || conn.daemon.currentState.kind !== "connected") throw new Error("source connection changed");
    };
    return conn.daemon.copyTransport(source, check);
  };
  let root = "";
  let manager: RemoteCopyManager | null = null;
  const open = async (at: string) => {
    const next = new RemoteCopyManager({ root: at, transport: connect });
    await next.cleanup();
    root = at;
    manager = next;
  };
  let ready = readDownloadRoot(userData).then(open);
  void ready.catch(() => {}); // Startup errors are surfaced by the next owner request.
  const current = async () => {
    await ready;
    if (!manager) throw new Error("downloads unavailable");
    return manager;
  };
  /** Move the store to the folder the owner picked (or back to the default); nothing may be downloading. */
  const move = async (picked: string) => {
    // Runs as `ready` (requests wait for it): the open manager directly, never `current()`.
    const from = root, old = manager;
    if (!old) throw new Error("downloads unavailable");
    if ((await old.list()).copies.some(c => c.status === "downloading")) throw new Error("wait for the downloads to finish, or cancel them, before moving the folder");
    const to = targetRoot(picked, from, userData);
    if (to === from) return;
    await old.dispose();
    manager = null;
    try {
      await copyStore(from, to);
      await open(to);
      await writeDownloadRoot(userData, to);
    } catch (e) {
      await open(from); // the old store is untouched until the new one is in use
      throw e;
    }
    await removeOldStore(from).catch(() => {}); // a leftover old folder loses nothing
  };
  const folder = () => ({ path: root, isDefault: root === defaultDownloadRoot(userData) });
  return {
    async request(request: CopyRequest) {
      if (!request || typeof request !== "object") throw new Error("invalid copy request");
      const manager = await current();
      switch (request.kind) {
        case "list": return manager.list();
        case "settings": return manager.settings({ retentionDays: request.retentionDays });
        case "folder": return folder();
        case "openFolder": {
          const error = await shell.openPath(root);
          if (error) throw new Error(error);
          return;
        }
        case "chooseFolder":
        case "defaultFolder": {
          const picked = request.kind === "defaultFolder" ? defaultDownloadRoot(userData) : await pickFolder();
          if (!picked) return folder();
          const step = ready.then(() => move(picked));
          ready = step.catch(() => {});
          await step;
          return folder();
        }
        case "inspect":
        case "start": {
          const fence = admitHostBinding(getHosts, request.binding);
          if (request.source?.hostId !== request.binding.hostId) throw new Error("copy host mismatch");
          const conn = getHosts()?.connection(request.binding.hostId);
          const state = conn?.daemon.currentState;
          const host = getHosts()?.state().hosts.find(h => h.id === request.binding.hostId);
          const raw = request.source;
          // The local host's files are already here; only a pinned artifact version is saved from it.
          if (!host || (host.kind === "local" && !raw?.artifact) || state?.kind !== "connected") throw new Error("source host unavailable");
          if (typeof raw.path !== "string" || raw.path.length > 32768 || /[\0\r\n]/.test(raw.path)) throw new Error("invalid source path");
          if (raw.scope && (!["session", "project"].includes(raw.scope.kind) || typeof raw.scope.id !== "string" || !raw.scope.id || raw.scope.id.length > 160)) throw new Error("invalid workspace scope");
          if ((request.kind === "start" || raw.hostIdentity) && raw.hostIdentity !== state.hostId) throw new Error("source identity changed; inspect again");
          const source: CopySource = { hostId: host.id, hostLabel: host.label, hostIdentity: state.hostId, path: raw.path, ...(raw.scope ? { scope: { kind: raw.scope.kind, id: raw.scope.id } } : {}), ...(raw.artifact ? { artifact: { id: raw.artifact.id, version: raw.artifact.version } } : {}) };
          if (request.kind === "inspect") {
            const meta = await manager.inspect(source); fence.check(); return { source, meta };
          }
          if (request.replaceId) {
            const old = (await manager.list()).copies.find(c => c.id === request.replaceId);
            if (!old || JSON.stringify({ ...old.source, hostLabel: "" }) !== JSON.stringify({ ...source, hostLabel: "" })) throw new Error("refresh source must match the original copy");
          }
          fence.check();
          return manager.start(source, request.expected, request.replaceId);
        }
        case "cancel": return manager.cancel(request.id);
        case "keep": return manager.keep(request.id, request.value);
        case "remove": return manager.remove(request.id);
        case "open":
        case "reveal": {
          const path = await manager.file(request.id);
          if (request.kind === "open" && !canOpenCopy(path)) throw new Error("executable files and scripts cannot be opened; use show in folder");
          return localFileAction("local", path, request.kind === "open" ? "open" : "reveal", shell);
        }
        default: throw new Error("unknown copy operation");
      }
    },
    async dispose() { await (await current().catch(() => null))?.dispose().catch(() => {}); },
  };
}
