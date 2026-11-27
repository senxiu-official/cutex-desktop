import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Session } from "electron";
import {
  BROWSER_IDENTITY_NAME_MAX, browserIdentityPartition, DEFAULT_BROWSER_IDENTITY_ID as DEFAULT_ID, DEFAULT_BROWSER_IDENTITY_PREFS,
  isBrowserIdentityColor, isBrowserIdentityId, parseBrowserIdentityRequest,
  type BrowserClearDataRequest, type BrowserIdentityColor, type BrowserIdentityPrefs, type BrowserIdentityState,
  type BrowserIdentityStorage, type BrowserIdentityView, type BrowserIdentityCleanup,
} from "../../../shared/browserIdentity";
import { writeFileAtomic } from "../../fileWrites";
import type { BrowserIdentityService, EmitBrowserIdentityEvent } from "./contract";
import { browserIdentityHostId, diskEntry, parseIdentityPartition, partitionBytes, partitionDirectory, partitionInventory } from "./disk";

type Identity = Omit<BrowserIdentityView, "isDefault" | "hosts" | "openTabs">;
type Cell = { identityId: string; hostId: string };

/** 跨主机同步 (./sync.ts): one change waiting for the primary host's directory. `sent`: tried at least once, so a
 *  retry repeats the same body (the daemon answers a repeat with its snapshot); `expectedRevision` is fixed then. */
export interface DirectoryOutboxEntry {
  mutationId: string;
  kind: "create" | "update" | "delete";
  id: string;
  name?: string;
  color?: BrowserIdentityColor;
  expectedRevision?: number;
  sent?: true;
  tries?: number;
}
/** A remote deletion whose local partitions (logins, site data) wait for the owner's 清除. */
interface DirectoryCleanup { identityId: string; name: string; color: BrowserIdentityColor | null; deletionRevision: number; partitions: string[] }
interface DirectoryFile { attached: boolean; outbox: DirectoryOutboxEntry[]; cleanups: DirectoryCleanup[] }
/** cutex r297 `GET /v2/browser-identities` (the fields this desktop reads). */
export interface BrowserIdentityDirectory {
  desktopRegistered: boolean;
  syncEnabled: boolean;
  revision: number;
  identities: { id: string; name: string; color: BrowserIdentityColor | null; revision: number }[];
  deleted: { id: string; revision: number; requiresLocalCleanupConfirmation: boolean }[];
  peers: { instanceId: string; label: string; state: string; confirmedRevision: number | null; confirmedAt: string | null }[];
}
const MUTATION_ID = /^[a-f0-9]{32}$/;
const OUTBOX_MAX = 512;
const blankDirectory = (): DirectoryFile => ({ attached: false, outbox: [], cleanups: [] });
interface IdentityFile {
  version: 1;
  current: string;
  identities: Identity[];
  prefs: BrowserIdentityPrefs;
  tombstones: { id: string; updatedAt: number; revision: number }[];
  pendingPartitions: string[];
  knownHosts: string[];
  pendingHosts: string[];
  /** 跨主机同步; absent before the first directory was seen. */
  directory?: DirectoryFile;
}

/** Identities this desktop creates itself; synced rows from other hosts may go beyond it (up to MAX_STORED). */
const MAX_IDENTITIES = 64;
const MAX_STORED = 2048;
const MAX_FILE_BYTES = 1024 * 1024;
const FILE = "browser-identities.json";
const DEFAULT: Identity = { id: DEFAULT_ID, name: "个人", color: null, initial: "个", createdAt: 0, updatedAt: 0, revision: 0 };
const blank = (): IdentityFile => ({
  version: 1, current: DEFAULT_ID, identities: [DEFAULT], prefs: { ...DEFAULT_BROWSER_IDENTITY_PREFS },
  tombstones: [], pendingPartitions: [], knownHosts: [], pendingHosts: [],
});
const validTime = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const validInitial = (v: unknown): v is string => typeof v === "string" && [...v].length === 1 && !/[\s\x00-\x1f\x7f]/.test(v);

