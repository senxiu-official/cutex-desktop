import { createOpaqueFrame } from "@cutex-desktop/opaque-frame";
import { buildSandboxDocument } from "./document";
export { buildSandboxDocument } from "./document";
import { createBroker, type BrokerOptions } from "./broker";
export * from "./manifest";
export { createBroker, isJson } from "./broker";
export type { BrokerOptions, Json, Operation, Scope } from "./broker";

export type SandboxResource = {
  kind: "external-plugin";
  pluginId: string;
  html: string;
  script: string;
  requestedPermissions: readonly string[];
} | {
  /** Host-resolved ui:// content, not a network fetch or MCP protocol implementation. */
  kind: "mcp-app";
  uri: `ui://${string}`;
  html: string;
  script: string;
  requestedPermissions: readonly string[];
};
export interface MountOptions extends Omit<BrokerOptions, "instanceId" | "channel" | "requestedPermissions"> {
  resource: SandboxResource;
  title: string;
  handshakeTimeoutMs?: number;
  /** Electron uses a host-resolved document URL; late preparation is disposed after unmount. */
  documentFactory?(identity: { instanceId: string; channel: string }): Promise<{ url: string; dispose(): void }>;

}

/** Mount only pre-resolved text. The caller owns trusted broker implementations and grants. */
export function mountSandbox(container: HTMLElement, options: MountOptions) {
  const resource = options.resource;
  if (resource.kind === "mcp-app" && !/^ui:\/\/[^\s]+$/.test(resource.uri)) throw new Error("Invalid UI resource URI");
  if (resource.html.length + resource.script.length > 1_000_000) throw new Error("Resource too large");
  const instanceId = crypto.randomUUID();
  const channel = crypto.randomUUID();
  const challenge = crypto.randomUUID();
  // The shared opaque frame shape (sandbox allow-scripts, no same-origin, no device access).
  const iframe = createOpaqueFrame(options.title);
  let broker: ReturnType<typeof createBroker> | undefined;
  const revoked = new Set<string>();
  let disposed = false;
  let releaseDocument: (() => void) | undefined;
  let loads = 0;
  let timer: ReturnType<typeof setTimeout>;
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Prevent unhandled rejection when a caller disposes without awaiting readiness.
  void ready.catch(() => {});
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    window.removeEventListener("message", receive);
    try { broker?.dispose(); }
    finally {
      try { releaseDocument?.(); }
      finally { releaseDocument = undefined; iframe.remove(); rejectReady(new Error("disposed")); }
    }
  };
  const receive = (event: MessageEvent) => {
    const data = event.data;
    if (disposed || broker || event.source !== iframe.contentWindow || event.origin !== "null"
      || loads !== 1 || event.ports.length !== 1 || !data || data.version !== 1 || data.kind !== "ready" || data.instanceId !== instanceId || data.channel !== channel || data.challenge !== challenge
      || Object.keys(data).sort().join() !== "challenge,channel,instanceId,kind,version") return;
    broker = createBroker(event.ports[0]!, { ...options, requestedPermissions: resource.requestedPermissions, instanceId, channel });
    for (const permission of revoked) broker.revoke(permission);
    window.removeEventListener("message", receive);
    clearTimeout(timer);
    resolveReady();
  };
  window.addEventListener("message", receive);
  iframe.addEventListener("load", () => {
    if (++loads > 1) return dispose();
    // Never send a port on unsolicited pre-load ready. A document navigated
    // before the first load does not know the source bootstrap's private channel.
    iframe.contentWindow?.postMessage({ version: 1, kind: "probe", instanceId, challenge }, "*");
  });
  timer = setTimeout(() => { rejectReady(new Error("handshake_timeout")); dispose(); }, options.handshakeTimeoutMs ?? 5000);
  if (options.documentFactory) {
    void Promise.resolve().then(async () => {
      if (disposed) return;
      const resource = await options.documentFactory!({ instanceId, channel });
      if (disposed) { resource.dispose(); return; }
      releaseDocument = resource.dispose;
      iframe.src = resource.url;
      container.append(iframe);
    }).catch(error => {
      rejectReady(error instanceof Error ? error : new Error("document_prepare_failed"));
      try { dispose(); } catch { /* The frame and broker were already revoked by dispose's finally blocks. */ }
    });
  } else {
    iframe.srcdoc = buildSandboxDocument({ instanceId, channel, html: resource.html, script: resource.script }).html;
    container.append(iframe);
  }
  return { iframe, instanceId, ready, dispose, revoke: (permission: string) => { revoked.add(permission); broker?.revoke(permission); } };
}
