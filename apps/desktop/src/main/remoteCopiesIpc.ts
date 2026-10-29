import { join } from "node:path";
import type { HostManager } from "./hosts";
import { admitHostBinding } from "./hostFence";
import { RemoteCopyManager } from "./remoteCopies";
import { localFileAction } from "./localFiles";
import { canOpenCopy, type CopyRequest } from "../shared/remoteCopyRequests";
import type { CopySource } from "../shared/remoteCopies";

export function createRemoteCopies(root: string, getHosts: () => HostManager | null, shell: Parameters<typeof localFileAction>[3]) {
  const connect = (source: CopySource) => {
    const hosts = getHosts(), conn = hosts?.connection(source.hostId);
    const host = hosts?.state().hosts.find(h => h.id === source.hostId);
    const identity = conn?.daemon.currentState;
    if (!conn || !host || host.kind === "local" || identity?.kind !== "connected" || source.hostIdentity !== identity.hostId) throw new Error("source host unavailable or changed");
    const generation = conn.daemon.generation;
    const check = () => {
      if (getHosts()?.connection(source.hostId) !== conn || conn.daemon.generation !== generation || conn.daemon.currentState.kind !== "connected") throw new Error("source connection changed");
    };
    return conn.daemon.copyTransport(source, check);
  };
  const manager = new RemoteCopyManager({ root: join(root, "remote-copies"), transport: connect });
  const ready = manager.cleanup();
  void ready.catch(() => {}); // Startup errors are surfaced by the next owner request.
  return {
    async request(request: CopyRequest) {
      await ready;
      if (!request || typeof request !== "object") throw new Error("invalid copy request");
      switch (request.kind) {
        case "list": return manager.list();
        case "settings": return manager.settings({ retentionDays: request.retentionDays });
        case "inspect":
        case "start": {
          const fence = admitHostBinding(getHosts, request.binding);
          if (request.source?.hostId !== request.binding.hostId) throw new Error("copy host mismatch");
          const conn = getHosts()?.connection(request.binding.hostId);
          const state = conn?.daemon.currentState;
          const host = getHosts()?.state().hosts.find(h => h.id === request.binding.hostId);
          if (!host || host.kind === "local" || state?.kind !== "connected") throw new Error("remote host unavailable");
          const raw = request.source;
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
    async dispose() { await manager.dispose().catch(() => {}); },
  };
}
