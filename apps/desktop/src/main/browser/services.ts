import { randomUUID } from "node:crypto";
import { CutexUnreachableError } from "@cutex-desktop/cutex-client";

/** Service proxy adapter. Credentials and one-use URLs never leave main. */
export interface BrowserServiceTarget { slug: string; path: string }
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export function parseBrowserServiceUrl(raw: string, connectionPort?: number): BrowserServiceTarget | null {
  if (raw.startsWith("cutex:service/")) {
    let key: string;
    try { key = decodeURIComponent(raw.slice("cutex:service/".length)); } catch { return null; }
    const slash = key.indexOf("/");
    const slug = slash < 0 ? key : key.slice(0, slash);
    const path = slash < 0 ? "/" : key.slice(slash);
    return SLUG.test(slug) && safeServicePath(path) ? { slug, path } : null;
  }
  try {
    const url = new URL(raw);
    const slug = url.hostname.endsWith(".svc.localhost") ? url.hostname.slice(0, -14) : "";
    // No port = the service by name on this host (agents often drop the proxy port); an explicit
    // port must be this connection's proxy port (another host's proxy URL is not this host's).
    if (url.protocol !== "http:" || !SLUG.test(slug) || url.username || url.password || url.hash
      || (url.port !== "" && Number(url.port) !== connectionPort) || !safeServicePath(url.pathname + url.search)) return null;
    return { slug, path: url.pathname + url.search };
  } catch { return null; }
}
export function safeServicePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !/[\\\x00-\x20\x7f#]/.test(path)
    && !/^\/__cutex(?:[/?]|$)/i.test(path) && path.length <= 2000;
}
export function serviceDisplayUrl(target: BrowserServiceTarget): string {
  // Query is encoded within the CutexRef key, never the cutex: URL's own query.
  return `cutex:service/${target.slug}${encodeURIComponent(target.path).replace(/%2F/g, "/")}`;
}
export interface ServiceClient {
  request<T>(method: "GET" | "POST" | "DELETE", path: string, options?: { body?: unknown }): Promise<T>;
}
export interface BrowserServiceOptions {
  client: ServiceClient;
  target: BrowserServiceTarget;
  /** Checks both connection identity and daemon generation; called around every awaited effect. */
  check(): void;
  /** Transient health only. A false result pauses renewal, never revives an invalid identity. */
  isAvailable?(): boolean;
  connectionPort(): number;
  lifetime: boolean;
  /**
   * The host has `services-lease-idempotent`: lease opens carry a `clientLeaseId` that is reused
   * until one open succeeds. Read at every open (an older cutex refuses the unknown field).
   */
  idempotentLease?(): boolean;
  onError(code: string): void;
}
/**
 * A service page's fetch / XHR answered 401 ticket-required (the daemon restarted and forgot the
 * tab's cookie): main re-tickets the top-level page once. At most one such automatic attempt per tab
 * per minute, so a page that keeps failing never loops.
 */
export const SUBRESOURCE_RETICKET_INTERVAL_MS = 60_000;
export function subresourceReticketDue(lastAt: number | undefined, now: number): boolean {
  return lastAt === undefined || now - lastAt >= SUBRESOURCE_RETICKET_INTERVAL_MS || now < lastAt;
}

export function browserServiceError(error: unknown): string {
  // A relay error that carries the daemon's precise service code (relayTypes BrowserRelayError.ownerCode).
  const owner = (error as { ownerCode?: unknown } | null)?.ownerCode;
  if (typeof owner === "string" && /^[a-z_]{1,64}$/.test(owner)) return owner;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[a-z_]{1,64}$/.test(code)) return code;
  const message = error instanceof Error ? error.message : "";
  return ["target_closed", "navigation_failed", "module_disabled", "service_auth_failed", "invalid_service_ticket", "invalid_service_lease"].includes(message) ? message : "service_unavailable";
}

// Only this internal error permits a retry. An identity error with the same public code does not.
class ServiceTemporarilyUnavailable extends Error {
  constructor() { super("service_unavailable"); }
}