class IdentityStorage {
  private readonly file: string;
  private readonly available: boolean;
  data: IdentityFile;
  constructor(private readonly userData: string) {
    this.file = join(userData, FILE);
    this.data = blank();
    try {
      const info = diskEntry(this.file);
      if (info) {
        if (!info.isFile() || info.size > MAX_FILE_BYTES) throw Error("invalid_browser_identity_storage");
        const input = JSON.parse(readFileSync(this.file, "utf8")) as IdentityFile;
        if (input?.version !== 1 || !Array.isArray(input.identities) || input.identities.length > MAX_STORED
          || !Array.isArray(input.tombstones) || !Array.isArray(input.pendingPartitions) || !Array.isArray(input.knownHosts)
          || input.pendingHosts !== undefined && !Array.isArray(input.pendingHosts))
          throw Error("invalid_browser_identity_storage");
        const prefs = parseBrowserIdentityRequest({ op: "prefs", patch: input.prefs });
        const ids = new Set<string>();
        const identities = input.identities.map(item => {
          if (!item || !isBrowserIdentityId(item.id) || ids.has(item.id) || typeof item.name !== "string"
            || !item.name.trim() || [...item.name].length > BROWSER_IDENTITY_NAME_MAX || /[\x00-\x1f\x7f]/.test(item.name)
            || !validInitial(item.initial) || !validTime(item.createdAt) || !validTime(item.updatedAt)
            || !validTime(item.revision) || item.revision >= Number.MAX_SAFE_INTEGER
            || (item.id === DEFAULT_ID ? item.color !== null : !isBrowserIdentityColor(item.color)))
            throw Error("invalid_browser_identity_storage");
          ids.add(item.id);
          const { id, name, color, initial, createdAt, updatedAt, revision } = item;
          return { id, name, color, initial, createdAt, updatedAt, revision };
        });
        if (!ids.has(DEFAULT_ID) || !input.pendingPartitions.every(value => typeof value === "string" && parseIdentityPartition(value))
          || !input.knownHosts.every(browserIdentityHostId) || !(input.pendingHosts ?? []).every(browserIdentityHostId)
          || !input.tombstones.every(item =>
            item && isBrowserIdentityId(item.id) && !ids.has(item.id) && validTime(item.updatedAt) && validTime(item.revision)))
          throw Error("invalid_browser_identity_storage");
        this.data = {
          ...blank(), identities, current: ids.has(input.current) ? input.current : DEFAULT_ID,
          prefs: { ...DEFAULT_BROWSER_IDENTITY_PREFS, ...(prefs.op === "prefs" ? prefs.patch : {}) },
          knownHosts: [...new Set(input.knownHosts)], pendingPartitions: [...new Set(input.pendingPartitions)],
          pendingHosts: [...new Set(input.pendingHosts ?? [])],
          tombstones: input.tombstones.map(({ id, updatedAt, revision }) => ({ id, updatedAt, revision })),
          ...(input.directory !== undefined ? { directory: parseDirectoryFile(input.directory, ids) } : {}),
        };
      }
      this.available = true;
    } catch {
      // Corrupt settings cannot create a named login context or overwrite evidence.
      this.available = false;
    }
  }
  save(data: IdentityFile): void {
    if (!this.available) throw Error("browser_identity_storage_unavailable");
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw Error("browser_identity_storage_unavailable");
    const directory = diskEntry(this.userData);
    if (!directory) mkdirSync(this.userData, { recursive: true });
    else if (!directory.isDirectory()) throw Error("browser_identity_storage_unavailable");
    diskEntry(this.file); // A file swapped for a junction/symlink never becomes authoritative.
    writeFileAtomic(this.file, text);
    this.data = data;
  }
}

function parseDirectoryFile(raw: unknown, live: ReadonlySet<string>): DirectoryFile {
  const bad = () => Error("invalid_browser_identity_storage");
  if (!raw || typeof raw !== "object") throw bad();
  const o = raw as Partial<DirectoryFile>;
  if (typeof o.attached !== "boolean" || !Array.isArray(o.outbox) || o.outbox.length > OUTBOX_MAX || !Array.isArray(o.cleanups) || o.cleanups.length > MAX_STORED) throw bad();
  const outbox = o.outbox.map(e => {
    if (!e || !MUTATION_ID.test(e.mutationId) || !["create", "update", "delete"].includes(e.kind) || !isBrowserIdentityId(e.id)
      || e.name !== undefined && (typeof e.name !== "string" || !e.name.trim() || [...e.name].length > BROWSER_IDENTITY_NAME_MAX || /[\x00-\x1f\x7f]/.test(e.name))
      || e.color !== undefined && !isBrowserIdentityColor(e.color) || e.expectedRevision !== undefined && !validTime(e.expectedRevision)
      || e.sent !== undefined && e.sent !== true || e.tries !== undefined && !validTime(e.tries)) throw bad();
    const { mutationId, kind, id, name, color, expectedRevision, sent, tries } = e;
    return { mutationId, kind, id, ...(name !== undefined ? { name } : {}), ...(color !== undefined ? { color } : {}),
      ...(expectedRevision !== undefined ? { expectedRevision } : {}), ...(sent ? { sent } : {}), ...(tries !== undefined ? { tries } : {}) };
  });
  const cleanups = o.cleanups.map(c => {
    if (!c || !isBrowserIdentityId(c.identityId) || c.identityId === DEFAULT_ID || live.has(c.identityId) || typeof c.name !== "string" || [...c.name].length > BROWSER_IDENTITY_NAME_MAX
      || !(c.color === null || isBrowserIdentityColor(c.color)) || !validTime(c.deletionRevision) || !Array.isArray(c.partitions)
      || !c.partitions.every(p => typeof p === "string" && parseIdentityPartition(p)?.identityId === c.identityId)) throw bad();
    return { identityId: c.identityId, name: c.name, color: c.color, deletionRevision: c.deletionRevision, partitions: [...new Set(c.partitions)] };
  });
  return { attached: o.attached, outbox, cleanups };
}

