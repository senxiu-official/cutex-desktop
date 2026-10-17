// Known issues from the public repo (Settings → 关于 → 已知问题; shared/knownIssues.ts): main fetches
// `docs/known-issues.json` from the `release` branch's raw URL through the updater's transport (its own
// Chromium session with the OS proxy, Node once the plugin network containment is engaged —
// updateNet.ts), so the renderer never fetches a URL itself. GET only, no redirects followed (anything
// but 200 fails), at most KNOWN_ISSUES_MAX_BYTES, a timeout, then strict validation. The last good copy
// is kept in userData (`known-issues.json`) and answered while offline; without one the renderer shows
// its built-in list. Dev runs fetch too (nothing here depends on the install).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { KNOWN_ISSUES_MAX_BYTES, KNOWN_ISSUES_PATH, parseKnownIssues, type KnownIssuesDoc, type KnownIssuesRequest, type KnownIssuesResult } from "../shared/knownIssues";
import { releaseRawUrl } from "../shared/project";
import type { Transport } from "./updateTransport";

export const KNOWN_ISSUES_URL = releaseRawUrl(KNOWN_ISSUES_PATH);
/** A copy younger than this is answered without a new fetch (unless refreshed). */
export const KNOWN_ISSUES_MAX_AGE_MS = 60 * 60 * 1000;
/** Fetch attempts (also refreshes and failures) are at least this far apart. */
export const KNOWN_ISSUES_MIN_INTERVAL_MS = 30 * 1000;
export const KNOWN_ISSUES_TIMEOUT_MS = 15 * 1000;
const USER_AGENT = "cutex-desktop-known-issues";

interface Cached {
  doc: KnownIssuesDoc;
  fetchedAt: string;
}

export interface KnownIssuesOptions {
  transport: Transport;
  /** userData/known-issues.json */
  cacheFile: string;
  url?: string;
  now?: () => number;
  timeoutMs?: number;
  maxBytes?: number;
  log?: (line: string) => void;
}

export class KnownIssuesSource {
  private cached: Cached | null | undefined;
  private lastAttempt = 0;
  private lastError: string | undefined;
  private pending: Promise<void> | null = null;

  constructor(private readonly opts: KnownIssuesOptions) {}

  async get(refresh = false): Promise<KnownIssuesResult> {
    const now = this.now();
    const cached = this.load();
    const fresh = cached && now - Date.parse(cached.fetchedAt) < KNOWN_ISSUES_MAX_AGE_MS;
    if ((refresh || !fresh) && now - this.lastAttempt >= KNOWN_ISSUES_MIN_INTERVAL_MS) await (this.pending ??= this.fetch().finally(() => (this.pending = null)));
    else if (this.pending) await this.pending;
    return this.result();
  }

  private result(): KnownIssuesResult {
    const c = this.cached;
    if (!c) return this.lastError ? { source: "none", error: this.lastError } : { source: "none" };
    return this.lastError ? { source: "github", doc: c.doc, fetchedAt: c.fetchedAt, stale: true, error: this.lastError } : { source: "github", doc: c.doc, fetchedAt: c.fetchedAt };
  }

  private async fetch(): Promise<void> {
    this.lastAttempt = this.now();
    try {
      const doc = parseKnownIssues(JSON.parse(await this.download()));
      if (!doc) throw new Error("the list is not a valid known-issues document (schema 1)");
      this.cached = { doc, fetchedAt: new Date(this.now()).toISOString() };
      this.lastError = undefined;
      this.save(this.cached);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.opts.log?.(`known issues: ${this.lastError}`);
    }
  }

  private async download(): Promise<string> {
    const max = this.opts.maxBytes ?? KNOWN_ISSUES_MAX_BYTES;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timed out")), this.opts.timeoutMs ?? KNOWN_ISSUES_TIMEOUT_MS);
    try {
      const res = await this.opts.transport(this.opts.url ?? KNOWN_ISSUES_URL, { headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/plain" }, signal: controller.signal });
      if (res.status !== 200) {
        res.cancel();
        throw new Error(`HTTP ${res.status}`);
      }
      const declared = Number(res.header("content-length"));
      if (Number.isFinite(declared) && declared > max) {
        res.cancel();
        throw new Error(`the list is larger than ${max} bytes`);
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of res.body) {
        size += chunk.byteLength;
        if (size > max) {
          res.cancel();
          throw new Error(`the list is larger than ${max} bytes`);
        }
        chunks.push(chunk);
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    } finally {
      clearTimeout(timer);
    }
  }

  private load(): Cached | null {
    if (this.cached !== undefined) return this.cached;
    this.cached = null;
    try {
      const raw = JSON.parse(readFileSync(this.opts.cacheFile, "utf8")) as { fetchedAt?: unknown; doc?: unknown };
      const doc = parseKnownIssues(raw.doc);
      if (doc && typeof raw.fetchedAt === "string" && Number.isFinite(Date.parse(raw.fetchedAt))) this.cached = { doc, fetchedAt: raw.fetchedAt };
    } catch {
      // no / unreadable cache: fetched on demand
    }
    return this.cached;
  }

  private save(cached: Cached): void {
    try {
      mkdirSync(dirname(this.opts.cacheFile), { recursive: true });
      const tmp = `${this.opts.cacheFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(cached));
      renameSync(tmp, this.opts.cacheFile);
    } catch (error) {
      this.opts.log?.(`known issues: cache not written: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }
}

/** The KNOWN_ISSUES_CHANNEL handler (the caller checks the sender first). */
export function handleKnownIssuesRequest(source: KnownIssuesSource, request: KnownIssuesRequest): Promise<KnownIssuesResult> {
  if (!request || typeof request !== "object" || request.op !== "get") throw new Error("unknown known-issues op");
  return source.get(request.refresh === true);
}
