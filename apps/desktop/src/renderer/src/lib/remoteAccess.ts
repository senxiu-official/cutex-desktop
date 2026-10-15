// Settings → 远程访问 / 配对手机 (cutex `listen-settings`, `device-pairing`;
// docs/research/cutex-mobile-api.md §1, §2): pure helpers over `/v2/settings` listen fields,
// pairing codes and client tokens. No React / store imports, so it is unit-testable.
import type { ClientTokenView, GlobalSettings, ListenEntry } from "../../../shared/ipc";
import { clientTokenName } from "./deviceNames";

export const LISTEN_FEATURE = "listen-settings";
export const PAIRING_FEATURE = "device-pairing";
export const LISTEN_FIELD = "managementListen";
/** cutex limits (validated again server-side). */
export const MAX_LISTEN_ENTRIES = 16;
export const MAX_CORS_ORIGINS = 20;

export interface ListenView {
  /** The effective list (configured, or the default when unset). */
  list: string[];
  /** True while `managementListen` is unset (cutex default). */
  isDefault: boolean;
  rows: ListenEntry[];
  /** cutex could not parse the stored list. */
  error: string | null;
  activeRemote: string[];
  cors: string[];
  corsIsDefault: boolean;
  corsDefault: string[];
  remoteAccess: { clientTokens: number | null; devices: number | null } | null;
}

/** The listen part of `/v2/settings`, or null on a cutex without `listen-settings` fields. */
export function readListenSettings(s: GlobalSettings | null | undefined): ListenView | null {
  if (!s || !("managementListenEntries" in s) || s.managementListenEntries === undefined) return null;
  const entries = s.managementListenEntries;
  const rows = Array.isArray(entries) ? entries : [];
  const def = s.managementListenDefault ?? ["127.0.0.1"];
  const corsDefault = s.managementCorsOriginsDefault ?? [];
  return {
    list: s.managementListen ?? def,
    isDefault: s.managementListen == null,
    rows,
    error: Array.isArray(entries) ? null : (entries?.error ?? "invalid"),
    activeRemote: s.managementListenActiveRemote ?? [],
    cors: s.managementCorsOrigins ?? corsDefault,
    corsIsDefault: s.managementCorsOrigins == null,
    corsDefault,
    remoteAccess: s.remoteAccess ?? null,
  };
}

/** `restartRequired` is an array of field names (the `/v2/settings` convention). */
export function needsRestart(restartRequired: unknown, field = LISTEN_FIELD): boolean {
  return Array.isArray(restartRequired) && restartRequired.includes(field);
}

export function hasRemoteEntry(rows: readonly ListenEntry[]): boolean {
  return rows.some((r) => r.kind !== "loopback");
}

/**
 * Banner "远程地址只接受客户端 / 设备令牌，先配对一台设备": a remote entry is configured but no
 * client or device token exists (a remote listener would only refuse requests). Unknown counts
 * (token store unreadable) → no banner.
 */
export function needsPairingBanner(view: Pick<ListenView, "rows" | "remoteAccess"> | null): boolean {
  if (!view?.remoteAccess || !hasRemoteEntry(view.rows)) return false;
  const { clientTokens, devices } = view.remoteAccess;
  if (clientTokens === null || devices === null) return false;
  return clientTokens + devices === 0;
}

/** "100.64.0.7:24270" → host part without brackets, and the port. */
function splitSocket(addr: string): { host: string; port: number } | null {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(addr) ?? /^([^:]+):(\d+)$/.exec(addr);
  return m ? { host: m[1]!, port: Number(m[2]) } : null;
}