const mutationId = () => randomBytes(16).toString("hex");
const firstChar = (name: string) => [...name][0] ?? "?";
const validRemoteName = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && [...v].length <= BROWSER_IDENTITY_NAME_MAX && !/[\x00-\x1f\x7f]/.test(v);

/** Called before any Electron session can open a partition. Failure leaves the pending entry blocked. */
export function cleanDeletedBrowserPartitions(userData: string, sessionData: string): void {
  const storage = new IdentityStorage(userData);
  const pending = storage.data.pendingPartitions;
  if (!pending.length) return;
  const remaining = pending.filter(partition => {
    const cell = parseIdentityPartition(partition)!;
    try {
      for (const directory of [sessionData, join(sessionData, "Partitions")]) {
        const info = diskEntry(directory);
        if (!info) return false;
        if (!info.isDirectory()) return true;
      }
      const directory = partitionDirectory(sessionData, cell.identityId, cell.hostId);
      const info = diskEntry(directory);
      if (!info) return false;
      if (!info.isDirectory()) return true;
      rmSync(directory, { recursive: true });
      return false;
    } catch { return true; }
  });
  if (remaining.length !== pending.length) storage.save({ ...storage.data, pendingPartitions: remaining });
}

interface IdentityOptions {
  userData: string;
  sessionData: string;
  hostIds(): readonly string[];
  tabs(): readonly { hostId: string; identityId?: string }[];
  session(partition: string): Session;
  close(identityId: string, hostId?: string): void;
  revoke(partition: string): void;
  /** With a host: only what is kept per identity and host (本机回环, certificate exceptions); site permissions are per
   *  identity (every host) and stay. Without: everything of the identity. */
  forgetAdmissions(identityId: string, hostId?: string): void;
  forgetHostAdmissions(hostId: string): void;
  reload(identityId: string, hostId: string): void;
  dropIdentity(identityId: string): Promise<void>;
  /** History of a host: every identity's, or one identity's. */
  dropHost(hostId: string, identityId?: string): Promise<void>;
  retentionChanged(): void;
  emit: EmitBrowserIdentityEvent;
  /** 跨主机同步: a change waits in the outbox / a cleanup item changed (./sync.ts drains and republishes). */
  directoryChanged?(): void;
  now?: () => number;
}

export class BrowserIdentities implements BrowserIdentityService {
  private readonly storageFile: IdentityStorage;
  private readonly busy = new Set<string>();
  private readonly activeCells = new Map<string, Cell>();
  private readonly pendingHostWork = new Set<string>();
  private readonly now: () => number;
  private publishing = false;

  constructor(private readonly options: IdentityOptions) {
    this.storageFile = new IdentityStorage(options.userData);
    this.now = options.now ?? Date.now;
  }

  has(id: string): boolean { return this.storageFile.data.identities.some(identity => identity.id === id); }
  current(): string { return this.storageFile.data.current; }
  preferences(): BrowserIdentityPrefs { return { ...this.storageFile.data.prefs }; }

  private require(id: string): Identity {
    const identity = this.storageFile.data.identities.find(row => row.id === id);
    if (!identity) throw Error("browser_identity_unavailable");
    return identity;
  }

