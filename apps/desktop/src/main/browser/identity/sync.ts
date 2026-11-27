// 跨主机同步 of 浏览器身份 (owner 2026-11-26; cutex r297 `browser-identity-sync-v1`, docs BROWSER-IDENTITY-SYNC.md).
// Per connected host: read its capabilities, register this desktop with the person key once that host's claim is
// recorded (Ed25519 over "cutex-browser-identities-v1\n<instanceId>\n<publicKey>"), then read the directory every
// POLL_MS. The daemons replicate among themselves; this desktop follows one primary host's directory (the local host
// when it supports sync, else the first registered one by id): it sends that host its outbox (create / update /
// delete, repeated unchanged after a lost reply) and merges the answer into the identity file (./identities.ts).
// Only names, colours and existence travel. Each host has its own on / off switch (PUT sync). A remote deletion's
// local data waits for the owner's 清除 here (owner gesture + the pending item, checked together in main).
import type { BrowserIdentityCleanup, BrowserIdentitySyncHost, BrowserIdentitySyncHostState, BrowserIdentitySyncState } from "../../../shared/browserIdentity";
import { isBrowserIdentityColor } from "../../../shared/browserIdentity";
import type { BrowserIdentitySyncService } from "./contract";
import type { BrowserIdentityDirectory, DirectoryOutboxEntry } from "./identities";

export const BROWSER_IDENTITY_SYNC_FEATURE = "browser-identity-sync-v1";
export const BROWSER_IDENTITY_SYNC_POLL_MS = 30_000;
export type BrowserIdentityRoute = "directory" | "desktop" | "sync" | "mutations";

export interface BrowserIdentitySyncTarget {
  hostId: string;
  /** The connection (a reconnect starts over: capabilities, registration). */
  epoch: string;
  /** `GET /v2/host` instanceId of the connected daemon; null: not known yet. */
  instanceId: string | null;
  client: {
    capabilities(): Promise<{ featureList?: readonly string[] } | null>;
    browserIdentities(method: "GET" | "POST" | "PUT", route: BrowserIdentityRoute, body?: unknown): Promise<unknown>;
  };
}

/** The identity file's side (./identities.ts BrowserIdentities). */
export interface LocalBrowserDirectory {
  directoryOutbox(): readonly DirectoryOutboxEntry[];
  directoryOutboxUpdate(mutationId: string, next: DirectoryOutboxEntry | null): void;
  applyDirectory(snapshot: BrowserIdentityDirectory): { limit: boolean };
  cleanups(): BrowserIdentityCleanup[];
  confirmCleanup(identityId: string, deletionRevision: number): Promise<void>;
}

export interface BrowserIdentitySyncOptions {
  targets(): BrowserIdentitySyncTarget[];
  /** The enrollment proof, or null while this desktop has no key or that host's claim is not recorded. */
  proof(hostId: string, instanceId: string): { publicKey: string; signature: string } | null;
  local: LocalBrowserDirectory;
  /** A fresh owner press / key in the app window (consumed). */
  ownerGesture(): boolean;
  emit(state: BrowserIdentitySyncState): void;
  pollMs?: number;
}

type HostError = "notOwner" | "waiting" | "error" | null;
interface HostRecord {
  target: BrowserIdentitySyncTarget;
  features: boolean | null;
  registeredKey: string | null;
  snapshot: BrowserIdentityDirectory | null;
  error: HostError;
  localLimit: boolean;
  running: Promise<void> | null;
  again: boolean;
}

/** Mutation answers that end that change for good (the next directory read shows the outcome). */
const FINAL = new Set(["identity_deleted", "default_identity", "invalid_request", "browser_identity_limit", "browser_identity_name_invalid"]);
const MAX_TRIES = 3;
const PEERS_IGNORED = new Set(["needsDesktop", "disabled", "unsupported"]);

const codeOf = (error: unknown): string => (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "");
const statusOf = (error: unknown): number => (error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 0);

