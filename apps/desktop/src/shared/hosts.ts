// SSH hosts (DESIGN §2 remote; multi-host P0, docs/research/multi-host-rfc-20261009.md: one daemon
// connection per connected host, the view scope picks what the UI shows). Types shared by main
// (tunnels / pairing / host list / connections) and the renderer (switcher, Settings → 主机), plus the
// pure helpers: ssh argument building, target / ssh_config parsing, error classification, the tunnel
// state reducer and hosts.json v1 → v2. Unit-tested in test/hosts.test.ts. Tokens never appear in any
// of these types.
import type { CutexBuild } from "@cutex-desktop/cutex-client";
import type { DaemonState } from "./ipc";

export const LOCAL_HOST_ID = "local";
/** cutex Management v2 default port on every host. */
export const DEFAULT_REMOTE_PORT = 24270;
export const DEFAULT_CUTEX_PATH = "cutex";

/** cutex capabilities the remote mode uses (gated per feature; older remotes degrade). */
export const REMOTE_FEATURES = {
  clientTokens: "management-client-tokens",
  attachments: "session-attachments",
  dirBrowse: "fs-dir-browse",
} as const;

/** The view scope on launch: the last one (★ RFC Q4) or this machine. */
export type HostStartOn = "local" | "last";

/**
 * What the UI shows (RFC §3): one host, a host group (P2: Settings → 主机 → 分组), or every host
 * (renderer lib/hostScope.ts resolves every kind).
 */
export type ViewScope = { kind: "host"; id: string } | { kind: "group"; id: string } | { kind: "all" };

/** Operating system of a host, from cutex `/v2/host.platform` at the last connect (null: never connected). */
export type HostPlatform = "windows" | "linux" | "macos";

/**
 * A named set of hosts (a scope filter, RFC §7; multi-host P2). List order = the switcher's order;
 * `hosts` order = the member dots' order. Names are unique (case-insensitive); a group may be empty
 * (it is then not offered in the switcher). Edited as a whole list (`saveHostGroups`).
 */
export interface HostGroup {
  /** `grp-<4–32 a-z0-9>`; assigned by main for new groups. */
  id: string;
  name: string;
  hosts: string[];
  /** `#rrggbb` tint of the group icon; absent = neutral. Hosts keep their own colors (RFC §7.3). */
  color?: string;
}

/** A group as the renderer sends it to `saveHostGroups`: no id = a new group (main assigns one). */
export interface HostGroupDraft {
  id?: string;
  name: string;
  hosts: string[];
  color?: string | null;
}

export const HOST_GROUP_ID = /^grp-[a-z0-9]{4,32}$/;
export const HOST_GROUP_NAME_MAX = 64;
export const HOST_GROUPS_MAX = 50;

/** Why a group list was refused (the renderer shows `hostGroups.error.<code>`). */
export type HostGroupError = "name" | "duplicateName" | "unknownHost" | "badColor" | "badId" | "tooMany";

/** Same group name (trimmed, case-insensitive). */
export function sameGroupName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/**
 * Validate + normalize a whole group list (main `saveHostGroups`; the renderer runs it too, to show
 * errors before sending): names trimmed, non-empty, ≤ 64 chars, unique; members must be known hosts
 * (duplicates dropped, order kept); color `#rrggbb` (lower case) or none; ids kept when valid and
 * unique, `newId()` for drafts without one.
 */
export function normalizeHostGroups(
  drafts: unknown,
  known: (hostId: string) => boolean,
  newId: () => string,
): { ok: true; groups: HostGroup[] } | { ok: false; error: HostGroupError; index: number } {
  if (!Array.isArray(drafts)) return { ok: false, error: "name", index: -1 };
  if (drafts.length > HOST_GROUPS_MAX) return { ok: false, error: "tooMany", index: HOST_GROUPS_MAX };
  const groups: HostGroup[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of drafts.entries()) {
    const d = (raw ?? {}) as Partial<Record<keyof HostGroupDraft, unknown>>;
    const name = typeof d.name === "string" ? d.name.trim() : "";
    if (!name || name.length > HOST_GROUP_NAME_MAX) return { ok: false, error: "name", index };
    if (groups.some((g) => sameGroupName(g.name, name))) return { ok: false, error: "duplicateName", index };
    if (!Array.isArray(d.hosts) || d.hosts.some((h) => typeof h !== "string" || !known(h))) return { ok: false, error: "unknownHost", index };
    if (d.color !== undefined && d.color !== null && !isHostColor(d.color)) return { ok: false, error: "badColor", index };
    let id: string;
    if (d.id === undefined || d.id === null) {
      do id = newId();
      while (ids.has(id));
    } else if (typeof d.id === "string" && HOST_GROUP_ID.test(d.id) && !ids.has(d.id)) id = d.id;
    else return { ok: false, error: "badId", index };
    ids.add(id);
    groups.push({ id, name, hosts: [...new Set(d.hosts as string[])], ...(typeof d.color === "string" ? { color: d.color.toLowerCase() } : {}) });
  }
  return { ok: true, groups };
}