  private cells(requireInventory = false): Cell[] {
    let inventory: Cell[] = [];
    try { inventory = partitionInventory(this.options.sessionData); }
    catch (error) { if (requireInventory) throw error; }
    const union = new Map(this.activeCells);
    for (const cell of inventory) union.set(browserIdentityPartition(cell.identityId, cell.hostId), cell);
    return [...union.values()].filter(cell =>
      this.has(cell.identityId) && !this.storageFile.data.pendingPartitions.includes(browserIdentityPartition(cell.identityId, cell.hostId)));
  }

  private view(row: Identity, tabs = this.options.tabs(), cells = this.cells()): BrowserIdentityView {
    return {
      ...row, isDefault: row.id === DEFAULT_ID, hosts: cells.filter(cell => cell.identityId === row.id).map(cell => cell.hostId).sort(),
      openTabs: tabs.filter(tab => tab.identityId === row.id).length,
    };
  }

  state(): BrowserIdentityState {
    const tabs = this.options.tabs(), cells = this.cells();
    return { identities: this.storageFile.data.identities.map(row => this.view(row, tabs, cells)), current: this.current() };
  }

  changed(): void {
    if (this.publishing) return;
    this.publishing = true;
    queueMicrotask(() => {
      this.publishing = false;
      this.options.emit({ kind: "identities", state: this.state() });
    });
  }

  partition(identityId: string, hostId: string): string {
    this.require(identityId);
    if (!this.options.hostIds().includes(hostId)) throw Error("stale_connection");
    const partition = browserIdentityPartition(identityId, hostId);
    if (this.busy.has(identityId) || this.storageFile.data.pendingPartitions.includes(partition)
      || this.storageFile.data.pendingHosts.includes(hostId)) throw Error("browser_identity_unavailable");
    return partition;
  }

  identityOfPartition(partition: string): Cell | undefined {
    const parsed = parseIdentityPartition(partition);
    if (!parsed) return;
    try { if (this.partition(parsed.identityId, parsed.hostId) === partition) return parsed; }
    catch { /* Retired or unavailable. */ }
  }

  used(partition: string): void {
    const cell = this.identityOfPartition(partition);
    if (!cell || this.activeCells.has(partition)) return;
    this.activeCells.set(partition, cell);
    this.changed();
  }

  async create(name: string, color: BrowserIdentityColor, initial?: string): Promise<BrowserIdentityView> {
    const data = this.storageFile.data;
    if (data.identities.length >= MAX_IDENTITIES) throw Error("browser_identity_limit");
    const now = this.now();
    const row: Identity = { id: randomBytes(16).toString("hex"), name, color, initial: initial ?? [...name][0]!, createdAt: now, updatedAt: now, revision: 1 };
    this.storageFile.save({ ...data, identities: [...data.identities, row], ...this.enqueue(data, { kind: "create", id: row.id, name, color }) });
    this.changed();
    this.options.directoryChanged?.();
    return this.view(row);
  }

  async update(id: string, expectedRevision: number, change: { name?: string; color?: BrowserIdentityColor; initial?: string }): Promise<BrowserIdentityView> {
    const before = this.require(id);
    if (before.revision !== expectedRevision) throw Error("revision_conflict");
    const row: Identity = {
      ...before, name: change.name ?? before.name, color: id === DEFAULT_ID ? null : change.color ?? before.color,
      initial: change.initial ?? before.initial, updatedAt: Math.max(this.now(), before.updatedAt + 1), revision: before.revision + 1,
    };
    const data = this.storageFile.data;
    const synced = { ...(row.name !== before.name ? { name: row.name } : {}), ...(row.color && row.color !== before.color ? { color: row.color } : {}) };
    this.storageFile.save({ ...data, identities: data.identities.map(identity => identity.id === id ? row : identity),
      ...(Object.keys(synced).length ? this.enqueue(data, { kind: "update", id, ...synced }) : {}) });
    this.changed();
    if (Object.keys(synced).length) this.options.directoryChanged?.();
    return this.view(row);
  }

  async setCurrent(id: string): Promise<BrowserIdentityState> {
    this.require(id);
    const data = this.storageFile.data;
    if (data.current !== id) {
      this.storageFile.save({ ...data, current: id });
      this.changed();
    }
    return this.state();
  }

  async prefs(patch?: Partial<BrowserIdentityPrefs>): Promise<BrowserIdentityPrefs> {
    const data = this.storageFile.data;
    if (patch && Object.keys(patch).length) {
      this.storageFile.save({ ...data, prefs: { ...data.prefs, ...patch } });
      if (patch.historyRetention !== undefined && patch.historyRetention !== data.prefs.historyRetention) this.options.retentionChanged();
    }
    return this.preferences();
  }