/**
 * A background lease RPC that failed in transit: the daemon was unreachable, or a gateway answered
 * 502 / 503 / 504 without a cutex error body. Only renewal retries it (bounded, LEASE_RETRY_DELAYS_MS);
 * a refusal by cutex and any identity / generation failure never get here.
 */
class LeaseRpcInterrupted extends Error {
  readonly code: string;
  constructor(cause: unknown) {
    super("service_lease_rpc_interrupted", { cause });
    this.code = browserServiceError(cause);
  }
}
const TRANSIENT_RPC_CODES = new Set(["transport_error", "http_502", "http_503", "http_504"]);
function leaseRpcError(error: unknown): unknown {
  const transient = error instanceof CutexUnreachableError || (error as { name?: unknown } | null)?.name === "CutexUnreachableError"
    || TRANSIENT_RPC_CODES.has(String((error as { code?: unknown } | null)?.code));
  return transient ? new LeaseRpcInterrupted(error) : error;
}
// Consecutive renewal retries, 95 s in all; a successful renewal resets the budget. Renewal is due every
// 60 s against cutex's 150 s lease TTL, so a late retry may find the lease expired: lease_not_found then
// reacquires it as usual.
const LEASE_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000, 30_000];

/** One lease per mounted browser.tab. Dispose invalidates all in-flight completions. */
export class BrowserServiceSession {
  private closed = false;
  private lease: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private authRetries = 0;
  private leaseRetries = 0;
  /** `clientLeaseId` of the logical lease open in progress; cleared once an open returns a lease. */
  private pendingLeaseKey: string | null = null;
  get target(): BrowserServiceTarget { return this.options.target; }
  setPath(path: string): void { if (!safeServicePath(path)) throw new Error("invalid_service_path"); this.options.target.path = path; }
  constructor(private readonly options: BrowserServiceOptions) {}
  private checkIdentity(): void {
    if (this.closed) throw new Error("target_closed");
    this.options.check();
  }
  private check(): void {
    this.checkIdentity();
    if (this.options.isAvailable?.() === false) throw new ServiceTemporarilyUnavailable();
  }
  private route(suffix = ""): string { return `/v2/services/${this.options.target.slug}${suffix}`; }
  async start(start = true): Promise<string> {
    this.check();
    if (this.options.lifetime) await this.acquire();
    return this.ticket(start);
  }
  async ticket(start = false): Promise<string> {
    this.check();
    const ticket = await this.options.client.request<{ hostLabel: string; authPath: string }>("POST", this.route("/view-ticket"),
      { body: { path: this.options.target.path, start, routing: "host" } });
    this.check();
    const port = this.options.connectionPort();
    if (!Number.isInteger(port) || port < 1 || port > 65535 || ticket.hostLabel !== `${this.options.target.slug}.svc.localhost`
      || !/^\/__cutex\/auth\?[^\x00-\x20#\\]{1,4096}$/.test(ticket.authPath)) throw new Error("invalid_service_ticket");
    const url = new URL(`http://${ticket.hostLabel}:${port}${ticket.authPath}`);
    if (url.hostname !== ticket.hostLabel || Number(url.port || 80) !== port || url.pathname !== "/__cutex/auth") throw new Error("invalid_service_ticket");
    return url.href;
  }
  /** Exactly one automatic exchange per explicit owner navigation; persistent 401 stops here. */
  async retryAuthentication(): Promise<string> {
    this.check();
    if (this.authRetries++ >= 1) throw new Error("service_auth_failed");
    return this.ticket();
  }
  async renew(): Promise<void> {
    this.check();
    if (!this.lease) return;
    try {
      await this.options.client.request("POST", this.route(`/lease/${encodeURIComponent(this.lease)}`));
    } catch (error) {
      this.check();
      const code = browserServiceError(error);
      // Retain the expired id until replacement succeeds, so a transient acquisition failure
      // still has a renewal timer. The next attempt can repeat the 404 -> acquire exchange.
      if (code === "lease_not_found") { await this.acquire(); return; }
      if (code === "service_not_found") {
        // A missing lease route alone cannot distinguish reclamation from an unknown service.
        try { await this.options.client.request("GET", this.route()); }
        catch (detail) { this.check(); throw leaseRpcError(detail); }
        this.check();
      }
      throw leaseRpcError(error);
    }
    // Outside the RPC catch: an identity failure after a reply is never classified as an RPC failure.
    this.check();
  }
  /**
   * `POST /v2/services/{slug}/lease`. With `services-lease-idempotent` every attempt of one logical
   * open (the start, or a reacquire after `lease_not_found` and its bounded retries) sends the same
   * `clientLeaseId`: cutex returns the lease an earlier, interrupted attempt created instead of
   * minting a second one, so a lost reply leaves no orphan. A new key is drawn only after an open
   * succeeded. Older hosts (no key) still mint a lease per attempt; a lost reply's lease then lapses
   * with cutex's 150 s TTL.
   */
  private async acquire(): Promise<void> {
    this.check();
    let result: { leaseId: string };
    const clientLeaseId = this.options.idempotentLease?.() ? (this.pendingLeaseKey ??= randomUUID()) : undefined;
    try {
      result = await this.options.client.request<{ leaseId: string }>("POST", this.route("/lease"),
        { body: clientLeaseId ? { holder: "desktop-browser", clientLeaseId } : { holder: "desktop-browser" } });
    } catch (error) { this.check(); throw leaseRpcError(error); }
    if (typeof result.leaseId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(result.leaseId)) throw new Error("invalid_service_lease");
    // This open is complete: the key now names a known lease, the next open draws a new one.
    if (clientLeaseId && this.pendingLeaseKey === clientLeaseId) this.pendingLeaseKey = null;
    try { this.check(); } catch (error) {
      if (error instanceof ServiceTemporarilyUnavailable) {
        // A late, valid lease still belongs to this identity. Keep it without offline RPCs,
        // but reject the foreground operation so no ticket/navigation escapes the health gate.
        this.lease = result.leaseId;
        this.schedule(5_000);
      } else await this.release(result.leaseId);
      throw error;
    }
    this.lease = result.leaseId;
    this.schedule();
  }
  private schedule(delay = 60_000): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.closed || !this.lease) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.renew().then(() => { this.leaseRetries = 0; this.schedule(); }, error => {
        if (this.closed) return;
        // Recheck identity at the rejection boundary too; a concurrent revocation or generation change
        // must not be mistaken for health recovery or an interrupted RPC, even if it shares a code.
        try { this.checkIdentity(); } catch (identityError) { error = identityError; }
        if (error instanceof ServiceTemporarilyUnavailable) { this.schedule(5_000); return; }
        if (error instanceof LeaseRpcInterrupted && this.leaseRetries < LEASE_RETRY_DELAYS_MS.length) {
          this.schedule(LEASE_RETRY_DELAYS_MS[this.leaseRetries++]);
          return;
        }
        this.dispose();
        this.options.onError(browserServiceError(error));
      });
    }, delay);
    this.timer.unref?.();
  }
  private async release(id: string): Promise<void> {
    // Use only the original client, not a re-resolved host. Revocation is safe after epoch change.
    try { await this.options.client.request("DELETE", this.route(`/lease/${encodeURIComponent(id)}`)); } catch { /* Best effort; daemon TTL remains bounded. */ }
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const lease = this.lease;
    this.lease = null;
    if (lease) void this.release(lease);
    const key = this.pendingLeaseKey;
    this.pendingLeaseKey = null;
    if (key) void this.releaseKeyed(key);
  }
  /**
   * An open interrupted before its reply may have created a lease this tab never learned. Replaying
   * the key names it (or opens one), so it can be released now instead of lapsing with the TTL.
   */
  private async releaseKeyed(clientLeaseId: string): Promise<void> {
    try {
      const result = await this.options.client.request<{ leaseId?: unknown }>("POST", this.route("/lease"),
        { body: { holder: "desktop-browser", clientLeaseId } });
      if (typeof result?.leaseId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(result.leaseId)) await this.release(result.leaseId);
    } catch { /* Best effort; daemon TTL remains bounded. */ }
  }
}