/** The groups the switcher offers: those with at least one known member (RFC §7.5: empty ones are hidden). */
export function switcherGroups(state: Pick<HostsState, "hosts" | "groups"> | null | undefined): HostGroup[] {
  if (!state) return [];
  const known = new Set(state.hosts.map((h) => h.id));
  return state.groups.filter((g) => g.hosts.some((id) => known.has(id)));
}

/** The groups a host belongs to (Settings → 主机 host card tags, RFC §7.3). */
export function groupsOfHost(groups: readonly HostGroup[], hostId: string): HostGroup[] {
  return groups.filter((g) => g.hosts.includes(hostId));
}

/** Desktop-local per-host settings (hosts.json v2): connection policy + appearance. */
export interface HostLocalConfig {
  /** Connected at launch and kept connected (reconnects) also outside the scope (★ RFC Q1 / Q2). */
  autoConnect: boolean;
  /** Host color (palette default by order, RFC §8.1). */
  color: string;
  platform: HostPlatform | null;
}

/** One stored SSH host (userData/hosts.json). The token lives encrypted in a separate file. */
export interface SshHostConfig {
  id: string;
  label: string;
  /** `alias` from ~/.ssh/config, or `user@host[:port]`. */
  target: string;
  remotePort: number;
  cutexPath: string;
  /** Client token id on the remote (for revoke); null when not paired. */
  tokenId: string | null;
  createdAt: string;
  lastConnectedAt: string | null;
  autoConnect: boolean;
  color: string;
  platform: HostPlatform | null;
}

/** userData/hosts.json v2 (v1 → v2 on read: `lastActive` → `scope`; one-way, RFC §6.4). */
export interface HostsFile {
  version: 2;
  hosts: SshHostConfig[];
  /** This machine's own entry (no ssh fields). */
  local: HostLocalConfig;
  startOn: HostStartOn;
  scope: ViewScope;
  groups: HostGroup[];
}

export type TunnelStatus = "idle" | "starting" | "up" | "retrying" | "error";

export type SshErrorCode =
  | "noSsh" // no OpenSSH client found
  | "auth" // BatchMode: no usable key / agent (needs interactive auth)
  | "hostKey" // unknown or changed host key
  | "resolve"
  | "refused"
  | "timeout"
  | "forward" // local port forward failed (port taken)
  | "cutexNotFound" // remote command not found
  | "cutexTooOld" // remote cutex lacks `management client-token`
  | "badOutput" // remote printed something we cannot parse
  | "noToken" // host not paired (no stored token)
  | "noKeyring" // safeStorage unavailable: refuse to store the token
  | "tokenRejected" // remote daemon answered 401/403 for the stored token
  | "badInput"
  | "exited";

export interface SshErrorView {
  code: SshErrorCode;
  /** Last lines of ssh / remote stderr (never stdout: that carries the token). */
  detail: string;
  /** cutexNotFound: the places cutex was looked for (`CUTEX_CANDIDATES` labels). */
  tried?: string[];
}

export interface TunnelView {
  status: TunnelStatus;
  localPort: number | null;
  error: SshErrorView | null;
  /** Consecutive failed attempts (backoff exponent). */
  attempt: number;
  /** Epoch ms of the next automatic retry (status "retrying"). */
  retryAt: number | null;
  /** Epoch ms when the forward came up (attempt resets after a stable period). */
  upSince: number | null;
}

export interface HostView {
  id: string;
  /** "dev-direct" = DEV ONLY loopback host from CUTEX_DESKTOP_DEV_HOSTS (main/devHosts.ts); never in packaged builds. */
  kind: "local" | "ssh" | "dev-direct";
  label: string;
  target: string | null;
  remotePort: number | null;
  cutexPath: string | null;
  paired: boolean;
  lastConnectedAt: string | null;
  /** Client token id this desktop holds on the remote (not a secret; marks it in 配对设备). */
  tokenId?: string | null;
  /** hosts.json v2 fields (absent in older test fixtures = defaults). */
  autoConnect?: boolean;
  color?: string;
  platform?: HostPlatform | null;
  /** This host's connection; absent / `epoch: null` = not connected. */
  conn?: HostConnView;
}

/** One host's connection (main `HostConnection`). */
export interface HostConnView {
  /**
   * Routing epoch: fresh for every (re)established connection, also for A → B → A. Calls carry it
   * (`HostBinding`) and events carry it; null = not connected. Mock browser hosts may leave it null
   * (no privileged IPC binding).
   */
  epoch: string | null;
  /** SSH tunnel; null for the local host (and dev-direct hosts). */
  tunnel: TunnelView | null;
  daemon: DaemonState;
  /** cutex build identity from `/v2/capabilities` `cutexBuild` (null until read / older cutex). */
  cutexBuild: CutexBuild | null;
}