  async storage(id: string): Promise<BrowserIdentityStorage[]> {
    this.require(id);
    const output: BrowserIdentityStorage[] = [];
    const configured = this.options.hostIds();
    for (const { hostId } of this.cells().filter(cell => cell.identityId === id)) {
      let siteDataBytes: number | null = null, cacheBytes: number | null = null;
      if (!configured.includes(hostId)) {
        // A leftover of a removed host: measured on disk (opening its session would recreate it).
        try { siteDataBytes = await partitionBytes(partitionDirectory(this.options.sessionData, id, hostId)); } catch { /* not measurable */ }
        output.push({ hostId, siteDataBytes, cacheBytes: null, removedHost: true });
        continue;
      }
      try {
        const partition = this.partition(id, hostId);
        cacheBytes = await this.options.session(partition).getCacheSize();
        const total = await partitionBytes(partitionDirectory(this.options.sessionData, id, hostId));
        siteDataBytes = Math.max(0, total - cacheBytes);
      } catch { /* A missing/removed host or inaccessible disk is not measurable. */ }
      output.push({ hostId, siteDataBytes, cacheBytes });
    }
    return output;
  }

  async signedInSites(id: string, hostId: string): Promise<string[]> {
    const partition = this.partition(id, hostId);
    const cookies = await this.options.session(partition).cookies.get({});
    if (this.partition(id, hostId) !== partition) return [];
    const domains = new Set<string>();
    for (const { domain } of cookies) {
      const normalized = domain?.toLowerCase().replace(/^\./, "");
      if (normalized && /^(?:[a-z0-9.-]{1,253}|\[[0-9a-f:]+\])$/.test(normalized)) domains.add(normalized);
    }
    return [...domains].sort();
  }

  async clearData(request: BrowserClearDataRequest): Promise<void> {
    const { identityId: id, hostId, types } = request;
    this.require(id);
    const origins = request.origins?.map(value => {
      const url = new URL(value);
      if (url.origin !== value || url.username || url.password || !["http:", "https:"].includes(url.protocol)) throw Error("invalid_browser_origin");
      return url.origin;
    });
    const dataTypes: NonNullable<Electron.ClearDataOptions["dataTypes"]> = [];
    if (types.includes("siteData")) dataTypes.push("cookies", "backgroundFetch", "fileSystems", "indexedDB", "localStorage", "serviceWorkers", "webSQL");
    if (types.includes("cache")) dataTypes.push("cache");
    if (!dataTypes.length) return;
    // 所有主机 = the configured hosts holding data; a removed host's leftover is cleared by clearLeftover.
    const configured = this.options.hostIds();
    const hosts = hostId === "all" ? this.cells().filter(cell => cell.identityId === id && configured.includes(cell.hostId)).map(cell => cell.hostId) : [hostId];
    for (const host of hosts) {
      const partition = this.partition(id, host);
      await this.options.session(partition).clearData({ dataTypes, ...(origins ? { origins, originMatchingMode: "origin-in-all-contexts" } : {}) });
      if (types.includes("siteData")) {
        const target = this.options.session(partition);
        if (origins) for (const origin of origins) await target.clearStorageData({ origin, storages: ["cachestorage"] });
        else await target.clearStorageData({ storages: ["cachestorage"] });
      }
      if (this.identityOfPartition(partition)) this.options.reload(id, host);
    }
    this.changed();
  }

  private async wipe(id: string): Promise<string[]> {
    const cells = this.cells(true).filter(cell => cell.identityId === id);
    this.options.close(id);
    const partitions = cells.map(({ hostId }) => browserIdentityPartition(id, hostId));
    for (const partition of partitions) this.options.revoke(partition);
    for (const partition of partitions) {
      const target = this.options.session(partition);
      await target.clearData();
      await target.clearStorageData();
      await target.clearCache();
      await target.clearAuthCache();
    }
    this.options.forgetAdmissions(id);
    return partitions;
  }

  async signOut(id: string): Promise<void> {
    this.require(id);
    if (this.busy.has(id)) throw Error("browser_identity_busy");
    this.busy.add(id);
    try { await this.wipe(id); }
    finally { this.busy.delete(id); this.changed(); }
  }