/** Strict enough read of a directory snapshot; anything else is a daemon we do not understand. */
export function parseBrowserIdentityDirectory(raw: unknown): BrowserIdentityDirectory {
  const bad = () => new Error("browser_identity_directory_invalid");
  if (!raw || typeof raw !== "object") throw bad();
  const o = raw as Record<string, unknown>;
  if (typeof o.desktopRegistered !== "boolean" || typeof o.syncEnabled !== "boolean" || !Number.isSafeInteger(o.revision)
    || !Array.isArray(o.identities) || !Array.isArray(o.deleted) || !Array.isArray(o.peers)) throw bad();
  const int = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  const identities = o.identities.map((r: Record<string, unknown>) => {
    if (!r || typeof r.id !== "string" || typeof r.name !== "string" || !(r.color === null || isBrowserIdentityColor(r.color)) || !int(r.revision)) throw bad();
    return { id: r.id, name: r.name, color: r.color as BrowserIdentityDirectory["identities"][number]["color"], revision: r.revision as number };
  });
  const deleted = o.deleted.map((d: Record<string, unknown>) => {
    if (!d || typeof d.id !== "string" || !int(d.revision) || typeof d.requiresLocalCleanupConfirmation !== "boolean") throw bad();
    return { id: d.id, revision: d.revision as number, requiresLocalCleanupConfirmation: d.requiresLocalCleanupConfirmation };
  });
  const peers = o.peers.map((p: Record<string, unknown>) => {
    if (!p || typeof p.instanceId !== "string" || typeof p.state !== "string") throw bad();
    return {
      instanceId: p.instanceId, label: typeof p.label === "string" ? p.label : "", state: p.state,
      confirmedRevision: int(p.confirmedRevision) ? p.confirmedRevision as number : null,
      confirmedAt: typeof p.confirmedAt === "string" && !Number.isNaN(Date.parse(p.confirmedAt)) ? p.confirmedAt : null,
    };
  });
  return { desktopRegistered: o.desktopRegistered, syncEnabled: o.syncEnabled, revision: o.revision as number, identities, deleted, peers };
}

/** One host's line in Settings (pure: tested on its own). */
export function syncHostView(hostId: string, r: Pick<HostRecord, "features" | "registeredKey" | "snapshot" | "error" | "localLimit">, pendingOutbox: boolean): BrowserIdentitySyncHost {
  const peers = (r.snapshot?.peers ?? []).filter(p => !PEERS_IGNORED.has(p.state));
  const times = (r.snapshot?.peers ?? []).map(p => p.confirmedAt).filter((v): v is string => !!v).sort();
  const lastSyncAt = times.at(-1) ?? null;
  const state = ((): BrowserIdentitySyncHostState => {
    if (r.features === false) return "unsupported";
    if (r.error === "notOwner") return "notOwner";
    if (r.features === null) return "syncing";
    if (r.error === "waiting" || !r.registeredKey || !r.snapshot) return r.error === "error" ? "error" : "waiting";
    if (!r.snapshot.syncEnabled) return "off";
    if (r.error === "error" || peers.some(p => p.state === "error" || p.state === "clock")) return "error";
    if (r.localLimit || peers.some(p => p.state === "limit")) return "limit";
    if (!peers.length) return "alone";
    if (pendingOutbox || peers.some(p => p.state !== "synced")) return "syncing";
    return "synced";
  })();
  return { hostId, state, lastSyncAt };
}

export class BrowserIdentitySync implements BrowserIdentitySyncService {
  private readonly hosts = new Map<string, HostRecord>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private published = "";
  private disposed = false;

  constructor(private readonly options: BrowserIdentitySyncOptions) {}

  start(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => this.refreshAll(), this.options.pollMs ?? BROWSER_IDENTITY_SYNC_POLL_MS);
    this.timer.unref?.();
    this.refreshAll();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Every connected host once (the poll, a host change, the module turning on). */
  refreshAll(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const targets = this.options.targets();
    const live = new Set(targets.map(t => t.hostId));
    for (const id of [...this.hosts.keys()]) if (!live.has(id)) this.hosts.delete(id);
    const work = Promise.all(targets.map(t => this.refresh(t))).then(() => {});
    this.publish();
    return work;
  }