/**
 * Renderer-observed routing identity of one host connection. Not a daemon credential. `focus`: a call
 * to the focus host (`bridge.api`) — main also refuses it when that host is no longer the focus at
 * admission or by the time it answers (the single-host "host switched" rule, now that the old focus
 * host may stay connected). Calls through `apiFor` (background work of one host) omit it.
 */
export interface HostBinding { hostId: string; epoch: string; focus?: boolean }

export interface HostsState {
  /** What the UI shows (P0: always `{ kind: "host", id: active }`). */
  scope: ViewScope;
  /**
   * The focus host: `bridge.api` calls go there and the single-host UI shows it (P0: the scope's
   * host). Per-host connection details are in `hosts[].conn`.
   */
  active: string;
  startOn: HostStartOn;
  hosts: HostView[];
  groups: HostGroup[];
  /** The focus host's tunnel (= its `conn.tunnel`); null for the local host. */
  tunnel: TunnelView | null;
  /** Linux without a keyring: safeStorage falls back to a weak obfuscation. */
  weakSecretStorage: boolean;
}

/** The routing epoch of `hostId`'s connection (null: not connected / unknown). */
export function hostEpoch(state: Pick<HostsState, "hosts"> | null | undefined, hostId: string): string | null {
  return state?.hosts.find((h) => h.id === hostId)?.conn?.epoch ?? null;
}

/** Ids of the hosts with a connection (focus first). */
export function connectedHosts(state: Pick<HostsState, "hosts" | "active"> | null | undefined): string[] {
  if (!state) return [];
  const ids = state.hosts.filter((h) => !!h.conn?.epoch).map((h) => h.id);
  return [...ids.filter((id) => id === state.active), ...ids.filter((id) => id !== state.active)];
}

/** Host ids in the view scope (unknown group / host → empty; P0: the scope host). */
export function scopeHosts(state: Pick<HostsState, "scope" | "hosts" | "groups"> | null | undefined): string[] {
  if (!state) return [];
  const known = new Set(state.hosts.map((h) => h.id));
  const scope = state.scope;
  if (scope.kind === "host") return known.has(scope.id) || scope.id === LOCAL_HOST_ID ? [scope.id] : [];
  if (scope.kind === "group") return (state.groups.find((g) => g.id === scope.id)?.hosts ?? []).filter((id) => known.has(id));
  return [...known];
}

export interface AddSshHostRequest {
  target: string;
  label?: string;
  remotePort?: number;
  cutexPath?: string;
}

export interface SshHostPatch {
  label?: string;
  remotePort?: number;
  cutexPath?: string;
}

/** `cutexPath`: what the host now uses (the discovered absolute path when the given one failed). */
/** `pending` (cutex users): the new token waits for the host owner to assign it to a user. */
export type HostResult = { ok: true; hostId: string; cutexPath?: string; pending?: boolean } | { ok: false; error: SshErrorView };

export interface HostTestResult {
  ok: boolean;
  /** null: the cutex predates `cutexBuild` (r224). */
  cutexBuild?: CutexBuild | null;
  hostId?: string;
  /** Remote-mode features the remote cutex lacks (REMOTE_FEATURES values). */
  missing?: string[];
  error?: SshErrorView;
  /** Daemon-level failure (tunnel fine, HTTP failed). */
  message?: string;
}

/** `GET /v2/fs/dirs` (cutex fs-dir-browse). */
export interface DirBrowse {
  path: string;
  parent: string | null;
  entries: { name: string; path: string; isDir: boolean; hidden?: boolean }[];
  home: string | null;
  roots: string[];
  truncated: boolean;
}

/**
 * Host colors (RFC §8.1): this machine slate grey, SSH hosts in order orange / purple / teal / rose /
 * amber / lime / fuchsia — no cyan / blue (project colors use those).
 */
export const HOST_PALETTE = ["#64748b", "#f97316", "#a855f7", "#14b8a6", "#f43f5e", "#f59e0b", "#84cc16", "#d946ef"] as const;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
/** DEV ONLY loopback host ids (main/devHosts.ts). */
const DEV_HOST_ID = /^dev-[a-z0-9-]{1,32}$/;

/** The first SSH palette color no host uses yet (cycling when all are taken). */
export function nextHostColor(used: readonly string[]): string {
  const ssh = HOST_PALETTE.slice(1);
  return ssh.find((c) => !used.includes(c)) ?? ssh[used.length % ssh.length]!;
}

export function isHostPlatform(value: unknown): value is HostPlatform {
  return value === "windows" || value === "linux" || value === "macos";
}

