// 百度网盘 (`/v2/pan/*`, owner-only) for the bound host's daemon. Inputs are checked and bodies rebuilt
// from known fields; the app secret only travels renderer → main → cutex (the owner typed it) and no
// answer carries a secret (cutex never returns one; known credential keys are dropped anyway).
// The event feed (`GET /v2/pan/events`, SSE `pan.download`) is followed while a page watches it and
// stops with unwatchPan / the connection closing; after a drop it reconnects and the page re-reads.
import { CutexApiError, SseParser, type CutexClient } from "@cutex-desktop/cutex-client";
import type { PanAppInput, PanAuthPoll, PanAuthStart, PanConnection, PanDownload, PanDownloadAction, PanDownloadRequest, PanFile, PanFilesPage, PanResult, PanSearchResult } from "../shared/baiduPan";
import { PAN_SEARCH_MAX } from "../shared/baiduPan";

type Method = "GET" | "PUT" | "POST" | "DELETE";

async function call<T>(client: CutexClient, method: Method, path: string, opts: { body?: unknown; query?: Record<string, string | number | undefined> } = {}): Promise<PanResult<T>> {
  try {
    const value = await client.request<T>(method, path, { ...(opts.body === undefined ? {} : { body: opts.body }), ...(opts.query ? { query: opts.query } : {}) });
    return { ok: true, value: scrub(value) };
  } catch (error) {
    if (error instanceof CutexApiError) {
      // A cutex without the routes: router 404 / 405 without a pan error code.
      const missing = (error.status === 404 || error.status === 405) && !error.code.startsWith("pan_");
      const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
      return { ok: false, code: missing ? "unsupported" : error.code, message, retryable: error.status === 429 || error.status >= 500 };
    }
    return { ok: false, code: "unreachable", message: String((error as Error)?.message ?? error), retryable: true };
  }
}

const SECRET_KEYS = ["clientSecret", "secretKey", "accessToken", "refreshToken", "token", "dlink"];
/** Defense in depth: drop credential-like keys at any depth. */
export function scrub<T>(value: T): T {
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!SECRET_KEYS.includes(k)) out[k] = scrub(v);
    return out as T;
  }
  return value;
}

const CONTROL = /[\u0000-\u001f\u007f]/;
function text(value: unknown, max: number, what: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || CONTROL.test(value)) throw new Error(`invalid ${what}`);
  return value.trim();
}
/** An absolute Netdisk path: `/…`, no `..` segment, no control characters. */
export function panPath(value: unknown, what = "path"): string {
  const p = text(value, 4096, what);
  if (!p.startsWith("/") || p.split("/").some((s) => s === "..")) throw new Error(`invalid ${what}`);
  return p;
}
const ID = /^[A-Za-z0-9._:-]{1,160}$/;
function id(value: unknown, what: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`invalid ${what}`);
  return value;
}
const int = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fallback);

