// Host registry and connections (multi-host P0, docs/research/multi-host-rfc-20261009.md §4): one
// `HostConnection` (daemon service + SSH tunnel + host feed) per connected host; the view scope picks
// what the UI shows, and connected hosts outside it stay connected when they auto-connect (their
// notifications, approvals and counts keep working). The local host is found by discovery (root
// token from ~/.cutex/config.json); SSH hosts get a client token at pairing time (`cutex management
// client-token issue` over ssh), stored encrypted with Electron safeStorage in userData — never
// logged, never sent to the renderer — and are reached through an `ssh -L` tunnel. DEV ONLY:
// `CUTEX_DESKTOP_DEV_HOSTS` adds direct loopback hosts (main/devHosts.ts; ignored when packaged).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { CutexApiError, CutexClient, CutexUnreachableError, readCutexBuild, type CutexBuild, type DaemonEndpoint } from "@cutex-desktop/cutex-client";
import { discoverLocalDaemon } from "@cutex-desktop/cutex-client/node";
import {
  DEFAULT_CUTEX_PATH,
  DEFAULT_REMOTE_PORT,
  LOCAL_HOST_ID,
  REMOTE_FEATURES,
  defaultHostLabel,
  deviceLabel,
  focusHostOf,
  hostPlatformOf,
  initialScope,
  initialTunnel,
  isHostColor,
  isValidCutexPath,
  isValidPort,
  nextHostColor,
  normalizeHostGroups,
  parseHostsFile,
  parseSshConfigHosts,
  parseSshTarget,
  issueTokenFindingCutex,
  scopeAfterRemoval,
  tokenRevokeCommand,
  type AddSshHostRequest,
  type HostAppearancePatch,
  type HostConnView,
  type HostGroupDraft,
  type HostPlatform,
  type HostResult,
  type HostsFile,
  type HostsState,
  type HostStartOn,
  type HostTestResult,
  type HostView,
  type IssuedToken,
  type SshErrorView,
  type SshHostConfig,
  type SshHostPatch,
  type SshTarget,
  type TunnelView,
  type ViewScope,
} from "../shared/hosts";
import type { CapabilitiesView, DaemonState, HostApi } from "../shared/ipc";
import type { DaemonService } from "./daemon";
import { SshFailure, SshTunnel, TunnelPidFile, openTemporaryTunnel, runSsh } from "./ssh";
import { SshAskpass, type AskpassSession } from "./sshAskpass";
import type { SshPromptAnswer, SshPromptView } from "../shared/sshPrompt";
import type { ClaimTarget, PersonIdentityService } from "./personIdentity";
import type { IdentityFileResult, IdentityImportTexts, IdentityKeyCopyResult, PersonIdentityView } from "../shared/personIdentity";
import { loadDevHosts, readDevToken, type DevHostConfig } from "./devHosts";
import { logError } from "./errorLog";
import { checkTransferRequest, transferProfile } from "./profileTransfer";
import type { ProfileTransferRequest, ProfileTransferResult } from "../shared/profileTransfer";

type PublishHosts = (event: "hostsState", payload: HostsState) => void;

/** DEV ONLY: a direct loopback host (main/devHosts.ts) with its in-memory desktop settings. */
type DevHost = DevHostConfig & { autoConnect: boolean; color: string; platform: HostPlatform | null };

/** Client tokens, encrypted with safeStorage (DPAPI / Keychain / libsecret), keyed by host id. */
class TokenStore {
  private tokens: Record<string, string> = {};
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as { tokens?: Record<string, unknown> };
      for (const [id, v] of Object.entries(data.tokens ?? {})) if (typeof v === "string") this.tokens[id] = v;
    } catch {
      // none yet
    }
  }

  get(id: string): string | null {
    const enc = this.tokens[id];
    if (!enc || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(enc, "base64"));
    } catch {
      return null;
    }
  }

  has(id: string): boolean {
    return id in this.tokens;
  }

  set(id: string, token: string): void {
    this.tokens[id] = safeStorage.encryptString(token).toString("base64");
    this.save();
  }

  delete(id: string): void {
    if (!(id in this.tokens)) return;
    delete this.tokens[id];
    this.save();
  }

  private save(): void {
    const body = `${JSON.stringify({ version: 1, tokens: this.tokens }, null, 2)}\n`;
    const file = this.file;
    this.saving = this.saving
      .then(async () => {
        await writeFile(`${file}.tmp`, body, { encoding: "utf8", mode: 0o600 });
        await rename(`${file}.tmp`, file);
      })
      .catch((error: unknown) => console.warn("[cutex-desktop] saving host tokens failed", (error as Error).message));
  }
}

function errorView(error: unknown): SshErrorView {
  if (error instanceof SshFailure) return error.view;
  return { code: "exited", detail: error instanceof Error ? error.message : String(error) };
}

