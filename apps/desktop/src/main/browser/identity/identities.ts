import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Session } from "electron";
import {
  BROWSER_IDENTITY_NAME_MAX, browserIdentityPartition, DEFAULT_BROWSER_IDENTITY_ID as DEFAULT_ID, DEFAULT_BROWSER_IDENTITY_PREFS,
  isBrowserIdentityColor, isBrowserIdentityId, parseBrowserIdentityRequest,
  type BrowserClearDataRequest, type BrowserIdentityColor, type BrowserIdentityPrefs, type BrowserIdentityState,
  type BrowserIdentityStorage, type BrowserIdentityView,
} from "../../../shared/browserIdentity";
import { writeFileAtomic } from "../../fileWrites";
import type { BrowserIdentityService, EmitBrowserIdentityEvent } from "./contract";
import { browserIdentityHostId, diskEntry, parseIdentityPartition, partitionBytes, partitionDirectory, partitionInventory } from "./disk";

type Identity = Omit<BrowserIdentityView, "isDefault" | "hosts" | "openTabs">;
type Cell = { identityId: string; hostId: string };
interface IdentityFile {
  version: 1;
  current: string;
  identities: Identity[];
  prefs: BrowserIdentityPrefs;
  tombstones: { id: string; updatedAt: number; revision: number }[];
  pendingPartitions: string[];
  knownHosts: string[];
  pendingHosts: string[];
}

const MAX_IDENTITIES = 64;
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
        if (input?.version !== 1 || !Array.isArray(input.identities) || input.identities.length > MAX_IDENTITIES
          || !Array.isArray(input.tombstones) || !Array.isArray(input.pendingPartitions) || !Array.isArray(input.knownHosts)
          || input.pendingHosts !== undefined && !Array.isArray(input.pendingHosts))
          throw Error("invalid_browser_identity_storage");
        const prefs = parseBrowserIdentityRequest({ op: "prefs", patch: input.prefs });
        const ids = new Set<string>();
        const identities = input.identities.map(item => {
          if (!item || !isBrowserIdentityId(item.id) || ids.has(item.id) || typeof item.name !== "string"
            || !item.name.trim() || item.name.length > BROWSER_IDENTITY_NAME_MAX || /[\x00-\x1f\x7f]/.test(item.name)
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
  forgetAdmissions(identityId: string, hostId?: string): void;
  forgetHostAdmissions(hostId: string): void;
  reload(identityId: string, hostId: string): void;
  dropIdentity(identityId: string): Promise<void>;
  dropHost(hostId: string): Promise<void>;
  retentionChanged(): void;
  emit: EmitBrowserIdentityEvent;
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
    this.storageFile.save({ ...data, identities: [...data.identities, row] });
    this.changed();
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
    this.storageFile.save({ ...data, identities: data.identities.map(identity => identity.id === id ? row : identity) });
    this.changed();
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
    for (const { hostId } of this.cells().filter(cell => cell.identityId === id)) {
      let siteDataBytes: number | null = null, cacheBytes: number | null = null;
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
    const hosts = hostId === "all" ? this.cells().filter(cell => cell.identityId === id).map(cell => cell.hostId) : [hostId];
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
      });
      for (const partition of partitions) this.activeCells.delete(partition);
    } finally { this.busy.delete(id); this.changed(); }
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