/** cutex `/v2/host.platform` (Rust `std::env::consts::OS` style) as a HostPlatform. */
export function hostPlatformOf(platform: string | null | undefined): HostPlatform | null {
  const p = (platform ?? "").toLowerCase();
  if (p.startsWith("win")) return "windows";
  if (p === "linux") return "linux";
  if (p === "macos" || p === "darwin" || p === "mac") return "macos";
  return null;
}

export function emptyHostsFile(): HostsFile {
  return { version: 2, hosts: [], local: { autoConnect: true, color: HOST_PALETTE[0], platform: null }, startOn: "last", scope: { kind: "host", id: LOCAL_HOST_ID }, groups: [] };
}

/**
 * userData/hosts.json, read defensively (bad entries dropped, defaults filled in). A v1 file is
 * migrated (one-way): `lastActive` → `scope`, every host auto-connects, colors from the palette in
 * order, platform unknown, no groups.
 */
export function parseHostsFile(raw: unknown): HostsFile {
  const file = emptyHostsFile();
  if (!raw || typeof raw !== "object") return file;
  const r = raw as Record<string, unknown>;
  const v1 = r.version !== 2;
  if (r.startOn === "local" || r.startOn === "last") file.startOn = r.startOn;
  const seen = new Set<string>();
  const used: string[] = [];
  for (const h of Array.isArray(r.hosts) ? r.hosts : []) {
    const x = h as Record<string, unknown> | null;
    if (!x || typeof x.id !== "string" || !/^ssh-[a-z0-9]{4,32}$/.test(x.id) || seen.has(x.id)) continue;
    if (typeof x.target !== "string" || !parseSshTarget(x.target)) continue;
    seen.add(x.id);
    const color = !v1 && typeof x.color === "string" && HEX_COLOR.test(x.color) ? x.color : nextHostColor(used);
    used.push(color);
    file.hosts.push({
      id: x.id,
      label: typeof x.label === "string" && x.label.trim() ? x.label.trim().slice(0, 64) : defaultHostLabel(x.target),
      target: x.target.trim(),
      remotePort: isValidPort(x.remotePort) ? x.remotePort : DEFAULT_REMOTE_PORT,
      cutexPath: typeof x.cutexPath === "string" && isValidCutexPath(x.cutexPath) ? x.cutexPath : DEFAULT_CUTEX_PATH,
      tokenId: isValidTokenId(x.tokenId) ? x.tokenId : null,
      createdAt: typeof x.createdAt === "string" ? x.createdAt : "",
      lastConnectedAt: typeof x.lastConnectedAt === "string" ? x.lastConnectedAt : null,
      autoConnect: v1 || typeof x.autoConnect !== "boolean" ? true : x.autoConnect,
      color,
      platform: !v1 && isHostPlatform(x.platform) ? x.platform : null,
    });
  }
  const known = (id: unknown): id is string => typeof id === "string" && (id === LOCAL_HOST_ID || seen.has(id));
  // Group members: known hosts, plus DEV ONLY `dev-…` hosts (not in hosts.json; filtered when shown).
  const member = (id: unknown): id is string => known(id) || (typeof id === "string" && DEV_HOST_ID.test(id));
  if (!v1) {
    const l = (r.local ?? {}) as Record<string, unknown>;
    file.local = {
      autoConnect: typeof l.autoConnect === "boolean" ? l.autoConnect : true,
      color: typeof l.color === "string" && HEX_COLOR.test(l.color) ? l.color : HOST_PALETTE[0],
      platform: isHostPlatform(l.platform) ? l.platform : null,
    };
    const groupIds = new Set<string>();
    for (const g of Array.isArray(r.groups) ? r.groups : []) {
      const x = g as Record<string, unknown> | null;
      if (!x || typeof x.id !== "string" || !HOST_GROUP_ID.test(x.id) || groupIds.has(x.id) || typeof x.name !== "string" || !x.name.trim()) continue;
      const name = x.name.trim().slice(0, HOST_GROUP_NAME_MAX);
      if (file.groups.some((other) => sameGroupName(other.name, name))) continue;
      groupIds.add(x.id);
      file.groups.push({ id: x.id, name, hosts: [...new Set(Array.isArray(x.hosts) ? x.hosts.filter(member) : [])], ...(isHostColor(x.color) ? { color: x.color.toLowerCase() } : {}) });
    }
    const s = (r.scope ?? null) as { kind?: unknown; id?: unknown } | null;
    if (s?.kind === "all") file.scope = { kind: "all" };
    else if (s?.kind === "group" && typeof s.id === "string" && groupIds.has(s.id)) file.scope = { kind: "group", id: s.id };
    else if (s?.kind === "host" && known(s.id)) file.scope = { kind: "host", id: s.id };
  } else if (known(r.lastActive)) file.scope = { kind: "host", id: r.lastActive };
  return file;
}