/** 100.64.0.0/10 (Tailscale CGNAT range). */
function isTailscaleIp(host: string): boolean {
  const m = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

function bareHost(entry: string): string {
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(entry);
  if (bracket) return bracket[1]!;
  return /^[^:]+:\d+$/.test(entry) ? entry.slice(0, entry.lastIndexOf(":")) : entry;
}

/** The address a row binds as shown to the user: "tailscale:24270", "10.0.0.5:24270", "[::]:24270". */
export function entryAddress(row: ListenEntry): string {
  if (row.kind === "tailscale") return `tailscale:${row.port}`;
  const host = bareHost(row.entry);
  return host.includes(":") ? `[${host}]:${row.port}` : `${host}:${row.port}`;
}

/**
 * Whether a non-loopback row is bound right now: "active" | "inactive" | null (loopback rows:
 * always local, no status). Tailscale rows match any active 100.64/10 listener on their port.
 */
export function entryStatus(row: ListenEntry, activeRemote: readonly string[]): "active" | "inactive" | null {
  if (row.kind === "loopback") return null;
  const active = activeRemote.map(splitSocket).filter((a): a is { host: string; port: number } => a !== null && a.port === row.port);
  if (row.kind === "tailscale") return active.some((a) => isTailscaleIp(a.host)) ? "active" : "inactive";
  const host = bareHost(row.entry);
  return active.some((a) => a.host === host) ? "active" : "inactive";
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function validPort(p: string): boolean {
  if (!/^\d{1,5}$/.test(p)) return false;
  const n = Number(p);
  return n >= 1 && n <= 65535;
}

function looksIpv6(host: string): boolean {
  return /^[0-9A-Fa-f:.]+$/.test(host) && host.includes(":") && host.split("::").length <= 2;
}

export type ListenEntryProblem = "empty" | "format" | "port" | "duplicate" | "tooMany";

/**
 * Light client-side check of a new `managementListen` entry (cutex validates for real):
 * `tailscale[:port]`, `<ipv4>[:port]`, `[<ipv6>][:port]` or a bare IPv6. Returns the trimmed entry
 * or the problem.
 */
export function checkListenEntry(input: string, existing: readonly string[]): { ok: true; entry: string } | { ok: false; problem: ListenEntryProblem } {
  const entry = input.trim();
  if (!entry) return { ok: false, problem: "empty" };
  if (existing.length >= MAX_LISTEN_ENTRIES) return { ok: false, problem: "tooMany" };
  let port: string | null = null;
  const lower = entry.toLowerCase();
  if (lower === "tailscale" || lower.startsWith("tailscale:")) {
    port = lower === "tailscale" ? null : lower.slice("tailscale:".length);
  } else {
    const bracket = /^\[([^\]]+)\](?::(.*))?$/.exec(entry);
    if (bracket) {
      if (!looksIpv6(bracket[1]!)) return { ok: false, problem: "format" };
      port = bracket[2] ?? null;
    } else if (looksIpv6(entry) && entry.split(":").length > 2) {
      port = null;
    } else {
      const [host, p, extra] = entry.split(":");
      if (extra !== undefined || !IPV4.test(host!)) return { ok: false, problem: "format" };
      port = p ?? null;
    }
  }
  if (port !== null && !validPort(port)) return { ok: false, problem: "port" };
  const norm = (e: string) => e.trim().toLowerCase();
  if (existing.some((e) => norm(e) === norm(entry))) return { ok: false, problem: "duplicate" };
  return { ok: true, entry };
}

export type CorsProblem = "empty" | "format" | "duplicate" | "tooMany";

/** Exact origin `scheme://host[:port]`: no path, query, fragment or credentials. */
export function checkCorsOrigin(input: string, existing: readonly string[]): { ok: true; origin: string } | { ok: false; problem: CorsProblem } {
  const origin = input.trim().replace(/\/$/, "");
  if (!origin) return { ok: false, problem: "empty" };
  if (existing.length >= MAX_CORS_ORIGINS) return { ok: false, problem: "tooMany" };
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^/?#@\s]+$/i.test(origin)) return { ok: false, problem: "format" };
  const port = /:(\d+)$/.exec(origin.slice(origin.indexOf("://") + 3));
  if (port && !validPort(port[1]!)) return { ok: false, problem: "format" };
  if (existing.includes(origin)) return { ok: false, problem: "duplicate" };
  return { ok: true, origin };
}

/** Whole seconds left until `expiresAt` (≥ 0; 0 when unparsable). */
export function secondsLeft(expiresAt: string, nowMs: number): number {
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - nowMs) / 1000));
}

/** "9:05" / "0:42". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Tokens that appeared since `known` was captured (a phone just paired). Devices first. */
export function newTokens(tokens: readonly ClientTokenView[], known: ReadonlySet<string>): ClientTokenView[] {
  return sortTokens(tokens.filter((t) => !known.has(t.tokenId)));
}

/** Devices first, then newest first. */
export function sortTokens(tokens: readonly ClientTokenView[]): ClientTokenView[] {
  return [...tokens].sort((a, b) => Number(b.kind === "device") - Number(a.kind === "device") || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}

/** Display name of a token (lib/deviceNames): owner-given name, device name, friendly desktop label, label, id. */
export function tokenName(token: ClientTokenView, t: Parameters<typeof clientTokenName>[1]): string {
  return clientTokenName(token, t);
}

/** RFC 3339 → unix seconds (for `formatWhen`), or null. */
export function unixSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t / 1000 : null;
}