export function panApi(client: CutexClient) {
  return {
    panConnection: () => call<PanConnection>(client, "GET", "/v2/pan/connection"),
    panConfigure(input: PanAppInput) {
      if (!input || typeof input !== "object") throw new Error("invalid app");
      // The secret may hold any printable character; it is never echoed back.
      const body = { appId: text(input.appId, 64, "AppId"), clientId: text(input.clientId, 128, "AppKey"), clientSecret: text(input.clientSecret, 256, "SecretKey") };
      return call<PanConnection>(client, "PUT", "/v2/pan/connection", { body });
    },
    panDisconnect: () => call<{ disconnected: true }>(client, "DELETE", "/v2/pan/connection"),
    panAuthStart: () => call<PanAuthStart>(client, "POST", "/v2/pan/auth", { body: {} }),
    panAuthPoll: (authId: string) => call<PanAuthPoll>(client, "GET", `/v2/pan/auth/${encodeURIComponent(id(authId, "auth id"))}`),
    /** Fallback when the device code does not apply: the official authorization-code / OOB flow. The code is used once and never echoed. */
    panAuthCode(code: string, redirectUri: string) {
      const c = text(code, 512, "authorization code");
      const r = text(redirectUri, 2048, "redirect URI");
      if (r !== "oob" && !/^https?:\/\/\S+$/.test(r)) throw new Error("invalid redirect URI");
      return call<PanConnection>(client, "POST", "/v2/pan/auth/code", { body: { code: c, redirectUri: r } });
    },
    panFiles: (dir: string, start = 0, limit = 100) =>
      call<PanFilesPage>(client, "GET", "/v2/pan/files", { query: { dir: panPath(dir, "folder"), start: int(start, 0, 1e9, 0), limit: int(limit, 1, 1000, 100) } }),
    panSearch(key: string, dir: string) {
      const k = text(key, 200, "keyword");
      if ([...k].length > PAN_SEARCH_MAX) throw new Error("keyword too long");
      return call<PanSearchResult>(client, "GET", "/v2/pan/search", { query: { key: k, dir: panPath(dir, "folder"), recursive: "true" } });
    },
    panMeta: (path: string) => call<{ file: PanFile }>(client, "GET", "/v2/pan/meta", { query: { path: panPath(path) } }),
    panDownloads: (limit = 100) => call<{ downloads: PanDownload[] }>(client, "GET", "/v2/pan/downloads", { query: { limit: int(limit, 1, 500, 100) } }),
    panStartDownload(req: PanDownloadRequest) {
      if (!req || typeof req !== "object") throw new Error("invalid download");
      const targetDir = text(req.targetDir, 4096, "target folder");
      // An absolute path on the daemon's host (Windows `C:\…` / UNC, or `/…`); the daemon checks the rest.
      if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(targetDir)) throw new Error("invalid target folder");
      return call<{ download: PanDownload }>(client, "POST", "/v2/pan/downloads", { body: { requestId: id(req.requestId, "request id"), remote: panPath(req.remote, "file"), targetDir } });
    },
    panDownloadAction(downloadId: string, action: PanDownloadAction) {
      if (action !== "pause" && action !== "resume" && action !== "cancel") throw new Error("invalid action");
      return call<{ download: PanDownload }>(client, "POST", `/v2/pan/downloads/${encodeURIComponent(id(downloadId, "download id"))}/${action}`, { body: {} });
    },
  };
}

export interface PanFeedHandlers {
  download(download: PanDownload): void;
  status(status: "connecting" | "live" | "retrying"): void;
}

const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];
/** No frame or keepalive for this long = a half-open connection: reconnect. */
const IDLE_MS = 80_000;

/**
 * Follow `GET /v2/pan/events` until stopped: reconnects with backoff (the page re-reads the list on
 * `live`, so nothing missed while away stays missing). A 404 / 405 / 401 / 403 ends it quietly.
 */
export function followPanEvents(client: CutexClient, on: PanFeedHandlers): { stop(): void } {
  const stopped = new AbortController();
  let attempt = 0;
  const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); stopped.signal.addEventListener("abort", () => (clearTimeout(t), r()), { once: true }); });
  void (async () => {
    while (!stopped.signal.aborted) {
      on.status(attempt === 0 ? "connecting" : "retrying");
      const ctl = new AbortController();
      const abort = () => ctl.abort();
      stopped.signal.addEventListener("abort", abort, { once: true });
      let idle: NodeJS.Timeout | null = null;
      const touch = () => { if (idle) clearTimeout(idle); idle = setTimeout(abort, IDLE_MS); };
      try {
        const response = await client.fetchRaw(client.url("/v2/pan/events"), { headers: client.headers({ Accept: "text/event-stream" }), signal: ctl.signal });
        if (!response.ok || !response.body) {
          if ([401, 403, 404, 405].includes(response.status)) return;
          throw new Error(`HTTP ${response.status}`);
        }
        attempt = 0;
        on.status("live");
        touch();
        const parser = new SseParser(touch);
        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          touch();
          for (const m of parser.push(decoder.decode(value, { stream: true }))) {
            if (m.event !== "pan.download") continue;
            try {
              const d = (JSON.parse(m.data) as { download?: PanDownload }).download;
              if (d && typeof d.id === "string") on.download(scrub(d));
            } catch {
              // a malformed frame is skipped
            }
          }
        }
      } catch {
        // dropped / unreachable: retry below
      } finally {
        if (idle) clearTimeout(idle);
        stopped.signal.removeEventListener("abort", abort);
      }
      if (stopped.signal.aborted) return;
      await sleep(RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]!);
    }
  })();
  return { stop: () => stopped.abort() };
}