export function isHostColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/** Desktop-local look of a host (Settings → 主机 card; `setHostAppearance`). */
export interface HostAppearancePatch {
  /** `#rrggbb` (palette swatch or custom hex). */
  color?: string;
}

/** Same scope (kind + id). */
export function sameScope(a: ViewScope | null | undefined, b: ViewScope | null | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === "all" || a.id === (b as { id: string }).id;
}

/**
 * The scope after a host or group member went away (RFC §11, ★ Q20): a scope naming a host that no
 * longer exists, or a group left without members, falls back to every host — or to this machine
 * when it is the only host left. Any other scope is kept (same object).
 */
export function scopeAfterRemoval(scope: ViewScope, remaining: { hosts: readonly string[]; groups: readonly HostGroup[] }): ViewScope {
  const known = new Set([LOCAL_HOST_ID, ...remaining.hosts]);
  const fallback = (): ViewScope => (known.size <= 1 ? { kind: "host", id: LOCAL_HOST_ID } : { kind: "all" });
  if (scope.kind === "host") return known.has(scope.id) ? scope : fallback();
  if (scope.kind === "group") {
    const group = remaining.groups.find((g) => g.id === scope.id);
    return group && group.hosts.some((id) => known.has(id)) ? scope : fallback();
  }
  return scope;
}

/** The view scope on launch (★ RFC Q4: the last one; `startOn: "local"` = this machine). */
export function initialScope(file: HostsFile): ViewScope {
  return file.startOn === "last" ? file.scope : { kind: "host", id: LOCAL_HOST_ID };
}

/**
 * The focus host of a scope: the host itself; a group's first member; for every host, this machine
 * (RFC §6.2 refines this with the selected agent in P1).
 */
export function focusHostOf(scope: ViewScope, file: Pick<HostsFile, "hosts" | "groups">): string {
  const known = (id: string) => id === LOCAL_HOST_ID || file.hosts.some((h) => h.id === id);
  if (scope.kind === "host") return known(scope.id) ? scope.id : LOCAL_HOST_ID;
  if (scope.kind === "group") return file.groups.find((g) => g.id === scope.id)?.hosts.find(known) ?? LOCAL_HOST_ID;
  return LOCAL_HOST_ID;
}

// ---------- targets ----------

export interface SshTarget {
  /** What goes after `--` on the ssh command line: `alias`, `host` or `user@host`. */
  destination: string;
  port: number | null;
}

const USER = "[A-Za-z0-9._%+-]+";
const HOSTNAME = "[A-Za-z0-9_](?:[A-Za-z0-9._-]{0,252})";
const TARGET_RE = new RegExp(`^(?:(${USER})@)?(\\[[0-9A-Fa-f:.]+\\]|${HOSTNAME})(?::(\\d{1,5}))?$`);

/**
 * `alias`, `host`, `user@host`, `user@host:port` or `user@[v6]:port`. Never starts with `-` (no
 * option injection); null when malformed.
 */
export function parseSshTarget(input: string): SshTarget | null {
  const raw = input.trim();
  if (!raw || raw.startsWith("-") || raw.length > 300) return null;
  const m = TARGET_RE.exec(raw);
  if (!m) return null;
  const [, user, hostPart, portText] = m;
  const host = hostPart!.startsWith("[") ? hostPart!.slice(1, -1) : hostPart!;
  if (!host || (user && user.startsWith("-"))) return null;
  let port: number | null = null;
  if (portText !== undefined) {
    port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  }
  return { destination: user ? `${user}@${host}` : host, port };
}

export function isValidPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** Remote cutex binary: a bare name or a path; no spaces, quotes or shell metacharacters. */
export function isValidCutexPath(path: string): boolean {
  return /^[A-Za-z0-9_./~:\\+-]{1,256}$/.test(path) && !path.startsWith("-");
}

const labelPart = (text: string, max: number) => text.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max);

/** 32-bit FNV-1a as 6 hex digits (a short, stable instance hint; not a secret). */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

/**
 * Client token label: `desktop-<hostname>-<userData folder name>-<hash of the userData path>`, so
 * `cutex client-token list` tells two desktop instances of one machine apart (an installed app and a
 * dev / side instance with its own userData). `userData` omitted: `desktop-<hostname>`.
 */
export function deviceLabel(hostname: string, userData?: string): string {
  const name = labelPart(hostname, 48) || "unknown";
  if (!userData) return `desktop-${name}`;
  const folder = labelPart(userData.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "", 24);
  return `desktop-${name}-${folder ? `${folder}-` : ""}${shortHash(userData.toLowerCase())}`;
}

/** The userData folder name of an installed app (`%APPDATA%\Cutex`, `~/.config/Cutex`). */
export const DEFAULT_USER_DATA_FOLDER = "Cutex";

