import { isBrowserUrl, ProtocolError, type BrowserOperationResult, type BrowserTabOperation, type BrowserTabSummary } from "@cutex-desktop/browser-protocol";
import type { OperationOptions } from "@cutex-desktop/browser-cdp";
import type { InAppProvider } from "./provider";
import { modelScreenshot, modelSnapshot, type BrowserImageDecoder } from "./modelOutput";
import { parseBrowserServiceUrl } from "./services";

export interface BrowserModelAdapterOptions {
  provider: Pick<InAppProvider, "hasGrant" | "controlView" | "snapshot" | "find" | "action" | "navigate" | "screenshot" | "release">;
  /** Return admitted current-identity targets with sanitized, policy-allowed public URLs only. */
  tabs(): BrowserTabSummary[];
  decodeImage: BrowserImageDecoder;
}
/** Decode the sanitized CutexRef key once; never expose an auth/tunnel URL or invent a port. */
export function publicBrowserServiceUrl(displayUrl: string, connectionPort: number | undefined): string {
  if (!displayUrl.startsWith("cutex:service/")) return displayUrl;
  const service = parseBrowserServiceUrl(displayUrl);
  if (!service || !Number.isInteger(connectionPort) || connectionPort! < 1 || connectionPort! > 65535)
    throw new ProtocolError("permission_denied", "Service display target is unavailable");
  const url = new URL(`http://${service.slug}.svc.localhost:${connectionPort}${service.path}`);
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { throw new ProtocolError("permission_denied", "Service display target is invalid"); }
  // Inspect the URL-normalized endpoint too (dot segments / escaped underscores). This is
  // a deny check only: do not decode the returned path/query a second time.
  if (/^\/__cutex(?:\/|$)/i.test(pathname) || !isBrowserUrl(url.href))
    throw new ProtocolError("permission_denied", "Service display target is invalid");
  return url.href;
}
function publicTab(tab: BrowserTabSummary): BrowserTabSummary {
  if (!isBrowserUrl(tab.url)) throw new ProtocolError("permission_denied", "Browser public URL is unavailable");
  return tab;
}
/** Shared agent open/navigate boundary, after URL normalization but before any allocation/effect. */
export function assertPublicBrowserNavigation(raw: string): void {
  if (!isBrowserUrl(raw)) throw new ProtocolError("permission_denied", "Navigation target is not a public browser URL");
  const target = new URL(raw);
  if (target.hostname.endsWith(".svc.localhost")) {
    let path: string;
    try { path = decodeURIComponent(target.pathname); } catch { throw new ProtocolError("permission_denied", "Service navigation path is invalid"); }
    if (/^\/__cutex(?:\/|$)/i.test(path)) throw new ProtocolError("permission_denied", "Private service endpoints are main-only");
  }
}

/** No discovery token, session identity, grant method, evaluator or arbitrary host RPC. */
export function createBrowserModelAdapter(options: BrowserModelAdapterOptions) {
  const { provider } = options;
  // This is the FINAL model-visible ref set, not the provider's larger AX snapshot. A new
  // attempt clears old authority immediately; identity/TTL remain independently executor-owned.
  const snapshots = new Map<string, { refs: Set<string>; pageGeneration?: number }>();
  function currentTabs(): BrowserTabSummary[] {
    let tabs: BrowserTabSummary[];
    try { tabs = options.tabs().filter(tab => provider.hasGrant(tab.guestId)); }
    catch (error) { snapshots.clear(); throw error; }
    const admitted = new Map(tabs.map(tab => [tab.guestId, tab]));
    for (const [id, snapshot] of snapshots) {
      const tab = admitted.get(id);
      if (!tab || provider.controlView(id)?.state !== "granted" ||
        snapshot.pageGeneration !== undefined && snapshot.pageGeneration !== tab.pageGeneration) snapshots.delete(id);
    }
    return tabs;
  }
  function owned(guestId: string): BrowserTabSummary {
    const tab = currentTabs().find(tab => tab.guestId === guestId);
    if (!tab) throw new ProtocolError("permission_denied", "No active browser lease for this browser tab");
    return publicTab(tab);
  }
  function requireReturnedRef(guestId: string, ref: string): void {
    if (provider.controlView(guestId)?.state !== "granted") throw new ProtocolError("permission_denied", "Browser control is paused");
    if (!snapshots.get(guestId)?.refs.has(ref)) throw new ProtocolError("stale_ref", "Read or find a model-visible ref before acting");
  }
  return {
    async list(_control: OperationOptions): Promise<BrowserTabSummary[]> {
      return currentTabs().map(publicTab);
    },
    async execute(guestId: string, operation: BrowserTabOperation, control: OperationOptions): Promise<BrowserOperationResult> {
      if (operation.kind === "tab.snapshot" || operation.kind === "tab.find" || operation.kind === "tab.release") snapshots.delete(guestId);
      owned(guestId);
      switch (operation.kind) {
        case "tab.snapshot":
        case "tab.find": {
          const state = { refs: new Set<string>(), pageGeneration: undefined as number | undefined };
          snapshots.set(guestId, state);
          try {
            const value = operation.kind === "tab.snapshot" ? await provider.snapshot(guestId, control)
              : await provider.find(guestId, operation.query, control);
            // Include the operation discriminator in the final budget too: the bridge must
            // not reject a boundary-sized result after this whitelist has been published.
            const current = owned(guestId);
            const output = modelSnapshot({ kind: operation.kind, ...value }, current.url);
            if (snapshots.get(guestId) !== state) throw new ProtocolError("stale_ref", "A newer snapshot attempt superseded this result");
            // Registry navigation and executor ref invalidation are independent clocks.
            // Preserve the executor generation in the wire result; cache the registry clock
            // only for this adapter's extra live-tab fence (native/CDP event order may differ).
            state.refs = new Set(output.nodes.map(node => node.ref)); state.pageGeneration = current.pageGeneration;
            return output;
          } catch (error) { if (snapshots.get(guestId) === state) snapshots.delete(guestId); throw error; }
        }
        case "tab.act": {
          if ("ref" in operation.action && operation.action.ref !== undefined) requireReturnedRef(guestId, operation.action.ref);
          if (["back", "forward", "reload", "wait"].includes(operation.action.kind)) snapshots.delete(guestId);
          const value = await provider.action(guestId, operation.action, control);
          return { kind: operation.kind, pageGeneration: value.pageGeneration };
        }
        case "tab.navigate": {
          snapshots.delete(guestId);
          assertPublicBrowserNavigation(operation.url);
          const value = await provider.navigate(guestId, operation.url, control);
          try { return { kind: operation.kind, pageGeneration: value.pageGeneration, url: owned(guestId).url }; }
          catch { throw new ProtocolError("outcome_unknown", "Navigation completed but its current target is unconfirmed; never replay automatically"); }
        }
        case "tab.screenshot": {
          if (operation.ref !== undefined) requireReturnedRef(guestId, operation.ref);
          const value = await provider.screenshot(guestId, { ...control, ref: operation.ref, format: operation.format, quality: operation.quality });
          owned(guestId);
          return { kind: operation.kind, ...modelScreenshot(value, options.decodeImage) };
        }
        case "tab.release":
          // A paused grant can always be relinquished, but release can never grant/resume.
          provider.release(guestId);
          return { kind: operation.kind };
        default:
          throw new ProtocolError("unsupported_operation", "Browser model adapter does not support this operation");
      }
    },
  };
}