  /** A local change waits in the outbox: send it to the primary host now. */
  kick(): void {
    const primary = this.primary();
    if (primary) void this.refresh(primary.target);
    else this.publish();
  }

  state(): BrowserIdentitySyncState {
    const pending = this.options.local.directoryOutbox().length > 0;
    const primary = this.primary()?.target.hostId;
    return {
      hosts: [...this.hosts.entries()].sort(([a], [b]) => (a === "local" ? -1 : b === "local" ? 1 : a.localeCompare(b)))
        .map(([hostId, r]) => syncHostView(hostId, r, pending && hostId === primary)),
      cleanups: this.options.local.cleanups(),
    };
  }

  async setHostSync(hostId: string, enabled: boolean): Promise<BrowserIdentitySyncState> {
    const r = this.hosts.get(hostId);
    if (!r || !r.features || !r.registeredKey) throw new Error("browser_identity_sync_unavailable");
    const snapshot = parseBrowserIdentityDirectory(await r.target.client.browserIdentities("PUT", "sync", { enabled }));
    if (this.hosts.get(hostId) === r) { r.snapshot = snapshot; r.error = null; }
    this.publish();
    if (enabled) void this.refresh(r.target);
    return this.state();
  }

  async confirmCleanup(identityId: string, deletionRevision: number): Promise<BrowserIdentitySyncState> {
    if (!this.options.ownerGesture()) throw new Error("owner_gesture_required");
    try { await this.options.local.confirmCleanup(identityId, deletionRevision); }
    finally { this.publish(); }
    return this.state();
  }

  /** The host whose directory the local list follows. */
  private primary(): HostRecord | undefined {
    const ready = [...this.hosts.entries()].filter(([, r]) => r.features && r.registeredKey && r.snapshot && r.error !== "notOwner");
    ready.sort(([a], [b]) => (a === "local" ? -1 : b === "local" ? 1 : a.localeCompare(b)));
    return ready[0]?.[1];
  }

  private refresh(target: BrowserIdentitySyncTarget): Promise<void> {
    let r = this.hosts.get(target.hostId);
    if (!r || r.target.epoch !== target.epoch) {
      r = { target, features: null, registeredKey: null, snapshot: null, error: null, localLimit: false, running: null, again: false };
      this.hosts.set(target.hostId, r);
    }
    r.target = target;
    if (r.running) { r.again = true; return r.running; }
    const record = r;
    record.running = this.run(record).catch((error) => {
      if (this.hosts.get(target.hostId) !== record) return;
      const status = statusOf(error), code = codeOf(error);
      if (code === "browser_identity_owner_required") record.error = "notOwner";
      else if (code === "browser_identity_owner_proof_invalid") { record.error = "waiting"; record.registeredKey = null; }
      else if (code === "browser_identity_desktop_unregistered") { record.error = "waiting"; record.registeredKey = null; }
      else if (status === 404 && record.features === null) record.features = false;
      else record.error = "error";
    }).finally(() => {
      record.running = null;
      this.publish();
      if (record.again && !this.disposed && this.hosts.get(target.hostId) === record) {
        record.again = false;
        void this.refresh(record.target);
      }
    });
    return record.running;
  }

  private async run(r: HostRecord): Promise<void> {
    if (this.disposed) return;
    const { client, hostId, instanceId } = r.target;
    if (r.features === null) {
      const caps = await client.capabilities();
      r.features = (caps?.featureList ?? []).includes(BROWSER_IDENTITY_SYNC_FEATURE);
    }
    if (!r.features) return;
    const proof = instanceId ? this.options.proof(hostId, instanceId) : null;
    if (proof && proof.publicKey !== r.registeredKey) {
      // Idempotent; a new registration never turns an owner's opt-out back on (daemon rule).
      r.snapshot = parseBrowserIdentityDirectory(await client.browserIdentities("POST", "desktop", proof));
      r.registeredKey = proof.publicKey;
    } else if (!r.registeredKey) {
      r.error = "waiting";
      return;
    } else {
      r.snapshot = parseBrowserIdentityDirectory(await client.browserIdentities("GET", "directory"));
    }
    r.error = null;
    if (this.primary() === r) await this.drain(r);
  }