/**
 * Reads a `deviceLabel` back: `desktop-<hostname>[-<folder>]-<6 hex>`, parsed from the end (the hash,
 * then the folder; the hostname is what remains, so a hostname may contain `-`, a folder may not).
 * `folder` is null when the label has none (`desktop-<hostname>-<hash>`). Null when the label is not
 * of that shape (an older `desktop-<hostname>` without hash, a typed label, a phone).
 */
export function parseDeviceLabel(label: string): { host: string; folder: string | null; hash: string } | null {
  const m = /^desktop-(.+)$/.exec(label.trim());
  if (!m) return null;
  const parts = m[1]!.split("-");
  const hash = parts.pop();
  if (!hash || !/^[0-9a-f]{6}$/.test(hash) || parts.length === 0 || parts.some((p) => p === "")) return null;
  const folder = parts.length >= 2 ? parts.pop()! : null;
  return { host: parts.join("-"), folder, hash };
}

/** Display label for a new host when the user gives none: the alias / host part of the target. */
export function defaultHostLabel(target: string): string {
  const t = parseSshTarget(target);
  if (!t) return target.trim();
  const at = t.destination.lastIndexOf("@");
  return at >= 0 ? t.destination.slice(at + 1) : t.destination;
}

// ---------- ssh command lines ----------

const COMMON = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];

/** `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remote> … -- <destination>` (no remote command). */
export function tunnelArgs(target: SshTarget, localPort: number, remotePort: number): string[] {
  return [
    "-N",
    "-T",
    ...COMMON,
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    ...(target.port ? ["-p", String(target.port)] : []),
    "--",
    target.destination,
  ];
}

/** One-shot remote command (`ssh -T … -- <destination> <command>`); the command is one string. */
export function execArgs(target: SshTarget, command: string): string[] {
  return ["-T", ...COMMON, ...(target.port ? ["-p", String(target.port)] : []), "--", target.destination, command];
}

export function tokenIssueCommand(cutexPath: string, label: string): string {
  return `${cutexPath} management client-token issue --label ${label}`;
}

export function tokenRevokeCommand(cutexPath: string, tokenId: string): string {
  return `${cutexPath} management client-token revoke ${tokenId}`;
}

export function isValidTokenId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(id);
}

// ---------- finding cutex on the remote ----------

/**
 * Where to look when the configured cutex path fails with "command not found": non-interactive ssh
 * commands get a minimal PATH, so a cutex that a login shell finds (profile-added dirs such as
 * a Linux host's ~/Resources/Shortcuts) is not found. In order; labels are shown as "tried".
 * `{name}` is the configured command name.
 */
export const CUTEX_CANDIDATES = ["{configured}", "$SHELL -lc 'command -v {name}'", "bash -lc 'command -v {name}'", "~/Resources/Shortcuts/cutex", "~/.local/bin/cutex", "~/.cargo/bin/cutex"] as const;

/** Display labels of `CUTEX_CANDIDATES` for this configured path. */
export function cutexCandidateLabels(configured: string): string[] {
  const name = configured.includes("/") ? "cutex" : configured;
  return CUTEX_CANDIDATES.map((c) => c.replace("{configured}", configured).replace("{name}", name));
}

/**
 * One POSIX `sh` script (one ssh round trip) that tries every candidate in order and prints
 * `try <i>` per candidate and `found <i> <absolute path>` for the first executable one. A path that
 * is a directory means the `cutex` binary inside it. Symlinks are kept (not dereferenced), so a
 * "current release" link keeps following upgrades. `configured` must pass `isValidCutexPath`
 * (no quotes / spaces), which is what makes embedding it safe.
 */
export function cutexDiscoveryCommand(configured: string): string {
  const home = (p: string) => (p === "~" ? "$HOME" : p.startsWith("~/") ? `$HOME/${p.slice(2)}` : p);
  const name = configured.includes("/") ? "cutex" : configured;
  const script = [
    `check() { printf "try %s\\n" "$1"; p="$2"; if [ -d "$p" ] && [ -x "$p/cutex" ]; then p="$p/cutex"; fi; if [ -f "$p" ] && [ -x "$p" ]; then case "$p" in /*) ;; *) p="$PWD/$p";; esac; printf "found %s %s\\n" "$1" "$p"; exit 0; fi; }`,
    `look() { printf "try %s\\n" "$1"; case "$2" in /*) if [ -x "$2" ]; then printf "found %s %s\\n" "$1" "$2"; exit 0; fi;; esac; }`,
    configured.includes("/") ? `check 0 "${home(configured)}"` : `look 0 "$(command -v ${name} 2>/dev/null)"`,
    `look 1 "$("\${SHELL:-/bin/sh}" -lc "command -v ${name}" 2>/dev/null </dev/null | tail -n 1)"`,
    `if command -v bash >/dev/null 2>&1; then look 2 "$(bash -lc "command -v ${name}" 2>/dev/null </dev/null | tail -n 1)"; fi`,
    `check 3 "$HOME/Resources/Shortcuts/cutex"`,
    `check 4 "$HOME/.local/bin/cutex"`,
    `check 5 "$HOME/.cargo/bin/cutex"`,
    "exit 3",
  ].join("\n");
  return `sh -c '${script}'`;
}