  async signOutHost(id: string, hostId: string): Promise<void> {
    const partition = this.partition(id, hostId);
    this.busy.add(id);
    try {
      this.options.close(id, hostId);
      this.options.revoke(partition);
      const target = this.options.session(partition);
      await target.clearData();
      await target.clearStorageData();
      await target.clearCache();
      await target.clearAuthCache();
      this.options.forgetAdmissions(id, hostId);
    } finally { this.busy.delete(id); this.changed(); }
  }

  async clearLeftover(id: string, hostId: string): Promise<void> {
    this.require(id);
    if (this.busy.has(id)) throw Error("browser_identity_busy");
    if (this.options.hostIds().includes(hostId)) throw Error("host_configured");
    const partition = browserIdentityPartition(id, hostId);
    if (!this.cells(true).some(cell => cell.identityId === id && cell.hostId === hostId)) throw Error("browser_identity_unavailable");
    // Queued first (cleanDeletedBrowserPartitions removes it before any session opens at the next start, should
    // removing it now fail); this run never opened the session of a host that is not configured.
    const data = this.storageFile.data;
    this.storageFile.save({ ...data, pendingPartitions: [...new Set([...data.pendingPartitions, partition])] });
    this.activeCells.delete(partition);
    try {
      // Same checks as the startup cleanup: a symlink (diskEntry throws) or a non-directory stays queued.
      const directory = partitionDirectory(this.options.sessionData, id, hostId), info = diskEntry(directory);
      if (info && !info.isDirectory()) throw Error("browser_identity_storage_unavailable");
      if (info) rmSync(directory, { recursive: true });
      const now = this.storageFile.data;
      this.storageFile.save({ ...now, pendingPartitions: now.pendingPartitions.filter(p => p !== partition) });
    } catch { /* Left queued for the next start. */ }
    // The rest it left on that host: certificate exceptions / 本机回环 and its browsing history there.
    this.options.forgetAdmissions(id, hostId);
    await this.options.dropHost(hostId, id).catch(() => {});
    this.changed();
  }

  async remove(id: string): Promise<void> {
    this.require(id);
    if (id === DEFAULT_ID) throw Error("default_identity");
    if (this.busy.has(id)) throw Error("browser_identity_busy");
    this.busy.add(id);
    try {
      const partitions = await this.wipe(id);
      await this.options.dropIdentity(id);
      const data = this.storageFile.data, row = this.require(id);
      this.storageFile.save({
        ...data, current: data.current === id ? DEFAULT_ID : data.current,
        identities: data.identities.filter(identity => identity.id !== id),
        tombstones: [...data.tombstones, { id, updatedAt: Math.max(this.now(), row.updatedAt + 1), revision: row.revision + 1 }],
        pendingPartitions: [...new Set([...data.pendingPartitions, ...partitions])],
        ...this.enqueue(data, { kind: "delete", id }),
      });
      for (const partition of partitions) this.activeCells.delete(partition);
      this.options.directoryChanged?.();
    } finally { this.busy.delete(id); this.changed(); }
  }

  // ---------- 跨主机同步 (./sync.ts) ----------

  /** The outbox after one more local change (nothing before the first directory: that one imports everything). */
  private enqueue(data: IdentityFile, change: Omit<DirectoryOutboxEntry, "mutationId">): Pick<IdentityFile, "directory"> | Record<string, never> {
    const dir = data.directory;
    if (!dir?.attached) return {};
    let outbox = dir.outbox;
    if (change.kind === "update") {
      // Not yet sent: one update per identity carries the latest name / colour.
      const waiting = outbox.find(e => e.id === change.id && !e.sent && (e.kind === "update" || e.kind === "create"));
      if (waiting) return { directory: { ...dir, outbox: outbox.map(e => e === waiting ? { ...e, ...(change.name ? { name: change.name } : {}), ...(change.color ? { color: change.color } : {}) } : e) } };
    }
    if (change.kind === "delete") {
      const unsentCreate = outbox.some(e => e.id === change.id && e.kind === "create" && !e.sent);
      outbox = outbox.filter(e => !(e.id === change.id && !e.sent));
      // Never reached the directory: nothing to delete there (and the id is never created again).
      if (unsentCreate) return { directory: { ...dir, outbox } };
    }
    if (outbox.length >= OUTBOX_MAX) outbox = outbox.slice(outbox.length - OUTBOX_MAX + 1);
    return { directory: { ...dir, outbox: [...outbox, { mutationId: mutationId(), ...change }] } };
  }