  /** Sends the outbox, merges the answer; once more when the merge queued changes (the first directory's import). */
  private async drain(r: HostRecord): Promise<void> {
    for (let round = 0; round < 2; round++) {
      await this.send(r);
      r.localLimit = this.options.local.applyDirectory(r.snapshot!).limit;
      if (!this.options.local.directoryOutbox().length) break;
    }
  }

  /** Sends the outbox in order (the primary host); r.snapshot ends as its latest answer. */
  private async send(r: HostRecord): Promise<void> {
    const { local } = this.options, { client } = r.target;
    let snapshot = r.snapshot!;
    for (let guard = 0; guard < 128 && !this.disposed; guard++) {
      const entry = local.directoryOutbox()[0];
      if (!entry) break;
      const remoteRevision = snapshot.identities.find(row => row.id === entry.id)?.revision ?? 0;
      // Fixed at the first send, so a repeat after a lost reply is the same operation.
      const sent: DirectoryOutboxEntry = entry.sent ? entry
        : { ...entry, sent: true, ...(entry.kind === "create" ? {} : { expectedRevision: entry.expectedRevision ?? remoteRevision }) };
      if (!entry.sent) local.directoryOutboxUpdate(entry.mutationId, sent);
      const body = sent.kind === "create"
        ? { kind: "create", mutationId: sent.mutationId, id: sent.id, name: sent.name, color: sent.color }
        : { kind: sent.kind, mutationId: sent.mutationId, id: sent.id, expectedRevision: sent.expectedRevision,
            ...(sent.kind === "update" && sent.name !== undefined ? { name: sent.name } : {}),
            ...(sent.kind === "update" && sent.color !== undefined ? { color: sent.color } : {}) };
      try {
        snapshot = parseBrowserIdentityDirectory(await client.browserIdentities("POST", "mutations", body));
        local.directoryOutboxUpdate(sent.mutationId, null);
      } catch (error) {
        const code = codeOf(error);
        if (code === "revision_conflict" || code === "mutation_conflict") {
          // Someone else changed the row (or the id was used for other data): read again, then a fresh operation.
          snapshot = parseBrowserIdentityDirectory(await client.browserIdentities("GET", "directory"));
          const tries = (sent.tries ?? 0) + 1;
          if (tries > MAX_TRIES) { local.directoryOutboxUpdate(sent.mutationId, null); continue; }
          const exists = snapshot.identities.some(row => row.id === sent.id);
          const kind = sent.kind === "create" && exists ? "update" : sent.kind;
          if (sent.kind === "create" && !exists && code === "revision_conflict") { local.directoryOutboxUpdate(sent.mutationId, null); continue; }
          local.directoryOutboxUpdate(sent.mutationId, {
            mutationId: freshMutationId(), kind, id: sent.id, tries,
            ...(sent.name !== undefined ? { name: sent.name } : {}), ...(sent.color !== undefined ? { color: sent.color } : {}),
          });
          continue;
        }
        if (FINAL.has(code) || (statusOf(error) >= 400 && statusOf(error) < 500 && statusOf(error) !== 403 && code !== "browser_identity_desktop_unregistered")) {
          local.directoryOutboxUpdate(sent.mutationId, null);
          continue;
        }
        r.snapshot = snapshot;
        throw error; // Unreachable / unregistered / 5xx: the same entry goes again at the next read.
      }
    }
    r.snapshot = snapshot;
  }

  private publish(): void {
    if (this.disposed) return;
    const state = this.state();
    const text = JSON.stringify(state);
    if (text === this.published) return;
    this.published = text;
    this.options.emit(state);
  }
}

function freshMutationId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