/** What the discovery script reported: the first hit (absolute path) and the labels it tried. */
export function parseCutexDiscovery(stdout: string, configured: string): { path: string | null; tried: string[] } {
  const labels = cutexCandidateLabels(configured);
  const tried: string[] = [];
  let path: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^(try|found) (\d+)(?: (\/.*))?$/.exec(line.trim());
    if (!m) continue;
    const label = labels[Number(m[2])];
    if (!label) continue;
    if (m[1] === "try" && !tried.includes(label)) tried.push(label);
    if (m[1] === "found" && m[3] && isValidCutexPath(m[3])) {
      path = m[3];
      break;
    }
  }
  return { path, tried };
}

/** Runs one remote command (ssh). Thrown errors are ssh failures, mapped by `toError`. */
export type RemoteRunner = (command: string) => Promise<{ code: number | null; stdout: string; stderr: string }>;

/**
 * `cutex management client-token issue` with the configured path; on "command not found" find
 * cutex (`cutexDiscoveryCommand`) and issue again with the absolute path it found, which the caller
 * stores. Nothing found: cutexNotFound with the list of places tried.
 */
export async function issueTokenFindingCutex(
  run: RemoteRunner,
  cutexPath: string,
  label: string,
  toError: (error: unknown) => SshErrorView,
): Promise<{ ok: true; token: IssuedToken; cutexPath: string } | { ok: false; error: SshErrorView }> {
  const issue = async (path: string): Promise<{ ok: true; token: IssuedToken; cutexPath: string } | { ok: false; error: SshErrorView }> => {
    try {
      const r = await run(tokenIssueCommand(path, label));
      if (r.code !== 0) return { ok: false, error: classifySshFailure(r.code, r.stderr, "exec") };
      const token = parseTokenIssue(r.stdout);
      // Never echo stdout: it may hold the token in a shape we did not recognise.
      if (!token) return { ok: false, error: { code: "badOutput", detail: `${r.stdout.length} bytes of unrecognised output` } };
      return { ok: true, token, cutexPath: path };
    } catch (error) {
      return { ok: false, error: toError(error) };
    }
  };
  const first = await issue(cutexPath);
  if (first.ok || first.error.code !== "cutexNotFound") return first;
  let found: { path: string | null; tried: string[] } = { path: null, tried: [cutexPath] };
  try {
    const r = await run(cutexDiscoveryCommand(cutexPath));
    const parsed = parseCutexDiscovery(r.stdout, cutexPath);
    found = { path: parsed.path, tried: parsed.tried.length ? parsed.tried : found.tried };
  } catch {
    // ssh failed now: report the original not-found
  }
  if (!found.path || found.path === cutexPath) return { ok: false, error: { ...first.error, tried: found.tried } };
  return issue(found.path);
}

// ---------- remote output ----------

export interface IssuedToken {
  tokenId: string;
  label: string;
  token: string;
  createdAt: string;
  /** cutex `users`: not assigned to any user yet (connects, sees nothing until an owner device assigns it). */
  pending?: boolean;
}