  directoryAttached(): boolean { return !!this.storageFile.data.directory?.attached; }
  directoryOutbox(): readonly DirectoryOutboxEntry[] { return this.storageFile.data.directory?.outbox ?? []; }

  /** One outbox entry after a send: replaced (`sent`, a new revision / id) or done (null). */
  directoryOutboxUpdate(id: string, next: DirectoryOutboxEntry | null): void {
    const data = this.storageFile.data, dir = data.directory;
    if (!dir || !dir.outbox.some(e => e.mutationId === id)) return;
    const outbox = next ? dir.outbox.map(e => e.mutationId === id ? next : e) : dir.outbox.filter(e => e.mutationId !== id);
    this.storageFile.save({ ...data, directory: { ...dir, outbox } });
  }

  cleanups(): BrowserIdentityCleanup[] {
    return (this.storageFile.data.directory?.cleanups ?? []).map(({ identityId, name, color, deletionRevision, partitions }) => ({
      identityId, name, color, deletionRevision, hosts: [...new Set(partitions.map(p => parseIdentityPartition(p)!.hostId))].sort(),
    }));
  }

  /**
   * Merges the primary host's directory. Names and colours follow it (not while this desktop's own change waits); new
   * identities appear; a deletion closes the identity's tabs, refuses its partitions at once and keeps their data for
   * the owner's 清除 when the daemon asks for that. The first directory imports this desktop's identities and deletions.
   */
  applyDirectory(snapshot: BrowserIdentityDirectory): { limit: boolean } {
    const data = this.storageFile.data;
    const dir = data.directory ?? blankDirectory();
    const waiting = new Set(dir.outbox.map(e => e.id));
    const deleted = new Map(snapshot.deleted.filter(d => isBrowserIdentityId(d.id) && d.id !== DEFAULT_ID).map(d => [d.id, d]));
    const remote = new Map(snapshot.identities.filter(r => isBrowserIdentityId(r.id) && !deleted.has(r.id)).map(r => [r.id, r]));
    const tombstoned = new Set([...data.tombstones.map(t => t.id), ...dir.cleanups.map(c => c.identityId)]);
    const now = this.now();
    let limit = false, changed = false;
    const outbox = [...dir.outbox];
    const identities: Identity[] = [];
    const removals: Identity[] = [];
    for (const row of data.identities) {
      if (deleted.has(row.id) && !this.busy.has(row.id)) { removals.push(row); continue; }
      const r = remote.get(row.id);
      if (r && !waiting.has(row.id) && validRemoteName(r.name)) {
        const color = row.id === DEFAULT_ID ? null : isBrowserIdentityColor(r.color) ? r.color : row.color;
        if (r.name !== row.name || color !== row.color) {
          changed = true;
          identities.push({ ...row, name: r.name, color, initial: row.initial === firstChar(row.name) ? firstChar(r.name) : row.initial,
            updatedAt: Math.max(now, row.updatedAt + 1), revision: row.revision + 1 });
          continue;
        }
      }
      identities.push(row);
    }
    for (const r of remote.values()) {
      if (identities.some(row => row.id === r.id) || tombstoned.has(r.id) || r.id === DEFAULT_ID) continue;
      if (!validRemoteName(r.name) || !isBrowserIdentityColor(r.color)) continue;
      if (identities.length >= MAX_STORED) { limit = true; continue; }
      changed = true;
      identities.push({ id: r.id, name: r.name, color: r.color, initial: firstChar(r.name), createdAt: now, updatedAt: now, revision: 1 });
    }
    if (!dir.attached) {
      // The first directory: this desktop's identities (existing ids) and deletions join it.
      for (const row of identities) {
        if (remote.has(row.id) || deleted.has(row.id) || waiting.has(row.id)) continue;
        if (row.id === DEFAULT_ID) outbox.push({ mutationId: mutationId(), kind: "update", id: DEFAULT_ID, name: row.name, expectedRevision: 0 });
        else outbox.push({ mutationId: mutationId(), kind: "create", id: row.id, name: row.name, color: row.color! });
      }
      for (const t of data.tombstones) {
        if (deleted.has(t.id) || waiting.has(t.id)) continue;
        outbox.push({ mutationId: mutationId(), kind: "delete", id: t.id });
      }
    }
    const cleanups = [...dir.cleanups];
    const tombstones = [...data.tombstones];
    let pendingPartitions = data.pendingPartitions, current = data.current;
    const dropped: string[] = [];
    for (const row of removals) {
      const d = deleted.get(row.id)!;
      const partitions = this.cells().filter(cell => cell.identityId === row.id).map(cell => browserIdentityPartition(row.id, cell.hostId));
      this.options.close(row.id);
      for (const partition of partitions) { this.options.revoke(partition); this.activeCells.delete(partition); }
      tombstones.push({ id: row.id, updatedAt: Math.max(now, row.updatedAt + 1), revision: d.revision });
      if (current === row.id) current = DEFAULT_ID;
      if (!partitions.length) continue;
      if (d.requiresLocalCleanupConfirmation) cleanups.push({ identityId: row.id, name: row.name, color: row.color, deletionRevision: d.revision, partitions });
      else { pendingPartitions = [...new Set([...pendingPartitions, ...partitions])]; dropped.push(row.id); }
    }
    if (changed || removals.length || !dir.attached || outbox.length !== dir.outbox.length) {
      this.storageFile.save({ ...data, identities, tombstones, current, pendingPartitions,
        directory: { attached: true, outbox: outbox.slice(-OUTBOX_MAX), cleanups } });
      this.changed();
      if (removals.length) this.options.directoryChanged?.();
    }
    // The daemon recorded this desktop's own confirmed delete: its data goes without asking again.
    for (const id of dropped) void this.options.dropIdentity(id).catch(() => {});
    return { limit };
  }