function sshMessage(error: SshErrorView | null): string {
  if (!error) return "ssh";
  return error.detail ? `ssh ${error.code}: ${error.detail}` : `ssh ${error.code}`;
}
export interface HostManagerOptions {
  /** Local discovery overrides (dev: isolated cutex home / port, see AGENTS.md). */
  home?: string;
  baseUrl?: string;
  /** A host's connection ended (disconnected, replaced or the host removed): main/index.ts drops its big alerts. */
  onDisconnect?(hostId: string): void;
  /** P2 person identity (main/personIdentity.ts): claims on connect, the identity HostApi calls. Absent in tests. */
  identity?: PersonIdentityService;
  /**
   * This machine is a host (main/localHost.ts; default true). False (macOS without a local cutex):
   * no local host is listed, connected or chosen; the focus falls back to a remote host, or to
   * none at all (an empty `hosts`: the renderer guides to adding an SSH host).
   */
  localHost?: boolean;
  /** The open SSH questions changed (main/index.ts → renderer event `sshPrompts`). */
  onSshPrompts?(prompts: SshPromptView[]): void;
}

/**
 * A fresh daemon service for one connection of one host. main/index.ts tags its events with
 * `hostId` + `epoch` (DaemonService itself knows neither) and drops them once the connection is replaced.
 */
export type DaemonFactory = (hostId: string, epoch: string) => DaemonService;

/** One connected (or connecting) host. */
export interface HostConnection {
  readonly hostId: string;
  /** Fresh for every (re)established connection, also for A → B → A (C-011 per host). */
  readonly routingEpoch: string;
  readonly daemon: DaemonService;
  tunnel: SshTunnel | null;
  /** Shown when the SSH host cannot even start a tunnel (not paired, bad target). */
  blocked: TunnelView | null;
  /** The daemon service holds this host's endpoint (a re-established tunnel only retargets it). */
  endpointHost: boolean;
  connectedOnce: boolean;
  cutexBuild: CutexBuild | null;
}

export class HostManager implements HostApi {
  private file: HostsFile;
  private readonly filePath: string;
  private readonly tokens: TokenStore;
  private readonly pids: TunnelPidFile;
  private readonly conns = new Map<string, HostConnection>();
  /** SSH prompts (passphrase / password / host key) → the renderer's dialog; created on first use. */
  private askpassBroker: SshAskpass | null = null;
  private scope: ViewScope;
  private saving: Promise<void> = Promise.resolve();
  /** DEV ONLY hosts (CUTEX_DESKTOP_DEV_HOSTS; empty in a packaged app); never written to hosts.json. */
  private readonly dev: Map<string, DevHost>;
  /** HostManagerOptions.localHost === false (undefined on harnesses built without the constructor). */
  private readonly noLocalHost: boolean;