/** `client-token issue` stdout: one JSON object (possibly after banner lines). */
export function parseTokenIssue(stdout: string): IssuedToken | null {
  const candidates = [stdout.trim(), ...stdout.split(/\r?\n/).map((l) => l.trim()).reverse()];
  for (const text of candidates) {
    if (!text.startsWith("{")) continue;
    try {
      const v = JSON.parse(text) as Record<string, unknown>;
      if (typeof v.token === "string" && v.token.length > 0 && v.token.length <= 4096 && isValidTokenId(v.tokenId)) {
        return { tokenId: v.tokenId, label: typeof v.label === "string" ? v.label : "", token: v.token, createdAt: typeof v.createdAt === "string" ? v.createdAt : "", ...(v.pending === true ? { pending: true } : {}) };
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Host aliases from an ssh_config text: `Host` patterns without wildcards / negation. */
export function parseSshConfigHosts(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*host(?:\s+|\s*=\s*)(.+)$/i.exec(line.replace(/(^|\s)#.*$/, ""));
    if (!m) continue;
    for (const raw of m[1]!.trim().split(/\s+/)) {
      const name = raw.replace(/^"|"$/g, "");
      if (!name || /[*?!]/.test(name) || out.includes(name)) continue;
      if (parseSshTarget(name)) out.push(name);
    }
  }
  return out;
}

// ---------- errors ----------

const NOISE = /^(Warning: Permanently added|Pseudo-terminal will not be allocated|\*\*|Connection to .* closed\.)/;

export function stderrTail(stderr: string, max = 600): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l && !NOISE.test(l));
  let out = lines.join("\n");
  if (out.length > max) out = `…${out.slice(-max)}`;
  return out;
}

/**
 * What an ssh run's failure means. `context` "exec": the remote command ran (any exit code other
 * than 255 is the remote's own), so "not found" / clap errors point at the remote cutex.
 */
export function classifySshFailure(exitCode: number | null, stderr: string, context: "tunnel" | "exec"): SshErrorView {
  const detail = stderrTail(stderr);
  const s = stderr;
  const code = ((): SshErrorCode => {
    if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No (?:\S+ )?host key is known|host key for .* has changed/i.test(s)) return "hostKey";
    if (/Permission denied \(|no supported authentication methods|Too many authentication failures|Authentication failed|passphrase/i.test(s)) return "auth";
    if (/Could not resolve hostname|Name or service not known|nodename nor servname|No such host is known/i.test(s)) return "resolve";
    if (/port forwarding failed|cannot listen to port|Address already in use|Could not request local forwarding|bind.*: (?:Permission denied|Address already in use)/i.test(s)) return "forward";
    // POSIX: "connect to host h port 22: Connection refused"; Windows OpenSSH: "banner exchange:
    // Connection to UNKNOWN port -1: Connection refused". A refused forward *channel* (remote daemon
    // down) does not end ssh and is not this.
    if (/Connection refused/i.test(s) && !/channel \d+: open failed/i.test(s)) return "refused";
    if (/Connection timed out|Operation timed out|timed out during banner exchange|timed out waiting for the port forward/i.test(s)) return "timeout";
    if (context === "exec" && exitCode !== 255) {
      if (/unrecognized subcommand|unexpected argument|wasn't expected|unknown (?:sub)?command|invalid subcommand|no such (?:sub)?command/i.test(s)) return "cutexTooOld";
      if (exitCode === 127 || /command not found|not recognized as an internal or external command|No such file or directory|cannot find the (?:file|path)/i.test(s)) return "cutexNotFound";
    }
    return "exited";
  })();
  return { code, detail: detail || (exitCode === null ? "" : `exit code ${exitCode}`) };
}

/** Errors that will not fix themselves: no automatic tunnel retry (the user retries). */
export function isPermanentSshError(code: SshErrorCode): boolean {
  return code === "auth" || code === "hostKey" || code === "noSsh" || code === "noToken" || code === "noKeyring" || code === "tokenRejected" || code === "badInput";
}

// ---------- tunnel state ----------

export const TUNNEL_MAX_BACKOFF_MS = 30_000;
/** An attempt that stayed up this long resets the backoff. */
export const TUNNEL_STABLE_MS = 30_000;

/** 1 s, 2 s, 4 s … capped at 30 s (attempt counts from 1). */
export function backoffMs(attempt: number): number {
  return Math.min(TUNNEL_MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempt - 1));
}

export function initialTunnel(): TunnelView {
  return { status: "idle", localPort: null, error: null, attempt: 0, retryAt: null, upSince: null };
}

export type TunnelEvent =
  | { type: "spawn"; localPort: number }
  | { type: "ready"; now: number }
  | { type: "exit"; error: SshErrorView; now: number }
  | { type: "stop" };

export function tunnelReduce(s: TunnelView, e: TunnelEvent): TunnelView {
  switch (e.type) {
    case "spawn":
      return { ...s, status: "starting", localPort: e.localPort, retryAt: null, upSince: null };
    case "ready":
      return { ...s, status: "up", error: null, retryAt: null, upSince: e.now };
    case "exit": {
      const stable = s.upSince !== null && e.now - s.upSince >= TUNNEL_STABLE_MS;
      const attempt = (stable ? 0 : s.attempt) + 1;
      if (isPermanentSshError(e.error.code)) return { ...s, status: "error", error: e.error, attempt, retryAt: null, upSince: null };
      return { ...s, status: "retrying", error: e.error, attempt, retryAt: e.now + backoffMs(attempt), upSince: null };
    }
    case "stop":
      return { ...initialTunnel(), localPort: s.localPort };
  }
}

/**
 * Why this machine's cutex does not answer (DaemonState unreachable `setup`): discovery found no
 * management token (no config.json, or one without a token) — cutex is not installed / never set up
 * here — or it is installed and its management service is stopped.
 */
export function localDaemonSetup(endpoint: { token: string | null }): "notInstalled" | "notRunning" {
  return endpoint.token ? "notRunning" : "notInstalled";
}