  /** 清除 (the owner confirmed in place; ./sync.ts checked the gesture): the retained partitions, history and saved passwords. */
  async confirmCleanup(identityId: string, deletionRevision: number): Promise<void> {
    const item = this.storageFile.data.directory?.cleanups.find(c => c.identityId === identityId && c.deletionRevision === deletionRevision);
    if (!item) throw Error("browser_identity_cleanup_missing");
    if (this.busy.has(identityId)) throw Error("browser_identity_busy");
    this.busy.add(identityId);
    try {
      this.options.close(identityId);
      for (const partition of item.partitions) {
        this.options.revoke(partition);
        const target = this.options.session(partition);
        await target.clearData();
        await target.clearStorageData();
        await target.clearCache();
        await target.clearAuthCache();
      }
      await this.options.dropIdentity(identityId);
      this.options.forgetAdmissions(identityId);
      const data = this.storageFile.data, dir = data.directory!;
      this.storageFile.save({ ...data, pendingPartitions: [...new Set([...data.pendingPartitions, ...item.partitions])],
        directory: { ...dir, cleanups: dir.cleanups.filter(c => c !== item && !(c.identityId === identityId && c.deletionRevision === deletionRevision)) } });
    } finally { this.busy.delete(identityId); this.changed(); this.options.directoryChanged?.(); }
  }

  reconcileHosts(hostIds: readonly string[]): void {
    const data = this.storageFile.data;
    const configured = new Set(hostIds.filter(browserIdentityHostId));
    // The built-in local host has no remove action. A temporarily absent local
    // connection still retires its guests, but must not erase its login data.
    if (data.knownHosts.includes("local")) configured.add("local");
    const next = [...configured].sort();
    const removed = data.knownHosts.filter(id => !next.includes(id));
    if (next.join() !== data.knownHosts.join()) try {
      const partitions = removed.flatMap(hostId => data.identities.map(row => browserIdentityPartition(row.id, hostId)));
      this.storageFile.save({ ...data, knownHosts: next, pendingPartitions: [...new Set([...data.pendingPartitions, ...partitions])],
        pendingHosts: [...new Set([...data.pendingHosts, ...removed])] });
    } catch { return; /* Retry persistence at the next host update. */ }
    for (const hostId of this.storageFile.data.pendingHosts) {
      if (!this.pendingHostWork.has(hostId)) void this.clearRemovedHost(hostId);
    }
  }

  private async clearRemovedHost(hostId: string): Promise<void> {
    this.pendingHostWork.add(hostId);
    try {
      for (const row of this.storageFile.data.identities) {
        const partition = browserIdentityPartition(row.id, hostId);
        this.options.close(row.id, hostId);
        this.options.revoke(partition);
        this.activeCells.delete(partition);
      }
      this.options.forgetHostAdmissions(hostId);
      await this.options.dropHost(hostId);
      const data = this.storageFile.data;
      this.storageFile.save({ ...data, pendingHosts: data.pendingHosts.filter(id => id !== hostId) });
      this.changed();
    } catch { /* Keep the pending host for retry. */ }
    finally { this.pendingHostWork.delete(hostId); }
  }
}