  constructor(
    private readonly emit: PublishHosts,
    private readonly createDaemon: DaemonFactory,
    private readonly local: HostManagerOptions = {},
  ) {
    const dir = app.getPath("userData");
    this.filePath = join(dir, "hosts.json");
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      // first run
    }
    this.file = parseHostsFile(raw);
    this.noLocalHost = this.local.localHost === false;
    // hosts.json v1 → v2 is one-way (RFC §6.4): write the migrated file at once.
    if ((raw as { version?: unknown } | null)?.version !== 2 && raw) this.save();
    this.scope = this.file.scope;
    this.tokens = new TokenStore(join(dir, "host-tokens.json"));
    this.pids = new TunnelPidFile(join(dir, "ssh-tunnels.json"));
    const colors = this.file.hosts.map((h) => h.color);
    this.dev = new Map(
      loadDevHosts().map((h) => {
        const color = nextHostColor(colors);
        colors.push(color);
        return [h.id, { ...h, autoConnect: true, color, platform: null }];
      }),
    );
  }

  /** Launch: the scope's hosts (focus first) and every auto-connect host (★ RFC §3.1). */
  async start(): Promise<void> {
    this.pids.reapStale();
    this.setScopeOnly(this.reachableScope(initialScope(this.file)));
    const focus = this.focus();
    for (const id of [focus, ...this.scopeIds(), ...this.autoConnectIds()]) if (!this.conns.has(id)) this.open(id);
    this.publish();
  }

  /** App quit: no ssh process may outlive the app. */
  stop(): void {
    for (const conn of this.conns.values()) {
      conn.tunnel?.stop();
      conn.tunnel = null;
      conn.daemon.stop();
    }
    this.conns.clear();
    this.askpassBroker?.stop();
  }

  // ---------- SSH prompts (main/sshAskpass.ts) ----------

  private get askpass(): SshAskpass {
    this.askpassBroker ??= new SshAskpass({ dir: join(app.getPath("userData"), "ssh-askpass"), onChange: (prompts) => this.local.onSshPrompts?.(prompts) });
    return this.askpassBroker;
  }

  /** One operation's prompts for a host (closed by the caller, or handed to its connection). */
  private promptSession(target: string): AskpassSession {
    return this.askpass.session(target);
  }

  async sshPrompts(): Promise<SshPromptView[]> {
    return this.askpassBroker?.prompts() ?? [];
  }

  /** The dialog's answer (null = cancel); the answer goes only to the ssh process that asked. */
  async answerSshPrompt(id: string, answer: SshPromptAnswer): Promise<boolean> {
    return this.askpassBroker?.answer(id, answer) ?? false;
  }

  /** The connection of a host (IPC routing); undefined when it is not connected. */
  connection(hostId: string | null | undefined): HostConnection | undefined {
    return hostId ? this.conns.get(hostId) : undefined;
  }

  /** The focus host (P0: the scope's host). */
  focus(): string {
    if (this.scope.kind === "host" && this.devHost(this.scope.id)) return this.scope.id;
    const focus = focusHostOf(this.scope, this.file);
    // No local host: the first remote host; with none at all the local id stays as a placeholder
    // that is never connected (the renderer sees an empty host list).
    if (focus === LOCAL_HOST_ID && this.noLocalHost) return this.file.hosts[0]?.id ?? this.devHosts()[0]?.id ?? LOCAL_HOST_ID;
    return focus;
  }

  /** A scope naming the local host when there is none: the fallback focus host instead (if any). */
  private reachableScope(scope: ViewScope): ViewScope {
    if (!this.noLocalHost || scope.kind !== "host" || scope.id !== LOCAL_HOST_ID) return scope;
    const fallback = this.file.hosts[0]?.id ?? this.devHosts()[0]?.id;
    return fallback ? { kind: "host", id: fallback } : scope;
  }

  /** Fed every daemonState a connection emits (index.ts); stale connections are ignored. */
  onDaemonState(hostId: string, epoch: string, state: DaemonState): void {
    const conn = this.conns.get(hostId);
    if (!conn || conn.routingEpoch !== epoch || state.kind !== "connected") return;
    // P2 person identity: present the key once per host + token + key (a no-op once done).
    this.local.identity?.onConnected(this.claimTarget(conn));
    let changed = false;
    const platform = hostPlatformOf(state.platform);
    if (platform && platform !== this.localConfig(hostId)?.platform) {
      this.patchLocal(hostId, { platform });
      changed = true;
    }
    if (!conn.connectedOnce) {
      conn.connectedOnce = true;
      if (this.find(hostId)) this.patchHost(hostId, { lastConnectedAt: new Date().toISOString() });
      changed = true;
      // cutex build identity for the switcher / settings (Q3 cache); best effort.
      void conn.daemon.capabilities().then((caps) => {
        const build = readCutexBuild(caps);
        if (this.conns.get(hostId) !== conn || !build || JSON.stringify(build) === JSON.stringify(conn.cutexBuild)) return;
        conn.cutexBuild = build;
        this.publish();
      }, () => {});
    }
    if (changed) this.publish();
  }

  // ---------- HostApi ----------

  async hosts(): Promise<HostsState> {
    return this.state();
  }

  async sshConfigHosts(): Promise<string[]> {
    try {
      return parseSshConfigHosts(await readFile(join(homedir(), ".ssh", "config"), "utf8")).slice(0, 200);
    } catch {
      return [];
    }
  }

  async addSshHost(request: AddSshHostRequest): Promise<HostResult> {
    const target = typeof request?.target === "string" ? parseSshTarget(request.target) : null;
    if (!target) return { ok: false, error: { code: "badInput", detail: "target" } };
    const remotePort = request.remotePort ?? DEFAULT_REMOTE_PORT;
    if (!isValidPort(remotePort)) return { ok: false, error: { code: "badInput", detail: "remotePort" } };
    const cutexPath = typeof request.cutexPath === "string" && request.cutexPath.trim() ? request.cutexPath.trim() : DEFAULT_CUTEX_PATH;
    if (!isValidCutexPath(cutexPath)) return { ok: false, error: { code: "badInput", detail: "cutexPath" } };
    const label = (typeof request.label === "string" && request.label.trim() ? request.label.trim() : defaultHostLabel(request.target)).slice(0, 64);
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: { code: "noKeyring", detail: "" } };
    const prompts = this.promptSession(request.target.trim());
    const issued = await this.issueToken(target, cutexPath, prompts);
    if (!issued.ok) {
      prompts.close();
      return issued;
    }
    const id = `ssh-${randomBytes(4).toString("hex")}`;
    this.tokens.set(id, issued.token.token);
    const color = nextHostColor(this.file.hosts.map((h) => h.color));
    this.file = {
      ...this.file,
      hosts: [...this.file.hosts, { id, label, target: request.target.trim(), remotePort, cutexPath: issued.cutexPath, tokenId: issued.token.tokenId, createdAt: new Date().toISOString(), lastConnectedAt: null, autoConnect: true, color, platform: null }],
    };
    this.save();
    // No local host: the first host added becomes the scope (it was the never-connected placeholder).
    const reachable = this.reachableScope(this.scope);
    if (reachable !== this.scope) this.setScopeOnly(reachable);
    // ★ RFC Q2: a newly paired SSH host auto-connects (with the answers given while pairing).
    this.open(id, prompts);
    this.publish();
    return { ok: true, hostId: id, cutexPath: issued.cutexPath, ...(issued.token.pending ? { pending: true } : {}) };
  }

  async pairSshHost(hostId: string): Promise<HostResult> {
    const host = this.find(hostId);
    const target = host ? parseSshTarget(host.target) : null;
    if (!host || !target) return { ok: false, error: { code: "badInput", detail: "host" } };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: { code: "noKeyring", detail: "" } };
    const prompts = this.promptSession(host.target);
    const issued = await this.issueToken(target, host.cutexPath, prompts);
    if (!issued.ok) {
      prompts.close();
      return issued;
    }
    const old = host.tokenId;
    this.tokens.set(host.id, issued.token.token);
    this.patchHost(host.id, { tokenId: issued.token.tokenId, cutexPath: issued.cutexPath });
    // The old token may still be valid (re-pair without a revoke): retire it, best effort.
    if (old && old !== issued.token.tokenId) {
      // Best effort and in the background: answers from the pairing only, no new questions.
      prompts.cancelled = true;
      void runSsh(target, tokenRevokeCommand(issued.cutexPath, old), 20_000, { askpass: prompts }).catch(() => {}).finally(() => prompts.close());
    } else prompts.close();
    if (this.conns.has(host.id) || this.wanted(host.id)) this.reopen(host.id);
    this.publish();
    return { ok: true, hostId: host.id, cutexPath: issued.cutexPath, ...(issued.token.pending ? { pending: true } : {}) };
  }

  async updateSshHost(hostId: string, patch: SshHostPatch): Promise<HostResult> {
    const host = this.find(hostId);
    if (!host) return { ok: false, error: { code: "badInput", detail: "host" } };
    const next: Partial<SshHostConfig> = {};
    if (patch?.label !== undefined) {
      if (typeof patch.label !== "string") return { ok: false, error: { code: "badInput", detail: "label" } };
      next.label = patch.label.trim().slice(0, 64) || defaultHostLabel(host.target);
    }
    if (patch?.remotePort !== undefined) {
      if (!isValidPort(patch.remotePort)) return { ok: false, error: { code: "badInput", detail: "remotePort" } };
      next.remotePort = patch.remotePort;
    }
    if (patch?.cutexPath !== undefined) {
      const p = typeof patch.cutexPath === "string" ? patch.cutexPath.trim() || DEFAULT_CUTEX_PATH : "";
      if (!isValidCutexPath(p)) return { ok: false, error: { code: "badInput", detail: "cutexPath" } };
      next.cutexPath = p;
    }
    this.patchHost(host.id, next);
    if (this.conns.has(host.id) && next.remotePort !== undefined && next.remotePort !== host.remotePort) this.reopen(host.id);
    this.publish();
    return { ok: true, hostId: host.id };
  }

  async removeSshHost(hostId: string): Promise<{ revoked: boolean }> {
    const host = this.find(hostId);
    if (!host) return { revoked: false };
    this.close(host.id);
    this.local.identity?.forget(host.id, true);
    const token = this.tokens.get(host.id);
    this.tokens.delete(host.id);
    this.file = { ...this.file, hosts: this.file.hosts.filter((h) => h.id !== host.id), groups: this.file.groups.map((g) => ({ ...g, hosts: g.hosts.filter((id) => id !== host.id) })) };
    // The scope pointed at it (or at a group it was the last member of): every host (★ RFC Q20; this
    // machine when it is the only host left).
    const scope = this.reachableScope(scopeAfterRemoval(this.scope, { hosts: [...this.file.hosts.map((h) => h.id), ...this.devHosts().map((h) => h.id)], groups: this.file.groups }));
    if (scope !== this.scope) this.setScopeOnly(scope);
    this.save();
    for (const id of this.scopeIds()) if (!this.conns.has(id)) this.open(id);
    this.publish();
    return { revoked: await this.revoke(host, token).catch(() => false) };
  }

  async switchHost(hostId: string): Promise<void> {
    if (!this.known(hostId)) throw new Error("unknown host");
    if (this.scope.kind === "host" && this.scope.id === hostId) return this.reconnectHost(hostId);
    await this.setScope({ kind: "host", id: hostId });
  }

  async setScope(scope: ViewScope): Promise<void> {
    const valid = scope?.kind === "all" || (scope?.kind === "host" && this.known(scope.id)) || (scope?.kind === "group" && this.file.groups.some((g) => g.id === scope.id));
    if (!valid) throw new Error("unknown scope");
    this.setScopeOnly(scope.kind === "all" ? { kind: "all" } : { kind: scope.kind, id: scope.id });
    this.syncConnections();
    this.publish();
  }

  /** The focus host and the scope's hosts are connected; others only when they auto-connect (the caller publishes). */
  private syncConnections(): void {
    // Choosing a host that is not connected connects it (today's switch experience, RFC §3.1).
    for (const id of [this.focus(), ...this.scopeIds()]) if (!this.conns.has(id)) this.open(id);
    // Hosts left outside the scope stay connected only when they auto-connect (★ RFC Q1).
    for (const id of [...this.conns.keys()]) if (!this.wanted(id)) this.close(id);
  }

  async reconnectHost(hostId?: string): Promise<void> {
    const id = hostId ?? this.focus();
    // No host at all (macOS without a local cutex, nothing added yet): nothing to reconnect.
    if (hostId === undefined && !this.known(id)) return;
    if (!this.known(id)) throw new Error("unknown host");
    const conn = this.conns.get(id);
    if (!conn) {
      this.open(id);
      this.publish();
    } else if (conn.tunnel) {
      conn.tunnel.reconnectNow();
      conn.daemon.reconnectNow();
    } else if (id === LOCAL_HOST_ID || this.devHost(id)) conn.daemon.reconnectNow();
    else {
      this.reopen(id);
      this.publish();
    }
  }

  async connectHost(hostId: string, on: boolean): Promise<void> {
    if (!this.known(hostId)) throw new Error("unknown host");
    if (on === this.conns.has(hostId)) return;
    if (on) this.open(hostId);
    else this.close(hostId);
    this.publish();
  }

  async setHostAutoConnect(hostId: string, on: boolean): Promise<HostsState> {
    if (!this.known(hostId)) throw new Error("unknown host");
    if (typeof on !== "boolean") throw new Error("bad autoConnect");
    this.patchLocal(hostId, { autoConnect: on });
    if (on && !this.conns.has(hostId)) this.open(hostId);
    if (!on && this.conns.has(hostId) && !this.wanted(hostId)) this.close(hostId);
    this.publish();
    return this.state();
  }

  async setHostAppearance(hostId: string, patch: HostAppearancePatch): Promise<HostsState> {
    if (!this.known(hostId)) throw new Error("unknown host");
    const color = patch?.color;
    if (color !== undefined && !isHostColor(color)) throw new Error("bad color");
    if (color !== undefined) this.patchLocal(hostId, { color: color.toLowerCase() });
    this.publish();
    return this.state();
  }

  async saveHostGroups(drafts: HostGroupDraft[]): Promise<HostsState> {
    const result = normalizeHostGroups(drafts, (id) => this.known(id), () => `grp-${randomBytes(5).toString("hex")}`);
    if (!result.ok) throw new Error(`bad groups: ${result.error}`);
    const before = this.focus();
    this.file = { ...this.file, groups: result.groups };
    // The scope's group was deleted or left without members: every host (★ RFC Q20 / §11).
    const scope = this.reachableScope(scopeAfterRemoval(this.scope, { hosts: [...this.file.hosts.map((h) => h.id), ...this.devHosts().map((h) => h.id)], groups: result.groups }));
    if (scope !== this.scope) this.setScopeOnly(scope, before);
    else if (before !== this.focus()) this.conns.get(before)?.daemon.detachViews();
    this.save();
    // Members added to / removed from the scope's group: connect the new ones, close the ones left
    // outside that do not auto-connect (as setScope).
    this.syncConnections();
    this.publish();
    return this.state();
  }

  async testHost(hostId: string): Promise<HostTestResult> {
    const host = hostId === LOCAL_HOST_ID ? null : this.find(hostId);
    const dev = this.devHost(hostId);
    if (!this.known(hostId)) return { ok: false, error: { code: "badInput", detail: "host" } };
    // A connected host: ask its live client (no second tunnel).
    const conn = this.conns.get(hostId);
    const live = conn?.daemon.activeClient();
    if (conn && live && conn.daemon.currentState.kind === "connected") return this.probe(live, hostId !== LOCAL_HOST_ID);
    if (dev) {
      try {
        return await this.probe(new CutexClient(this.devEndpoint(dev)), true);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    }
    if (!host) {
      try {
        return await this.probe(new CutexClient(await discoverLocalDaemon(this.local)), false);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    }
    const target = parseSshTarget(host.target);
    const token = this.tokens.get(host.id);
    if (!target) return { ok: false, error: { code: "badInput", detail: "target" } };
    if (!token) return { ok: false, error: { code: "noToken", detail: "" } };
    let tunnel: { port: number; close(): void };
    const prompts = this.promptSession(host.target);
    try {
      tunnel = await openTemporaryTunnel(target, host.remotePort, this.pids, undefined, { askpass: prompts });
    } catch (error) {
      prompts.close();
      return { ok: false, error: errorView(error) };
    }
    try {
      return await this.probe(new CutexClient(this.endpoint(tunnel.port, token, host)), true);
    } finally {
      tunnel.close();
      prompts.close();
    }
  }

  // ---------- P2 person identity (HostApi; main/personIdentity.ts) ----------

  /** A connection as the identity service sees it: an SSH host's own client token id (others: none). */
  private claimTarget(conn: HostConnection): ClaimTarget {
    // The credential as the desktop knows it: an SSH host's client token id, this machine's root
    // credential, a dev host's token file. cutex names the token id to sign in its challenge.
    const credential = this.find(conn.hostId)?.tokenId ?? (conn.hostId === LOCAL_HOST_ID ? "root" : this.devHost(conn.hostId) ? "dev" : "ssh");
    return { hostId: conn.hostId, credential, epoch: conn.routingEpoch, client: conn.daemon };
  }

  /** Connected hosts (identity: claim again after an import). */
  claimTargets(): ClaimTarget[] {
    return [...this.conns.values()].filter((c) => c.daemon.currentState.kind === "connected").map((c) => this.claimTarget(c));
  }

  async identityState(): Promise<PersonIdentityView> {
    if (!this.local.identity) return { publicKey: null, fingerprint: null, error: "unavailable", claims: {} };
    return this.local.identity.view();
  }

  async exportIdentity(title: string): Promise<IdentityFileResult> {
    return this.local.identity ? this.local.identity.exportIdentity(title) : { ok: false, error: "unavailable" };
  }

  async importIdentity(texts: IdentityImportTexts): Promise<IdentityFileResult> {
    return this.local.identity ? this.local.identity.importIdentity(texts) : { ok: false, error: "unavailable" };
  }

  async copyIdentityKey(): Promise<IdentityKeyCopyResult> {
    return this.local.identity ? this.local.identity.copyKeyString() : { ok: false, error: "unavailable" };
  }

  async importIdentityKey(text: string, texts: IdentityImportTexts): Promise<IdentityFileResult> {
    return this.local.identity ? this.local.identity.importKeyString(text, texts) : { ok: false, error: "unavailable" };
  }

  /** 复制到其他主机: export on the source host's connection, import on the target's (main → main). */
  async copyProfileToHost(request: ProfileTransferRequest): Promise<ProfileTransferResult> {
    const checked = checkTransferRequest(request);
    if (typeof checked === "string") return { ok: false, stage: "request", error: { code: "invalid_request", message: checked } };
    const source = this.conns.get(checked.sourceHostId);
    const target = this.conns.get(checked.targetHostId);
    if (!source || !target) return { ok: false, stage: "request", error: { code: "host_not_connected", message: "both hosts must be connected" } };
    return transferProfile(
      checked,
      { exportBundle: (profile, includeCredentials) => source.daemon.exportProfileBundle(profile, includeCredentials) },
      { importBundle: (bundle, name) => target.daemon.importProfileBundle(bundle, name) },
      logError,
    );
  }

  async setIdentityName(name: string | null): Promise<void> {
    this.local.identity?.setDisplayName(name);
  }

  async setHostStartOn(value: HostStartOn): Promise<HostsState> {
    if (value !== "local" && value !== "last") throw new Error("bad startOn");
    this.file = { ...this.file, startOn: value };
    this.save();
    this.publish();
    return this.state();
  }

  // ---------- internals ----------

  state(): HostsState {
    const view = (id: string): HostConnView => {
      const conn = this.conns.get(id);
      if (!conn) return { epoch: null, tunnel: null, daemon: { kind: "unreachable", baseUrl: "", message: "not connected" }, cutexBuild: null };
      const tunnel = id === LOCAL_HOST_ID || this.devHost(id) ? null : (conn.tunnel?.state ?? conn.blocked ?? initialTunnel());
      return { epoch: conn.routingEpoch, tunnel, daemon: conn.daemon.currentState, cutexBuild: conn.cutexBuild };
    };
    const l = this.file.local;
    const local: HostView = { id: LOCAL_HOST_ID, kind: "local", label: hostname(), target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, autoConnect: l.autoConnect, color: l.color, platform: l.platform, conn: view(LOCAL_HOST_ID) };
    const ssh = this.file.hosts.map(
      (h): HostView => ({ id: h.id, kind: "ssh", label: h.label, target: h.target, remotePort: h.remotePort, cutexPath: h.cutexPath, paired: this.tokens.has(h.id), lastConnectedAt: h.lastConnectedAt, tokenId: h.tokenId, autoConnect: h.autoConnect, color: h.color, platform: h.platform, conn: view(h.id) }),
    );
    const dev = this.devHosts().map(
      (h): HostView => ({ id: h.id, kind: "dev-direct", label: h.name, target: h.baseUrl, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, autoConnect: h.autoConnect, color: h.color, platform: h.platform, conn: view(h.id) }),
    );
    const focus = this.focus();
    const focusView = [local, ...ssh, ...dev].find((h) => h.id === focus);
    return {
      scope: this.scope,
      active: focus,
      startOn: this.file.startOn,
      hosts: [...(!this.noLocalHost ? [local] : []), ...ssh, ...dev],
      groups: this.file.groups,
      tunnel: focus === LOCAL_HOST_ID || this.devHost(focus) ? null : (focusView?.conn?.tunnel ?? initialTunnel()),
      weakSecretStorage: process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text",
    };
  }

  private publish(): void {
    this.emit("hostsState", this.state());
  }

  private find(id: string): SshHostConfig | undefined {
    return this.file.hosts.find((h) => h.id === id);
  }

  /** DEV ONLY hosts (absent on a HostManager built without its constructor, e.g. test harnesses). */
  private devHost(id: string): DevHost | undefined {
    return this.dev?.get(id);
  }

  private devHosts(): DevHost[] {
    return [...(this.dev?.values() ?? [])];
  }

  private known(id: string): boolean {
    return (id === LOCAL_HOST_ID && !this.noLocalHost) || !!this.find(id) || !!this.devHost(id);
  }

  private localConfig(id: string): { autoConnect: boolean; platform: string | null } | undefined {
    return id === LOCAL_HOST_ID ? this.file.local : (this.find(id) ?? this.devHost(id));
  }

  private scopeIds(): string[] {
    const scope = this.scope;
    const known = (id: string) => this.known(id);
    if (scope.kind === "host") return known(scope.id) ? [scope.id] : [];
    if (scope.kind === "group") return (this.file.groups.find((g) => g.id === scope.id)?.hosts ?? []).filter(known);
    return [...(!this.noLocalHost ? [LOCAL_HOST_ID] : []), ...this.file.hosts.map((h) => h.id), ...this.devHosts().map((h) => h.id)];
  }

  private autoConnectIds(): string[] {
    return [...(!this.noLocalHost && this.file.local.autoConnect ? [LOCAL_HOST_ID] : []), ...this.file.hosts.filter((h) => h.autoConnect).map((h) => h.id), ...this.devHosts().filter((h) => h.autoConnect).map((h) => h.id)];
  }

  /** Should this host be connected: it is in the scope (or the focus host), or it auto-connects. */
  private wanted(id: string): boolean {
    return id === this.focus() || this.scopeIds().includes(id) || !!this.localConfig(id)?.autoConnect;
  }

  /** `before`: the focus host before a change that already happened (saveHostGroups). */
  private setScopeOnly(scope: ViewScope, before: string | null = this.scope ? this.focus() : null): void {
    this.scope = scope;
    // The host the app showed stays connected outside the scope: its views' streams go (as with a switch).
    if (before !== null && before !== this.focus()) this.conns.get(before)?.daemon.detachViews();
    // A dev host's scope is not remembered (dev hosts are not in hosts.json).
    if (!(scope.kind === "host" && this.devHost(scope.id)) && JSON.stringify(this.file.scope) !== JSON.stringify(scope)) {
      this.file = { ...this.file, scope };
      this.save();
    }
  }

  private endpoint(port: number, token: string, host: SshHostConfig): DaemonEndpoint {
    return { baseUrl: `http://127.0.0.1:${port}`, token, configPath: `ssh:${host.target}` };
  }

  /** DEV ONLY: the direct endpoint; the token is read now (main only, never logged). */
  private devEndpoint(host: DevHost): DaemonEndpoint {
    return { baseUrl: host.baseUrl, token: readDevToken(host), configPath: `dev:${host.id}` };
  }

  /** End a host's connection: tunnel, feeds, watches and terminals; replies still in flight are dropped. */
  private close(id: string): void {
    const conn = this.conns.get(id);
    if (!conn) return;
    this.conns.delete(id);
    conn.tunnel?.stop();
    conn.tunnel = null;
    conn.daemon.stop();
    this.local.onDisconnect?.(id);
  }

  /** A fresh connection (new routing epoch) in place of the current one. */
  private reopen(id: string): void {
    this.close(id);
    this.open(id);
  }

  /**
   * Start a connection to `id` (the caller publishes). The connection and its routing epoch exist at
   * once (state "connecting"), so the renderer can bind to it before the endpoint is known; the
   * endpoint (local discovery / SSH tunnel) is installed only while this connection is current.
   */
  private open(id: string, prompts?: AskpassSession): void {
    const host = this.find(id);
    const dev = this.devHost(id);
    if (!this.known(id) || !host) prompts?.close();
    if (!this.known(id)) return;
    const epoch = randomBytes(24).toString("hex");
    const daemon = this.createDaemon(id, epoch);
    const conn: HostConnection = { hostId: id, routingEpoch: epoch, daemon, tunnel: null, blocked: null, endpointHost: false, connectedOnce: false, cutexBuild: null };
    this.conns.set(id, conn);
    const current = () => this.conns.get(id) === conn;
    if (dev) {
      // DEV ONLY: straight to the loopback daemon, treated as remote (uploads, no local FS), no tunnel.
      daemon.suspend({ kind: "connecting", baseUrl: dev.baseUrl }, { remote: true });
      try {
        daemon.useEndpoint(this.devEndpoint(dev), { remote: true });
      } catch (error) {
        daemon.suspend({ kind: "error", baseUrl: dev.baseUrl, message: error instanceof Error ? error.message : String(error) }, { remote: true });
      }
      return;
    }
    const sshUrl = host ? `ssh://${host.target}` : "";
    daemon.suspend({ kind: "connecting", baseUrl: sshUrl }, { remote: !!host });

    if (!host) {
      void discoverLocalDaemon(this.local).then(
        (endpoint) => {
          if (current()) daemon.useEndpoint(endpoint, { remote: false });
        },
        (error: unknown) => {
          if (current()) daemon.suspend({ kind: "error", baseUrl: "", message: error instanceof Error ? error.message : String(error) }, { remote: false });
        },
      );
      return;
    }
    const target = parseSshTarget(host.target);
    const token = this.tokens.get(host.id);
    if (!target || !token) {
      prompts?.close();
      const error: SshErrorView = !target ? { code: "badInput", detail: host.target } : { code: safeStorage.isEncryptionAvailable() ? "noToken" : "noKeyring", detail: "" };
      conn.blocked = { ...initialTunnel(), status: "error", error };
      daemon.suspend({ kind: "error", baseUrl: sshUrl, message: sshMessage(error) }, { remote: true });
      return;
    }
    const tunnel = new SshTunnel({
      target,
      remotePort: host.remotePort,
      pids: this.pids,
      // The connection's prompts: a reconnect reuses answers given for it; closed with the tunnel.
      askpass: prompts ?? this.promptSession(host.target),
      onChange: (view) => this.onTunnel(conn, tunnel, host, token, view),
    });
    conn.tunnel = tunnel;
    tunnel.start();
  }

  private onTunnel(conn: HostConnection, tunnel: SshTunnel, host: SshHostConfig, token: string, view: TunnelView): void {
    if (this.conns.get(conn.hostId) !== conn || conn.tunnel !== tunnel) return;
    if (view.status === "up" && view.localPort !== null) {
      const baseUrl = `http://127.0.0.1:${view.localPort}`;
      if (conn.endpointHost && conn.daemon.activeClient()) {
        // Same daemon behind a re-established tunnel: keep feeds and cursors, just reconnect.
        conn.daemon.retarget(baseUrl);
        conn.daemon.reconnectNow();
      } else {
        conn.endpointHost = true;
        conn.daemon.useEndpoint(this.endpoint(view.localPort, token, host), { remote: true });
      }
    } else if ((view.status === "retrying" || view.status === "error") && !conn.endpointHost) {
      // Never connected yet: show the ssh problem as the daemon state too.
      conn.daemon.suspend({ kind: view.status === "error" ? "error" : "unreachable", baseUrl: `ssh://${host.target}`, message: sshMessage(view.error) }, { remote: true });
    }
    this.publish();
  }

  /** Issues a client token; when cutex is not found at `cutexPath` it is looked for (login shell,
   *  well-known dirs) and the absolute path found is returned for the host config. */
  private issueToken(target: SshTarget, cutexPath: string, prompts: AskpassSession): Promise<{ ok: true; token: IssuedToken; cutexPath: string } | { ok: false; error: SshErrorView }> {
    // Pairing waits for the user while a prompt is open (runSsh pauses its timeout).
    return issueTokenFindingCutex((command) => runSsh(target, command, 30_000, { askpass: prompts }), cutexPath, deviceLabel(hostname(), app.getPath("userData")), errorView);
  }

  /** `DELETE /v2/client-tokens/{id}` through a short tunnel; falls back to the CLI over ssh. */
  private async revoke(host: SshHostConfig, token: string | null): Promise<boolean> {
    const target = parseSshTarget(host.target);
    if (!host.tokenId || !target) return false;
    const prompts = this.promptSession(host.target);
    try {
      return await this.revokeWith(host, host.tokenId, token, target, prompts);
    } finally {
      prompts.close();
    }
  }

  private async revokeWith(host: SshHostConfig, tokenId: string, token: string | null, target: SshTarget, prompts: AskpassSession): Promise<boolean> {
    if (token) {
      try {
        const tunnel = await openTemporaryTunnel(target, host.remotePort, this.pids, 15_000, { askpass: prompts });
        try {
          await new CutexClient(this.endpoint(tunnel.port, token, host)).request("DELETE", `/v2/client-tokens/${encodeURIComponent(tokenId)}`);
          return true;
        } finally {
          tunnel.close();
        }
      } catch {
        // try the CLI
      }
    }
    try {
      const r = await runSsh(target, tokenRevokeCommand(host.cutexPath, tokenId), 20_000, { askpass: prompts });
      return r.code === 0;
    } catch {
      return false;
    }
  }

  private async probe(client: CutexClient, remote: boolean): Promise<HostTestResult> {
    try {
      const host = await client.host();
      const caps = await client.request<CapabilitiesView>("GET", "/v2/capabilities").catch((e: unknown) => {
        if (e instanceof CutexApiError && e.status === 404) return null;
        throw e;
      });
      const features = new Set(caps?.featureList ?? []);
      const missing = remote ? Object.values(REMOTE_FEATURES).filter((f) => !features.has(f)) : [];
      return { ok: true, hostId: host.hostId, cutexBuild: readCutexBuild(caps), missing };
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 401 || error.status === 403)) return { ok: false, error: { code: "tokenRejected", detail: error.message } };
      if (error instanceof CutexUnreachableError) return { ok: false, message: error.message };
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private patchHost(id: string, patch: Partial<SshHostConfig>): void {
    this.file = { ...this.file, hosts: this.file.hosts.map((h) => (h.id === id ? { ...h, ...patch } : h)) };
    this.save();
  }

  /** Desktop-local settings of any host (this machine included). */
  private patchLocal(id: string, patch: Partial<HostsFile["local"]>): void {
    const dev = this.devHost(id);
    if (dev) Object.assign(dev, patch);
    else if (id === LOCAL_HOST_ID) {
      this.file = { ...this.file, local: { ...this.file.local, ...patch } };
      this.save();
    } else this.patchHost(id, patch);
  }

  private save(): void {
    const body = `${JSON.stringify(this.file, null, 2)}\n`;
    const file = this.filePath;
    this.saving = this.saving
      .then(async () => {
        await writeFile(`${file}.tmp`, body, "utf8");
        await rename(`${file}.tmp`, file);
      })
      .catch((error: unknown) => console.warn("[cutex-desktop] saving hosts failed", (error as Error).message));
  }
}
